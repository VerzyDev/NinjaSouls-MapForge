use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ColorType, ImageEncoder};
use rayon::prelude::*;
use serde::Serialize;

use crate::formats::tibia::otb::OtbItems;
use crate::map_model::MapModel;
use crate::{MapState, MinimapPaletteState, OtbState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedFloor {
	z: u8,
	path: String,
	min_x: u16,
	min_y: u16,
	width: u32,
	height: u32,
	tile_count: u32,
}

struct FloorImage {
	min_x: u16,
	min_y: u16,
	width: u32,
	height: u32,
	rgb: Vec<u8>,
	tile_count: u32,
}

fn rgb_of(color: u8) -> [u8; 3] {
	let i = color as u32;
	[(((i / 36) % 6) * 51) as u8, (((i / 6) % 6) * 51) as u8, ((i % 6) * 51) as u8]
}

fn top_color(clients: &[u16], palette: &[u8]) -> u8 {
	for &c in clients.iter().rev() {
		let ci = c as usize;
		if ci < palette.len() && palette[ci] != 0 {
			return palette[ci];
		}
	}
	0
}

fn floor_colors(model: &MapModel, z: u8, palette: &[u8]) -> Vec<(u16, u16, u8)> {
	let mut out: Vec<(u16, u16, u8)> = Vec::new();
	let efloor = model.edits.get(&z);
	if let Some(floor) = model.floors.get(&z) {
		for (&key, &(start, end)) in floor {
			let edits_chunk = efloor.and_then(|c| c.get(&key));
			for t in start as usize..end as usize {
				let x = model.tile_x[t];
				let y = model.tile_y[t];
				let pos = ((x as u32) << 16) | y as u32;
				if edits_chunk.is_some_and(|c| c.contains_key(&pos)) {
					continue;
				}
				let s = model.item_off[t] as usize;
				let e = model.item_off[t + 1] as usize;
				let col = top_color(&model.client_ids[s..e], palette);
				if col != 0 {
					out.push((x, y, col));
				}
			}
		}
	}
	if let Some(chunks) = efloor {
		for chunk in chunks.values() {
			for (&pos, stack) in chunk {
				if stack.is_empty() {
					continue;
				}
				let clients: Vec<u16> = stack.iter().map(|&(c, _)| c).collect();
				let col = top_color(&clients, palette);
				if col != 0 {
					out.push((((pos >> 16) & 0xFFFF) as u16, (pos & 0xFFFF) as u16, col));
				}
			}
		}
	}
	out
}

fn render_floor(colors: &[(u16, u16, u8)]) -> Option<FloorImage> {
	let (mut min_x, mut min_y, mut max_x, mut max_y) = (u16::MAX, u16::MAX, 0u16, 0u16);
	for &(x, y, _) in colors {
		min_x = min_x.min(x);
		min_y = min_y.min(y);
		max_x = max_x.max(x);
		max_y = max_y.max(y);
	}
	if colors.is_empty() {
		return None;
	}
	let width = (max_x - min_x) as u32 + 1;
	let height = (max_y - min_y) as u32 + 1;
	let mut rgb = vec![0u8; (width as usize) * (height as usize) * 3];
	for &(x, y, c) in colors {
		let o = (((y - min_y) as usize) * (width as usize) + (x - min_x) as usize) * 3;
		rgb[o..o + 3].copy_from_slice(&rgb_of(c));
	}
	Some(FloorImage {
		min_x,
		min_y,
		width,
		height,
		rgb,
		tile_count: colors.len() as u32,
	})
}

fn write_png(path: &Path, img: &FloorImage) -> Result<(), String> {
	let file = File::create(path).map_err(|e| format!("Failed to create {}: {}", path.display(), e))?;
	let encoder = PngEncoder::new_with_quality(BufWriter::new(file), CompressionType::Fast, FilterType::Adaptive);
	encoder
		.write_image(&img.rgb, img.width, img.height, ColorType::Rgb8)
		.map_err(|e| format!("Failed to encode {}: {}", path.display(), e))
}

fn safe_stem(name: &str) -> String {
	let cleaned: String = name
		.chars()
		.map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
		.collect();
	let trimmed = cleaned.trim_matches('.').to_string();
	if trimmed.is_empty() {
		"minimap".to_string()
	} else {
		trimmed
	}
}

#[tauri::command]
pub fn export_minimap(
	map_id: u32,
	floors: Vec<u8>,
	dir: String,
	base_name: String,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	palette_state: tauri::State<MinimapPaletteState>,
) -> Result<Vec<ExportedFloor>, String> {
	let palette_guard = palette_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let palette: &[u8] = &palette_guard;
	if palette.is_empty() {
		return Err("minimap palette not loaded".into());
	}
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let model = guard.maps.get_mut(&map_id).ok_or("map not loaded - call open_otbm first")?;

	let mut targets: Vec<u8> = floors.into_iter().filter(|z| model.available_floors.contains(z)).collect();
	targets.sort_unstable();
	targets.dedup();
	if targets.is_empty() {
		return Err("no floors to export".into());
	}
	for &z in &targets {
		model.ensure_floor(z, otb)?;
	}

	let dir = PathBuf::from(dir);
	std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
	let stem = safe_stem(&base_name);
	let model = &*model;

	let done: Vec<Result<Option<ExportedFloor>, String>> = targets
		.par_iter()
		.map(|&z| {
			let Some(img) = render_floor(&floor_colors(model, z, palette)) else {
				return Ok(None);
			};
			let path = dir.join(format!("{}_{}.png", stem, z));
			write_png(&path, &img)?;
			Ok(Some(ExportedFloor {
				z,
				path: path.to_string_lossy().into_owned(),
				min_x: img.min_x,
				min_y: img.min_y,
				width: img.width,
				height: img.height,
				tile_count: img.tile_count,
			}))
		})
		.collect();

	let mut out: Vec<ExportedFloor> = Vec::new();
	for entry in done {
		if let Some(f) = entry? {
			out.push(f);
		}
	}
	out.sort_by_key(|f| f.z);
	Ok(out)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn render_floor_crops_to_content_bounds() {
		let colors = vec![(10u16, 20u16, 1u8), (12, 21, 215)];
		let img = render_floor(&colors).unwrap();
		assert_eq!((img.min_x, img.min_y, img.width, img.height), (10, 20, 3, 2));
		assert_eq!(&img.rgb[0..3], &rgb_of(1));
		let last = (((21 - 20) * 3 + (12 - 10)) * 3) as usize;
		assert_eq!(&img.rgb[last..last + 3], &rgb_of(215));
		assert_eq!(&img.rgb[3..6], &[0, 0, 0]);
	}

	#[test]
	fn render_floor_rejects_empty() {
		assert!(render_floor(&[]).is_none());
	}

	#[test]
	fn top_color_picks_topmost_painted_item() {
		let mut palette = vec![0u8; 300];
		palette[100] = 5;
		palette[200] = 9;
		assert_eq!(top_color(&[100, 200], &palette), 9);
		assert_eq!(top_color(&[100, 250], &palette), 5);
		assert_eq!(top_color(&[250], &palette), 0);
	}

	#[test]
	fn safe_stem_strips_path_characters() {
		assert_eq!(safe_stem("my/map:name"), "my_map_name");
		assert_eq!(safe_stem(""), "minimap");
	}
}
