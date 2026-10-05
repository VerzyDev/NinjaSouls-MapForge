use std::collections::HashMap;

use super::dat_writer::ThingType;
use super::nodefile::{parse_node_file, Cursor};

const ROOT_ATTR_VERSION: u8 = 0x01;
const ITEM_ATTR_SERVERID: u8 = 0x10;
const ITEM_ATTR_CLIENTID: u8 = 0x11;

#[derive(Default)]
pub struct OtbItems {
	pub server_to_client: HashMap<u16, u16>,
	pub server_to_group: HashMap<u16, u8>,
	pub server_to_type: HashMap<u16, String>,
	pub server_to_flags: HashMap<u16, u32>,
}

const FLAG_PICKUPABLE: u32 = 1 << 5;
const FLAG_STACKABLE: u32 = 1 << 7;
const FLAG_READABLE: u32 = 1 << 14;
const FLAG_ALLOWDISTREAD: u32 = 1 << 20;

pub const OTB_GROUP_GROUND: u8 = 1;
pub const OTB_GROUP_CONTAINER: u8 = 2;
pub const OTB_GROUP_TELEPORT: u8 = 7;
pub const OTB_GROUP_MAGICFIELD: u8 = 8;
pub const OTB_GROUP_WRITEABLE: u8 = 9;
pub const OTB_GROUP_SPLASH: u8 = 11;
pub const OTB_GROUP_FLUID: u8 = 12;
pub const OTB_GROUP_DOOR: u8 = 13;

impl OtbItems {
	pub fn client_id(&self, server_id: u16) -> Option<u16> {
		self.server_to_client.get(&server_id).copied()
	}

	pub fn group(&self, server_id: u16) -> u8 {
		self.server_to_group.get(&server_id).copied().unwrap_or(0)
	}

	pub fn kind(&self, server_id: u16) -> &str {
		self.server_to_type.get(&server_id).map(String::as_str).unwrap_or("")
	}

	fn has_flag(&self, server_id: u16, mask: u32) -> bool {
		self.server_to_flags.get(&server_id).is_some_and(|f| f & mask != 0)
	}

	pub fn readable(&self, server_id: u16) -> bool {
		self.has_flag(server_id, FLAG_READABLE | FLAG_ALLOWDISTREAD)
	}

	pub fn stackable(&self, server_id: u16) -> bool {
		self.has_flag(server_id, FLAG_STACKABLE)
	}

	pub fn pickupable(&self, server_id: u16) -> bool {
		self.has_flag(server_id, FLAG_PICKUPABLE)
	}
}

pub fn identity_from_dat(things: &[ThingType]) -> OtbItems {
	let mut items = OtbItems::default();
	for t in things {
		let Ok(id) = u16::try_from(t.id) else { continue };
		let group = if t.is_ground {
			OTB_GROUP_GROUND
		} else if t.is_container {
			OTB_GROUP_CONTAINER
		} else if t.is_fluid_container {
			OTB_GROUP_FLUID
		} else if t.is_fluid {
			OTB_GROUP_SPLASH
		} else if t.writable || t.writable_once {
			OTB_GROUP_WRITEABLE
		} else {
			0
		};
		let mut flags = 0u32;
		if t.stackable {
			flags |= FLAG_STACKABLE;
		}
		if t.pickupable {
			flags |= FLAG_PICKUPABLE;
		}
		if t.writable || t.writable_once {
			flags |= FLAG_READABLE;
		}
		items.server_to_client.insert(id, id);
		items.server_to_group.insert(id, group);
		items.server_to_flags.insert(id, flags);
	}
	items
}

