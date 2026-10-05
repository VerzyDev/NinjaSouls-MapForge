use super::{AlignNode, Materials, TO_ALL};

pub(crate) const WALL_ALIGNMENT_COUNT: usize = 17;

pub(crate) const WALL_POLE: u8 = 0;
pub(crate) const WALL_SOUTH_END: u8 = 1;
pub(crate) const WALL_EAST_END: u8 = 2;
pub(crate) const WALL_NORTHWEST_DIAGONAL: u8 = 3;
pub(crate) const WALL_WEST_END: u8 = 4;
pub(crate) const WALL_NORTHEAST_DIAGONAL: u8 = 5;
pub(crate) const WALL_HORIZONTAL: u8 = 6;
pub(crate) const WALL_SOUTH_T: u8 = 7;
pub(crate) const WALL_NORTH_END: u8 = 8;
pub(crate) const WALL_VERTICAL: u8 = 9;
pub(crate) const WALL_SOUTHWEST_DIAGONAL: u8 = 10;
pub(crate) const WALL_EAST_T: u8 = 11;
pub(crate) const WALL_SOUTHEAST_DIAGONAL: u8 = 12;
pub(crate) const WALL_WEST_T: u8 = 13;
pub(crate) const WALL_NORTH_T: u8 = 14;
pub(crate) const WALL_INTERSECTION: u8 = 15;
pub(crate) const WALL_UNTOUCHABLE: u8 = 16;

pub(crate) const DOOR_NORMAL: u8 = 1;
pub(crate) const DOOR_LOCKED: u8 = 2;
pub(crate) const DOOR_MAGIC: u8 = 3;
pub(crate) const DOOR_QUEST: u8 = 4;
pub(crate) const DOOR_NORMAL_ALT: u8 = 5;
pub(crate) const DOOR_ARCHWAY: u8 = 6;
pub(crate) const DOOR_WINDOW: u8 = 7;
pub(crate) const DOOR_HATCH_WINDOW: u8 = 8;

const ALL_DOORS: [u8; 6] = [DOOR_NORMAL, DOOR_NORMAL_ALT, DOOR_LOCKED, DOOR_QUEST, DOOR_MAGIC, DOOR_ARCHWAY];
const ALL_WINDOWS: [u8; 2] = [DOOR_WINDOW, DOOR_HATCH_WINDOW];

pub(crate) fn door_types(name: &str) -> Option<Vec<u8>> {
	Some(match name {
		"any door" => ALL_DOORS.to_vec(),
		"any window" => ALL_WINDOWS.to_vec(),
		"any" => ALL_DOORS.iter().chain(ALL_WINDOWS.iter()).copied().collect(),
		"normal" => vec![DOOR_NORMAL],
		"normal_alt" => vec![DOOR_NORMAL_ALT],
		"locked" => vec![DOOR_LOCKED],
		"quest" => vec![DOOR_QUEST],
		"magic" => vec![DOOR_MAGIC],
		"archway" => vec![DOOR_ARCHWAY],
		"window" => vec![DOOR_WINDOW],
		"hatch_window" | "hatch window" => vec![DOOR_HATCH_WINDOW],
		_ => return None,
	})
}

pub(crate) fn door_type_needs_open(name: &str) -> bool {
	!matches!(name, "window" | "any window" | "hatch window")
}

#[derive(Clone, Copy)]
pub struct DoorItem {
	pub id: u16,
	pub kind: u8,
	pub open: bool,
	pub locked: bool,
}

pub(crate) const WALLTILE_N: u32 = 1;
pub(crate) const WALLTILE_W: u32 = 2;
pub(crate) const WALLTILE_E: u32 = 4;
pub(crate) const WALLTILE_S: u32 = 8;

pub(crate) fn wall_edge_bit(name: &str) -> Option<u32> {
	Some(match name {
		"n" | "north" => WALLTILE_N,
		"w" | "west" => WALLTILE_W,
		"e" | "east" => WALLTILE_E,
		"s" | "south" => WALLTILE_S,
		_ => return None,
	})
}

