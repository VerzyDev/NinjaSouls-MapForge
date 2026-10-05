use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use flate2::read::ZlibDecoder;
use mlua::{Function, LightUserData, Lua, Table};
use tauri::ipc::Response;
use tauri::State;

use crate::formats::{FormatManagerState, SpriteHeader, SpriteProvider};
use crate::lua_host::LuaState;
use crate::map_model::{
	build_map_model, serialize_meta, store_map, House, MapModel, MapSpawns, SpawnArea, SpawnCreature, Town,
};
use crate::{MapState, PlaceFlags, PlacementState};

const SPRITE_SIZE: u32 = 32;

pub struct ItemDef {
	pub name: String,
	pub group: u32,
	pub kind: u32,
	pub flags: u32,
	pub ground: bool,
	pub caps: ItemCaps,
}

#[derive(Default, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCaps {
	pub writable: bool,
	pub container: bool,
	pub teleport: bool,
	pub door: bool,
	pub depot: bool,
	pub fluid: bool,
	pub stackable: bool,
	pub pickupable: bool,
	pub max_text_len: u32,
}

impl ItemCaps {
	pub fn from_lua(def: &Table) -> Self {
		ItemCaps {
			writable: def.get("writable").unwrap_or(false),
			container: def.get("container").unwrap_or(false),
			teleport: def.get("teleport").unwrap_or(false),
			door: def.get("door").unwrap_or(false),
			depot: def.get("depot").unwrap_or(false),
			fluid: def.get("fluid").unwrap_or(false),
			stackable: def.get("stackable").unwrap_or(false),
			pickupable: def.get("pickupable").unwrap_or(false),
			max_text_len: def.get("max_text_len").unwrap_or(0),
		}
	}

	pub fn duplicable(&self) -> bool {
		self.writable || self.container || self.fluid || self.stackable || self.pickupable
	}
}

#[derive(Default)]
pub struct ItemDb {
	pub items: HashMap<u32, ItemDef>,
}

impl ItemDb {
	pub fn caps(&self, id: u32) -> ItemCaps {
		self.items.get(&id).map_or_else(ItemCaps::default, |d| d.caps)
	}
}

pub type ItemDbState = Arc<Mutex<ItemDb>>;

pub type ItemSpriteState = Arc<Mutex<HashMap<u32, u32>>>;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(untagged)]
pub enum AttrValue {
	Bool(bool),
	Num(f64),
	Str(String),
}

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThingDef {
	pub id: u32,
	pub width: u32,
	pub height: u32,
	pub layers: u32,
	pub frames: u32,
	pub pattern_x: u32,
	pub pattern_y: u32,
	pub pattern_z: u32,
	pub offset_x: u32,
	pub offset_y: u32,
	pub elevation: u32,
	pub ground_speed: u32,
	pub exact_size: u32,
	pub is_ground: bool,
	pub is_ground_border: bool,
	pub is_on_bottom: bool,
	pub is_on_top: bool,
	pub is_unpassable: bool,
	pub has_offset: bool,
	pub has_elevation: bool,
	pub sprite_index: Vec<u32>,
	pub attrs: HashMap<String, AttrValue>,
}

pub type ThingsState = Arc<Mutex<Vec<ThingDef>>>;

fn read_attrs(def: &Table) -> HashMap<String, AttrValue> {
	let mut out = HashMap::new();
	let Ok(attrs) = def.get::<Table>("attrs") else {
		return out;
	};
	for pair in attrs.pairs::<String, mlua::Value>().flatten() {
		let (k, v) = pair;
		let av = match v {
			mlua::Value::Boolean(b) => Some(AttrValue::Bool(b)),
			mlua::Value::Integer(i) => Some(AttrValue::Num(i as f64)),
			mlua::Value::Number(n) => Some(AttrValue::Num(n)),
			mlua::Value::String(s) => s.to_str().ok().map(|g| AttrValue::Str(g.to_string())),
			_ => None,
		};
		if let Some(av) = av {
			out.insert(k, av);
		}
	}
	out
}

struct Atlas {
	w: u32,
	h: u32,
	rgba: Vec<u8>,
}

struct Region {
	atlas_id: u16,
	x: u32,
	y: u32,
	w: u32,
	h: u32,
}

#[derive(Default)]
struct AssetsBuilder {
	atlases: HashMap<u16, Atlas>,
	sprites: HashMap<u32, Region>,
	item_map: HashMap<u32, u32>,
	client_map: HashMap<u16, u16>,
}

pub type ClientIdState = Arc<Mutex<HashMap<u16, u16>>>;

pub struct ScriptedSpriteProvider {
	atlases: HashMap<u16, Atlas>,
	sprites: HashMap<u32, Region>,
	sprite_size: u32,
}

fn crop(atlas: &Atlas, r: &Region, ss: u32) -> Vec<u8> {
	let mut out = vec![0u8; (ss * ss * 4) as usize];
	if r.x >= atlas.w {
		return out;
	}
	let copy_w = r.w.min(ss).min(atlas.w - r.x);
	let copy_h = r.h.min(ss);
	for row in 0..copy_h {
		let sy = r.y + row;
		if sy >= atlas.h {
			break;
		}
		let src = (((sy * atlas.w) + r.x) * 4) as usize;
		let dst = (row * ss * 4) as usize;
		out[dst..dst + (copy_w * 4) as usize].copy_from_slice(&atlas.rgba[src..src + (copy_w * 4) as usize]);
	}
	out
}

impl ScriptedSpriteProvider {
	fn pack(&self, ids: &[u32]) -> Vec<u8> {
		let ss = self.sprite_size;
		let sds = (ss * ss * 4) as usize;
		let mut buf = Vec::with_capacity(4 + ids.len() * (9 + sds));
		buf.extend_from_slice(&(ids.len() as u32).to_le_bytes());
		for &id in ids {
			buf.extend_from_slice(&id.to_le_bytes());
			let rgba = self
				.sprites
				.get(&id)
				.and_then(|r| self.atlases.get(&r.atlas_id).map(|a| crop(a, r, ss)));
			match rgba {
				Some(px) => {
					buf.push(0);
					buf.extend_from_slice(&0u32.to_le_bytes());
					buf.extend_from_slice(&px);
				}
				None => {
					buf.push(1);
					buf.extend_from_slice(&0u32.to_le_bytes());
					buf.extend_from_slice(&vec![0u8; sds]);
				}
			}
		}
		buf
	}
}

impl SpriteProvider for ScriptedSpriteProvider {
	fn sprite_size(&self) -> u32 {
		self.sprite_size
	}

	fn open(&mut self, _path: &str, _extended: bool) -> Result<SpriteHeader, String> {
		Ok(SpriteHeader {
			signature: 0,
			sprite_count: self.sprites.len() as u32,
			extended: false,
			sprite_size: self.sprite_size,
		})
	}

	fn close(&mut self, _path: &str) -> Result<(), String> {
		Ok(())
	}

	fn read_sprites_rgba(&mut self, _path: &str, ids: &[u32], _transparent: bool) -> Result<Vec<u8>, String> {
		Ok(self.pack(ids))
	}

	fn read_sprites_batch_rgba(&mut self, _path: &str, start_id: u32, count: u32, _transparent: bool) -> Result<Vec<u8>, String> {
		let ids: Vec<u32> = (start_id..start_id + count).collect();
		Ok(self.pack(&ids))
	}

	fn read_sprites_rgba_lz4(&mut self, _path: &str, ids: &[u32], _transparent: bool) -> Result<Vec<u8>, String> {
		use lz4_flex::frame::FrameEncoder;
		let raw = self.pack(ids);
		let mut enc = FrameEncoder::new(Vec::new());
		enc.write_all(&raw).map_err(|e| e.to_string())?;
		enc.finish().map_err(|e| e.to_string())
	}
}

struct TileAcc {
	x: u16,
	y: u16,
	z: u8,
	items: Vec<u16>,
	attrs: Vec<(u8, crate::formats::tibia::otbm::ItemAttrs)>,
	flags: u32,
	house: u32,
	door: u8,
}

#[derive(Default)]
struct MapBuilder {
	width: u16,
	height: u16,
	index: HashMap<(u16, u16, u8), usize>,
	tiles: Vec<TileAcc>,
	towns: Vec<Town>,
	houses: Vec<House>,
	spawns: MapSpawns,
	description: String,
}

#[derive(Default)]
struct ItemDbBuilder {
	items: HashMap<u32, ItemDef>,
}