pub fn apply_items_xml(items: &mut OtbItems, xml: &str) {
	let Ok(doc) = roxmltree::Document::parse(xml) else {
		return;
	};
	for item in doc.descendants().filter(|n| n.has_tag_name("item")) {
		let mut kind: Option<&str> = None;
		let mut text_flags = 0u32;
		for attr in item.children().filter(|c| c.has_tag_name("attribute")) {
			let Some(key) = attr.attribute("key") else { continue };
			let value = attr.attribute("value").unwrap_or("");
			let truthy = value == "1" || value.eq_ignore_ascii_case("true");
			if key.eq_ignore_ascii_case("type") {
				kind = attr.attribute("value");
			} else if truthy && (key.eq_ignore_ascii_case("readable") || key.eq_ignore_ascii_case("writeable")) {
				text_flags |= FLAG_READABLE;
			} else if truthy && key.eq_ignore_ascii_case("allowdistread") {
				text_flags |= FLAG_ALLOWDISTREAD;
			}
		}
		if kind.is_none() && text_flags == 0 {
			continue;
		}
		let ids: Vec<u16> = match item.attribute("id").and_then(|v| v.parse::<u16>().ok()) {
			Some(id) => vec![id],
			None => match (
				item.attribute("fromid").and_then(|v| v.parse::<u16>().ok()),
				item.attribute("toid").and_then(|v| v.parse::<u16>().ok()),
			) {
				(Some(from), Some(to)) => (from..=to).collect(),
				_ => continue,
			},
		};
		for id in ids {
			if let Some(k) = kind {
				items.server_to_type.insert(id, k.to_string());
			}
			if text_flags != 0 {
				*items.server_to_flags.entry(id).or_insert(0) |= text_flags;
			}
		}
	}
}

pub fn parse_otb(bytes: &[u8]) -> Result<OtbItems, String> {
	let root = parse_node_file(bytes)?;

	// Root payload (type byte already consumed as node kind):
	// [flags u32][ROOT_ATTR_VERSION u8][version_len u16][major u32][minor u32][build u32][tail...]
	let mut c = Cursor::new(&root.data);
	c.u32().ok_or("otb: missing root flags")?;
	let attr = c.u8().ok_or("otb: missing root version attribute")?;
	if attr != ROOT_ATTR_VERSION {
		return Err("otb: expected ROOT_ATTR_VERSION".into());
	}
	let version_len = c.u16().ok_or("otb: missing version length")? as usize;
	c.u32().ok_or("otb: missing major version")?;
	c.u32().ok_or("otb: missing minor version")?;
	c.u32().ok_or("otb: missing build number")?;
	// Skip the remainder of the version payload (12 bytes already read of version_len).
	if version_len > 12 {
		c.skip(version_len - 12);
	}

	let mut server_to_client: HashMap<u16, u16> = HashMap::new();
	let mut server_to_group: HashMap<u16, u8> = HashMap::new();
	let mut server_to_flags: HashMap<u16, u32> = HashMap::new();

	for item in &root.children {
		let group = item.kind;
		let mut ic = Cursor::new(&item.data);
		let Some(flags) = ic.u32() else {
			continue;
		};

		let mut server_id: Option<u16> = None;
		let mut client_id: Option<u16> = None;

		while let Some(a) = ic.u8() {
			let len = match ic.u16() {
				Some(l) => l as usize,
				None => break,
			};
			match a {
				ITEM_ATTR_SERVERID => {
					if len == 2 {
						server_id = ic.u16();
					} else {
						ic.skip(len);
					}
				}
				ITEM_ATTR_CLIENTID => {
					if len == 2 {
						client_id = ic.u16();
					} else {
						ic.skip(len);
					}
				}
				_ => {
					ic.skip(len);
				}
			}
		}

		if let (Some(s), Some(cid)) = (server_id, client_id) {
			if s != 0 {
				server_to_client.insert(s, cid);
				server_to_group.insert(s, group);
				server_to_flags.insert(s, flags);
			}
		}
	}

	if server_to_client.is_empty() {
		return Err("otb: no item definitions parsed".into());
	}

	Ok(OtbItems { server_to_client, server_to_group, server_to_type: HashMap::new(), server_to_flags })
}