pub(crate) fn wall_alignment(name: &str) -> Option<u8> {
	Some(match name {
		"vertical" => WALL_VERTICAL,
		"horizontal" => WALL_HORIZONTAL,
		"corner" => WALL_NORTHWEST_DIAGONAL,
		"pole" => WALL_POLE,
		"south end" => WALL_SOUTH_END,
		"east end" => WALL_EAST_END,
		"north end" => WALL_NORTH_END,
		"west end" => WALL_WEST_END,
		"south T" => WALL_SOUTH_T,
		"east T" => WALL_EAST_T,
		"west T" => WALL_WEST_T,
		"north T" => WALL_NORTH_T,
		"northwest diagonal" => WALL_NORTHWEST_DIAGONAL,
		"northeast diagonal" => WALL_NORTHEAST_DIAGONAL,
		"southwest diagonal" => WALL_SOUTHWEST_DIAGONAL,
		"southeast diagonal" => WALL_SOUTHEAST_DIAGONAL,
		"intersection" => WALL_INTERSECTION,
		"untouchable" => WALL_UNTOUCHABLE,
		_ => return None,
	})
}

pub(crate) fn build_wall_tables() -> ([u8; 16], [u8; 16]) {
	let mut full = [0u8; 16];
	let (n, w, e, s) = (WALLTILE_N as usize, WALLTILE_W as usize, WALLTILE_E as usize, WALLTILE_S as usize);
	full[0] = WALL_POLE;
	full[n] = WALL_SOUTH_END;
	full[w] = WALL_EAST_END;
	full[n | w] = WALL_NORTHWEST_DIAGONAL;
	full[e] = WALL_WEST_END;
	full[n | e] = WALL_NORTHEAST_DIAGONAL;
	full[w | e] = WALL_HORIZONTAL;
	full[n | w | e] = WALL_SOUTH_T;
	full[s] = WALL_NORTH_END;
	full[n | s] = WALL_VERTICAL;
	full[w | s] = WALL_SOUTHWEST_DIAGONAL;
	full[n | w | s] = WALL_EAST_T;
	full[e | s] = WALL_SOUTHEAST_DIAGONAL;
	full[n | e | s] = WALL_WEST_T;
	full[w | e | s] = WALL_NORTH_T;
	full[n | w | e | s] = WALL_INTERSECTION;

	let mut half = [0u8; 16];
	for (i, slot) in half.iter_mut().enumerate() {
		let bits = i & (n | w);
		*slot = if bits == (n | w) {
			WALL_NORTHWEST_DIAGONAL
		} else if bits == n {
			WALL_VERTICAL
		} else if bits == w {
			WALL_HORIZONTAL
		} else {
			WALL_POLE
		};
	}
	(full, half)
}

#[derive(Clone)]
pub(crate) struct WallCond {
	pub(crate) dir_bit: u32,
	pub(crate) when: u8,
}

#[derive(Clone)]
pub(crate) struct WallSpecific {
	pub(crate) base: u8,
	pub(crate) conds: Vec<WallCond>,
	pub(crate) item: u16,
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct WallBrush {
	pub id: u32,
	pub name: String,
	pub(crate) alignments: Vec<AlignNode>,
	pub(crate) doors: Vec<Vec<DoorItem>>,
	pub(crate) friends: Vec<u32>,
	pub(crate) redirect_to: u32,
	pub(crate) specifics: Vec<WallSpecific>,
	pub(crate) decoration: bool,
}

impl WallBrush {
	fn friend_of(&self, other_id: u32) -> bool {
		self.friends.iter().any(|&f| f == other_id || f == TO_ALL)
	}
}

impl Materials {
	fn wall(&self, id: u32) -> Option<&WallBrush> {
		if id == 0 {
			return None;
		}
		self.walls.get(id as usize - 1)
	}

	pub fn wall_alignment_of(&self, server_id: u16) -> Option<u8> {
		self.server_to_alignment.get(&server_id).copied()
	}