thread_local! {
	static BUILDER: RefCell<Option<MapBuilder>> = const { RefCell::new(None) };
	static ITEMS: RefCell<Option<ItemDbBuilder>> = const { RefCell::new(None) };
	static ASSETS: RefCell<Option<AssetsBuilder>> = const { RefCell::new(None) };
	static THINGS: RefCell<Option<Vec<ThingDef>>> = const { RefCell::new(None) };
}

pub struct ScopedMapBuild;

impl ScopedMapBuild {
	fn enter() -> Self {
		BUILDER.with(|b| *b.borrow_mut() = Some(MapBuilder::default()));
		ScopedMapBuild
	}
}

impl Drop for ScopedMapBuild {
	fn drop(&mut self) {
		BUILDER.with(|b| *b.borrow_mut() = None);
	}
}

pub struct ScopedItemBuild;

impl ScopedItemBuild {
	fn enter() -> Self {
		ITEMS.with(|b| *b.borrow_mut() = Some(ItemDbBuilder::default()));
		ScopedItemBuild
	}
}

impl Drop for ScopedItemBuild {
	fn drop(&mut self) {
		ITEMS.with(|b| *b.borrow_mut() = None);
	}
}

pub struct ScopedAssetBuild;

impl ScopedAssetBuild {
	fn enter() -> Self {
		ASSETS.with(|b| *b.borrow_mut() = Some(AssetsBuilder::default()));
		ScopedAssetBuild
	}
}

impl Drop for ScopedAssetBuild {
	fn drop(&mut self) {
		ASSETS.with(|b| *b.borrow_mut() = None);
	}
}

pub struct ScopedThingsBuild;

impl ScopedThingsBuild {
	fn enter() -> Self {
		THINGS.with(|b| *b.borrow_mut() = Some(Vec::new()));
		ScopedThingsBuild
	}
}

impl Drop for ScopedThingsBuild {
	fn drop(&mut self) {
		THINGS.with(|b| *b.borrow_mut() = None);
	}
}

fn with_tile<R>(x: u16, y: u16, z: u8, f: impl FnOnce(&mut TileAcc) -> R) -> Option<R> {
	BUILDER.with(|b| {
		let mut guard = b.borrow_mut();
		let b = guard.as_mut()?;
		let idx = *b.index.entry((x, y, z)).or_insert_with(|| {
			b.tiles.push(TileAcc { x, y, z, items: Vec::new(), attrs: Vec::new(), flags: 0, house: 0, door: 0 });
			b.tiles.len() - 1
		});
		Some(f(&mut b.tiles[idx]))
	})
}

thread_local! {
	static FS_BASE: RefCell<Option<(PathBuf, String)>> = const { RefCell::new(None) };
}

pub struct ScopedFsBase;

