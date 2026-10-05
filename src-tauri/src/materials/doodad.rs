use super::Materials;

#[derive(Clone)]
pub(crate) struct DoodadComposite {
	pub(crate) chance: i32,
	pub(crate) tiles: Vec<(i32, i32, Vec<u16>)>,
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct DoodadBrush {
	pub id: u32,
	pub name: String,
	pub(crate) singles: Vec<(u16, i32)>,
	pub(crate) composites: Vec<DoodadComposite>,
	pub(crate) thickness: (i32, i32),
	pub(crate) on_duplicate: bool,
}

impl Materials {
	pub fn doodad_brush_for(&self, server_id: u16) -> Option<u32> {
		self.server_to_doodad.get(&server_id).copied()
	}

	pub fn doodad_id_by_name(&self, name: &str) -> Option<u32> {
		if name.is_empty() {
			return None;
		}
		self.doodads.iter().find(|d| d.name == name).map(|d| d.id)
	}

	pub fn doodad_on_duplicate(&self, own: u32) -> bool {
		self.doodads
			.get(own.checked_sub(1).unwrap_or(u32::MAX) as usize)
			.is_some_and(|d| d.on_duplicate)
	}

	pub fn doodad_density(&self, own: u32) -> f32 {
		let Some(d) = self.doodads.get(own.checked_sub(1).unwrap_or(u32::MAX) as usize) else {
			return 1.0;
		};
		let (low, ceil) = d.thickness;
		if ceil <= 0 {
			return 0.0;
		}
		low as f32 / ceil as f32
	}

	pub fn doodad_placement(&self, own: u32, seed: u32) -> Vec<(i32, i32, u16)> {
		let Some(d) = self.doodads.get(own.checked_sub(1).unwrap_or(u32::MAX) as usize) else {
			return Vec::new();
		};
		let singles_total: i32 = d.singles.iter().map(|(_, c)| (*c).max(0)).sum();
		let composites_total: i32 = d.composites.iter().map(|c| c.chance.max(0)).sum();
		let total = singles_total + composites_total;
		if total <= 0 {
			return d.singles.first().map(|&(id, _)| vec![(0, 0, id)]).unwrap_or_default();
		}

		let mut roll = (seed % total as u32) as i32;
		for &(id, chance) in &d.singles {
			let chance = chance.max(0);
			if roll < chance {
				return vec![(0, 0, id)];
			}
			roll -= chance;
		}
		for comp in &d.composites {
			let chance = comp.chance.max(0);
			if roll < chance {
				return comp.tiles.iter().flat_map(|(dx, dy, items)| items.iter().map(move |&id| (*dx, *dy, id))).collect();
			}
			roll -= chance;
		}
		Vec::new()
	}
}