	pub fn door_of(&self, server_id: u16) -> Option<DoorItem> {
		self.door_info.get(&server_id).copied()
	}

	pub fn door_id_for(&self, own: u32, alignment: u8, kind: u8, open: bool, locked: bool) -> Option<u16> {
		let mut cur = own;
		let mut discarded: Option<u16> = None;
		let mut close_match = false;
		for _ in 0..self.walls.len().max(1) {
			let Some(wb) = self.wall(cur) else {
				break;
			};
			for d in wb.doors.get(alignment as usize).into_iter().flatten() {
				if d.kind != kind {
					continue;
				}
				if d.open == open {
					if open || d.locked == locked {
						return Some(d.id);
					}
					discarded = Some(d.id);
					close_match = true;
				} else if !close_match {
					discarded = Some(d.id);
					close_match = true;
				}
			}
			if wb.redirect_to == 0 || wb.redirect_to == own {
				break;
			}
			cur = wb.redirect_to;
		}
		discarded
	}

	pub fn wall_brush_for(&self, server_id: u16) -> Option<u32> {
		self.server_to_wall.get(&server_id).copied()
	}

	pub fn is_wall_decoration(&self, own: u32) -> bool {
		self.wall(own).is_some_and(|w| w.decoration)
	}

	pub fn decoration_brush_for(&self, server_id: u16) -> Option<u32> {
		self.wall_brush_for(server_id).filter(|&id| self.is_wall_decoration(id))
	}

	pub fn structural_wall_brush_for(&self, server_id: u16) -> Option<u32> {
		self.wall_brush_for(server_id).filter(|&id| !self.is_wall_decoration(id))
	}

	pub fn walls_connect(&self, own: u32, other: u32) -> bool {
		if own == other {
			return true;
		}
		let (Some(a), Some(b)) = (self.wall(own), self.wall(other)) else {
			return false;
		};
		a.friend_of(other) || b.friend_of(own)
	}

	fn pick_wall_alignment(&self, own: u32, alignment: usize, seed: u32) -> Option<u16> {
		let mut cur = own;
		for _ in 0..self.walls.len().max(1) {
			let wb = self.wall(cur)?;
			if let Some(id) = wb.alignments.get(alignment).and_then(|n| n.weighted(seed)) {
				return Some(id);
			}
			if wb.redirect_to == 0 || wb.redirect_to == own {
				return None;
			}
			cur = wb.redirect_to;
		}
		None
	}

	pub fn wall_item_for_alignment(&self, own: u32, alignment: u8, seed: u32) -> Option<u16> {
		self.pick_wall_alignment(own, alignment as usize, seed)
	}

	pub fn wall_id_for(&self, own: u32, tiledata: u32, seed: u32) -> Option<u16> {
		let idx = (tiledata & 0x0F) as usize;
		let full = crate::scripting::wall_segment(idx as u8, false).unwrap_or(self.full_border_types[idx]) as usize;
		self.pick_wall_alignment(own, full, seed).or_else(|| {
			let half = crate::scripting::wall_segment(idx as u8, true).unwrap_or(self.half_border_types[idx]) as usize;
			self.pick_wall_alignment(own, half, seed)
		})
	}

	pub fn wall_full_alignment(&self, tiledata: u32) -> u8 {
		let idx = (tiledata & 0x0F) as usize;
		crate::scripting::wall_segment(idx as u8, false).unwrap_or(self.full_border_types[idx])
	}

	pub fn wall_specific_for(&self, own: u32, base: u8, neighbors: &[(u32, u8)]) -> Option<u16> {
		let wb = self.wall(own)?;
		wb.specifics
			.iter()
			.filter(|s| {
				s.base == base
					&& !s.conds.is_empty()
					&& s.conds
						.iter()
						.all(|c| neighbors.iter().any(|&(bit, na)| bit == c.dir_bit && na == c.when))
			})
			.max_by_key(|s| s.conds.len())
			.map(|s| s.item)
	}
}