impl ScopedFsBase {
	fn enter(path: &str) -> Self {
		let p = Path::new(path);
		let dir = p.parent().map(|d| d.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
		let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
		FS_BASE.with(|b| *b.borrow_mut() = Some((dir, name)));
		ScopedFsBase
	}
}

impl Drop for ScopedFsBase {
	fn drop(&mut self) {
		FS_BASE.with(|b| *b.borrow_mut() = None);
	}
}

fn fs_base() -> mlua::Result<(PathBuf, String)> {
	FS_BASE
		.with(|b| b.borrow().clone())
		.ok_or_else(|| mlua::Error::runtime("forge.fs is only available while a format is reading or writing"))
}

fn fs_resolve(rel: &str) -> mlua::Result<PathBuf> {
	let (base, _) = fs_base()?;
	let mut out = base;
	for part in Path::new(rel).components() {
		match part {
			std::path::Component::Normal(c) => out.push(c),
			std::path::Component::CurDir => {}
			_ => return Err(mlua::Error::runtime(format!("forge.fs: `{rel}` leaves the format folder"))),
		}
	}
	Ok(out)
}

fn register_fs(lua: &Lua, forge: &Table) -> mlua::Result<()> {
	let fs = lua.create_table()?;

	fs.set("dir", lua.create_function(|_, ()| Ok(fs_base()?.0.to_string_lossy().into_owned()))?)?;
	fs.set("name", lua.create_function(|_, ()| Ok(fs_base()?.1))?)?;

	fs.set(
		"read",
		lua.create_function(|lua, rel: String| {
			let path = fs_resolve(&rel)?;
			match std::fs::read(&path) {
				Ok(bytes) => Ok(Some(lua.create_string(&bytes)?)),
				Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
				Err(e) => Err(mlua::Error::runtime(format!("forge.fs.read {rel}: {e}"))),
			}
		})?,
	)?;

	fs.set(
		"write",
		lua.create_function(|_, (rel, data): (String, mlua::String)| {
			let path = fs_resolve(&rel)?;
			if let Some(parent) = path.parent() {
				std::fs::create_dir_all(parent)
					.map_err(|e| mlua::Error::runtime(format!("forge.fs.write {rel}: {e}")))?;
			}
			std::fs::write(&path, data.as_bytes())
				.map_err(|e| mlua::Error::runtime(format!("forge.fs.write {rel}: {e}")))
		})?,
	)?;

	fs.set(
		"list",
		lua.create_function(|_, rel: Option<String>| {
			let path = fs_resolve(rel.as_deref().unwrap_or(""))?;
			let mut names: Vec<String> = match std::fs::read_dir(&path) {
				Ok(entries) => entries.flatten().filter_map(|e| e.file_name().into_string().ok()).collect(),
				Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
				Err(e) => return Err(mlua::Error::runtime(format!("forge.fs.list: {e}"))),
			};
			names.sort();
			Ok(names)
		})?,
	)?;

	fs.set("exists", lua.create_function(|_, rel: String| Ok(fs_resolve(&rel)?.exists()))?)?;

	fs.set(
		"remove",
		lua.create_function(|_, rel: String| {
			let path = fs_resolve(&rel)?;
			match std::fs::remove_file(&path) {
				Ok(()) => Ok(()),
				Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
				Err(e) => Err(mlua::Error::runtime(format!("forge.fs.remove {rel}: {e}"))),
			}
		})?,
	)?;

	fs.set(
		"rename",
		lua.create_function(|_, (from, to): (String, String)| {
			let from_path = fs_resolve(&from)?;
			let to_path = fs_resolve(&to)?;
			if let Some(parent) = to_path.parent() {
				std::fs::create_dir_all(parent)
					.map_err(|e| mlua::Error::runtime(format!("forge.fs.rename {to}: {e}")))?;
			}
			std::fs::rename(&from_path, &to_path)
				.map_err(|e| mlua::Error::runtime(format!("forge.fs.rename {from} -> {to}: {e}")))
		})?,
	)?;

	forge.set("fs", fs)
}

pub fn register(lua: &Lua) -> mlua::Result<()> {
	let forge: Table = lua.globals().get("forge")?;
	forge.set("_formats", lua.create_table()?)?;
	register_fs(lua, &forge)?;

	let map = lua.create_table()?;
	map.set("chunk_size", crate::map_model::CHUNK)?;
	map.set(
		"begin",
		lua.create_function(|_, (w, h, _floors): (u16, u16, Option<u16>)| {
			BUILDER.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.width = w;
					b.height = h;
				}
			});
			Ok(())
		})?,
	)?;
	map.set(
		"set_ground",
		lua.create_function(|_, (x, y, z, id, attrs): (u16, u16, u8, u16, Option<Table>)| {
			let parsed = attrs.as_ref().map(item_attrs_from_lua).filter(|a| !a.is_default());
			with_tile(x, y, z, |t| {
				t.items.insert(0, id);
				for a in t.attrs.iter_mut() {
					a.0 += 1;
				}
				if let Some(a) = parsed {
					t.attrs.push((0, a));
				}
			});
			Ok(())
		})?,
	)?;
	map.set(
		"add_item",
		lua.create_function(|_, (x, y, z, id, attrs): (u16, u16, u8, u16, Option<Table>)| {
			let parsed = attrs.as_ref().map(item_attrs_from_lua).filter(|a| !a.is_default());
			with_tile(x, y, z, |t| {
				t.items.push(id);
				if let Some(a) = parsed {
					let idx = (t.items.len() - 1) as u8;
					t.attrs.push((idx, a));
				}
			});
			Ok(())
		})?,
	)?;
	map.set(
		"set_flags",
		lua.create_function(|_, (x, y, z, flags, house, door): (u16, u16, u8, u32, u32, u8)| {
			with_tile(x, y, z, |t| {
				t.flags = flags;
				t.house = house;
				t.door = door;
			});
			Ok(())
		})?,
	)?;
	map.set(
		"add_town",
		lua.create_function(|_, (id, name, x, y, z): (u32, String, u16, u16, u8)| {
			BUILDER.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.towns.push(Town { id, name, x, y, z });
				}
			});
			Ok(())
		})?,
	)?;
	map.set(
		"add_house",
		lua.create_function(|_, def: Table| {
			let house = House {
				id: def.get("id").unwrap_or(0),
				name: def.get("name").unwrap_or_default(),
				town_id: def.get("town_id").unwrap_or(0),
				rent: def.get("rent").unwrap_or(0),
				guildhall: def.get("guildhall").unwrap_or(false),
				entry_x: def.get("entry_x").unwrap_or(0),
				entry_y: def.get("entry_y").unwrap_or(0),
				entry_z: def.get("entry_z").unwrap_or(0),
			};
			BUILDER.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.houses.push(house);
				}
			});
			Ok(())
		})?,
	)?;
	map.set(
		"add_spawn",
		lua.create_function(|_, (x, y, z, radius): (u16, u16, u8, u16)| {
			BUILDER.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.spawns.areas.push(SpawnArea { x, y, z, radius });
				}
			});
			Ok(())
		})?,
	)?;
	map.set(
		"add_creature",
		lua.create_function(|_, def: Table| {
			let creature = SpawnCreature {
				name: def.get("name").unwrap_or_default(),
				x: def.get("x").unwrap_or(0),
				y: def.get("y").unwrap_or(0),
				z: def.get("z").unwrap_or(0),
				is_npc: def.get("npc").unwrap_or(false),
				spawntime: def.get("spawntime").unwrap_or(60),
				direction: def.get("direction").unwrap_or(2),
			};
			BUILDER.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.spawns.creatures.push(creature);
				}
			});
			Ok(())
		})?,
	)?;
	map.set(
		"set_description",
		lua.create_function(|_, text: String| {
			BUILDER.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.description = text;
				}
			});
			Ok(())
		})?,
	)?;
	map.set("finish", lua.create_function(|_, ()| Ok(()))?)?;
	forge.set("map", map)?;

	let items = lua.create_table()?;
	items.set(
		"begin",
		lua.create_function(|_, ()| {
			ITEMS.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.items.clear();
				}
			});
			Ok(())
		})?,
	)?;
	items.set(
		"add",
		lua.create_function(|_, (id, def): (u32, Table)| {
			let d = ItemDef {
				name: def.get("name").unwrap_or_default(),
				group: def.get("group").unwrap_or(0),
				kind: def.get("kind").unwrap_or(0),
				flags: def.get("flags").unwrap_or(0),
				ground: def.get("ground").unwrap_or(false),
				caps: ItemCaps::from_lua(&def),
			};
			ITEMS.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.items.insert(id, d);
				}
			});
			Ok(())
		})?,
	)?;
	items.set("finish", lua.create_function(|_, ()| Ok(()))?)?;
	forge.set("items", items)?;

	let sprites = lua.create_table()?;
	sprites.set(
		"begin",
		lua.create_function(|_, ()| {
			ASSETS.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.atlases.clear();
					b.sprites.clear();
					b.item_map.clear();
					b.client_map.clear();
				}
			});
			Ok(())
		})?,
	)?;
	sprites.set(
		"map_client",
		lua.create_function(|_, (server_id, client_id): (u16, u16)| {
			ASSETS.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.client_map.insert(server_id, client_id);
				}
			});
			Ok(())
		})?,
	)?;
	sprites.set(
		"set_atlas",
		lua.create_function(|_, (atlas_id, w, h, format, data): (u16, u32, u32, u8, mlua::String)| {
			let comp = data.as_bytes();
			let mut raw = Vec::new();
			ZlibDecoder::new(&comp[..]).read_to_end(&mut raw).map_err(mlua::Error::external)?;
			let rgba = match format {
				0 => raw,
				1 => {
					let mut o = Vec::with_capacity((w * h * 4) as usize);
					for px in raw.chunks_exact(3) {
						o.extend_from_slice(&[px[0], px[1], px[2], 255]);
					}
					o
				}
				_ => return Err(mlua::Error::external(format!("unknown atlas format {}", format))),
			};
			ASSETS.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.atlases.insert(atlas_id, Atlas { w, h, rgba });
				}
			});
			Ok(())
		})?,
	)?;
	sprites.set(
		"set_sprite",
		lua.create_function(|_, (sprite_id, atlas_id, x, y, w, h): (u32, u16, u16, u16, u16, u16)| {
			ASSETS.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.sprites.insert(
						sprite_id,
						Region { atlas_id, x: x as u32, y: y as u32, w: w as u32, h: h as u32 },
					);
				}
			});
			Ok(())
		})?,
	)?;
	sprites.set(
		"map_item",
		lua.create_function(|_, (item_id, sprite_id): (u32, u32)| {
			ASSETS.with(|b| {
				if let Some(b) = b.borrow_mut().as_mut() {
					b.item_map.insert(item_id, sprite_id);
				}
			});
			Ok(())
		})?,
	)?;
	sprites.set("finish", lua.create_function(|_, ()| Ok(()))?)?;
	forge.set("sprites", sprites)?;

	let things = lua.create_table()?;
	things.set(
		"begin",
		lua.create_function(|_, ()| {
			THINGS.with(|b| {
				if let Some(v) = b.borrow_mut().as_mut() {
					v.clear();
				}
			});
			Ok(())
		})?,
	)?;
	things.set(
		"add",
		lua.create_function(|_, def: Table| {
			let attrs = read_attrs(&def);
			let flag = |key: &str| match def.get::<mlua::Value>(key) {
				Ok(mlua::Value::Boolean(b)) => b,
				_ => matches!(attrs.get(key), Some(AttrValue::Bool(true))),
			};
			let t = ThingDef {
				id: def.get("id").unwrap_or(0),
				width: def.get("width").unwrap_or(0),
				height: def.get("height").unwrap_or(0),
				layers: def.get("layers").unwrap_or(0),
				frames: def.get("frames").unwrap_or(0),
				pattern_x: def.get("pattern_x").unwrap_or(0),
				pattern_y: def.get("pattern_y").unwrap_or(0),
				pattern_z: def.get("pattern_z").unwrap_or(0),
				offset_x: def.get("offset_x").unwrap_or(0),
				offset_y: def.get("offset_y").unwrap_or(0),
				elevation: def.get("elevation").unwrap_or(0),
				ground_speed: def.get("ground_speed").unwrap_or(0),
				exact_size: def.get("exact_size").unwrap_or(0),
				is_ground: flag("is_ground"),
				is_ground_border: flag("is_ground_border"),
				is_on_bottom: flag("is_on_bottom"),
				is_on_top: flag("is_on_top"),
				is_unpassable: flag("is_unpassable"),
				has_offset: flag("has_offset"),
				has_elevation: flag("has_elevation"),
				sprite_index: def.get("sprite_index").unwrap_or_default(),
				attrs,
			};
			THINGS.with(|b| {
				if let Some(v) = b.borrow_mut().as_mut() {
					v.push(t);
				}
			});
			Ok(())
		})?,
	)?;
	things.set("finish", lua.create_function(|_, ()| Ok(()))?)?;
	forge.set("things", things)?;

	forge.set(
		"inflate",
		lua.create_function(|lua, (data, orig_len): (mlua::String, usize)| {
			let comp = data.as_bytes();
			let mut out = Vec::with_capacity(orig_len);
			ZlibDecoder::new(&comp[..]).read_to_end(&mut out).map_err(mlua::Error::external)?;
			lua.create_string(&out)
		})?,
	)?;

	forge.set(
		"deflate",
		lua.create_function(|lua, data: mlua::String| {
			use flate2::write::ZlibEncoder;
			use flate2::Compression;
			let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
			e.write_all(&data.as_bytes()).map_err(mlua::Error::external)?;
			let out = e.finish().map_err(mlua::Error::external)?;
			lua.create_string(&out)
		})?,
	)?;

	forge.set(
		"register_format",
		lua.create_function(|lua, t: Table| {
			let ext: String = t.get("ext")?;
			let forge: Table = lua.globals().get("forge")?;
			let formats: Table = forge.get("_formats")?;
			formats.set(ext.to_lowercase(), t)?;
			Ok(())
		})?,
	)?;
	Ok(())
}

