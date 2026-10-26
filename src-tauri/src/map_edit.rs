use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};

use tauri::ipc::Response;

use crate::map_model::{
	chunk_key_of, door_id_at, empty_model, first_item_at, flags_at, house_id_at, push_u16, push_u32, serialize_chunks, stack_at,
	tile_stack_mut, with_stack, MapModel,
	ACTION_DELETE, ACTION_ERASE, ACTION_FLAG, ACTION_HOUSE, ACTION_MOVE, ACTION_PAINT, CHUNK,
};

fn empty_door_id(m: &MapModel, house_id: u32) -> u8 {
	let mut used = [false; 256];
	let mark = |used: &mut [bool; 256], z: u8, x: u16, y: u16| {
		if house_id_at(m, z, x, y) == house_id {
			let d = door_id_at(m, z, x, y);
			if d != 0 {
				used[d as usize] = true;
			}
		}
	};
	for (&z, floor) in &m.floors {
		for &(start, end) in floor.values() {
			for t in start as usize..end as usize {
				mark(&mut used, z, m.tile_x[t], m.tile_y[t]);
			}
		}
	}
	for (&z, chunks) in &m.house_edits {
		for posmap in chunks.values() {
			for &pos in posmap.keys() {
				mark(&mut used, z, (pos >> 16) as u16, (pos & 0xFFFF) as u16);
			}
		}
	}
	(1..=255u16).find(|&i| !used[i as usize]).map(|i| i as u8).unwrap_or(0)
}
use crate::materials::{self, Materials};
use crate::formats::tibia::otb::OtbItems;
use crate::formats::tibia::otbm::{attrs_key, ContainedItem, ItemAttrs};
use crate::lua_host::LuaState;
use crate::scripting::ScopedLua;
use crate::{CopyBufferState, MapState, MaterialsState, OtbState, PlaceFlags, PlacementState};

pub struct CopyTile {
	pub dx: u16,
	pub dy: u16,
	pub dz: i8,
	pub items: Vec<(u16, u16)>,
}

pub struct CopyBuffer {
	pub tiles: Vec<CopyTile>,
}

const GROUND_CLASS: i32 = -1;
const BORDER_CLASS: i32 = 0;
const NORMAL_CLASS: i32 = 1000;

const NEIGHBOUR_OFFSETS: [(i32, i32); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];
const WALL_NEIGHBOUR_OFFSETS: [(i32, i32); 4] = [(0, -1), (-1, 0), (1, 0), (0, 1)];

fn tile_seed(x: u16, y: u16) -> u32 {
	(x as u32).wrapping_mul(73856093) ^ (y as u32).wrapping_mul(19349663)
}

static ROLL_SALT: AtomicU32 = AtomicU32::new(0);

fn paint_roll(x: u16, y: u16) -> u32 {
	tile_seed(x, y) ^ ROLL_SALT.load(Ordering::Relaxed)
}

fn mix32(mut v: u32) -> u32 {
	v ^= v >> 16;
	v = v.wrapping_mul(0x7feb_352d);
	v ^= v >> 15;
	v = v.wrapping_mul(0x846c_a68b);
	v ^ (v >> 16)
}

static DOODAD_THICKNESS: AtomicI32 = AtomicI32::new(-1);
static DOOR_LOCKED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_door_locked(locked: bool) {
	DOOR_LOCKED.store(locked, Ordering::Relaxed);
}