fn take_built() -> Result<MapModel, String> {
	let b = BUILDER.with(|b| b.borrow_mut().take()).ok_or("begin() was not called")?;
	let mut xs = Vec::with_capacity(b.tiles.len());
	let mut ys = Vec::with_capacity(b.tiles.len());
	let mut zs = Vec::with_capacity(b.tiles.len());
	let mut item_start = Vec::with_capacity(b.tiles.len());
	let mut item_count = Vec::with_capacity(b.tiles.len());
	let mut ids = Vec::new();
	let mut subtypes = Vec::new();
	let mut flags = Vec::with_capacity(b.tiles.len());
	let mut house_ids = Vec::with_capacity(b.tiles.len());
	let mut door_ids = Vec::with_capacity(b.tiles.len());
	let mut item_attrs: HashMap<u64, crate::formats::tibia::otbm::ItemAttrs> = HashMap::new();
	for t in &b.tiles {
		let start = ids.len() as u32;
		for &id in &t.items {
			ids.push(id);
			subtypes.push(0u8);
		}
		for (idx, a) in &t.attrs {
			if (*idx as usize) < t.items.len() {
				subtypes[start as usize + *idx as usize] = a.subtype;
			}
			item_attrs.insert(crate::formats::tibia::otbm::attrs_key(t.z, t.x, t.y, *idx), a.clone());
		}
		xs.push(t.x);
		ys.push(t.y);
		zs.push(t.z);
		item_start.push(start);
		item_count.push(t.items.len() as u16);
		flags.push(t.flags);
		house_ids.push(t.house);
		door_ids.push(t.door);
	}
	let mut model = build_map_model(
		b.width, b.height, &xs, &ys, &zs, &item_start, &item_count, &ids, &ids, &subtypes, &flags, &house_ids, &door_ids,
		Vec::new(), 0,
	);
	model.item_attrs = item_attrs;
	model.towns = b.towns;
	model.houses = b.houses;
	model.spawns = b.spawns;
	model.description = b.description;
	Ok(model)
}

fn take_itemdb() -> Result<ItemDb, String> {
	let b = ITEMS.with(|b| b.borrow_mut().take()).ok_or("items.begin() was not called")?;
	Ok(ItemDb { items: b.items })
}

fn take_assets() -> Result<(ScriptedSpriteProvider, HashMap<u32, u32>, HashMap<u16, u16>), String> {
	let b = ASSETS.with(|b| b.borrow_mut().take()).ok_or("sprites.begin() was not called")?;
	let provider = ScriptedSpriteProvider {
		atlases: b.atlases,
		sprites: b.sprites,
		sprite_size: SPRITE_SIZE,
	};
	Ok((provider, b.item_map, b.client_map))
}

fn take_things() -> Vec<ThingDef> {
	THINGS.with(|b| b.borrow_mut().take()).unwrap_or_default()
}

fn ext_of(path: &str) -> String {
	Path::new(path)
		.extension()
		.and_then(|e| e.to_str())
		.unwrap_or_default()
		.to_lowercase()
}

fn format_read(lua: &Lua, ext: &str) -> Result<Function, String> {
	let forge: Table = lua.globals().get("forge").map_err(|e| e.to_string())?;
	let formats: Table = forge.get("_formats").map_err(|e| e.to_string())?;
	let fmt: Table = formats.get(ext.to_string()).map_err(|_| format!("no registered format for .{}", ext))?;
	fmt.get("read").map_err(|_| format!("format .{} has no read function", ext))
}

fn call_read(read: &Function, bytes: &[u8]) -> Result<(), String> {
	let buf = LightUserData(bytes.as_ptr() as *mut c_void);
	read.call::<()>((buf, bytes.len())).map_err(|e| format!("lua read error: {}", e))
}

fn format_write(lua: &Lua, ext: &str) -> Result<Function, String> {
	let forge: Table = lua.globals().get("forge").map_err(|e| e.to_string())?;
	let formats: Table = forge.get("_formats").map_err(|e| e.to_string())?;
	let fmt: Table = formats.get(ext.to_string()).map_err(|_| format!("no registered format for .{}", ext))?;
	fmt.get("write").map_err(|_| format!("format .{} has no write function", ext))
}

#[tauri::command]
pub fn save_scripted_map(map_id: u32, path: String, map_state: State<MapState>, lua_state: State<LuaState>) -> Result<(), String> {
	let ext = ext_of(&path);
	let lua_guard = lua_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let lua = &lua_guard.lua;
	let write = format_write(lua, &ext)?;

	let guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let model = guard.maps.get(&map_id).ok_or("map not loaded")?;

	write_scripted_map(lua, &write, model, &path, &ext)
}

fn write_scripted_map(lua: &Lua, write: &Function, model: &MapModel, path: &str, ext: &str) -> Result<(), String> {
	let _fs = ScopedFsBase::enter(path);

	let written = lua
		.scope(|scope| {
			let map_tbl = lua.create_table()?;
			map_tbl.set("width", model.width)?;
			map_tbl.set("height", model.height)?;
			map_tbl.set("description", model.description.as_str())?;
			let towns = lua.create_table_with_capacity(model.towns.len(), 0)?;
			for (i, t) in model.towns.iter().enumerate() {
				let tt = lua.create_table()?;
				tt.set("id", t.id)?;
				tt.set("name", t.name.as_str())?;
				tt.set("x", t.x)?;
				tt.set("y", t.y)?;
				tt.set("z", t.z)?;
				towns.set(i + 1, tt)?;
			}
			map_tbl.set("towns", towns)?;

			let houses = lua.create_table_with_capacity(model.houses.len(), 0)?;
			for (i, h) in model.houses.iter().enumerate() {
				let ht = lua.create_table()?;
				ht.set("id", h.id)?;
				ht.set("name", h.name.as_str())?;
				ht.set("town_id", h.town_id)?;
				ht.set("rent", h.rent)?;
				ht.set("guildhall", h.guildhall)?;
				ht.set("entry_x", h.entry_x)?;
				ht.set("entry_y", h.entry_y)?;
				ht.set("entry_z", h.entry_z)?;
				houses.set(i + 1, ht)?;
			}
			map_tbl.set("houses", houses)?;

			let areas = lua.create_table_with_capacity(model.spawns.areas.len(), 0)?;
			for (i, a) in model.spawns.areas.iter().enumerate() {
				let at = lua.create_table()?;
				at.set("x", a.x)?;
				at.set("y", a.y)?;
				at.set("z", a.z)?;
				at.set("radius", a.radius)?;
				areas.set(i + 1, at)?;
			}
			let creatures = lua.create_table_with_capacity(model.spawns.creatures.len(), 0)?;
			for (i, c) in model.spawns.creatures.iter().enumerate() {
				let ct = lua.create_table()?;
				ct.set("name", c.name.as_str())?;
				ct.set("x", c.x)?;
				ct.set("y", c.y)?;
				ct.set("z", c.z)?;
				ct.set("npc", c.is_npc)?;
				ct.set("spawntime", c.spawntime)?;
				ct.set("direction", c.direction)?;
				creatures.set(i + 1, ct)?;
			}
			let spawns = lua.create_table()?;
			spawns.set("areas", areas)?;
			spawns.set("creatures", creatures)?;
			map_tbl.set("spawns", spawns)?;

			let meta = lua.create_table()?;
			meta.set(
				"__index",
				scope.create_function(move |lua, (_t, key): (Table, String)| {
					if key != "tiles" {
						return Ok(mlua::Value::Nil);
					}
					let tiles = crate::map_save::export_tiles(model);
					Ok(mlua::Value::Table(tiles_table(lua, model, &tiles)?))
				})?,
			)?;
			map_tbl.set_metatable(Some(meta));

			let forge: Table = lua.globals().get("forge")?;
			let map_api: Table = forge.get("map")?;
			map_api.set(
				"chunks",
				scope.create_function(move |lua, ()| {
					let list = crate::map_save::list_chunks(model);
					let out = lua.create_table_with_capacity(list.len(), 0)?;
					for (i, (z, cx, cy)) in list.into_iter().enumerate() {
						let t = lua.create_table()?;
						t.set("z", z)?;
						t.set("cx", cx)?;
						t.set("cy", cy)?;
						out.set(i + 1, t)?;
					}
					Ok(out)
				})?,
			)?;
			map_api.set(
				"chunk_tiles",
				scope.create_function(move |lua, (z, cx, cy): (u8, u16, u16)| {
					let tiles = crate::map_save::export_chunk_tiles(model, z, cx, cy);
					tiles_table(lua, model, &tiles)
				})?,
			)?;

			let out = write.call::<mlua::Value>(map_tbl);

			map_api.set("chunks", mlua::Value::Nil)?;
			map_api.set("chunk_tiles", mlua::Value::Nil)?;
			out
		})
		.map_err(|e| format!("lua write error: {}", e))?;

	match written {
		mlua::Value::Nil => Ok(()),
		mlua::Value::String(bytes) => std::fs::write(&path, bytes.as_bytes())
			.map_err(|e| format!("Failed to write {}: {}", path, e)),
		other => Err(format!("format .{} write returned {}, expected a string or nothing", ext, other.type_name())),
	}
}

fn item_attrs_from_lua(t: &Table) -> crate::formats::tibia::otbm::ItemAttrs {
	crate::formats::tibia::otbm::ItemAttrs {
		action_id: t.get("action_id").unwrap_or(0),
		unique_id: t.get("unique_id").unwrap_or(0),
		text: t.get("text").unwrap_or_default(),
		desc: t.get("desc").unwrap_or_default(),
		charges: t.get("charges").unwrap_or(0),
		tier: t.get("tier").unwrap_or(0),
		depot_id: t.get("depot_id").unwrap_or(0),
		subtype: t.get("subtype").unwrap_or(0),
		has_contents: false,
		tele_x: t.get("tele_x").unwrap_or(0),
		tele_y: t.get("tele_y").unwrap_or(0),
		tele_z: t.get("tele_z").unwrap_or(0),
	}
}

fn attrs_table(lua: &Lua, a: &crate::formats::tibia::otbm::ItemAttrs) -> mlua::Result<Table> {
	let t = lua.create_table()?;
	t.set("action_id", a.action_id)?;
	t.set("unique_id", a.unique_id)?;
	t.set("text", a.text.as_str())?;
	t.set("desc", a.desc.as_str())?;
	t.set("charges", a.charges)?;
	t.set("tier", a.tier)?;
	t.set("depot_id", a.depot_id)?;
	t.set("subtype", a.subtype)?;
	t.set("tele_x", a.tele_x)?;
	t.set("tele_y", a.tele_y)?;
	t.set("tele_z", a.tele_z)?;
	Ok(t)
}

fn tiles_table(lua: &Lua, model: &MapModel, tiles: &[crate::map_save::ExportTile]) -> mlua::Result<Table> {
	let out = lua.create_table_with_capacity(tiles.len(), 0)?;
	for (i, t) in tiles.iter().enumerate() {
		let tt = lua.create_table()?;
		tt.set("x", t.x)?;
		tt.set("y", t.y)?;
		tt.set("z", t.z)?;
		tt.set("flags", t.flags)?;
		tt.set("house", t.house)?;
		tt.set("door", t.door)?;
		let items = lua.create_table_with_capacity(t.items.len(), 0)?;
		let attrs = lua.create_table()?;
		for (k, &id) in t.items.iter().enumerate() {
			items.set(k + 1, id)?;
			let key = crate::formats::tibia::otbm::attrs_key(t.z, t.x, t.y, k as u8);
			match model.item_attrs.get(&key) {
				Some(a) if !a.is_default() => attrs.set(k + 1, attrs_table(lua, a)?)?,
				_ => {}
			}
		}
		tt.set("items", items)?;
		tt.set("item_attrs", attrs)?;
		out.set(i + 1, tt)?;
	}
	Ok(out)
}

fn formats_of(lua: &Lua) -> Result<Vec<(String, String, String)>, String> {
	let forge: Table = lua.globals().get("forge").map_err(|e| e.to_string())?;
	let formats: Table = forge.get("_formats").map_err(|e| e.to_string())?;
	let mut out = Vec::new();
	for pair in formats.pairs::<String, Table>() {
		let (ext, t) = pair.map_err(|e| e.to_string())?;
		let name: String = t.get("name").unwrap_or_else(|_| ext.clone());
		let kind: String = t.get("kind").unwrap_or_else(|_| "map".to_string());
		out.push((ext, name, kind));
	}
	Ok(out)
}

pub fn itemdb_extensions(lua: &Lua) -> Vec<String> {
	formats_of(lua)
		.unwrap_or_default()
		.into_iter()
		.filter(|(_, _, kind)| kind == "itemdb")
		.map(|(ext, _, _)| ext.to_ascii_lowercase())
		.collect()
}

#[tauri::command]
pub fn registered_formats(lua_state: State<LuaState>) -> Result<Vec<(String, String, String)>, String> {
	let guard = lua_state.lock().map_err(|e| e.to_string())?;
	formats_of(&guard.lua)
}

#[tauri::command]
pub fn open_scripted_map(path: String, map_state: State<MapState>, lua_state: State<LuaState>) -> Result<Response, String> {
	let ext = ext_of(&path);
	let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;

	let lua_guard = lua_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let read = format_read(&lua_guard.lua, &ext)?;

	let model = {
		let _scope = ScopedMapBuild::enter();
		let _fs = ScopedFsBase::enter(&path);
		call_read(&read, &bytes)?;
		let mut model = take_built()?;
		model.source_path = Some(PathBuf::from(&path));
		model
	};

	let meta = serialize_meta(&model);
	let mut mguard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	Ok(Response::new(store_map(&mut mguard, model, meta)))
}

#[tauri::command]
pub fn load_scripted_itemdb(path: String, itemdb_state: State<ItemDbState>, lua_state: State<LuaState>) -> Result<usize, String> {
	let ext = ext_of(&path);
	let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;

	let lua_guard = lua_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let read = format_read(&lua_guard.lua, &ext)?;

	let db = {
		let _scope = ScopedItemBuild::enter();
		call_read(&read, &bytes)?;
		take_itemdb()?
	};

	let count = db.items.len();
	*itemdb_state.lock().map_err(|e| format!("Lock error: {}", e))? = db;
	Ok(count)
}

#[tauri::command]
pub fn load_scripted_assets(
	path: String,
	fm: State<FormatManagerState>,
	item_sprite_state: State<ItemSpriteState>,
	things_state: State<ThingsState>,
	client_id_state: State<ClientIdState>,
	placement_state: State<PlacementState>,
	itemdb_state: State<ItemDbState>,
	lua_state: State<LuaState>,
) -> Result<usize, String> {
	let ext = ext_of(&path);
	let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;

	let lua_guard = lua_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let read = format_read(&lua_guard.lua, &ext)?;

	let (provider, item_map, client_map, things) = {
		let _assets = ScopedAssetBuild::enter();
		let _things = ScopedThingsBuild::enter();
		call_read(&read, &bytes)?;
		let (provider, item_map, client_map) = take_assets()?;
		(provider, item_map, client_map, take_things())
	};

	let db = itemdb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mut placement: HashMap<u16, PlaceFlags> = HashMap::with_capacity(things.len());
	for t in &things {
		if let Ok(cid) = u16::try_from(t.id) {
			let top_order = if t.is_on_top { 3 } else if t.is_on_bottom { 1 } else { 0 };
			let duplicable = db.caps(t.id).duplicable();
			placement.insert(cid, PlaceFlags { ground: t.is_ground, top_order, blocking: t.is_unpassable, duplicable });
		}
	}
	drop(db);

	let count = provider.sprites.len();
	fm.lock().map_err(|e| format!("Lock error: {}", e))?.set_sprite(Box::new(provider));
	*item_sprite_state.lock().map_err(|e| format!("Lock error: {}", e))? = item_map;
	*things_state.lock().map_err(|e| format!("Lock error: {}", e))? = things;
	*client_id_state.lock().map_err(|e| format!("Lock error: {}", e))? = client_map;
	*placement_state.lock().map_err(|e| format!("Lock error: {}", e))? = placement;
	Ok(count)
}