fn door_locked_pref() -> bool {
	DOOR_LOCKED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_doodad_thickness(percent: i32) {
	DOODAD_THICKNESS.store(percent, Ordering::Relaxed);
}

fn doodad_density(mats: &Materials, brush: u32) -> f32 {
	match DOODAD_THICKNESS.load(Ordering::Relaxed) {
		p if p >= 0 => p as f32 / 100.0,
		_ => mats.doodad_density(brush),
	}
}

fn advance_roll_salt() {
	ROLL_SALT.fetch_add(0x9E37_79B9, Ordering::Relaxed);
}

fn is_ground_item(place: &HashMap<u16, PlaceFlags>, mats: Option<&Materials>, client: u16, server: u16) -> bool {
	if place.get(&client).is_some_and(|p| p.ground) {
		return true;
	}
	mats.is_some_and(|m| m.server_to_ground.contains_key(&server))
}

fn order_class(place: &HashMap<u16, PlaceFlags>, mats: Option<&Materials>, client: u16, server: u16) -> i32 {
	let is_ground = is_ground_item(place, mats, client, server);
	let is_border = !is_ground && mats.is_some_and(|m| m.is_border_item(server));
	let top_order = place.get(&client).map_or(0, |p| p.top_order);
	crate::scripting::stack_class(is_ground, is_border, top_order)
}

fn same_brush(mats: Option<&Materials>, brush_server: u16, item_server: u16) -> bool {
	if brush_server == item_server {
		return true;
	}
	let Some(m) = mats else {
		return false;
	};
	let pair = |map: &HashMap<u16, u32>| matches!((map.get(&brush_server), map.get(&item_server)), (Some(a), Some(b)) if a == b);
	pair(&m.server_to_ground)
		|| pair(&m.server_to_wall)
		|| pair(&m.server_to_table)
		|| pair(&m.server_to_carpet)
		|| pair(&m.server_to_doodad)
}

fn insert_ordered(stack: &mut Vec<(u16, u16)>, place: &HashMap<u16, PlaceFlags>, mats: Option<&Materials>, client: u16, server: u16) {
	let ground = crate::scripting::ground_class();
	let class = order_class(place, mats, client, server);
	if class == ground {
		let head_ground = stack.first().is_some_and(|&(c, s)| order_class(place, mats, c, s) == ground);
		if head_ground {
			stack[0] = (client, server);
		} else {
			stack.insert(0, (client, server));
		}
		return;
	}
	let mut idx = 0;
	if stack.first().is_some_and(|&(c, s)| order_class(place, mats, c, s) == ground) {
		idx = 1;
	}
	while idx < stack.len() {
		let (c, s) = stack[idx];
		if order_class(place, mats, c, s) > class {
			break;
		}
		idx += 1;
	}
	stack.insert(idx, (client, server));
}

fn ground_brush_at(m: &MapModel, mats: &Materials, place: &HashMap<u16, PlaceFlags>, z: u8, x: u16, y: u16) -> u32 {
	if let Some((c, s)) = first_item_at(m, z, x, y) {
		if is_ground_item(place, Some(mats), c, s) {
			return mats.server_to_ground.get(&s).copied().unwrap_or(0);
		}
	}
	0
}

fn borderize(
	m: &mut MapModel,
	mats: &Materials,
	place: &HashMap<u16, PlaceFlags>,
	otb: &OtbItems,
	z: u8,
	tiles: &HashSet<(u16, u16)>,
	optional: bool,
	force_optional: bool,
) -> HashSet<u32> {
	let mut affected: HashSet<(u16, u16)> = HashSet::new();
	for &(x, y) in tiles {
		affected.insert((x, y));
		for (dx, dy) in NEIGHBOUR_OFFSETS {
			let nx = x as i32 + dx;
			let ny = y as i32 + dy;
			if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 {
				affected.insert((nx as u16, ny as u16));
			}
		}
	}

	let mut computed: Vec<((u16, u16), materials::BorderResult)> = Vec::with_capacity(affected.len());
	for &(x, y) in &affected {
		let own = ground_brush_at(m, mats, place, z, x, y);
		let mut neigh = [0u32; 8];
		for (i, (dx, dy)) in NEIGHBOUR_OFFSETS.iter().enumerate() {
			let nx = x as i32 + dx;
			let ny = y as i32 + dy;
			if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 {
				neigh[i] = ground_brush_at(m, mats, place, z, nx as u16, ny as u16);
			}
		}
		let own_optional = (force_optional && tiles.contains(&(x, y)))
			|| (optional && with_stack(m, z, x, y, |st| st.iter().any(|&(_, s)| mats.is_optional_border_item(s))));
		computed.push(((x, y), mats.calculate_borders(own, &neigh, own_optional)));
	}

	let mut touched: HashSet<u32> = HashSet::new();
	let mut before: Vec<(u16, u16)> = Vec::new();
	for ((x, y), result) in computed {
		let stack = tile_stack_mut(m, z, x, y);
		before.clear();
		before.extend_from_slice(stack);
		stack.retain(|&(_, s)| !mats.is_border_item(s));
		let mut idx = 0;
		if stack.first().is_some_and(|&(c, s)| is_ground_item(place, Some(mats), c, s)) {
			idx = 1;
		}
		for s in result.items {
			let c = otb.client_id(s).unwrap_or(s);
			stack.insert(idx, (c, s));
			idx += 1;
		}
		for sc in &result.specifics {
			apply_specific_case(stack, otb, sc);
		}
		if stack[..] != before[..] {
			touched.insert(chunk_key_of(x, y));
		}
	}
	touched
}

fn apply_specific_case(stack: &mut Vec<(u16, u16)>, otb: &OtbItems, sc: &materials::SpecificCase) {
	let present = |id: u16| stack.iter().any(|&(_, s)| s == id);
	if !sc.matches.iter().all(|&id| present(id)) {
		return;
	}
	let mut replaced = sc.delete_all;
	let mut i = 0;
	while i < stack.len() {
		let server = stack[i].1;
		if sc.matches.contains(&server) {
			if !replaced && server == sc.to_replace {
				stack[i] = (otb.client_id(sc.with).unwrap_or(sc.with), sc.with);
				replaced = true;
				i += 1;
			} else if sc.delete_all || !sc.keep_border {
				stack.remove(i);
			} else {
				i += 1;
			}
		} else {
			i += 1;
		}
	}
}

fn tile_has_wall(m: &MapModel, mats: &Materials, own_wall: u32, z: u8, x: u16, y: u16) -> bool {
	with_stack(m, z, x, y, |stack| {
		stack
			.iter()
			.any(|&(_, s)| mats.structural_wall_brush_for(s).is_some_and(|other| mats.walls_connect(own_wall, other)))
	})
}

fn base_wall_at(m: &MapModel, mats: &Materials, z: u8, x: u16, y: u16) -> Option<(usize, u16, u32, u8)> {
	stack_at(m, z, x, y).iter().enumerate().find_map(|(i, &(_, server))| {
		let brush = mats.structural_wall_brush_for(server)?;
		let alignment = mats.wall_alignment_of(server)?;
		Some((i, server, brush, alignment))
	})
}

fn decoration_id_for(mats: &Materials, deco: u32, base_server: u16, alignment: u8, seed: u32) -> Option<u16> {
	match mats.door_of(base_server) {
		Some(door) => mats
			.door_id_for(deco, alignment, door.kind, door.open, door_locked_pref())
			.or_else(|| mats.wall_item_for_alignment(deco, alignment, seed)),
		None => mats.wall_item_for_alignment(deco, alignment, seed),
	}
}

fn place_wall_decoration(m: &mut MapModel, mats: &Materials, otb: &OtbItems, z: u8, x: u16, y: u16, deco: u32) -> bool {
	tile_stack_mut(m, z, x, y).retain(|&(_, s)| mats.decoration_brush_for(s) != Some(deco));
	let Some((idx, base_server, _, alignment)) = base_wall_at(m, mats, z, x, y) else {
		return false;
	};
	let Some(id) = decoration_id_for(mats, deco, base_server, alignment, paint_roll(x, y)) else {
		return false;
	};
	tile_stack_mut(m, z, x, y).insert(idx + 1, (otb.client_id(id).unwrap_or(id), id));
	true
}

fn place_door(m: &mut MapModel, mats: &Materials, otb: &OtbItems, z: u8, x: u16, y: u16, door: materials::DoorItem) -> bool {
	let stack = stack_at(m, z, x, y);
	let target = stack.iter().enumerate().find_map(|(i, &(_, server))| {
		let brush = mats.structural_wall_brush_for(server)?;
		let alignment = mats.wall_alignment_of(server)?;
		let open = mats.door_of(server).is_some_and(|d| d.open);
		let id = mats.door_id_for(brush, alignment, door.kind, open, door_locked_pref())?;
		Some((i, alignment, id))
	});
	let Some((idx, alignment, id)) = target else {
		return false;
	};
	let slot = (otb.client_id(id).unwrap_or(id), id);
	let decorations: Vec<(usize, u16)> = stack
		.iter()
		.enumerate()
		.skip(idx + 1)
		.filter_map(|(i, &(_, server))| {
			let deco = mats.decoration_brush_for(server)?;
			let new_id = decoration_id_for(mats, deco, id, alignment, paint_roll(x, y))?;
			(new_id != server).then_some((i, new_id))
		})
		.collect();
	if stack[idx] == slot && decorations.is_empty() {
		return false;
	}
	let stack = tile_stack_mut(m, z, x, y);
	stack[idx] = slot;
	for (i, new_id) in decorations {
		stack[i] = (otb.client_id(new_id).unwrap_or(new_id), new_id);
	}

	let house_id = house_id_at(m, z, x, y);
	if house_id != 0 && door_id_at(m, z, x, y) == 0 {
		let door_id = empty_door_id(m, house_id);
		if door_id != 0 {
			m.set_tile_door_id(z, x, y, door_id);
		}
	}
	true
}

fn restore_wall_under_doors(m: &mut MapModel, mats: &Materials, otb: &OtbItems, z: u8, x: u16, y: u16) -> bool {
	let seed = paint_roll(x, y);
	let swaps: Vec<(usize, Option<u16>)> = stack_at(m, z, x, y)
		.iter()
		.enumerate()
		.filter_map(|(i, &(_, server))| {
			mats.door_of(server)?;
			let brush = mats.wall_brush_for(server)?;
			let alignment = mats.wall_alignment_of(server)?;
			Some((i, mats.wall_item_for_alignment(brush, alignment, seed)))
		})
		.collect();
	if swaps.is_empty() {
		return false;
	}
	let stack = tile_stack_mut(m, z, x, y);
	for &(i, wall) in swaps.iter().rev() {
		match wall {
			Some(id) => stack[i] = (otb.client_id(id).unwrap_or(id), id),
			None => {
				stack.remove(i);
			}
		}
	}
	true
}

fn wallize(m: &mut MapModel, mats: &Materials, otb: &OtbItems, z: u8, tiles: &HashSet<(u16, u16)>) -> HashSet<u32> {
	let grow = |set: &HashSet<(u16, u16)>| -> HashSet<(u16, u16)> {
		let mut out = set.clone();
		for &(x, y) in set {
			for (dx, dy) in WALL_NEIGHBOUR_OFFSETS {
				let nx = x as i32 + dx;
				let ny = y as i32 + dy;
				if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 {
					out.insert((nx as u16, ny as u16));
				}
			}
		}
		out
	};
	let affected = grow(&grow(tiles));

	let mut computed: Vec<((u16, u16), Vec<(usize, u16)>)> = Vec::new();
	for &(x, y) in &affected {
		let stack = stack_at(m, z, x, y);
		let mut changes: Vec<(usize, u16)> = Vec::new();
		let mut last_base: Option<(u16, u8)> = None;
		for (i, &(_, server)) in stack.iter().enumerate() {
			if let Some(deco) = mats.decoration_brush_for(server) {
				let Some((base_server, alignment)) = last_base else {
					continue;
				};
				if let Some(new_id) = decoration_id_for(mats, deco, base_server, alignment, tile_seed(x, y)) {
					if new_id != server {
						changes.push((i, new_id));
					}
				}
				continue;
			}
			let Some(own_wall) = mats.wall_brush_for(server) else {
				continue;
			};
			if mats.wall_alignment_of(server) == Some(materials::WALL_UNTOUCHABLE) {
				continue;
			}
			let wall_mask = |cx: i32, cy: i32| -> u32 {
				let mut mask = 0u32;
				for (bit, (dx, dy)) in WALL_NEIGHBOUR_OFFSETS.iter().enumerate() {
					let nx = cx + dx;
					let ny = cy + dy;
					if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 && tile_has_wall(m, mats, own_wall, z, nx as u16, ny as u16) {
						mask |= 1u32 << bit;
					}
				}
				mask
			};
			let tiledata = wall_mask(x as i32, y as i32);
			let mut nbr_aligns: Vec<(u32, u8)> = Vec::new();
			for (bit, (dx, dy)) in WALL_NEIGHBOUR_OFFSETS.iter().enumerate() {
				if tiledata & (1u32 << bit) == 0 {
					continue;
				}
				nbr_aligns.push((1u32 << bit, mats.wall_full_alignment(wall_mask(x as i32 + dx, y as i32 + dy))));
			}
			let base = mats.wall_full_alignment(tiledata);
			let resolved = mats
				.wall_specific_for(own_wall, base, &nbr_aligns)
				.or_else(|| mats.wall_id_for(own_wall, tiledata, tile_seed(x, y)));
			let Some(new_server) = resolved else {
				continue;
			};
			let final_server = match mats.door_of(server) {
				Some(door) => {
					let target = mats.wall_alignment_of(new_server);
					if target == mats.wall_alignment_of(server) {
						server
					} else {
						target
							.and_then(|a| mats.door_id_for(own_wall, a, door.kind, door.open, door.locked))
							.unwrap_or(new_server)
					}
				}
				None => new_server,
			};
			last_base = mats.wall_alignment_of(final_server).map(|a| (final_server, a));
			if final_server != server {
				changes.push((i, final_server));
			}
		}
		if !changes.is_empty() {
			computed.push(((x, y), changes));
		}
	}

	let mut touched: HashSet<u32> = HashSet::new();
	for ((x, y), changes) in computed {
		let stack = tile_stack_mut(m, z, x, y);
		for (idx, new_server) in changes {
			if let Some(slot) = stack.get_mut(idx) {
				*slot = (otb.client_id(new_server).unwrap_or(new_server), new_server);
			}
		}
		touched.insert(chunk_key_of(x, y));
	}
	touched
}

fn realign8<B, I>(m: &mut MapModel, mats: &Materials, otb: &OtbItems, z: u8, tiles: &HashSet<(u16, u16)>, brush_for: B, id_for: I) -> HashSet<u32>
where
	B: Fn(&Materials, u16) -> Option<u32>,
	I: Fn(&Materials, u32, u32, u32) -> Option<u16>,
{
	let mut affected: HashSet<(u16, u16)> = HashSet::new();
	for &(x, y) in tiles {
		affected.insert((x, y));
		for (dx, dy) in NEIGHBOUR_OFFSETS {
			let nx = x as i32 + dx;
			let ny = y as i32 + dy;
			if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 {
				affected.insert((nx as u16, ny as u16));
			}
		}
	}

	let tile_has = |m: &MapModel, own: u32, x: u16, y: u16| -> bool {
		with_stack(m, z, x, y, |stack| stack.iter().any(|&(_, s)| brush_for(mats, s) == Some(own)))
	};

	let mut computed: Vec<((u16, u16), Vec<(usize, u16)>)> = Vec::new();
	for &(x, y) in &affected {
		let stack = stack_at(m, z, x, y);
		let mut changes: Vec<(usize, u16)> = Vec::new();
		for (idx, &(_, server)) in stack.iter().enumerate() {
			let Some(own) = brush_for(mats, server) else {
				continue;
			};
			let mut tiledata = 0u32;
			for (bit, (dx, dy)) in NEIGHBOUR_OFFSETS.iter().enumerate() {
				let nx = x as i32 + dx;
				let ny = y as i32 + dy;
				if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 && tile_has(m, own, nx as u16, ny as u16) {
					tiledata |= 1 << bit;
				}
			}
			if let Some(new_server) = id_for(mats, own, tiledata, tile_seed(x, y)) {
				if new_server != server {
					changes.push((idx, new_server));
				}
			}
		}
		if !changes.is_empty() {
			computed.push(((x, y), changes));
		}
	}

	let mut touched: HashSet<u32> = HashSet::new();
	for ((x, y), changes) in computed {
		let stack = tile_stack_mut(m, z, x, y);
		for (idx, new_server) in changes {
			if let Some(slot) = stack.get_mut(idx) {
				*slot = (otb.client_id(new_server).unwrap_or(new_server), new_server);
			}
		}
		touched.insert(chunk_key_of(x, y));
	}
	touched
}

fn auto_all(m: &mut MapModel, mats: &Materials, place: &HashMap<u16, PlaceFlags>, otb: &OtbItems, z: u8, tiles: &HashSet<(u16, u16)>) -> HashSet<u32> {
	let mut touched: HashSet<u32> = HashSet::new();
	touched.extend(borderize(m, mats, place, otb, z, tiles, true, false));
	touched.extend(wallize(m, mats, otb, z, tiles));
	touched.extend(realign8(m, mats, otb, z, tiles, Materials::table_brush_for, Materials::table_id_for));
	touched.extend(realign8(m, mats, otb, z, tiles, Materials::carpet_brush_for, Materials::carpet_id_for));
	touched
}

#[allow(clippy::too_many_arguments)]
fn auto_after_change(
	m: &mut MapModel,
	mats: &Materials,
	place: &HashMap<u16, PlaceFlags>,
	otb: &OtbItems,
	z: u8,
	tiles: &HashSet<(u16, u16)>,
	client: u16,
	server: u16,
	force_ground: bool,
) -> HashSet<u32> {
	let mut touched: HashSet<u32> = HashSet::new();
	if force_ground || is_ground_item(place, Some(mats), client, server) {
		touched.extend(borderize(m, mats, place, otb, z, tiles, true, false));
	}
	if mats.wall_brush_for(server).is_some() {
		touched.extend(wallize(m, mats, otb, z, tiles));
	}
	if mats.table_brush_for(server).is_some() {
		touched.extend(realign8(m, mats, otb, z, tiles, Materials::table_brush_for, Materials::table_id_for));
	}
	if mats.carpet_brush_for(server).is_some() {
		touched.extend(realign8(m, mats, otb, z, tiles, Materials::carpet_brush_for, Materials::carpet_id_for));
	}
	touched
}

#[allow(clippy::too_many_arguments)]
fn item_blocks(place: &HashMap<u16, PlaceFlags>, otb: &OtbItems, server: u16) -> bool {
	let client = otb.client_id(server).unwrap_or(server);
	place.get(&client).is_some_and(|p| p.blocking)
}

fn complex_flags(m: &MapModel, z: u8, x: u16, y: u16) -> Vec<bool> {
	let len = with_stack(m, z, x, y, |stack| stack.len());
	(0..len)
		.map(|i| {
			let key = attrs_key(z, x, y, i as u8);
			m.item_attrs.get(&key).is_some_and(|a| !a.is_default()) || m.container_contents.get(&key).is_some_and(|c| !c.is_empty())
		})
		.collect()
}

fn tile_has_doodad(m: &MapModel, mats: &Materials, brush: u32, z: u8, x: u16, y: u16) -> bool {
	with_stack(m, z, x, y, |stack| stack.iter().any(|&(_, s)| mats.doodad_brush_for(s) == Some(brush)))
}

fn tile_has_blocking(m: &MapModel, place: &HashMap<u16, PlaceFlags>, z: u8, x: u16, y: u16) -> bool {
	with_stack(m, z, x, y, |stack| {
		stack.iter().any(|&(c, _)| place.get(&c).is_some_and(|p| p.blocking))
	})
}

fn run_paint(
	m: &mut MapModel,
	mats: Option<&Materials>,
	place: &HashMap<u16, PlaceFlags>,
	otb: &OtbItems,
	z: u8,
	xs: &[u16],
	ys: &[u16],
	server_id: u16,
	client_id: u16,
	is_ground: bool,
	is_doodad: bool,
	brush_name: &str,
	automagic: bool,
	block_guard: bool,
	is_raw: bool,
) -> HashSet<u32> {
	let mut touched: HashSet<u32> = HashSet::new();
	let mut painted: HashSet<(u16, u16)> = HashSet::new();
	let mut painted_ground = false;

	let doodad_brush = if is_doodad {
		mats.and_then(|mt| mt.doodad_id_by_name(brush_name).or_else(|| mt.doodad_brush_for(server_id)))
	} else {
		None
	};

	let ground_brush = if is_ground && !is_doodad {
		mats.and_then(|mt| mt.ground_brush_by_name(brush_name))
	} else {
		None
	};

	let mut doodad_allowed = vec![true; xs.len()];
	if let (Some(mats), Some(brush)) = (mats, doodad_brush) {
		let density = doodad_density(mats, brush);
		let count = ((xs.len() as f32 * density).round() as usize).clamp(1, xs.len());
		if count < xs.len() {
			let mut order: Vec<usize> = (0..xs.len()).collect();
			order.sort_by_key(|&i| mix32(paint_roll(xs[i], ys[i])));
			doodad_allowed.fill(false);
			for &i in order.iter().take(count) {
				doodad_allowed[i] = true;
			}
		}
	}

	for i in 0..xs.len() {
		let (x, y) = (xs[i], ys[i]);
		if let (Some(mats), Some(brush)) = (mats, doodad_brush) {
			if !doodad_allowed[i] {
				continue;
			}
			let allow_duplicate = mats.doodad_on_duplicate(brush);
			let mut cleaned: HashSet<(u16, u16, u32)> = HashSet::new();
			for (dx, dy, item) in mats.doodad_placement(brush, mix32(tile_seed(x, y))) {
				let (tx, ty) = (x as i32 + dx, y as i32 + dy);
				if tx < 0 || ty < 0 || tx > u16::MAX as i32 || ty > u16::MAX as i32 {
					continue;
				}
				let (tx, ty) = (tx as u16, ty as u16);
				let has_ground = first_item_at(m, z, tx, ty).is_some_and(|(c, s)| is_ground_item(place, Some(mats), c, s));
				if !crate::scripting::allow_place(item, has_ground) {
					continue;
				}
				if block_guard && item_blocks(place, otb, item) && tile_has_blocking(m, place, z, tx, ty) {
					continue;
				}
				if !allow_duplicate && tile_has_doodad(m, mats, brush, z, tx, ty) {
					continue;
				}
				if let Some(wall_brush) = mats.wall_brush_for(item) {
					if cleaned.insert((tx, ty, wall_brush)) {
						tile_stack_mut(m, z, tx, ty).retain(|&(_, s)| mats.wall_brush_for(s) != Some(wall_brush));
					}
				}
				let client = otb.client_id(item).unwrap_or(item);
				insert_ordered(tile_stack_mut(m, z, tx, ty), place, Some(mats), client, item);
				touched.insert(chunk_key_of(tx, ty));
				painted.insert((tx, ty));
			}
			continue;
		}
		if let Some((mats, deco)) = mats.filter(|_| !is_raw).and_then(|mt| mt.decoration_brush_for(server_id).map(|d| (mt, d))) {
			if place_wall_decoration(m, mats, otb, z, x, y, deco) {
				touched.insert(chunk_key_of(x, y));
				painted.insert((x, y));
			}
			continue;
		}
		if let Some((mats, door)) = mats.filter(|_| !is_raw).and_then(|mt| mt.door_of(server_id).map(|d| (mt, d))) {
			if place_door(m, mats, otb, z, x, y, door) {
				touched.insert(chunk_key_of(x, y));
				painted.insert((x, y));
			}
			continue;
		}
		let (server_id, client_id) = match ground_brush.and_then(|b| b.pick_item(paint_roll(x, y))) {
			Some(picked) => (picked, otb.client_id(picked).unwrap_or(picked)),
			None => (server_id, client_id),
		};
		let has_ground = first_item_at(m, z, x, y).is_some_and(|(c, s)| is_ground_item(place, mats, c, s));
		if !crate::scripting::allow_place(server_id, has_ground) {
			continue;
		}
		if block_guard && item_blocks(place, otb, server_id) && tile_has_blocking(m, place, z, x, y) {
			continue;
		}
		insert_ordered(tile_stack_mut(m, z, x, y), place, mats, client_id, server_id);
		painted_ground |= is_ground;
		touched.insert(chunk_key_of(x, y));
		painted.insert((x, y));
	}

	if automagic {
		if let Some(mats) = mats {
			touched.extend(auto_after_change(m, mats, place, otb, z, &painted, client_id, server_id, painted_ground));
		}
	}
	touched
}

#[allow(clippy::too_many_arguments)]
fn replace_filter(
	m: &MapModel,
	mats: &Materials,
	place: &HashMap<u16, PlaceFlags>,
	z: u8,
	xs: &[u16],
	ys: &[u16],
	anchor: (u16, u16),
) -> (Vec<u16>, Vec<u16>) {
	let has_ground = |x: u16, y: u16| first_item_at(m, z, x, y).is_some_and(|(c, s)| is_ground_item(place, Some(mats), c, s));
	let (want_brush, want_ground) = (ground_brush_at(m, mats, place, z, anchor.0, anchor.1), has_ground(anchor.0, anchor.1));
	let kept: Vec<(u16, u16)> = xs
		.iter()
		.zip(ys.iter())
		.map(|(&x, &y)| (x, y))
		.filter(|&(x, y)| ground_brush_at(m, mats, place, z, x, y) == want_brush && has_ground(x, y) == want_ground)
		.collect();
	(kept.iter().map(|&(x, _)| x).collect(), kept.iter().map(|&(_, y)| y).collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn paint_tiles(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	server_id: u16,
	is_ground: bool,
	is_doodad: bool,
	is_raw: bool,
	automagic: bool,
	brush_name: String,
	replace: Option<(u16, u16)>,
	otb_state: tauri::State<'_, OtbState>,
	map_state: tauri::State<'_, MapState>,
	materials_state: tauri::State<'_, MaterialsState>,
	placement_state: tauri::State<'_, PlacementState>,
	lua_state: tauri::State<'_, LuaState>,
) -> Result<Response, String> {
	if xs.len() != ys.len() {
		return Err("xs and ys length mismatch".into());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty_otb = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty_otb);
	let client_id = match otb_guard.as_ref() {
		Some(o) => o.client_id(server_id).unwrap_or(0),
		None => server_id,
	};

	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let lua_guard = lua_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let _lua = ScopedLua::enter(&lua_guard);

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let anchor = replace.filter(|_| is_ground && !is_doodad);
	let mut edit_tiles: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	if let Some(pos) = anchor {
		edit_tiles.push(pos);
	}
	m.ensure_tiles(z, &edit_tiles, otb)?;
	let (xs, ys) = match (anchor, mats) {
		(Some(pos), Some(mt)) => replace_filter(m, mt, &place, z, &xs, &ys, pos),
		_ => (xs, ys),
	};
	m.record_begin();
	let touched = run_paint(m, mats, &place, otb, z, &xs, &ys, server_id, client_id, is_ground, is_doodad, &brush_name, automagic, false, is_raw);
	m.record_commit(ACTION_PAINT);
	advance_roll_salt();
	let keys: Vec<u32> = touched.into_iter().collect();
	m.ensure_chunks(z, &keys, otb)?;
	let mut out: Vec<u8> = Vec::new();
	push_u32(&mut out, keys.len() as u32);
	for key in &keys {
		push_u32(&mut out, *key);
	}
	out.extend_from_slice(&serialize_chunks(m, z, &keys));
	Ok(Response::new(out))
}

const FLOOD_LIMIT: usize = 250_000;

fn ground_key(m: &MapModel, mats: Option<&Materials>, place: &HashMap<u16, PlaceFlags>, z: u8, x: u16, y: u16) -> u64 {
	match first_item_at(m, z, x, y) {
		Some((client, server)) if is_ground_item(place, mats, client, server) => {
			match mats.and_then(|mt| mt.server_to_ground.get(&server)) {
				Some(&brush) => (1u64 << 32) | brush as u64,
				None => server as u64,
			}
		}
		_ => u64::MAX,
	}
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn ground_mask(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	w: u16,
	h: u16,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Response, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let cells = w as usize * h as usize;
	if cells == 0 {
		return Ok(Response::new(Vec::new()));
	}
	let max_x = x.saturating_add(w.saturating_sub(1));
	let max_y = y.saturating_add(h.saturating_sub(1));
	m.ensure_span(z, x, y, max_x, max_y, otb)?;

	let mut out = vec![0u8; cells.div_ceil(8)];
	for gy in 0..h {
		for gx in 0..w {
			let (tx, ty) = (x.saturating_add(gx), y.saturating_add(gy));
			let has_ground = first_item_at(m, z, tx, ty).is_some_and(|(c, s)| is_ground_item(&place, mats, c, s));
			if has_ground {
				let idx = gy as usize * w as usize + gx as usize;
				out[idx >> 3] |= 1 << (idx & 7);
			}
		}
	}
	Ok(Response::new(out))
}

fn flood_tiles(
	m: &MapModel,
	mats: Option<&Materials>,
	place: &HashMap<u16, PlaceFlags>,
	z: u8,
	x: u16,
	y: u16,
	contiguous: bool,
) -> Vec<(u16, u16)> {
	let max_x = m.width.saturating_sub(1).max(m.max_x);
	let max_y = m.height.saturating_sub(1).max(m.max_y);
	let mut found: Vec<(u16, u16)> = Vec::new();
	if x > max_x || y > max_y {
		return found;
	}
	let want = ground_key(m, mats, place, z, x, y);
	if contiguous {
		let mut seen: HashSet<u32> = HashSet::new();
		let mut queue: Vec<(u16, u16)> = vec![(x, y)];
		seen.insert((x as u32) << 16 | y as u32);
		while let Some((cx, cy)) = queue.pop() {
			found.push((cx, cy));
			if found.len() >= FLOOD_LIMIT {
				break;
			}
			for (dx, dy) in [(0i32, -1i32), (-1, 0), (1, 0), (0, 1)] {
				let nx = cx as i32 + dx;
				let ny = cy as i32 + dy;
				if nx < 0 || ny < 0 || nx > max_x as i32 || ny > max_y as i32 {
					continue;
				}
				let (nx, ny) = (nx as u16, ny as u16);
				if !seen.insert((nx as u32) << 16 | ny as u32) {
					continue;
				}
				if ground_key(m, mats, place, z, nx, ny) == want {
					queue.push((nx, ny));
				}
			}
		}
		return found;
	}
	if want == u64::MAX {
		return found;
	}
	'scan: for sy in 0..=max_y {
		for sx in 0..=max_x {
			if ground_key(m, mats, place, z, sx, sy) == want {
				found.push((sx, sy));
				if found.len() >= FLOOD_LIMIT {
					break 'scan;
				}
			}
		}
	}
	found
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn flood_region(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	contiguous: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Response, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.ensure_floor(z, otb)?;

	let found = flood_tiles(m, mats, &place, z, x, y, contiguous);

	let mut out: Vec<u8> = Vec::new();
	push_u32(&mut out, found.len() as u32);
	for (fx, fy) in found {
		push_u16(&mut out, fx);
		push_u16(&mut out, fy);
	}
	Ok(Response::new(out))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn paint_zone(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	flag: u32,
	set: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	if xs.len() != ys.len() {
		return Err("xs and ys length mismatch".into());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let edit_tiles: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	m.ensure_tiles(z, &edit_tiles, otb)?;
	m.record_begin();

	let mut touched: HashSet<u32> = HashSet::new();
	for i in 0..xs.len() {
		let (x, y) = (xs[i], ys[i]);
		if set {
			let stack = stack_at(m, z, x, y);
			let has_ground = stack.first().is_some_and(|&(c, s)| is_ground_item(&place, mats, c, s));
			if !has_ground {
				continue;
			}
		}
		let cur = flags_at(m, z, x, y);
		let next = if set { cur | flag } else { cur & !flag };
		if next != cur {
			m.set_tile_flags(z, x, y, next);
			touched.insert(chunk_key_of(x, y));
		}
	}
	m.record_commit(ACTION_FLAG);
	Ok(touched.into_iter().collect())
}

const HOUSE_PZ_FLAG: u32 = 0x01;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn set_house(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	house_id: u32,
	set: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	if xs.len() != ys.len() {
		return Err("xs and ys length mismatch".into());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let edit_tiles: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	m.ensure_tiles(z, &edit_tiles, otb)?;
	m.record_begin();

	let mut touched: HashSet<u32> = HashSet::new();
	for i in 0..xs.len() {
		let (x, y) = (xs[i], ys[i]);
		if set {
			let stack = stack_at(m, z, x, y);
			let has_ground = stack.first().is_some_and(|&(c, s)| is_ground_item(&place, mats, c, s));
			if !has_ground {
				continue;
			}
			let mut changed = false;
			if house_id_at(m, z, x, y) != house_id {
				m.set_tile_house_id(z, x, y, house_id);
				changed = true;
			}
			let flags = flags_at(m, z, x, y);
			if flags & HOUSE_PZ_FLAG == 0 {
				m.set_tile_flags(z, x, y, flags | HOUSE_PZ_FLAG);
				changed = true;
			}
			if let Some(mats) = mats {
				let has_door = stack_at(m, z, x, y).iter().any(|&(_, s)| mats.is_door(s));
				if has_door && door_id_at(m, z, x, y) == 0 {
					let door = empty_door_id(m, house_id);
					if door != 0 {
						m.set_tile_door_id(z, x, y, door);
						changed = true;
					}
				}
			}
			if changed {
				touched.insert(chunk_key_of(x, y));
			}
		} else {
			let was_house = house_id_at(m, z, x, y) != 0;
			if !was_house {
				continue;
			}
			m.set_tile_house_id(z, x, y, 0);
			let flags = flags_at(m, z, x, y);
			if flags & HOUSE_PZ_FLAG != 0 {
				m.set_tile_flags(z, x, y, flags & !HOUSE_PZ_FLAG);
			}
			touched.insert(chunk_key_of(x, y));
		}
	}
	m.record_commit(ACTION_HOUSE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
pub fn house_sizes(
	map_id: u32,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<HashMap<u32, u32>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	for z in m.available_floors.clone() {
		m.ensure_floor(z, otb)?;
	}

	let mut sizes: HashMap<u32, u32> = HashMap::new();
	for z in m.available_floors.clone() {
		let Some(floor) = m.floors.get(&z) else { continue };
		let keys: Vec<u32> = floor.keys().copied().collect();
		for k in keys {
			let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&k)) else { continue };
			for t in start as usize..end as usize {
				let (x, y) = (m.tile_x[t], m.tile_y[t]);
				let id = house_id_at(m, z, x, y);
				if id != 0 {
					*sizes.entry(id).or_insert(0) += 1;
				}
			}
		}
	}
	for (&z, chunks) in &m.house_edits {
		for posmap in chunks.values() {
			for (&pos, &id) in posmap {
				let (x, y) = ((pos >> 16) as u16, (pos & 0xFFFF) as u16);
				let on_base = m
					.floors
					.get(&z)
					.and_then(|f| f.get(&chunk_key_of(x, y)))
					.map(|&(s, e)| (s as usize..e as usize).any(|t| m.tile_x[t] == x && m.tile_y[t] == y))
					.unwrap_or(false);
				if !on_base && id != 0 {
					*sizes.entry(id).or_insert(0) += 1;
				}
			}
		}
	}
	Ok(sizes)
}

const PREVIEW_AREA_CAP: u32 = 262144;
const PREVIEW_AUTOMAGIC_CAP: usize = 16384;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn preview_paint(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	server_id: u16,
	is_ground: bool,
	is_doodad: bool,
	is_raw: bool,
	brush_name: String,
	automagic: bool,
	delta_only: bool,
	otb_state: tauri::State<'_, OtbState>,
	map_state: tauri::State<'_, MapState>,
	materials_state: tauri::State<'_, MaterialsState>,
	placement_state: tauri::State<'_, PlacementState>,
) -> Result<Response, String> {
	let empty = || Response::new(vec![0u8; 4]);
	if xs.len() != ys.len() || xs.is_empty() {
		return Ok(empty());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty_otb = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty_otb);
	let client_id = match otb_guard.as_ref() {
		Some(o) => o.client_id(server_id).unwrap_or(0),
		None => server_id,
	};
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let Some(mats) = materials_guard.as_ref() else {
		return Ok(empty());
	};
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let min_x = *xs.iter().min().unwrap();
	let max_x = *xs.iter().max().unwrap();
	let min_y = *ys.iter().min().unwrap();
	let max_y = *ys.iter().max().unwrap();
	let area = (max_x as u32 - min_x as u32 + 1) * (max_y as u32 - min_y as u32 + 1);
	if area > PREVIEW_AREA_CAP {
		return Ok(empty());
	}

	let clamp = |v: i32| v.clamp(0, u16::MAX as i32) as u16;
	let (sx0, sy0) = (clamp(min_x as i32 - 2), clamp(min_y as i32 - 2));
	let (sx1, sy1) = (clamp(max_x as i32 + 2), clamp(max_y as i32 + 2));
	let span_w = (sx1 - sx0) as usize + 1;

	let mut scratch;
	let mut base: Vec<Vec<(u16, u16)>> = Vec::with_capacity(span_w * ((sy1 - sy0) as usize + 1));
	{
		let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
		let real = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
		let edit_tiles: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
		real.ensure_tiles(z, &edit_tiles, otb)?;
		scratch = empty_model(real.width, real.height);
		for y in sy0..=sy1 {
			for x in sx0..=sx1 {
				base.push(stack_at(real, z, x, y));
			}
		}
	}

	for (i, s) in base.iter().enumerate() {
		if s.is_empty() {
			continue;
		}
		let x = sx0 + (i % span_w) as u16;
		let y = sy0 + (i / span_w) as u16;
		*tile_stack_mut(&mut scratch, z, x, y) = s.clone();
	}

	let base_at = |x: u16, y: u16| -> &[(u16, u16)] {
		if x < sx0 || x > sx1 || y < sy0 || y > sy1 {
			return &[];
		}
		&base[(y - sy0) as usize * span_w + (x - sx0) as usize]
	};

	let automagic = automagic && xs.len() <= PREVIEW_AUTOMAGIC_CAP;
	run_paint(&mut scratch, Some(mats), &place, otb, z, &xs, &ys, server_id, client_id, is_ground, is_doodad, &brush_name, automagic, false, is_raw);

	let mut out: Vec<u8> = Vec::new();
	push_u32(&mut out, 0);
	let mut count = 0u32;
	for y in clamp(min_y as i32 - 1)..=clamp(max_y as i32 + 1) {
		for x in clamp(min_x as i32 - 1)..=clamp(max_x as i32 + 1) {
			let new = stack_at(&scratch, z, x, y);
			let old = base_at(x, y);
			if new == old {
				continue;
			}
			let start = if delta_only { new.iter().zip(old.iter()).take_while(|(a, b)| a == b).count() } else { 0 };
			let added = &new[start..];
			if added.is_empty() {
				continue;
			}
			push_u16(&mut out, x);
			push_u16(&mut out, y);
			push_u16(&mut out, added.len() as u16);
			for (client, _) in added {
				push_u16(&mut out, *client);
			}
			count += 1;
		}
	}
	out[0..4].copy_from_slice(&count.to_le_bytes());
	Ok(Response::new(out))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn move_item(
	map_id: u32,
	z: u8,
	from_x: u16,
	from_y: u16,
	to_x: u16,
	to_y: u16,
	automagic: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	if from_x == to_x && from_y == to_y {
		return Ok(Vec::new());
	}
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.ensure_tiles(z, &[(from_x, from_y), (to_x, to_y)], otb)?;
	if stack_at(m, z, from_x, from_y).is_empty() {
		return Ok(Vec::new());
	}
	m.record_begin();
	let (client, server) = tile_stack_mut(m, z, from_x, from_y).pop().expect("source tile is non-empty");
	insert_ordered(tile_stack_mut(m, z, to_x, to_y), &place, mats, client, server);

	let mut touched: HashSet<u32> = [chunk_key_of(from_x, from_y), chunk_key_of(to_x, to_y)].into_iter().collect();
	if automagic {
		if let Some(mats) = mats {
			let tiles: HashSet<(u16, u16)> = [(from_x, from_y), (to_x, to_y)].into_iter().collect();
			touched.extend(auto_after_change(m, mats, &place, otb, z, &tiles, client, server, false));
		}
	}
	m.record_commit(ACTION_MOVE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn move_selection(
	map_id: u32,
	zs: Vec<u8>,
	xs: Vec<u16>,
	ys: Vec<u16>,
	all: Vec<bool>,
	dx: i32,
	dy: i32,
	automagic: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<(u8, u32)>, String> {
	if xs.len() != ys.len() || xs.len() != all.len() || xs.len() != zs.len() {
		return Err("selection arrays length mismatch".into());
	}
	if dx == 0 && dy == 0 {
		return Ok(Vec::new());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let dest = |x: u16, y: u16| -> Option<(u16, u16)> {
		let nx = x as i32 + dx;
		let ny = y as i32 + dy;
		if (0..=u16::MAX as i32).contains(&nx) && (0..=u16::MAX as i32).contains(&ny) {
			Some((nx as u16, ny as u16))
		} else {
			None
		}
	};

	let mut by_floor: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for i in 0..xs.len() {
		if let Some((nx, ny)) = dest(xs[i], ys[i]) {
			let f = by_floor.entry(zs[i]).or_default();
			f.push((xs[i], ys[i]));
			f.push((nx, ny));
		}
	}
	for (&z, tiles) in &by_floor {
		m.ensure_tiles(z, tiles, otb)?;
	}
	m.record_begin();

	let mut touched: HashSet<(u8, u32)> = HashSet::new();
	let mut affected: HashMap<u8, HashSet<(u16, u16)>> = HashMap::new();
	let mut moved: Vec<(u8, u16, u16, Vec<(u16, u16)>)> = Vec::new();
	for i in 0..xs.len() {
		let (z, x, y) = (zs[i], xs[i], ys[i]);
		let Some((nx, ny)) = dest(x, y) else {
			continue;
		};
		let stack = tile_stack_mut(m, z, x, y);
		let items = if all[i] {
			std::mem::take(stack)
		} else {
			match stack.pop() {
				Some(item) => vec![item],
				None => Vec::new(),
			}
		};
		if items.is_empty() {
			continue;
		}
		touched.insert((z, chunk_key_of(x, y)));
		affected.entry(z).or_default().insert((x, y));
		moved.push((z, nx, ny, items));
	}

	for (z, nx, ny, items) in moved {
		for (client, server) in items {
			insert_ordered(tile_stack_mut(m, z, nx, ny), &place, mats, client, server);
		}
		touched.insert((z, chunk_key_of(nx, ny)));
		affected.entry(z).or_default().insert((nx, ny));
	}

	if automagic {
		if let Some(mats) = mats {
			for (&z, tiles) in &affected {
				touched.extend(auto_all(m, mats, &place, otb, z, tiles).into_iter().map(|k| (z, k)));
			}
		}
	}
	m.record_commit(ACTION_MOVE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
pub fn delete_item(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	automagic: bool,
	ground_only: bool,
	leave_unique: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.ensure_tiles(z, &[(x, y)], otb)?;
	m.record_begin();

	let unique: Vec<bool> = if leave_unique { complex_flags(m, z, x, y) } else { Vec::new() };
	let stack = tile_stack_mut(m, z, x, y);
	let before = stack.len();
	let (g, b) = (crate::scripting::ground_class(), crate::scripting::border_class());
	let mut idx = 0;
	stack.retain(|&(c, s)| {
		let cl = order_class(&place, mats, c, s);
		let keep = if ground_only { cl != g } else { cl == g || cl == b };
		let unique_here = unique.get(idx).copied().unwrap_or(false);
		idx += 1;
		keep || unique_here
	});
	let removed_any = stack.len() != before;

	let mut touched: HashSet<u32> = [chunk_key_of(x, y)].into_iter().collect();
	if automagic && removed_any {
		if let Some(mats) = mats {
			let tiles: HashSet<(u16, u16)> = [(x, y)].into_iter().collect();
			touched.extend(auto_all(m, mats, &place, otb, z, &tiles));
		}
	}
	m.record_commit(ACTION_ERASE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
pub fn remove_item_at(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	client_id: u16,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Vec<u32>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.ensure_tiles(z, &[(x, y)], otb)?;
	m.record_begin();
	let stack = tile_stack_mut(m, z, x, y);
	let before = stack.len();
	stack.retain(|&(c, _)| c != client_id);
	let removed = stack.len() != before;
	m.record_commit(ACTION_ERASE);
	Ok(if removed { vec![chunk_key_of(x, y)] } else { Vec::new() })
}

#[tauri::command]
pub fn remove_items_with_client_ids(
	map_id: u32,
	client_ids: Vec<u16>,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Vec<(u32, u8)>, String> {
	let wanted: HashSet<u16> = client_ids.into_iter().collect();
	if wanted.is_empty() {
		return Ok(Vec::new());
	}
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let floors = m.available_floors.clone();
	for z in floors.iter().copied() {
		m.ensure_floor(z, otb)?;
	}

	let mut targets: Vec<(u8, u16, u16)> = Vec::new();
	for z in floors {
		let mut positions: Vec<(u16, u16)> = Vec::new();
		if let Some(f) = m.floors.get(&z) {
			for &(start, end) in f.values() {
				for t in start as usize..end as usize {
					positions.push((m.tile_x[t], m.tile_y[t]));
				}
			}
		}
		if let Some(c) = m.edits.get(&z) {
			for tiles in c.values() {
				for &pos in tiles.keys() {
					positions.push(((pos >> 16) as u16, (pos & 0xFFFF) as u16));
				}
			}
		}
		positions.sort_unstable();
		positions.dedup();
		for (x, y) in positions {
			if stack_at(m, z, x, y).iter().any(|&(c, _)| wanted.contains(&c)) {
				targets.push((z, x, y));
			}
		}
	}
	if targets.is_empty() {
		return Ok(Vec::new());
	}

	m.record_begin();
	let mut touched: HashSet<(u32, u8)> = HashSet::new();
	for (z, x, y) in targets {
		let stack = tile_stack_mut(m, z, x, y);
		let before = stack.len();
		stack.retain(|&(c, _)| !wanted.contains(&c));
		if stack.len() != before {
			touched.insert((chunk_key_of(x, y), z));
		}
	}
	m.record_commit(ACTION_ERASE);
	Ok(touched.into_iter().collect())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
	pub total: u32,
	pub counts: Vec<u32>,
	pub touched: Vec<(u8, u32)>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePair {
	pub from: u16,
	pub to: u16,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceScope {
	#[serde(default)]
	pub floors: Vec<u8>,
	#[serde(default)]
	pub zs: Vec<u8>,
	#[serde(default)]
	pub xs: Vec<u16>,
	#[serde(default)]
	pub ys: Vec<u16>,
	#[serde(default)]
	pub all: Vec<bool>,
}

impl ReplaceScope {
	fn tiles_by_floor(&self) -> Result<HashMap<u8, Vec<(u16, u16, bool)>>, String> {
		if self.xs.len() != self.ys.len() || self.xs.len() != self.zs.len() {
			return Err("scope tile arrays length mismatch".into());
		}
		let mut by_floor: HashMap<u8, Vec<(u16, u16, bool)>> = HashMap::new();
		for i in 0..self.xs.len() {
			let whole_stack = self.all.get(i).copied().unwrap_or(true);
			by_floor.entry(self.zs[i]).or_default().push((self.xs[i], self.ys[i], whole_stack));
		}
		for tiles in by_floor.values_mut() {
			tiles.sort_unstable_by(|a, b| (a.0, a.1, b.2).cmp(&(b.0, b.1, a.2)));
			tiles.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);
		}
		Ok(by_floor)
	}

	fn floors_of(&self, m: &MapModel) -> Vec<u8> {
		if self.floors.is_empty() {
			m.available_floors.clone()
		} else {
			self.floors.clone()
		}
	}
}

fn positions_of(tiles: &[(u16, u16, bool)]) -> Vec<(u16, u16)> {
	tiles.iter().map(|&(x, y, _)| (x, y)).collect()
}

fn scoped_items(stack: &[(u16, u16)], whole_stack: bool) -> &[(u16, u16)] {
	if whole_stack || stack.is_empty() {
		stack
	} else {
		&stack[stack.len() - 1..]
	}
}

fn tally_stack(stack: &[(u16, u16)], wanted: &HashMap<u16, usize>, counts: &mut [u32]) {
	for &(_, server_id) in stack {
		if let Some(&i) = wanted.get(&server_id) {
			counts[i] += 1;
		}
	}
}

fn tally_floor(m: &MapModel, z: u8, wanted: &HashMap<u16, usize>, counts: &mut [u32]) {
	let floor_edits = m.edits.get(&z);
	if let Some(f) = m.floors.get(&z) {
		for (&chunk_key, &(start, end)) in f {
			let edited = floor_edits.and_then(|c| c.get(&chunk_key));
			for t in start as usize..end as usize {
				let pos = ((m.tile_x[t] as u32) << 16) | m.tile_y[t] as u32;
				if edited.is_some_and(|tiles| tiles.contains_key(&pos)) {
					continue;
				}
				let s = m.item_off[t] as usize;
				let e = m.item_off[t + 1] as usize;
				for &server_id in &m.server_ids[s..e] {
					if let Some(&i) = wanted.get(&server_id) {
						counts[i] += 1;
					}
				}
			}
		}
	}
	if let Some(c) = floor_edits {
		for tiles in c.values() {
			for stack in tiles.values() {
				tally_stack(stack, wanted, counts);
			}
		}
	}
}

fn collect_floor_hits(m: &MapModel, z: u8, wanted: &HashMap<u16, usize>) -> Vec<(u32, u32, Vec<(u16, u16)>)> {
	let mut hits: Vec<(u32, u32, Vec<(u16, u16)>)> = Vec::new();
	let floor_edits = m.edits.get(&z);
	if let Some(f) = m.floors.get(&z) {
		for (&chunk_key, &(start, end)) in f {
			let edited = floor_edits.and_then(|c| c.get(&chunk_key));
			for t in start as usize..end as usize {
				let pos = ((m.tile_x[t] as u32) << 16) | m.tile_y[t] as u32;
				if edited.is_some_and(|tiles| tiles.contains_key(&pos)) {
					continue;
				}
				let s = m.item_off[t] as usize;
				let e = m.item_off[t + 1] as usize;
				if !m.server_ids[s..e].iter().any(|id| wanted.contains_key(id)) {
					continue;
				}
				hits.push((chunk_key, pos, (s..e).map(|j| (m.client_ids[j], m.server_ids[j])).collect()));
			}
		}
	}
	if let Some(c) = floor_edits {
		for (&chunk_key, tiles) in c {
			for (&pos, stack) in tiles {
				if stack.iter().any(|&(_, id)| wanted.contains_key(&id)) {
					hits.push((chunk_key, pos, stack.clone()));
				}
			}
		}
	}
	hits
}

#[tauri::command]
pub fn distinct_items(
	map_id: u32,
	scope: ReplaceScope,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Vec<u16>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let mut found: HashSet<u16> = HashSet::new();
	let scoped_tiles = scope.tiles_by_floor()?;
	if scoped_tiles.is_empty() {
		for z in scope.floors_of(m) {
			m.ensure_floor(z, otb)?;
			if let Some(f) = m.floors.get(&z) {
				let floor_edits = m.edits.get(&z);
				for (&chunk_key, &(start, end)) in f {
					let edited = floor_edits.and_then(|c| c.get(&chunk_key));
					for t in start as usize..end as usize {
						let pos = ((m.tile_x[t] as u32) << 16) | m.tile_y[t] as u32;
						if edited.is_some_and(|tiles| tiles.contains_key(&pos)) {
							continue;
						}
						found.extend(&m.server_ids[m.item_off[t] as usize..m.item_off[t + 1] as usize]);
					}
				}
			}
			if let Some(c) = m.edits.get(&z) {
				for tiles in c.values() {
					for stack in tiles.values() {
						found.extend(stack.iter().map(|&(_, id)| id));
					}
				}
			}
		}
	} else {
		for (&z, tiles) in &scoped_tiles {
			m.ensure_tiles(z, &positions_of(tiles), otb)?;
		}
		for (&z, tiles) in &scoped_tiles {
			for &(x, y, whole_stack) in tiles {
				with_stack(m, z, x, y, |stack| found.extend(scoped_items(stack, whole_stack).iter().map(|&(_, id)| id)));
			}
		}
	}

	let mut ids: Vec<u16> = found.into_iter().filter(|&id| id != 0).collect();
	ids.sort_unstable();
	Ok(ids)
}

#[tauri::command]
pub fn count_items(
	map_id: u32,
	ids: Vec<u16>,
	scope: ReplaceScope,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Vec<u32>, String> {
	let mut counts = vec![0u32; ids.len()];
	if ids.is_empty() {
		return Ok(counts);
	}
	let wanted: HashMap<u16, usize> = ids.iter().enumerate().map(|(i, &id)| (id, i)).collect();

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	count_in_model(m, &scope, &wanted, &mut counts, otb)?;
	Ok(counts)
}

fn count_in_model(
	m: &mut MapModel,
	scope: &ReplaceScope,
	wanted: &HashMap<u16, usize>,
	counts: &mut [u32],
	otb: &OtbItems,
) -> Result<(), String> {
	let scoped_tiles = scope.tiles_by_floor()?;
	if scoped_tiles.is_empty() {
		for z in scope.floors_of(m) {
			m.ensure_floor(z, otb)?;
			tally_floor(m, z, wanted, counts);
		}
		return Ok(());
	}

	for (&z, tiles) in &scoped_tiles {
		m.ensure_tiles(z, &positions_of(tiles), otb)?;
	}
	for (&z, tiles) in &scoped_tiles {
		for &(x, y, whole_stack) in tiles {
			with_stack(m, z, x, y, |stack| tally_stack(scoped_items(stack, whole_stack), wanted, counts));
		}
	}
	Ok(())
}

#[tauri::command]
pub fn replace_items(
	map_id: u32,
	pairs: Vec<ReplacePair>,
	scope: ReplaceScope,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<ReplaceResult, String> {
	let mut counts = vec![0u32; pairs.len()];
	if pairs.is_empty() {
		return Ok(ReplaceResult { total: 0, counts, touched: Vec::new() });
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);

	let mut wanted: HashMap<u16, usize> = HashMap::new();
	let mut targets: Vec<(u16, u16)> = Vec::with_capacity(pairs.len());
	for (i, pair) in pairs.iter().enumerate() {
		let client_id = otb.client_id(pair.to).unwrap_or(pair.to);
		targets.push((client_id, pair.to));
		wanted.entry(pair.from).or_insert(i);
	}

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let touched = replace_in_model(m, &scope, &wanted, &targets, &mut counts, otb)?;
	let total = counts.iter().sum();
	Ok(ReplaceResult { total, counts, touched })
}

fn replace_in_model(
	m: &mut MapModel,
	scope: &ReplaceScope,
	wanted: &HashMap<u16, usize>,
	targets: &[(u16, u16)],
	counts: &mut [u32],
	otb: &OtbItems,
) -> Result<Vec<(u8, u32)>, String> {
	let scoped_tiles = scope.tiles_by_floor()?;
	let mut touched: HashSet<(u8, u32)> = HashSet::new();
	m.record_begin();

	if scoped_tiles.is_empty() {
		for z in scope.floors_of(m) {
			m.ensure_floor(z, otb)?;
			for (chunk_key, pos, mut stack) in collect_floor_hits(m, z, wanted) {
				let before = stack.clone();
				for entry in stack.iter_mut() {
					if let Some(&i) = wanted.get(&entry.1) {
						*entry = targets[i];
						counts[i] += 1;
					}
				}
				m.record_stack_before(z, pos, before);
				m.edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, stack);
				touched.insert((z, chunk_key));
			}
		}
	} else {
		for (&z, tiles) in &scoped_tiles {
			m.ensure_tiles(z, &positions_of(tiles), otb)?;
		}
		for (&z, tiles) in &scoped_tiles {
			for &(x, y, whole_stack) in tiles {
				let mut changed = false;
				let stack = tile_stack_mut(m, z, x, y);
				let first = if whole_stack { 0 } else { stack.len().saturating_sub(1) };
				for entry in stack[first..].iter_mut() {
					if let Some(&i) = wanted.get(&entry.1) {
						*entry = targets[i];
						counts[i] += 1;
						changed = true;
					}
				}
				if changed {
					touched.insert((z, chunk_key_of(x, y)));
				}
			}
		}
	}

	m.record_commit(ACTION_PAINT);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
pub fn switch_door(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
) -> Result<Vec<u32>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let Some(mats) = materials_guard.as_ref() else {
		return Ok(Vec::new());
	};

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.ensure_tiles(z, &[(x, y)], otb)?;

	m.record_begin();
	if !flip_door(m, mats, otb, z, x, y) {
		m.record_commit(ACTION_PAINT);
		return Ok(Vec::new());
	}
	m.record_commit(ACTION_PAINT);
	Ok(vec![chunk_key_of(x, y)])
}

fn flip_door(m: &mut MapModel, mats: &Materials, otb: &OtbItems, z: u8, x: u16, y: u16) -> bool {
	let found = stack_at(m, z, x, y).iter().enumerate().find_map(|(i, &(_, server))| {
		let door = mats.door_of(server)?;
		let brush = mats.wall_brush_for(server)?;
		let alignment = mats.wall_alignment_of(server)?;
		let id = mats.door_id_for(brush, alignment, door.kind, !door.open, door_locked_pref())?;
		(id != server).then_some((i, id))
	});
	let Some((idx, id)) = found else {
		return false;
	};
	tile_stack_mut(m, z, x, y)[idx] = (otb.client_id(id).unwrap_or(id), id);
	true
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn erase_brush(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	server_id: u16,
	automagic: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	if xs.len() != ys.len() {
		return Err("xs and ys length mismatch".into());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let tiles_vec: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	m.ensure_tiles(z, &tiles_vec, otb)?;
	m.record_begin();

	let mut touched: HashSet<u32> = tiles_vec.iter().map(|&(x, y)| chunk_key_of(x, y)).collect();
	let mut removed: HashSet<(u16, u16)> = HashSet::new();
	let door_mats = mats.filter(|mt| mt.door_of(server_id).is_some());
	let is_own_border = |s: u16| mats.is_some_and(|mt| mt.is_border_of_ground(server_id, s));
	for &(x, y) in &tiles_vec {
		if let Some(mt) = door_mats {
			if restore_wall_under_doors(m, mt, otb, z, x, y) {
				removed.insert((x, y));
			}
			continue;
		}
		let stack = tile_stack_mut(m, z, x, y);
		let before = stack.len();
		stack.retain(|&(_, s)| !same_brush(mats, server_id, s));
		if stack.len() != before {
			removed.insert((x, y));
		}
		let before = stack.len();
		stack.retain(|&(_, s)| !is_own_border(s));
		if stack.len() != before {
			touched.insert(chunk_key_of(x, y));
		}
	}

	if automagic && !removed.is_empty() {
		if let Some(mats) = mats {
			touched.extend(auto_all(m, mats, &place, otb, z, &removed));
		}
	}
	m.record_commit(ACTION_ERASE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn borderize_brush(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	remove: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	if xs.len() != ys.len() {
		return Err("xs and ys length mismatch".into());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let tiles_vec: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	m.ensure_tiles(z, &tiles_vec, otb)?;
	m.record_begin();

	let mut touched: HashSet<u32> = tiles_vec.iter().map(|&(x, y)| chunk_key_of(x, y)).collect();
	if let Some(mats) = mats {
		if remove {
			for &(x, y) in &tiles_vec {
				let stack = tile_stack_mut(m, z, x, y);
				let before = stack.len();
				stack.retain(|&(_, s)| !mats.is_border_item(s));
				if stack.len() != before {
					touched.insert(chunk_key_of(x, y));
				}
			}
		} else {
			let tiles: HashSet<(u16, u16)> = tiles_vec.into_iter().collect();
			touched.extend(borderize(m, mats, &place, otb, z, &tiles, true, true));
			touched.extend(wallize(m, mats, otb, z, &tiles));
			touched.extend(realign8(m, mats, otb, z, &tiles, Materials::table_brush_for, Materials::table_id_for));
			touched.extend(realign8(m, mats, otb, z, &tiles, Materials::carpet_brush_for, Materials::carpet_id_for));
		}
	}
	m.record_commit(ACTION_PAINT);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn erase_area(
	map_id: u32,
	z: u8,
	x0: u16,
	y0: u16,
	x1: u16,
	y1: u16,
	automagic: bool,
	ground_only: bool,
	leave_unique: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let (min_x, max_x) = (x0.min(x1), x0.max(x1));
	let (min_y, max_y) = (y0.min(y1), y0.max(y1));
	m.ensure_span(z, min_x, min_y, max_x, max_y, otb)?;
	let (g, b) = (crate::scripting::ground_class(), crate::scripting::border_class());
	let kept = |c: u16, s: u16| {
		let cl = order_class(&place, mats, c, s);
		if ground_only {
			cl != g
		} else {
			cl == g || cl == b
		}
	};
	let in_rect = |x: u16, y: u16| x >= min_x && x <= max_x && y >= min_y && y <= max_y;

	let mut to_erase: Vec<(u16, u16)> = Vec::new();
	for cy in (min_y as u32 / CHUNK)..=(max_y as u32 / CHUNK) {
		for cx in (min_x as u32 / CHUNK)..=(max_x as u32 / CHUNK) {
			let chunk = (cx << 16) | cy;
			let edited = m.edits.get(&z).and_then(|c| c.get(&chunk));
			if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&chunk)) {
				for t in start as usize..end as usize {
					let (x, y) = (m.tile_x[t], m.tile_y[t]);
					if !in_rect(x, y) {
						continue;
					}
					let pos = (x as u32) << 16 | y as u32;
					if edited.is_some_and(|e| e.contains_key(&pos)) {
						continue;
					}
					if (m.item_off[t] as usize..m.item_off[t + 1] as usize).any(|j| !kept(m.client_ids[j], m.server_ids[j])) {
						to_erase.push((x, y));
					}
				}
			}
			if let Some(e) = edited {
				for (&pos, stack) in e {
					let (x, y) = ((pos >> 16) as u16, (pos & 0xFFFF) as u16);
					if in_rect(x, y) && stack.iter().any(|&(c, s)| !kept(c, s)) {
						to_erase.push((x, y));
					}
				}
			}
		}
	}

	m.record_begin();
	let mut touched: HashSet<u32> = HashSet::new();
	let mut affected: HashSet<(u16, u16)> = HashSet::new();
	for (x, y) in to_erase {
		let unique: Vec<bool> = if leave_unique { complex_flags(m, z, x, y) } else { Vec::new() };
		let stack = tile_stack_mut(m, z, x, y);
		let before = stack.len();
		let mut idx = 0;
		stack.retain(|&(c, s)| {
			let keep = kept(c, s) || unique.get(idx).copied().unwrap_or(false);
			idx += 1;
			keep
		});
		if stack.len() != before {
			touched.insert(chunk_key_of(x, y));
			affected.insert((x, y));
		}
	}

	if automagic && !affected.is_empty() {
		if let Some(mats) = mats {
			touched.extend(auto_all(m, mats, &place, otb, z, &affected));
		}
	}
	m.record_commit(ACTION_ERASE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
pub fn erase_duplicates(
	map_id: u32,
	z: u8,
	x0: u16,
	y0: u16,
	x1: u16,
	y1: u16,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let (min_x, max_x) = (x0.min(x1), x0.max(x1));
	let (min_y, max_y) = (y0.min(y1), y0.max(y1));
	m.ensure_span(z, min_x, min_y, max_x, max_y, otb)?;
	let in_rect = |x: u16, y: u16| x >= min_x && x <= max_x && y >= min_y && y <= max_y;

	let mut positions: Vec<(u16, u16)> = Vec::new();
	for cy in (min_y as u32 / CHUNK)..=(max_y as u32 / CHUNK) {
		for cx in (min_x as u32 / CHUNK)..=(max_x as u32 / CHUNK) {
			let chunk = (cx << 16) | cy;
			let edited = m.edits.get(&z).and_then(|c| c.get(&chunk));
			if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&chunk)) {
				for t in start as usize..end as usize {
					let (x, y) = (m.tile_x[t], m.tile_y[t]);
					let pos = (x as u32) << 16 | y as u32;
					if in_rect(x, y) && !edited.is_some_and(|e| e.contains_key(&pos)) {
						positions.push((x, y));
					}
				}
			}
			if let Some(e) = edited {
				for &pos in e.keys() {
					let (x, y) = ((pos >> 16) as u16, (pos & 0xFFFF) as u16);
					if in_rect(x, y) {
						positions.push((x, y));
					}
				}
			}
		}
	}

	m.record_begin();
	let mut touched: HashSet<u32> = HashSet::new();
	for (x, y) in positions {
		if dedupe_tile(m, &place, z, x, y) {
			touched.insert(chunk_key_of(x, y));
		}
	}
	m.record_commit(ACTION_ERASE);
	Ok(touched.into_iter().collect())
}

fn dedupe_tile(m: &mut MapModel, place: &HashMap<u16, PlaceFlags>, z: u8, x: u16, y: u16) -> bool {
	let stack = stack_at(m, z, x, y);
	let entries: Vec<(ItemAttrs, Vec<ContainedItem>)> = (0..stack.len())
		.map(|i| {
			let key = attrs_key(z, x, y, i as u8);
			(
				m.item_attrs.get(&key).cloned().unwrap_or_default(),
				m.container_contents.get(&key).cloned().unwrap_or_default(),
			)
		})
		.collect();

	let mut keep = vec![true; stack.len()];
	let mut seen: Vec<usize> = Vec::new();
	for (i, &(c, s)) in stack.iter().enumerate() {
		if place.get(&c).is_some_and(|p| p.duplicable) {
			continue;
		}
		if seen.iter().any(|&j| stack[j] == (c, s) && entries[j] == entries[i]) {
			keep[i] = false;
		} else {
			seen.push(i);
		}
	}
	if keep.iter().all(|&k| k) {
		return false;
	}

	let mut next = 0usize;
	for i in 0..stack.len() {
		if !keep[i] {
			continue;
		}
		let key = attrs_key(z, x, y, next as u8);
		m.set_item_attr(key, entries[i].0.clone());
		m.set_container_contents(key, entries[i].1.clone());
		next += 1;
	}
	for i in next..stack.len() {
		let key = attrs_key(z, x, y, i as u8);
		m.set_item_attr(key, ItemAttrs::default());
		m.set_container_contents(key, Vec::new());
	}

	let mut i = 0usize;
	tile_stack_mut(m, z, x, y).retain(|_| {
		let k = keep[i];
		i += 1;
		k
	});
	true
}

fn auto_frontier(tiles: &HashSet<(u16, u16)>, voids: Option<&HashSet<(u16, u16)>>) -> HashSet<(u16, u16)> {
	let Some(voids) = voids else {
		return tiles.clone();
	};
	tiles
		.iter()
		.copied()
		.filter(|&(x, y)| {
			if !voids.contains(&(x, y)) {
				return true;
			}
			for dy in -1i32..=1 {
				for dx in -1i32..=1 {
					let nx = (x as i32 + dx).clamp(0, u16::MAX as i32) as u16;
					let ny = (y as i32 + dy).clamp(0, u16::MAX as i32) as u16;
					if !voids.contains(&(nx, ny)) {
						return true;
					}
				}
			}
			false
		})
		.collect()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
	pub removed: u32,
	pub touched: Vec<(u8, u32)>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn delete_selection(
	map_id: u32,
	zs: Vec<u8>,
	xs: Vec<u16>,
	ys: Vec<u16>,
	all: Vec<bool>,
	automagic: bool,
	otb_state: tauri::State<'_, OtbState>,
	map_state: tauri::State<'_, MapState>,
	materials_state: tauri::State<'_, MaterialsState>,
	placement_state: tauri::State<'_, PlacementState>,
) -> Result<DeleteResult, String> {
	if xs.len() != ys.len() || xs.len() != all.len() || xs.len() != zs.len() {
		return Err("selection arrays length mismatch".into());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let mut by_floor: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for i in 0..xs.len() {
		by_floor.entry(zs[i]).or_default().push((xs[i], ys[i]));
	}
	for (&z, tiles) in &by_floor {
		m.ensure_tiles(z, tiles, otb)?;
	}
	m.record_begin();

	let mut touched: HashSet<(u8, u32)> = HashSet::new();
	let mut affected: HashMap<u8, HashSet<(u16, u16)>> = HashMap::new();
	let mut emptied: HashMap<u8, HashSet<(u16, u16)>> = HashMap::new();
	let mut removed = 0u32;
	for i in 0..xs.len() {
		let (z, x, y) = (zs[i], xs[i], ys[i]);
		if first_item_at(m, z, x, y).is_none() {
			continue;
		}
		let stack = tile_stack_mut(m, z, x, y);
		if all[i] {
			stack.clear();
		} else {
			stack.pop();
		}
		if stack.is_empty() {
			emptied.entry(z).or_default().insert((x, y));
		}
		removed += 1;
		touched.insert((z, chunk_key_of(x, y)));
		affected.entry(z).or_default().insert((x, y));
	}

	if automagic {
		if let Some(mats) = mats {
			for (&z, tiles) in &affected {
				let ring = auto_frontier(tiles, emptied.get(&z));
				touched.extend(auto_all(m, mats, &place, otb, z, &ring).into_iter().map(|k| (z, k)));
			}
		}
	}
	m.record_commit(ACTION_DELETE);
	Ok(DeleteResult { removed, touched: touched.into_iter().collect() })
}

#[tauri::command]
pub fn copy_selection(
	map_id: u32,
	zs: Vec<u8>,
	xs: Vec<u16>,
	ys: Vec<u16>,
	all: Vec<bool>,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	clip_state: tauri::State<CopyBufferState>,
) -> Result<u32, String> {
	if xs.len() != ys.len() || xs.len() != all.len() || xs.len() != zs.len() {
		return Err("selection arrays length mismatch".into());
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let mut by_floor: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for i in 0..xs.len() {
		by_floor.entry(zs[i]).or_default().push((xs[i], ys[i]));
	}
	for (&z, tiles) in &by_floor {
		m.ensure_tiles(z, tiles, otb)?;
	}

	let min_x = xs.iter().copied().min().unwrap_or(0);
	let min_y = ys.iter().copied().min().unwrap_or(0);
	let min_z = zs.iter().copied().min().unwrap_or(0);

	let mut tiles: Vec<CopyTile> = Vec::new();
	for i in 0..xs.len() {
		let (z, x, y) = (zs[i], xs[i], ys[i]);
		let stack = stack_at(m, z, x, y);
		if stack.is_empty() {
			continue;
		}
		let items = if all[i] { stack } else { vec![*stack.last().unwrap()] };
		tiles.push(CopyTile { dx: x - min_x, dy: y - min_y, dz: (z as i16 - min_z as i16) as i8, items });
	}

	let count = tiles.len() as u32;
	*clip_state.lock().map_err(|e| format!("Lock error: {}", e))? = if tiles.is_empty() { None } else { Some(CopyBuffer { tiles }) };
	Ok(count)
}

#[tauri::command]
pub fn paste_selection(
	map_id: u32,
	x: u16,
	y: u16,
	z: u8,
	merge: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
	clip_state: tauri::State<CopyBufferState>,
) -> Result<Vec<(u8, u32)>, String> {
	let clip = clip_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let Some(buffer) = clip.as_ref() else {
		return Ok(Vec::new());
	};

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let target = |tile: &CopyTile| -> Option<(u8, u16, u16)> {
		let tx = x as u32 + tile.dx as u32;
		let ty = y as u32 + tile.dy as u32;
		let tz = z as i32 + tile.dz as i32;
		if tx > u16::MAX as u32 || ty > u16::MAX as u32 || !(0..=15).contains(&tz) {
			None
		} else {
			Some((tz as u8, tx as u16, ty as u16))
		}
	};

	let mut by_floor: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for tile in &buffer.tiles {
		if let Some((tz, tx, ty)) = target(tile) {
			by_floor.entry(tz).or_default().push((tx, ty));
		}
	}
	for (&tz, tiles) in &by_floor {
		m.ensure_tiles(tz, tiles, otb)?;
	}
	m.record_begin();

	let mut touched: HashSet<(u8, u32)> = HashSet::new();
	for tile in &buffer.tiles {
		let Some((tz, tx, ty)) = target(tile) else {
			continue;
		};
		let copied_has_ground = tile.items.iter().any(|&(c, s)| is_ground_item(&place, mats, c, s));
		if !merge && copied_has_ground {
			tile_stack_mut(m, tz, tx, ty).clear();
		}
		for &(client, server) in &tile.items {
			insert_ordered(tile_stack_mut(m, tz, tx, ty), &place, mats, client, server);
		}
		touched.insert((tz, chunk_key_of(tx, ty)));
	}
	m.record_commit(ACTION_PAINT);
	Ok(touched.into_iter().collect())
}

pub struct GenLayer {
	pub server_id: u16,
	pub is_ground: bool,
	pub is_doodad: bool,
	pub brush: String,
	pub z: u8,
	pub xs: Vec<u16>,
	pub ys: Vec<u16>,
}

struct Cursor<'a> {
	b: &'a [u8],
	o: usize,
}

impl<'a> Cursor<'a> {
	fn need(&self, n: usize) -> Result<(), String> {
		if self.o + n > self.b.len() {
			Err("generate payload truncated".into())
		} else {
			Ok(())
		}
	}
	fn u8(&mut self) -> Result<u8, String> {
		self.need(1)?;
		let v = self.b[self.o];
		self.o += 1;
		Ok(v)
	}
	fn u16(&mut self) -> Result<u16, String> {
		self.need(2)?;
		let v = u16::from_le_bytes([self.b[self.o], self.b[self.o + 1]]);
		self.o += 2;
		Ok(v)
	}
	fn u32(&mut self) -> Result<u32, String> {
		self.need(4)?;
		let v = u32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
		self.o += 4;
		Ok(v)
	}
	fn utf8(&mut self, n: usize) -> Result<String, String> {
		self.need(n)?;
		let s = String::from_utf8(self.b[self.o..self.o + n].to_vec()).map_err(|_| "invalid utf8 in generate payload")?;
		self.o += n;
		Ok(s)
	}
}

fn decode_generate(bytes: &[u8]) -> Result<(u32, bool, String, Vec<GenLayer>), String> {
	let mut c = Cursor { b: bytes, o: 0 };
	let map_id = c.u32()?;
	let automagic = c.u8()? != 0;
	let dir_len = c.u16()? as usize;
	let data_dir = c.utf8(dir_len)?;
	let layer_count = c.u32()? as usize;
	let mut layers = Vec::with_capacity(layer_count);
	for _ in 0..layer_count {
		let server_id = c.u16()?;
		let flags = c.u8()?;
		let z = c.u8()?;
		let brush_len = c.u16()? as usize;
		let brush = c.utf8(brush_len)?;
		let tile_count = c.u32()? as usize;
		let mut xs = Vec::with_capacity(tile_count);
		for _ in 0..tile_count {
			xs.push(c.u16()?);
		}
		let mut ys = Vec::with_capacity(tile_count);
		for _ in 0..tile_count {
			ys.push(c.u16()?);
		}
		layers.push(GenLayer {
			server_id,
			is_ground: flags & 1 != 0,
			is_doodad: flags & 2 != 0,
			brush,
			z,
			xs,
			ys,
		});
	}
	Ok((map_id, automagic, data_dir, layers))
}

#[tauri::command]
pub fn generate_apply(
	request: tauri::ipc::Request<'_>,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
	lua_state: tauri::State<LuaState>,
) -> Result<Vec<(u8, u32)>, String> {
	let body = match request.body() {
		tauri::ipc::InvokeBody::Raw(b) => b.as_slice(),
		_ => return Err("generate_apply expects a binary body".into()),
	};
	let (map_id, automagic, data_dir, layers) = decode_generate(body)?;

	if !data_dir.is_empty() {
		if let Ok(fresh) = Materials::load(std::path::Path::new(&data_dir)) {
			*materials_state.lock().map_err(|e| format!("Lock error: {}", e))? = Some(fresh);
		}
	}

	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty_otb = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty_otb);

	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let lua_guard = lua_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let _lua = ScopedLua::enter(&lua_guard);

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let mut tiles_by_z: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for layer in &layers {
		let bucket = tiles_by_z.entry(layer.z).or_default();
		for i in 0..layer.xs.len() {
			bucket.push((layer.xs[i], layer.ys[i]));
		}
	}
	for (&z, tiles) in &tiles_by_z {
		m.ensure_tiles(z, tiles, otb)?;
	}
	m.record_begin();

	let mut touched: HashSet<(u8, u32)> = HashSet::new();
	for (&z, tiles) in &tiles_by_z {
		for &(x, y) in tiles {
			tile_stack_mut(m, z, x, y).clear();
			touched.insert((z, chunk_key_of(x, y)));
		}
	}

	let mut affected: HashMap<u8, HashSet<(u16, u16)>> = HashMap::new();
	for layer in &layers {
		let client_id = match otb_guard.as_ref() {
			Some(o) => o.client_id(layer.server_id).unwrap_or(0),
			None => layer.server_id,
		};
		let keys = run_paint(
			m, mats, &place, otb, layer.z, &layer.xs, &layer.ys, layer.server_id, client_id, layer.is_ground, layer.is_doodad,
			&layer.brush, false, true, false,
		);
		touched.extend(keys.into_iter().map(|k| (layer.z, k)));
		let set = affected.entry(layer.z).or_default();
		for i in 0..layer.xs.len() {
			set.insert((layer.xs[i], layer.ys[i]));
		}
	}

	if automagic {
		if let Some(mats) = mats {
			let mut need_wall = false;
			let mut need_table = false;
			let mut need_carpet = false;
			for layer in &layers {
				if mats.wall_brush_for(layer.server_id).is_some() {
					need_wall = true;
				}
				if mats.table_brush_for(layer.server_id).is_some() {
					need_table = true;
				}
				if mats.carpet_brush_for(layer.server_id).is_some() {
					need_carpet = true;
				}
			}
			for (&z, tiles) in &affected {
				touched.extend(borderize(m, mats, &place, otb, z, tiles, true, false).into_iter().map(|k| (z, k)));
				if need_wall {
					touched.extend(wallize(m, mats, otb, z, tiles).into_iter().map(|k| (z, k)));
				}
				if need_table {
					let keys = realign8(m, mats, otb, z, tiles, Materials::table_brush_for, Materials::table_id_for);
					touched.extend(keys.into_iter().map(|k| (z, k)));
				}
				if need_carpet {
					let keys = realign8(m, mats, otb, z, tiles, Materials::carpet_brush_for, Materials::carpet_id_for);
					touched.extend(keys.into_iter().map(|k| (z, k)));
				}
			}
		}
	}
	m.record_commit(ACTION_PAINT);
	Ok(touched.into_iter().collect())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::map_model::{build_map_model, stack_at};
	use crate::formats::tibia::otb::parse_otb;
	use std::fs;
	use std::path::PathBuf;

	const DATA: &str = "../data/860";

	#[test]
	fn decode_generate_round_trips_layout() {
		let mut b: Vec<u8> = Vec::new();
		b.extend_from_slice(&7u32.to_le_bytes());
		b.push(1);
		let dir = b"d/860";
		b.extend_from_slice(&(dir.len() as u16).to_le_bytes());
		b.extend_from_slice(dir);
		b.extend_from_slice(&1u32.to_le_bytes());
		b.extend_from_slice(&4526u16.to_le_bytes());
		b.push(0b01);
		b.push(7);
		let brush = b"grass";
		b.extend_from_slice(&(brush.len() as u16).to_le_bytes());
		b.extend_from_slice(brush);
		b.extend_from_slice(&2u32.to_le_bytes());
		for x in [10u16, 11] {
			b.extend_from_slice(&x.to_le_bytes());
		}
		for y in [20u16, 21] {
			b.extend_from_slice(&y.to_le_bytes());
		}

		let (map_id, automagic, data_dir, layers) = decode_generate(&b).unwrap();
		assert_eq!(map_id, 7);
		assert!(automagic);
		assert_eq!(data_dir, "d/860");
		assert_eq!(layers.len(), 1);
		let l = &layers[0];
		assert_eq!(l.server_id, 4526);
		assert!(l.is_ground && !l.is_doodad);
		assert_eq!(l.z, 7);
		assert_eq!(l.brush, "grass");
		assert_eq!(l.xs, vec![10, 11]);
		assert_eq!(l.ys, vec![20, 21]);

		assert!(decode_generate(&b[..b.len() - 1]).is_err(), "truncated payload errors");
	}

	fn load_materials() -> Materials {
		Materials::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/860")).unwrap()
	}

	fn synthetic_wall_materials(dir: &PathBuf, walls: &str) -> Materials {
		fs::create_dir_all(dir).unwrap();
		fs::write(dir.join("borders.xml"), "<materials/>").unwrap();
		fs::write(dir.join("grounds.xml"), "<materials/>").unwrap();
		fs::write(dir.join("doodads.xml"), "<materials/>").unwrap();
		fs::write(dir.join("walls.xml"), walls).unwrap();
		Materials::load(dir).unwrap()
	}

	#[test]
	fn doodad_thickness_limits_how_many_tiles_get_items() {
		const D: u16 = 600;
		let dir = std::env::temp_dir().join("nosbor_doodad_thickness_test");
		fs::create_dir_all(&dir).unwrap();
		fs::write(dir.join("borders.xml"), "<materials/>").unwrap();
		fs::write(dir.join("grounds.xml"), "<materials/>").unwrap();
		fs::write(dir.join("walls.xml"), "<materials/>").unwrap();
		fs::write(
			dir.join("doodads.xml"),
			format!("<materials><brush name=\"d\" type=\"doodad\" thickness=\"25/100\"><item id=\"{D}\" chance=\"1\"/></brush></materials>"),
		)
		.unwrap();
		let mats = Materials::load(&dir).unwrap();
		let otb = OtbItems::default();
		let place = HashMap::new();
		let xs: Vec<u16> = (0..100u16).map(|i| 50 + i % 10).collect();
		let ys: Vec<u16> = (0..100u16).map(|i| 50 + i / 10).collect();

		let painted = |m: &MapModel| xs.iter().zip(ys.iter()).filter(|(&x, &y)| !stack_at(m, 7, x, y).is_empty()).count();

		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &xs, &ys, D, D, false, true, "d", false, false, false);
		assert_eq!(painted(&m), 25, "brush thickness 25/100 places on a quarter of the area");
		let rows: HashSet<u16> = xs
			.iter()
			.zip(ys.iter())
			.filter(|(&x, &y)| !stack_at(&m, 7, x, y).is_empty())
			.map(|(_, &y)| y)
			.collect();
		assert!(rows.len() >= 8, "picked tiles spread across the area, got {} rows", rows.len());

		set_doodad_thickness(100);
		let mut full = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		run_paint(&mut full, Some(&mats), &place, &otb, 7, &xs, &ys, D, D, false, true, "d", false, false, false);
		assert_eq!(painted(&full), 100, "custom thickness overrides the brush value");
		set_doodad_thickness(-1);
	}

	#[test]
	fn door_switches_open_state_and_erasing_restores_the_wall() {
		const H: u16 = 800;
		const CLOSED: u16 = 801;
		const OPEN: u16 = 802;
		const LOCKED: u16 = 803;
		let walls = format!(
			"<materials><brush name=\"w\" type=\"wall\">			 <wall type=\"horizontal\"><item id=\"{H}\"/>			 <door id=\"{CLOSED}\" type=\"normal\" open=\"false\"/>			 <door id=\"{OPEN}\" type=\"normal\" open=\"true\"/>			 <door id=\"{LOCKED}\" type=\"normal\" open=\"false\" locked=\"true\"/></wall>			 </brush></materials>"
		);
		let dir = std::env::temp_dir().join("nosbor_switch_door_test");
		let mats = synthetic_wall_materials(&dir, &walls);
		let otb = OtbItems::default();
		let mut place = HashMap::new();
		for id in [H, CLOSED, OPEN, LOCKED] {
			place.insert(id, PlaceFlags { ground: false, top_order: 0, blocking: true, duplicable: false });
		}
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], H, H, false, false, "w", false, false, false);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], CLOSED, CLOSED, false, false, "", false, false, false);
		let placed = stack_at(&m, 7, 50, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert!(placed.contains(&CLOSED), "unlocked preference places the plain closed door, got {:?}", placed);

		assert!(flip_door(&mut m, &mats, &otb, 7, 50, 50), "flip reports a change");
		let opened = stack_at(&m, 7, 50, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert!(opened.contains(&OPEN), "flip opens the door, got {:?}", opened);
		assert!(flip_door(&mut m, &mats, &otb, 7, 50, 50), "flip back reports a change");
		let closed = stack_at(&m, 7, 50, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert!(closed.contains(&CLOSED), "flip closes the door again, got {:?}", closed);

		assert!(restore_wall_under_doors(&mut m, &mats, &otb, 7, 50, 50), "erase reports a change");
		let erased = stack_at(&m, 7, 50, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert_eq!(erased, vec![H], "erasing the door leaves the plain wall, got {:?}", erased);

		set_door_locked(true);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], CLOSED, CLOSED, false, false, "", false, false, false);
		let locked = stack_at(&m, 7, 50, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		set_door_locked(false);
		assert!(locked.contains(&LOCKED), "locked preference places the locked variant, got {:?}", locked);
	}

	fn synthetic_materials(dir: &PathBuf, walls: &str, doodads: &str, grounds: &str) -> Materials {
		fs::create_dir_all(dir).unwrap();
		fs::write(dir.join("borders.xml"), "<materials/>").unwrap();
		fs::write(dir.join("grounds.xml"), grounds).unwrap();
		fs::write(dir.join("doodads.xml"), doodads).unwrap();
		fs::write(dir.join("walls.xml"), walls).unwrap();
		Materials::load(dir).unwrap()
	}

	fn stack_ids(m: &MapModel, z: u8, x: u16, y: u16) -> Vec<u16> {
		stack_at(m, z, x, y).iter().map(|&(_, s)| s).collect()
	}

	#[test]
	fn doodad_replaces_walls_it_owns_and_skips_duplicate_tiles() {
		const H: u16 = 620;
		const V: u16 = 621;
		const BUSH: u16 = 622;
		let walls = format!(
			"<materials><brush name=\"w\" type=\"wall\">\
			 <wall type=\"horizontal\"><item id=\"{H}\"/></wall>\
			 <wall type=\"vertical\"><item id=\"{V}\"/></wall>\
			 </brush></materials>"
		);
		let once = format!("<materials><brush name=\"d\" type=\"doodad\"><item id=\"{V}\" chance=\"1\"/></brush></materials>");
		let many = format!(
			"<materials><brush name=\"d\" type=\"doodad\" on_duplicate=\"true\"><item id=\"{BUSH}\" chance=\"1\"/></brush></materials>"
		);
		let otb = OtbItems::default();
		let mut place = HashMap::new();
		for id in [H, V, BUSH] {
			place.insert(id, PlaceFlags { ground: false, top_order: 0, blocking: false, duplicable: false });
		}

		let mats = synthetic_materials(&std::env::temp_dir().join("nosbor_doodad_dup_test"), &walls, &once, "<materials/>");
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], H, H, false, false, "w", false, false, false);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], V, V, false, true, "d", false, false, false);
		assert_eq!(stack_ids(&m, 7, 50, 50), vec![V], "the stamped wall item replaces the wall of the same brush");
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], V, V, false, true, "d", false, false, false);
		assert_eq!(stack_ids(&m, 7, 50, 50), vec![V], "without on_duplicate the brush refuses a second stamp");

		let dup = synthetic_materials(&std::env::temp_dir().join("nosbor_doodad_dup_on_test"), &walls, &many, "<materials/>");
		let mut m2 = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		run_paint(&mut m2, Some(&dup), &place, &otb, 7, &[50], &[50], BUSH, BUSH, false, true, "d", false, false, false);
		run_paint(&mut m2, Some(&dup), &place, &otb, 7, &[50], &[50], BUSH, BUSH, false, true, "d", false, false, false);
		assert_eq!(stack_ids(&m2, 7, 50, 50), vec![BUSH, BUSH], "on_duplicate lets the brush stack on itself");
	}

	#[test]
	fn wall_decoration_tracks_the_wall_alignment_and_its_door() {
		const H: u16 = 900;
		const V: u16 = 901;
		const DOOR: u16 = 902;
		const DEC_H: u16 = 910;
		const DEC_V: u16 = 911;
		const DEC_DOOR: u16 = 912;
		let walls = format!(
			"<materials><brush name=\"w\" type=\"wall\">\
			 <wall type=\"horizontal\"><item id=\"{H}\"/><door id=\"{DOOR}\" type=\"normal\" open=\"false\"/></wall>\
			 <wall type=\"vertical\"><item id=\"{V}\"/></wall>\
			 <wall type=\"north end\"><item id=\"{V}\"/></wall>\
			 <wall type=\"south end\"><item id=\"{V}\"/></wall>\
			 </brush>\
			 <brush name=\"dec\" type=\"wall decoration\">\
			 <wall type=\"horizontal\"><item id=\"{DEC_H}\"/><door id=\"{DEC_DOOR}\" type=\"normal\" open=\"false\"/></wall>\
			 <wall type=\"vertical\"><item id=\"{DEC_V}\"/></wall>\
			 <wall type=\"north end\"><item id=\"{DEC_V}\"/></wall>\
			 <wall type=\"south end\"><item id=\"{DEC_V}\"/></wall>\
			 </brush></materials>"
		);
		let dir = std::env::temp_dir().join("nosbor_wall_decoration_test");
		let mats = synthetic_wall_materials(&dir, &walls);
		let otb = OtbItems::default();
		let mut place = HashMap::new();
		for id in [H, V, DOOR, DEC_H, DEC_V, DEC_DOOR] {
			place.insert(id, PlaceFlags { ground: false, top_order: 0, blocking: false, duplicable: false });
		}
		let paint = |m: &mut MapModel, x: u16, y: u16, id: u16, name: &str, automagic: bool| {
			run_paint(m, Some(&mats), &place, &otb, 7, &[x], &[y], id, id, false, false, name, automagic, false, false);
		};

		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		paint(&mut m, 50, 50, H, "w", false);
		paint(&mut m, 50, 50, DEC_H, "dec", false);
		assert_eq!(stack_ids(&m, 7, 50, 50), vec![H, DEC_H], "the decoration lands right above the wall");

		paint(&mut m, 50, 50, DOOR, "w", false);
		assert_eq!(stack_ids(&m, 7, 50, 50), vec![DOOR, DEC_DOOR], "the door transform carries the decoration along");

		let mut m2 = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		paint(&mut m2, 50, 50, H, "w", false);
		paint(&mut m2, 50, 50, DEC_H, "dec", false);
		paint(&mut m2, 50, 49, H, "w", true);
		paint(&mut m2, 50, 51, H, "w", true);
		assert_eq!(stack_ids(&m2, 7, 50, 50), vec![V, DEC_V], "a vertical run realigns the wall and its decoration");
	}

	#[test]
	fn alt_replace_paints_only_tiles_sharing_the_anchor_ground() {
		const GRASS: u16 = 4526;
		const SAND: u16 = 231;
		let grounds = format!(
			"<materials>\
			 <brush name=\"grass\" type=\"ground\" z-order=\"10\"><item id=\"{GRASS}\" chance=\"1\"/></brush>\
			 <brush name=\"sand\" type=\"ground\" z-order=\"10\"><item id=\"{SAND}\" chance=\"1\"/></brush>\
			 </materials>"
		);
		let dir = std::env::temp_dir().join("nosbor_replace_ground_test");
		let mats = synthetic_materials(&dir, "<materials/>", "<materials/>", &grounds);
		let otb = OtbItems::default();
		let mut place = HashMap::new();
		for id in [GRASS, SAND] {
			place.insert(id, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		}
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], GRASS, GRASS, true, false, "grass", false, false, false);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[51], &[50], SAND, SAND, true, false, "sand", false, false, false);

		let (xs, ys) = replace_filter(&m, &mats, &place, 7, &[50, 51, 52], &[50, 50, 50], (50, 50));
		assert_eq!((xs, ys), (vec![50], vec![50]), "only the tile carrying the anchor ground brush survives");

		let (xs, ys) = replace_filter(&m, &mats, &place, 7, &[50, 51, 52], &[50, 50, 50], (52, 50));
		assert_eq!((xs, ys), (vec![52], vec![50]), "an empty anchor keeps only tiles without ground");
	}

	#[test]
	fn raw_door_item_is_placed_literally_while_door_brush_transforms() {
		const H: u16 = 600;
		const DOOR_A: u16 = 601;
		const DOOR_B: u16 = 602;
		let walls = format!(
			"<materials><brush name=\"w\" type=\"wall\">			 <wall type=\"horizontal\"><item id=\"{H}\"/>			 <door id=\"{DOOR_A}\" type=\"normal\" open=\"false\"/></wall>			 </brush>			 <brush name=\"w2\" type=\"wall\">			 <wall type=\"horizontal\"><item id=\"700\"/>			 <door id=\"{DOOR_B}\" type=\"normal\" open=\"false\"/></wall>			 </brush></materials>"
		);
		let dir = std::env::temp_dir().join("nosbor_raw_door_test");
		let mats = synthetic_wall_materials(&dir, &walls);
		let otb = OtbItems::default();
		let mut place = HashMap::new();
		for id in [H, DOOR_A, DOOR_B, 700] {
			place.insert(id, PlaceFlags { ground: false, top_order: 0, blocking: true, duplicable: false });
		}
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], H, H, false, false, "w", false, false, false);
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], DOOR_B, DOOR_B, false, false, "", false, false, true);
		let raw = stack_at(&m, 7, 50, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert!(raw.contains(&DOOR_B), "raw paint keeps the selected door id, got {:?}", raw);
		assert!(raw.contains(&H), "raw paint leaves the wall untouched, got {:?}", raw);

		let mut m2 = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		run_paint(&mut m2, Some(&mats), &place, &otb, 7, &[50], &[50], H, H, false, false, "w", false, false, false);
		run_paint(&mut m2, Some(&mats), &place, &otb, 7, &[50], &[50], DOOR_B, DOOR_B, false, false, "", false, false, false);
		let brushed = stack_at(&m2, 7, 50, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert!(brushed.contains(&DOOR_A), "door brush transforms into the wall's own door, got {:?}", brushed);
	}

	#[test]
	fn wall_specific_reacts_to_a_neighbour_two_tiles_away() {
		const H: u16 = 500;
		const T: u16 = 501;
		const V: u16 = 502;
		const H_SHADOW: u16 = 503;
		let walls = format!(
			"<materials><brush name=\"w\" type=\"wall\">\
			 <wall type=\"horizontal\"><item id=\"{H}\"/>\
			 <specific dir=\"east\" when=\"north T\"><item id=\"{H_SHADOW}\"/></specific></wall>\
			 <wall type=\"north T\"><item id=\"{T}\"/></wall>\
			 <wall type=\"vertical\"><item id=\"{V}\"/></wall>\
			 <wall type=\"north end\"><item id=\"{V}\"/></wall>\
			 <wall type=\"east end\"><item id=\"{H}\"/></wall>\
			 <wall type=\"west end\"><item id=\"{H}\"/></wall>\
			 </brush></materials>"
		);
		let dir = std::env::temp_dir().join("nosbor_wall_specific_test");
		let mats = synthetic_wall_materials(&dir, &walls);
		let otb = OtbItems::default();
		let mut place = HashMap::new();
		for id in [H, T, V, H_SHADOW] {
			place.insert(id, PlaceFlags { ground: false, top_order: 0, blocking: true, duplicable: false });
		}
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		for x in 50..=53u16 {
			run_paint(&mut m, Some(&mats), &place, &otb, 7, &[x], &[50], H, H, false, false, "w", true, false, false);
		}
		let before = stack_at(&m, 7, 51, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert!(before.contains(&H), "plain run leaves horizontals, got {:?}", before);

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[52], &[51], V, V, false, false, "w", true, false, false);

		let branch = stack_at(&m, 7, 52, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert!(branch.contains(&T), "tile above the branch becomes a north T, got {:?}", branch);
		let west = stack_at(&m, 7, 51, 50).iter().map(|&(_, s)| s).collect::<Vec<_>>();
		assert!(
			west.contains(&H_SHADOW),
			"horizontal west of the new north T picks the shadow variant, got {:?}",
			west
		);
	}

	#[test]
	fn a_door_replaces_the_wall_and_follows_its_alignment() {
		const H: u16 = 510;
		const V: u16 = 511;
		const T: u16 = 512;
		const DH: u16 = 513;
		const DV: u16 = 514;
		const DT: u16 = 515;
		let walls = format!(
			"<materials><brush name=\"w\" type=\"wall\">\
			 <wall type=\"horizontal\"><item id=\"{H}\"/><door id=\"{DH}\" type=\"normal\" open=\"false\"/></wall>\
			 <wall type=\"vertical\"><item id=\"{V}\"/><door id=\"{DV}\" type=\"normal\" open=\"false\"/></wall>\
			 <wall type=\"north T\"><item id=\"{T}\"/><door id=\"{DT}\" type=\"normal\" open=\"false\"/></wall>\
			 <wall type=\"north end\"><item id=\"{V}\"/></wall>\
			 <wall type=\"east end\"><item id=\"{H}\"/></wall>\
			 <wall type=\"west end\"><item id=\"{H}\"/></wall>\
			 </brush></materials>"
		);
		let dir = std::env::temp_dir().join("nosbor_wall_door_test");
		let mats = synthetic_wall_materials(&dir, &walls);
		let otb = OtbItems::default();
		let mut place = HashMap::new();
		for id in [H, V, T, DH, DV, DT] {
			place.insert(id, PlaceFlags { ground: false, top_order: 0, blocking: true, duplicable: false });
		}
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		let servers = |m: &MapModel, x: u16, y: u16| stack_at(m, 7, x, y).iter().map(|&(_, s)| s).collect::<Vec<_>>();

		for x in 50..=52u16 {
			run_paint(&mut m, Some(&mats), &place, &otb, 7, &[x], &[50], H, H, false, false, "w", true, false, false);
		}
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[51], &[50], DH, DH, false, false, "w", true, false, false);
		assert_eq!(servers(&m, 51, 50), vec![DH], "the door replaces the wall segment instead of stacking on it");

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[51], &[51], V, V, false, false, "w", true, false, false);
		assert_eq!(servers(&m, 51, 50), vec![DT], "the door follows the new alignment instead of reverting to a plain wall");

		let mut empty = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		run_paint(&mut empty, Some(&mats), &place, &otb, 7, &[10], &[10], DH, DH, false, false, "w", true, false, false);
		assert!(servers(&empty, 10, 10).is_empty(), "a door needs a wall to sit in");
	}

	#[test]
	fn border_brush_forces_mountain_gravel() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass_c = otb.client_id(4526).unwrap_or(0);
		let mtn_c = otb.client_id(919).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass_c, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		place.insert(mtn_c, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		for dx in 0..3u16 {
			for dy in 0..3u16 {
				run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50 + dx], &[50 + dy], 4526, grass_c, true, false, "", false, false, false);
			}
		}
		for dx in 0..3u16 {
			run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50 + dx], &[50], 919, mtn_c, true, false, "", false, false, false);
		}
		let tiles: HashSet<(u16, u16)> = [(51u16, 51u16)].into_iter().collect();
		borderize(&mut m, &mats, &place, &otb, 7, &tiles, true, false);
		let gated = stack_at(&m, 7, 51, 51).iter().any(|&(_, s)| (4468..=4479).contains(&s));
		assert!(!gated, "without force, no gravel on a fresh grass tile");

		borderize(&mut m, &mats, &place, &otb, 7, &tiles, true, true);
		let forced = stack_at(&m, 7, 51, 51).iter().any(|&(_, s)| (4468..=4479).contains(&s));
		assert!(forced, "border brush forces the mountain gravel (border 29)");
	}

	#[test]
	fn insert_ordered_places_ground_borders_and_normal() {
		let mut place = HashMap::new();
		place.insert(10u16, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		place.insert(20u16, PlaceFlags { ground: false, top_order: 2, blocking: false, duplicable: false });

		let mut stack: Vec<(u16, u16)> = Vec::new();
		insert_ordered(&mut stack, &place, None, 30, 300);
		insert_ordered(&mut stack, &place, None, 20, 200);
		insert_ordered(&mut stack, &place, None, 10, 100);
		assert_eq!(stack, vec![(10, 100), (20, 200), (30, 300)]);

		insert_ordered(&mut stack, &place, None, 10, 101);
		assert_eq!(stack, vec![(10, 101), (20, 200), (30, 300)]);
	}

	#[test]
	fn lua_veto_blocks_placement() {
		use crate::lua_host::LuaHost;
		use std::path::PathBuf;
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		let host = LuaHost::new(PathBuf::from("."));
		host.lua
			.load("forge = {}\nfunction forge.allow_place(s, hg) return s ~= 4526 end")
			.exec()
			.unwrap();
		let _s = ScopedLua::enter(&host);

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], 4526, grass, true, false, "", false, false, false);
		assert!(stack_at(&m, 7, 50, 50).is_empty(), "lua veto blocks grass (4526)");

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[51], &[51], 4527, otb.client_id(4527).unwrap_or(0), false, false, "", false, false, false);
		assert!(!stack_at(&m, 7, 51, 51).is_empty(), "non-vetoed id still places");
	}

	#[test]
	fn flood_stops_at_a_different_ground() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let grass = otb.client_id(4526).unwrap_or(0);
		let stone = otb.client_id(431).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		place.insert(stone, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		let mut m = build_map_model(40, 40, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		let xs: Vec<u16> = (10..20).flat_map(|x| std::iter::repeat(x).take(10)).collect();
		let ys: Vec<u16> = (10..20).flat_map(|_| 10..20).collect();
		run_paint(&mut m, None, &place, &otb, 7, &xs, &ys, 4526, grass, true, false, "", false, false, false);
		run_paint(&mut m, None, &place, &otb, 7, &[14, 14, 14], &[10, 11, 12], 431, stone, true, false, "", false, false, false);

		let filled = flood_tiles(&m, None, &place, 7, 10, 10, true);
		assert_eq!(filled.len(), 97, "grass patch minus the three stone tiles");
		assert!(!filled.contains(&(14, 10)), "stops at the stone strip");

		let strip = flood_tiles(&m, None, &place, 7, 14, 10, true);
		assert_eq!(strip.len(), 3, "stone strip floods on its own");

		let outside = flood_tiles(&m, None, &place, 7, 0, 0, true);
		assert!(outside.len() > 100 && !outside.contains(&(10, 10)), "empty ground floods around the patch");

		let all_stone = flood_tiles(&m, None, &place, 7, 14, 10, false);
		assert_eq!(all_stone.len(), 3, "floor wide scan finds every stone tile");
	}

	#[test]
	fn ground_brush_paints_declared_variants() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let brush = mats.ground_brush_by_name("grass").expect("grass ground brush");
		assert!(brush.items.len() > 1, "grass declares several variants");

		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		let mut m = build_map_model(600, 600, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		let xs: Vec<u16> = (0..500).map(|i| 50 + i % 25).collect();
		let ys: Vec<u16> = (0..500).map(|i| 50 + i / 25).collect();
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &xs, &ys, 4526, grass, true, false, "grass", false, false, false);

		let painted: HashSet<u16> = xs.iter().zip(ys.iter()).filter_map(|(&x, &y)| stack_at(&m, 7, x, y).first().map(|&(_, s)| s)).collect();
		assert!(painted.len() > 1, "weighted list produces more than one ground id, got {:?}", painted);
		assert!(painted.iter().all(|s| brush.items.iter().any(|&(id, _)| id == *s)), "every painted id belongs to the brush");
	}

	#[test]
	fn raw_item_paint_is_not_rerolled() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });
		let mut m = build_map_model(600, 600, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		let xs: Vec<u16> = (0..200).map(|i| 100 + i % 20).collect();
		let ys: Vec<u16> = (0..200).map(|i| 100 + i / 20).collect();
		run_paint(&mut m, Some(&mats), &place, &otb, 7, &xs, &ys, 4526, grass, true, false, "", false, false, false);

		assert!(
			xs.iter().zip(ys.iter()).all(|(&x, &y)| stack_at(&m, 7, x, y).first().map(|&(_, s)| s) == Some(4526)),
			"an empty brush name places the literal id"
		);
	}

	#[test]
	fn block_guard_skips_overlapping_blocking_item() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let blk_server = 3813u16;
		let blk = otb.client_id(blk_server).unwrap_or(blk_server);
		let mut place = HashMap::new();
		place.insert(blk, PlaceFlags { ground: false, top_order: 0, blocking: true, duplicable: false });
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[60], &[60], blk_server, blk, false, false, "", false, true, false);
		let after_first = stack_at(&m, 7, 60, 60).len();
		assert_eq!(after_first, 1, "first blocking item places");

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[60], &[60], blk_server, blk, false, false, "", false, true, false);
		assert_eq!(stack_at(&m, 7, 60, 60).len(), after_first, "guard skips second blocking item on same tile");

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[60], &[60], blk_server, blk, false, false, "", false, false, false);
		assert!(stack_at(&m, 7, 60, 60).len() > after_first, "without guard a second blocking item stacks");
	}

	#[test]
	fn dedupe_drops_repeats_but_keeps_duplicable_items_and_distinct_attrs() {
		let wall = 3000u16;
		let coins = 4000u16;
		let mut place = HashMap::new();
		place.insert(wall, PlaceFlags { ground: false, top_order: 0, blocking: true, duplicable: false });
		place.insert(coins, PlaceFlags { ground: false, top_order: 0, blocking: false, duplicable: true });
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		let stack = tile_stack_mut(&mut m, 7, 50, 50);
		stack.extend_from_slice(&[(wall, wall), (wall, wall), (wall, wall), (coins, coins), (coins, coins)]);
		let mut tagged = ItemAttrs::default();
		tagged.action_id = 1000;
		m.item_attrs.insert(attrs_key(7, 50, 50, 2), tagged);

		assert!(dedupe_tile(&mut m, &place, 7, 50, 50));
		let after = stack_at(&m, 7, 50, 50);
		assert_eq!(after, vec![(wall, wall), (wall, wall), (coins, coins), (coins, coins)], "one plain wall dropped, tagged wall and stackable coins kept");
		assert_eq!(m.item_attrs.get(&attrs_key(7, 50, 50, 1)).map(|a| a.action_id), Some(1000), "attrs follow the item to its new slot");
	}

	#[test]
	fn borderize_adds_grass_borders_next_to_empty() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();

		let grass_client = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass_client, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });

		let mut m = build_map_model(100, 100, &[50], &[50], &[7], &[0], &[1], &[grass_client], &[4526], &[1], &[], &[], &[], Vec::new(), 0);

		let tiles: HashSet<(u16, u16)> = [(50u16, 50u16)].into_iter().collect();
		borderize(&mut m, &mats, &place, &otb, 7, &tiles, false, false);

		let stack = stack_at(&m, 7, 50, 50);
		assert_eq!(stack.first(), Some(&(grass_client, 4526)), "ground stays at slot 0");
		let borders: Vec<u16> = stack.iter().skip(1).filter(|&&(_, s)| mats.is_border_item(s)).map(|&(_, s)| s).collect();
		assert!(!borders.is_empty(), "grass surrounded by empty gets its to-none borders");
	}

	#[test]
	fn erasing_a_ground_reborders_the_neighbour() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });

		let mut m = build_map_model(100, 100, &[50, 51], &[50, 50], &[7, 7], &[0, 1], &[1, 1], &[grass, grass], &[4526, 4526], &[1, 1], &[], &[], &[], Vec::new(), 0);

		let both: HashSet<(u16, u16)> = [(50, 50), (51, 50)].into_iter().collect();
		borderize(&mut m, &mats, &place, &otb, 7, &both, false, false);
		let border_count = |m: &MapModel, x, y| stack_at(m, 7, x, y).iter().filter(|&&(_, s)| mats.is_border_item(s)).count();
		let before = border_count(&m, 50, 50);

		tile_stack_mut(&mut m, 7, 51, 50).clear();
		borderize(&mut m, &mats, &place, &otb, 7, &[(50, 50)].into_iter().collect(), false, false);
		let after = border_count(&m, 50, 50);

		assert!(after > before, "exposing an empty east neighbour adds borders ({before} -> {after})");
	}

	#[test]
	fn undo_restores_and_redo_reapplies_a_paint() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });

		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		m.record_begin();
		insert_ordered(tile_stack_mut(&mut m, 7, 50, 50), &place, Some(&mats), grass, 4526);
		borderize(&mut m, &mats, &place, &otb, 7, &[(50, 50)].into_iter().collect(), false, false);
		m.record_commit(ACTION_PAINT);

		let painted = stack_at(&m, 7, 50, 50);
		assert!(painted.len() > 1, "paint placed grass plus its to-none borders");

		m.undo();
		assert!(stack_at(&m, 7, 50, 50).is_empty(), "undo clears a tile that was empty before");

		m.redo();
		assert_eq!(stack_at(&m, 7, 50, 50), painted, "redo restores the exact stack");
	}

	#[test]
	fn eraser_keeps_ground_and_borders_drops_items() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });

		let border_server = *mats.border_item_ids.iter().next().expect("a border item exists");
		let border_client = otb.client_id(border_server).unwrap_or(0);
		let item = (0u16, 1u16);

		assert_eq!(order_class(&place, Some(&mats), grass, 4526), GROUND_CLASS, "grass is ground");
		assert_eq!(order_class(&place, Some(&mats), border_client, border_server), BORDER_CLASS, "border item");
		assert_eq!(order_class(&place, Some(&mats), item.0, item.1), NORMAL_CLASS, "synthetic item is normal");

		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		let stack = tile_stack_mut(&mut m, 7, 10, 10);
		*stack = vec![(grass, 4526), (border_client, border_server), item];
		stack.retain(|&(c, s)| matches!(order_class(&place, Some(&mats), c, s), GROUND_CLASS | BORDER_CLASS));

		let result = stack_at(&m, 7, 10, 10);
		assert!(result.iter().any(|&(_, s)| s == 4526), "ground stays");
		assert!(result.iter().any(|&(_, s)| s == border_server), "border stays");
		assert!(!result.contains(&item), "placed item removed");
	}

	#[test]
	fn ground_only_eraser_drops_ground_keeps_rest() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0, blocking: false, duplicable: false });

		let border_server = *mats.border_item_ids.iter().next().expect("a border item exists");
		let border_client = otb.client_id(border_server).unwrap_or(0);
		let item = (0u16, 1u16);

		let g = GROUND_CLASS;
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		let stack = tile_stack_mut(&mut m, 7, 10, 10);
		*stack = vec![(grass, 4526), (border_client, border_server), item];
		stack.retain(|&(c, s)| order_class(&place, Some(&mats), c, s) != g);

		let result = stack_at(&m, 7, 10, 10);
		assert!(!result.iter().any(|&(_, s)| s == 4526), "ground removed");
		assert!(result.iter().any(|&(_, s)| s == border_server), "border stays");
		assert!(result.contains(&item), "placed item stays");
	}

	#[test]
	fn specific_case_replaces_target_and_drops_other_matches() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let sc = materials::SpecificCase {
			matches: vec![10, 20],
			to_replace: 20,
			with: 4526,
			delete_all: false,
			keep_border: false,
		};
		let mut stack = vec![(0u16, 5u16), (0, 10), (0, 20), (0, 99)];
		apply_specific_case(&mut stack, &otb, &sc);
		assert!(stack.iter().any(|&(_, s)| s == 4526), "target border replaced with `with`");
		assert!(!stack.iter().any(|&(_, s)| s == 10), "other matched border dropped");
		assert!(!stack.iter().any(|&(_, s)| s == 20), "old target id gone");
		assert!(stack.iter().any(|&(_, s)| s == 99), "unrelated item untouched");
		assert!(stack.iter().any(|&(_, s)| s == 5), "ground untouched");
	}

	fn replace_test_model() -> MapModel {
		let xs = [10u16, 11, 12];
		let ys = [10u16, 10, 10];
		let zs = [7u8, 7, 7];
		let item_start = [0u32, 2, 4];
		let item_count = [2u16, 2, 2];
		let client_ids = [100u16, 200, 100, 300, 400, 400];
		let server_ids = [1000u16, 2000, 1000, 3000, 4000, 4000];
		let subtypes = [1u8; 6];
		let flags = [0u32; 3];
		let house_ids = [0u32; 3];
		let door_ids = [0u8; 3];
		build_map_model(
			100,
			100,
			&xs,
			&ys,
			&zs,
			&item_start,
			&item_count,
			&client_ids,
			&server_ids,
			&subtypes,
			&flags,
			&house_ids,
			&door_ids,
			Vec::new(),
			0,
		)
	}

	fn replace_all(m: &mut MapModel, pairs: &[(u16, u16)], scope: &ReplaceScope) -> Vec<u32> {
		let otb = OtbItems::default();
		let wanted: HashMap<u16, usize> = pairs.iter().enumerate().map(|(i, &(from, _))| (from, i)).collect();
		let targets: Vec<(u16, u16)> = pairs.iter().map(|&(_, to)| (to, to)).collect();
		let mut counts = vec![0u32; pairs.len()];
		replace_in_model(m, scope, &wanted, &targets, &mut counts, &otb).unwrap();
		counts
	}

	fn ids_at(m: &MapModel, x: u16, y: u16) -> Vec<u16> {
		stack_at(m, 7, x, y).iter().map(|&(_, s)| s).collect()
	}

	#[test]
	fn batch_replace_counts_per_pair_and_undoes_as_one_action() {
		let mut m = replace_test_model();
		let scope = ReplaceScope::default();

		let mut counts = vec![0u32; 2];
		let wanted: HashMap<u16, usize> = [(1000u16, 0usize), (4000, 1)].into_iter().collect();
		count_in_model(&mut m, &scope, &wanted, &mut counts, &OtbItems::default()).unwrap();
		let counted = counts.clone();
		assert_eq!(counted, vec![2, 2], "counts both occurrences of each id before touching the map");

		let applied = replace_all(&mut m, &[(1000, 1001), (4000, 4001)], &scope);
		assert_eq!(applied, counted, "replace touches exactly what the count promised");
		assert_eq!(ids_at(&m, 10, 10), vec![1001, 2000]);
		assert_eq!(ids_at(&m, 11, 10), vec![1001, 3000]);
		assert_eq!(ids_at(&m, 12, 10), vec![4001, 4001]);

		m.undo();
		assert_eq!(ids_at(&m, 10, 10), vec![1000, 2000], "one undo reverts the whole batch");
		assert_eq!(ids_at(&m, 12, 10), vec![4000, 4000]);
	}

	#[test]
	fn batch_replace_honors_tile_scope_and_does_not_chain_pairs() {
		let mut m = replace_test_model();
		let tile_scope = ReplaceScope { floors: Vec::new(), zs: vec![7], xs: vec![10], ys: vec![10], all: vec![true] };

		let counts = replace_all(&mut m, &[(1000, 2000), (2000, 5000)], &tile_scope);
		assert_eq!(counts, vec![1, 1], "only the scoped tile is visited");
		assert_eq!(ids_at(&m, 10, 10), vec![2000, 5000], "each entry maps once, no A->B->C chaining");
		assert_eq!(ids_at(&m, 11, 10), vec![1000, 3000], "tiles outside the scope stay untouched");
	}

	#[test]
	fn tile_scope_without_all_only_touches_the_top_item() {
		let mut m = replace_test_model();
		let top_only = ReplaceScope { floors: Vec::new(), zs: vec![7], xs: vec![10], ys: vec![10], all: vec![false] };

		let mut counts = vec![0u32; 2];
		let wanted: HashMap<u16, usize> = [(1000u16, 0usize), (2000, 1)].into_iter().collect();
		count_in_model(&mut m, &top_only, &wanted, &mut counts, &OtbItems::default()).unwrap();
		assert_eq!(counts, vec![0, 1], "ground below the selected item is not counted");

		let applied = replace_all(&mut m, &[(1000, 1001), (2000, 2001)], &top_only);
		assert_eq!(applied, vec![0, 1]);
		assert_eq!(ids_at(&m, 10, 10), vec![1000, 2001], "ground stays, only the top item is replaced");
	}
}