#[tauri::command]
pub fn scripted_things(things_state: State<ThingsState>) -> Result<Vec<ThingDef>, String> {
	Ok(things_state.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn item_sprite(item_id: u32, item_sprite_state: State<ItemSpriteState>) -> Result<Option<u32>, String> {
	Ok(item_sprite_state.lock().map_err(|e| e.to_string())?.get(&item_id).copied())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiAssets {
	pub ext: String,
	pub label: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiConfig {
	pub client_versions: bool,
	pub assets: Option<UiAssets>,
}

fn read_ui_config(lua: &Lua) -> UiConfig {
	let mut cfg = UiConfig { client_versions: true, assets: None };
	let Ok(forge) = lua.globals().get::<Table>("forge") else {
		return cfg;
	};
	let Ok(ui) = forge.get::<Table>("ui") else {
		return cfg;
	};
	if let Ok(cv) = ui.get::<bool>("client_versions") {
		cfg.client_versions = cv;
	}
	if let Ok(a) = ui.get::<Table>("assets") {
		cfg.assets = Some(UiAssets { ext: a.get("ext").unwrap_or_default(), label: a.get("label").unwrap_or_default() });
	}
	cfg
}

#[tauri::command]
pub fn ui_config(lua_state: State<LuaState>) -> Result<UiConfig, String> {
	let guard = lua_state.lock().map_err(|e| e.to_string())?;
	Ok(read_ui_config(&guard.lua))
}

#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
	pub name: Option<String>,
	pub floor_offset: Option<FloorOffset>,
}

#[derive(serde::Serialize)]
pub struct FloorOffset {
	pub x: f64,
	pub y: f64,
}

fn read_app_config(lua: &Lua) -> AppConfig {
	let mut cfg = AppConfig::default();
	let Ok(forge) = lua.globals().get::<Table>("forge") else {
		return cfg;
	};
	let Ok(app) = forge.get::<Table>("app") else {
		return cfg;
	};
	if let Ok(name) = app.get::<String>("name") {
		if !name.is_empty() {
			cfg.name = Some(name);
		}
	}
	if let Ok(offset) = app.get::<f64>("floor_offset") {
		cfg.floor_offset = Some(FloorOffset {
			x: offset,
			y: offset,
		});
	} else if let Ok(table) = app.get::<Table>("floor_offset") {
		cfg.floor_offset = Some(FloorOffset {
			x: table.get::<f64>("x").unwrap_or(0.0),
			y: table.get::<f64>("y").unwrap_or(0.0),
		});
	}
	cfg
}

pub fn lua_app_config(lua_state: &LuaState) -> AppConfig {
	match lua_state.lock() {
		Ok(guard) => read_app_config(&guard.lua),
		Err(_) => AppConfig::default(),
	}
}

#[tauri::command]
pub fn app_config(lua_state: State<LuaState>) -> Result<AppConfig, String> {
	Ok(lua_app_config(&lua_state))
}

#[tauri::command]
pub fn container_ids(itemdb_state: State<ItemDbState>) -> Result<Vec<u32>, String> {
	let db = itemdb_state.lock().map_err(|e| e.to_string())?;
	Ok(db.items.iter().filter(|(_, d)| d.caps.container).map(|(id, _)| *id).collect())
}

#[tauri::command]
pub fn item_name(id: u32, itemdb_state: State<ItemDbState>) -> Result<Option<String>, String> {
	let db = itemdb_state.lock().map_err(|e| e.to_string())?;
	Ok(db.items.get(&id).map(|d| d.name.clone()))
}

#[tauri::command]
pub fn item_names(itemdb_state: State<ItemDbState>) -> Result<Vec<(u32, String)>, String> {
	let db = itemdb_state.lock().map_err(|e| e.to_string())?;
	Ok(db
		.items
		.iter()
		.filter(|(_, d)| !d.name.is_empty())
		.map(|(&id, d)| (id, d.name.clone()))
		.collect())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::lua_host::LuaHost;

	fn host_with(src: &str) -> LuaHost {
		let host = LuaHost::new(PathBuf::from("."));
		host.lua.load("forge = {}").exec().unwrap();
		register(&host.lua).unwrap();
		host.lua.load(src).exec().unwrap();
		host
	}

	fn model_with_two_tiles(host: &LuaHost) -> MapModel {
		host.lua
			.load(
				"forge.register_format{ ext='m', name='M', read=function(buf, len)
				   forge.map.begin(256, 256, 16)
				   forge.map.set_ground(10, 10, 7, 100)
				   forge.map.set_ground(100, 100, 7, 200)
				   forge.map.finish()
				 end }",
			)
			.exec()
			.unwrap();
		let read = format_read(&host.lua, "m").unwrap();
		let _scope = ScopedMapBuild::enter();
		call_read(&read, &[0u8]).unwrap();
		take_built().unwrap()
	}

	#[test]
	fn item_attrs_survive_a_read_write_round_trip() {
		let dir = temp_dir("attrs");
		let host = host_with(
			"forge.register_format{ ext='a', name='A', read=function()
			     forge.map.begin(64, 64, 16)
			     forge.map.set_ground(5, 6, 7, 100)
			     forge.map.add_item(5, 6, 7, 300, { text='hello sign', action_id=42, subtype=3 })
			     forge.map.finish()
			   end,
			   write=function(m)
			     local t = m.tiles[1]
			     local a = t.item_attrs[2]
			     return a.text .. '|' .. a.action_id .. '|' .. a.subtype .. '|' .. #t.items
			   end }",
		);
		let read = format_read(&host.lua, "a").unwrap();
		let model = {
			let _scope = ScopedMapBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_built().unwrap()
		};

		let key = crate::formats::tibia::otbm::attrs_key(7, 5, 6, 1);
		assert_eq!(model.item_attrs.get(&key).map(|a| a.text.as_str()), Some("hello sign"));

		let write = format_write(&host.lua, "a").unwrap();
		let path = dir.join("world.a");
		write_scripted_map(&host.lua, &write, &model, path.to_str().unwrap(), "a").unwrap();
		assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello sign|42|3|2");
	}

	#[test]
	fn single_file_format_still_returns_bytes_for_the_host_to_write() {
		let dir = temp_dir("single");
		let host = host_with(
			"forge.register_format{ ext='t', name='T', read=function() end,
			   write=function(m)
			     return 'W' .. m.width .. ':' .. #m.tiles
			   end }",
		);
		let model = model_with_two_tiles(&host);
		let write = format_write(&host.lua, "t").unwrap();
		let path = dir.join("world.t");

		write_scripted_map(&host.lua, &write, &model, path.to_str().unwrap(), "t").unwrap();

		assert_eq!(
			std::fs::read_to_string(&path).unwrap(),
			"W256:2",
			"a format returning a string is written by the host, and m.tiles still holds every tile"
		);
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn chunk_wise_format_never_materialises_the_whole_map() {
		let dir = temp_dir("chunkwise");
		let host = host_with(
			"touched = 0
			 forge.register_format{ ext='t', name='T', read=function() end,
			   write=function(m)
			     for _, c in ipairs(forge.map.chunks()) do
			       local tiles = forge.map.chunk_tiles(c.z, c.cx, c.cy)
			       touched = touched + #tiles
			       forge.fs.write('chunks/' .. c.z .. '/' .. c.cx .. '_' .. c.cy .. '.bin', tostring(#tiles))
			     end
			   end }",
		);
		let model = model_with_two_tiles(&host);
		let write = format_write(&host.lua, "t").unwrap();
		let path = dir.join("world.t");

		write_scripted_map(&host.lua, &write, &model, path.to_str().unwrap(), "t").unwrap();

		assert!(!path.exists(), "the host writes nothing when the format returns nothing");
		assert_eq!(std::fs::read_to_string(dir.join("chunks/7/0_0.bin")).unwrap(), "1");
		assert_eq!(std::fs::read_to_string(dir.join("chunks/7/3_3.bin")).unwrap(), "1");

		let touched: u32 = host.lua.globals().get("touched").unwrap();
		assert_eq!(touched, 2, "every tile reached the script, one chunk at a time");
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn chunk_query_returns_only_that_chunk() {
		let host = host_with(
			"forge.register_format{ ext='t', name='T', read=function(buf, len)
			   forge.map.begin(256, 256, 16)
			   forge.map.set_ground(10, 10, 7, 100)
			   forge.map.set_ground(100, 100, 7, 200)
			   forge.map.add_item(100, 100, 7, 201)
			   forge.map.finish()
			 end }",
		);
		let read = format_read(&host.lua, "t").unwrap();
		let model = {
			let _scope = ScopedMapBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_built().unwrap()
		};

		assert_eq!(crate::map_save::list_chunks(&model), vec![(7u8, 0u16, 0u16), (7, 3, 3)]);

		let near = crate::map_save::export_chunk_tiles(&model, 7, 0, 0);
		assert_eq!(near.len(), 1);
		assert_eq!((near[0].x, near[0].y), (10, 10));
		assert_eq!(near[0].items, vec![100]);

		let far = crate::map_save::export_chunk_tiles(&model, 7, 3, 3);
		assert_eq!(far.len(), 1);
		assert_eq!((far[0].x, far[0].y), (100, 100));
		assert_eq!(far[0].items, vec![200, 201]);

		assert!(crate::map_save::export_chunk_tiles(&model, 7, 9, 9).is_empty());
		assert!(crate::map_save::export_chunk_tiles(&model, 6, 0, 0).is_empty(), "another floor is a different chunk");
	}

	fn temp_dir(tag: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("map-forge-fs-{}-{}", tag, std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn format_writes_its_own_files_through_fs() {
		let dir = temp_dir("write");
		let host = host_with(
			"forge.register_format{ ext='t', name='T', read=function() end,
			   write=function(m)
			     forge.fs.write('head.bin', 'H')
			     forge.fs.write('chunks/7/0_0.bin', 'A')
			     forge.fs.write('chunks/7/1_0.bin', 'B')
			   end }",
		);
		let write = format_write(&host.lua, "t").unwrap();

		let _fs = ScopedFsBase::enter(dir.join("world.t").to_str().unwrap());
		let out = write.call::<mlua::Value>(host.lua.create_table().unwrap()).unwrap();

		assert!(matches!(out, mlua::Value::Nil), "a format that writes its own files returns nothing");
		assert_eq!(std::fs::read(dir.join("head.bin")).unwrap(), b"H");
		assert_eq!(std::fs::read(dir.join("chunks/7/0_0.bin")).unwrap(), b"A", "nested folders are created");
		assert_eq!(std::fs::read(dir.join("chunks/7/1_0.bin")).unwrap(), b"B");
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn fs_reads_lists_and_removes() {
		let dir = temp_dir("read");
		std::fs::create_dir_all(dir.join("chunks")).unwrap();
		std::fs::write(dir.join("chunks/b.bin"), b"second").unwrap();
		std::fs::write(dir.join("chunks/a.bin"), b"first").unwrap();

		let host = host_with("");
		let _fs = ScopedFsBase::enter(dir.join("world.t").to_str().unwrap());

		let names: Vec<String> = host.lua.load("return forge.fs.list('chunks')").eval().unwrap();
		assert_eq!(names, vec!["a.bin", "b.bin"], "listing is sorted so saves stay reproducible");

		let body: String = host.lua.load("return forge.fs.read('chunks/a.bin')").eval().unwrap();
		assert_eq!(body, "first");

		let missing: Option<String> = host.lua.load("return forge.fs.read('chunks/nope.bin')").eval().unwrap();
		assert_eq!(missing, None, "a missing file reads as nil, not an error");

		host.lua.load("forge.fs.remove('chunks/a.bin')").exec().unwrap();
		assert!(!dir.join("chunks/a.bin").exists());
		host.lua.load("forge.fs.remove('chunks/a.bin')").exec().unwrap();

		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn fs_refuses_paths_outside_the_format_folder() {
		let dir = temp_dir("escape");
		let host = host_with("");
		let _fs = ScopedFsBase::enter(dir.join("world.t").to_str().unwrap());

		for bad in ["../outside.bin", "chunks/../../outside.bin", "/etc/passwd"] {
			let err = host
				.lua
				.load(format!("forge.fs.write([[{bad}]], 'x')"))
				.exec()
				.expect_err(&format!("`{bad}` must be rejected"));
			assert!(err.to_string().contains("leaves the format folder"), "unexpected error: {err}");
		}
		assert!(!dir.parent().unwrap().join("outside.bin").exists());
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn fs_is_unavailable_outside_a_format_call() {
		let host = host_with("");
		let err = host.lua.load("return forge.fs.read('x')").exec().expect_err("no base is set");
		assert!(err.to_string().contains("only available"), "unexpected error: {err}");
	}

	#[test]
	fn map_builder_single_id_straight_through() {
		let host = host_with(
			"forge.register_format{ ext='t', name='T', read=function(buf, len)\n\
			   forge.map.begin(256, 256, 16)\n\
			   forge.map.set_ground(100, 100, 7, 4526)\n\
			   forge.map.add_item(100, 100, 7, 1234)\n\
			   forge.map.finish()\n\
			 end }",
		);
		let read = format_read(&host.lua, "t").unwrap();
		let model = {
			let _scope = ScopedMapBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_built().unwrap()
		};
		assert_eq!(model.width, 256);
		assert_eq!(model.total_tiles, 1);
		assert_eq!(model.client_ids, vec![4526, 1234], "ground then item, ids straight through");
		assert_eq!(model.server_ids, vec![4526, 1234], "client_id == server_id");
	}

	#[test]
	fn houses_and_spawns_round_trip_through_the_builder_and_the_write_table() {
		let host = host_with(
			"forge.register_format{ ext='t', name='T',\n\
			   read=function(buf, len)\n\
			     forge.map.begin(64, 64, 16)\n\
			     forge.map.set_flags(5, 6, 7, 0, 12, 0)\n\
			     forge.map.add_house({ id=12, name='Sea Hut', town_id=1, rent=100, guildhall=true,\n\
			       entry_x=5, entry_y=6, entry_z=7 })\n\
			     forge.map.add_spawn(20, 21, 7, 3)\n\
			     forge.map.add_creature({ name='Rat', x=21, y=21, z=7, spawntime=30, direction=1 })\n\
			     forge.map.add_creature({ name='Al Dee', x=22, y=21, z=7, npc=true })\n\
			     forge.map.finish()\n\
			   end,\n\
			   write=function(m)\n\
			     local h = m.houses[1]\n\
			     local a = m.spawns.areas[1]\n\
			     local c1, c2 = m.spawns.creatures[1], m.spawns.creatures[2]\n\
			     return h.id .. ':' .. h.name .. ':' .. h.town_id .. ':' .. h.rent .. ':' ..\n\
			       tostring(h.guildhall) .. ':' .. h.entry_x .. ',' .. h.entry_y .. ',' .. h.entry_z ..\n\
			       '|' .. a.x .. ',' .. a.y .. ',' .. a.z .. 'r' .. a.radius ..\n\
			       '|' .. c1.name .. '@' .. c1.x .. ',' .. c1.y .. 't' .. c1.spawntime .. 'd' .. c1.direction ..\n\
			       '|' .. c2.name .. ':' .. tostring(c2.npc) .. 't' .. c2.spawntime .. 'd' .. c2.direction\n\
			   end }",
		);
		let read = format_read(&host.lua, "t").unwrap();
		let model = {
			let _scope = ScopedMapBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_built().unwrap()
		};
		assert_eq!(model.houses.len(), 1);
		assert_eq!(model.spawns.areas.len(), 1);
		assert_eq!(model.spawns.creatures.len(), 2);

		let dir = std::env::temp_dir().join("forge_houses_test");
		let _ = std::fs::create_dir_all(&dir);
		let path = dir.join("m.t");
		let write = format_write(&host.lua, "t").unwrap();
		write_scripted_map(&host.lua, &write, &model, path.to_str().unwrap(), "t").unwrap();
		assert_eq!(
			std::fs::read_to_string(&path).unwrap(),
			"12:Sea Hut:1:100:true:5,6,7|20,21,7r3|Rat@21,21t30d1|Al Dee:truet60d2",
			"omitted creature fields fall back to the defaults"
		);
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn towns_round_trip_through_the_builder_and_the_write_table() {
		let host = host_with(
			"forge.register_format{ ext='t', name='T',\n\
			   read=function(buf, len)\n\
			     forge.map.begin(64, 64, 16)\n\
			     forge.map.set_ground(1, 1, 7, 100)\n\
			     forge.map.add_town(3, 'Thais', 10, 20, 7)\n\
			     forge.map.set_description('hello')\n\
			     forge.map.finish()\n\
			   end,\n\
			   write=function(m)\n\
			     local t = m.towns[1]\n\
			     return t.id .. ':' .. t.name .. ':' .. t.x .. ',' .. t.y .. ',' .. t.z .. '/' .. m.description\n\
			   end }",
		);
		let read = format_read(&host.lua, "t").unwrap();
		let model = {
			let _scope = ScopedMapBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_built().unwrap()
		};
		assert_eq!(model.towns.len(), 1);
		assert_eq!(model.towns[0].name, "Thais");
		assert_eq!(model.description, "hello");

		let dir = std::env::temp_dir().join("forge_towns_test");
		let _ = std::fs::create_dir_all(&dir);
		let path = dir.join("m.t");
		let write = format_write(&host.lua, "t").unwrap();
		write_scripted_map(&host.lua, &write, &model, path.to_str().unwrap(), "t").unwrap();
		assert_eq!(std::fs::read_to_string(&path).unwrap(), "3:Thais:10,20,7/hello");
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn itemdb_builder_collects_names() {
		let host = host_with(
			"forge.register_format{ ext='d', name='D', read=function(buf, len)\n\
			   forge.items.begin()\n\
			   forge.items.add(4526, { name='grass', ground=true, group=2 })\n\
			   forge.items.add(1234, { name='torch' })\n\
			   forge.items.finish()\n\
			 end }",
		);
		let read = format_read(&host.lua, "d").unwrap();
		let db = {
			let _scope = ScopedItemBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_itemdb().unwrap()
		};
		assert_eq!(db.items.len(), 2);
		assert_eq!(db.items.get(&4526).map(|d| d.name.as_str()), Some("grass"));
		assert!(db.items.get(&4526).unwrap().ground);
		assert_eq!(db.items.get(&1234).map(|d| d.name.as_str()), Some("torch"));
	}

	#[test]
	fn scripted_sprite_provider_crops_regions() {
		use flate2::write::ZlibEncoder;
		use flate2::Compression;
		use std::io::Write;

		let zlib = |raw: &[u8]| {
			let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
			e.write_all(raw).unwrap();
			e.finish().unwrap()
		};
		let c0 = zlib(&[255, 0, 0, 255, 0, 255, 0, 255]);
		let c1 = zlib(&[0, 0, 255, 255]);
		let mut buf = Vec::new();
		buf.extend_from_slice(&(c0.len() as u32).to_le_bytes());
		buf.extend_from_slice(&c0);
		buf.extend_from_slice(&(c1.len() as u32).to_le_bytes());
		buf.extend_from_slice(&c1);

		let host = host_with(
			"forge.register_format{ ext='tpak', name='T', kind='assets', read=function(buf, len)\n\
			   local ffi = require('ffi'); local p = ffi.cast('const uint8_t*', buf); local pos = 0\n\
			   local function u32() local v=p[pos]+p[pos+1]*256+p[pos+2]*65536+p[pos+3]*16777216; pos=pos+4; return v end\n\
			   forge.sprites.begin()\n\
			   local l0 = u32(); local a0 = ffi.string(p+pos, l0); pos = pos + l0\n\
			   forge.sprites.set_atlas(0, 2, 1, 0, a0)\n\
			   local l1 = u32(); local a1 = ffi.string(p+pos, l1); pos = pos + l1\n\
			   forge.sprites.set_atlas(1, 1, 1, 0, a1)\n\
			   forge.sprites.set_sprite(100, 0, 0, 0, 1, 1)\n\
			   forge.sprites.set_sprite(101, 0, 1, 0, 1, 1)\n\
			   forge.sprites.set_sprite(200, 1, 0, 0, 1, 1)\n\
			   forge.sprites.map_item(5, 100)\n\
			   forge.sprites.finish()\n\
			 end }",
		);
		let read = format_read(&host.lua, "tpak").unwrap();
		let (mut provider, item_map, _client_map) = {
			let _s = ScopedAssetBuild::enter();
			call_read(&read, &buf).unwrap();
			take_assets().unwrap()
		};
		assert_eq!(item_map.get(&5), Some(&100), "item->sprite map");

		let sds = (SPRITE_SIZE * SPRITE_SIZE * 4) as usize;
		let rec = 9 + sds;
		let out = provider.read_sprites_rgba("", &[100, 101, 200], false).unwrap();
		assert_eq!(&out[0..4], &3u32.to_le_bytes(), "sprite count");

		let red = &out[4 + 9..4 + 9 + sds];
		assert_eq!(&red[0..4], &[255, 0, 0, 255], "sprite 100 = red top-left");
		assert_eq!(&red[4..8], &[0, 0, 0, 0], "rest padded transparent");

		let green = &out[4 + rec + 9..4 + rec + 9 + sds];
		assert_eq!(&green[0..4], &[0, 255, 0, 255], "sprite 101 = green (atlas0 x=1)");

		let blue = &out[4 + rec * 2 + 9..4 + rec * 2 + 9 + sds];
		assert_eq!(&blue[0..4], &[0, 0, 255, 255], "sprite 200 = blue (atlas1)");
	}

	#[test]
	fn items_add_declares_capabilities_and_never_infers_them() {
		let host = host_with(
			"forge.register_format{ ext='it', name='IT', read=function(buf, len)\n\
			   forge.items.begin()\n\
			   forge.items.add(5, { name='sign', writable=true, max_text_len=64 })\n\
			   forge.items.add(6, { name='rock', attrs={ writable=true, container=true } })\n\
			   forge.items.add(7, { name='bag', container=true })\n\
			   forge.items.add(8, { name='torch' })\n\
			   forge.items.finish()\n\
			 end }",
		);
		let read = format_read(&host.lua, "it").unwrap();
		let db = {
			let _s = ScopedItemBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			ItemDb { items: ITEMS.with(|b| b.borrow_mut().take()).unwrap_or_default().items }
		};
		assert!(db.caps(5).writable, "declared capability reaches the host");
		assert_eq!(db.caps(5).max_text_len, 64);
		assert!(!db.caps(6).writable, "a lookalike key in the free attrs bag is never inferred");
		assert!(!db.caps(6).container, "same for every other capability");
		assert!(db.caps(7).container);
		assert!(db.caps(7).duplicable(), "container implies duplicable placement");
		assert!(!db.caps(8).duplicable());
	}

	#[test]
	fn things_add_collects_attrs_bag() {
		let host = host_with(
			"forge.register_format{ ext='th', name='TH', read=function(buf, len)\n\
			   forge.things.begin()\n\
			   forge.things.add({ id=7, width=1, attrs={ swimmable=true, depth=3, label='deep' } })\n\
			   forge.things.finish()\n\
			 end }",
		);
		let read = format_read(&host.lua, "th").unwrap();
		let things = {
			let _s = ScopedThingsBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_things()
		};
		assert_eq!(things.len(), 1);
		let a = &things[0].attrs;
		assert_eq!(a.get("swimmable"), Some(&AttrValue::Bool(true)));
		assert_eq!(a.get("depth"), Some(&AttrValue::Num(3.0)));
		assert_eq!(a.get("label"), Some(&AttrValue::Str("deep".to_string())));
	}

	#[test]
	fn things_add_falls_back_to_the_attrs_bag_for_render_flags() {
		let host = host_with(
			"forge.register_format{ ext='th', name='TH', read=function(buf, len)\n\
			   forge.things.begin()\n\
			   forge.things.add({ id=9, attrs={ is_unpassable=true, is_ground=false } })\n\
			   forge.things.add({ id=10, is_unpassable=false, attrs={ is_unpassable=true } })\n\
			   forge.things.finish()\n\
			 end }",
		);
		let read = format_read(&host.lua, "th").unwrap();
		let things = {
			let _s = ScopedThingsBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_things()
		};
		assert!(things[0].is_unpassable, "flag only in the attrs bag still reaches the thing");
		assert!(!things[0].is_ground);
		assert!(!things[1].is_unpassable, "an explicit top-level value wins over the bag");
	}

	#[test]
	fn ui_config_default_then_override() {
		let host = host_with("");
		let d = read_ui_config(&host.lua);
		assert!(d.client_versions, "default keeps client version tab");
		assert!(d.assets.is_none());

		let host2 = host_with("forge.ui = { client_versions = false, assets = { ext = 'x', label = 'Assets' } }");
		let c = read_ui_config(&host2.lua);
		assert!(!c.client_versions, "lua hides client version tab");
		assert_eq!(c.assets.as_ref().map(|a| a.ext.as_str()), Some("x"));
		assert_eq!(c.assets.as_ref().map(|a| a.label.as_str()), Some("Assets"));
	}

	#[test]
	fn forge_alias_drives_same_registry() {
		let host = host_with(
			"forge.register_format{ ext='y', name='Items', kind='itemdb', read=function(buf, len)\n\
			   forge.items.begin()\n\
			   forge.items.add(4526, { name='grass', ground=true })\n\
			   forge.items.finish()\n\
			 end }",
		);
		let read = format_read(&host.lua, "y").unwrap();
		let db = {
			let _scope = ScopedItemBuild::enter();
			call_read(&read, &[0u8]).unwrap();
			take_itemdb().unwrap()
		};
		assert_eq!(db.items.get(&4526).map(|d| d.name.as_str()), Some("grass"));
	}

	#[test]
	fn inflate_roundtrips_zlib() {
		let host = host_with("");
		let original = b"scripted chunk payload, repeated repeated repeated";
		let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
		use std::io::Write;
		enc.write_all(original).unwrap();
		let comp = enc.finish().unwrap();

		let forge: Table = host.lua.globals().get("forge").unwrap();
		let inflate: Function = forge.get("inflate").unwrap();
		let input = host.lua.create_string(&comp).unwrap();
		let out: mlua::String = inflate.call((input, original.len())).unwrap();
		assert_eq!(&out.as_bytes()[..], &original[..]);
	}
}
