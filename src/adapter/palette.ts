import { invoke } from '@tauri-apps/api/core';

import { Thing } from '~/domain/thing';
import { defaultDataDir } from '~/adapter/assets';
import { FlagIndex, buildFlagIndex } from '~/adapter/thingFlags';
import { BrushKind, ItemBrushKind, PaletteData, PaletteBrush, PaletteTileset } from '~/domain/palette';

function sanitizeXml(text: string): string {
  return text.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(sanitizeXml(text), 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(error.textContent?.trim() || 'invalid XML');
  return doc;
}

async function readXml(dir: string, name: string): Promise<Document> {
  const text = await invoke<string>('read_file_text', { path: `${dir}/${name}` });
  return parseXml(text);
}

const emptyDoc = (root: string): Document => new DOMParser().parseFromString(`<${root}/>`, 'application/xml');

async function readXmlOptional(dir: string, name: string, root: string): Promise<Document> {
  try {
    return await readXml(dir, name);
  } catch (e) {
    console.error(`palette: ${name} unavailable in ${dir}:`, e);
    return emptyDoc(root);
  }
}

function numAttr(el: Element, name: string): number | undefined {
  const raw = el.getAttribute(name);
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function topLevel(doc: Document, tag: string): Element[] {
  return Array.from(doc.documentElement.children).filter((el) => el.tagName === tag);
}

function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((child) => child.tagName === tag);
}

function firstItemId(el: Element): number | undefined {
  for (const item of el.querySelectorAll('item')) {
    const id = numAttr(item, 'id');
    if (id != null) return id;
  }
  return undefined;
}

function brushLook(brushEl: Element): number | undefined {
  return numAttr(brushEl, 'server_lookid') ?? firstItemId(brushEl);
}

function groundPaintId(brushEl: Element): number | undefined {
  let best: { id: number; chance: number } | undefined;
  for (const item of directChildren(brushEl, 'item')) {
    const id = numAttr(item, 'id');
    if (id == null) continue;
    const chance = numAttr(item, 'chance') ?? 0;
    if (!best || chance > best.chance) best = { id, chance };
  }
  return best?.id;
}

function expandRange(item: Element): number[] {
  const id = numAttr(item, 'id');
  if (id != null) return [id];
  const from = numAttr(item, 'fromid');
  const to = numAttr(item, 'toid');
  if (from != null && to != null && to >= from) {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  return [];
}

export type BrushRef = { kind: BrushKind; look?: number; paint?: number };
type BrushIndex = Map<string, BrushRef>;

export interface ItemBrushRef {
  name: string;
  kind: ItemBrushKind;
  look?: number;
  paint?: number;
  open?: boolean;
}

let itemBrushIndex = new Map<number, ItemBrushRef>();

export function brushForItem(serverId: number): ItemBrushRef | null {
  return itemBrushIndex.get(serverId) ?? null;
}

function parseBorderItems(doc: Document): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const border of topLevel(doc, 'border')) {
    const id = numAttr(border, 'id');
    if (id == null) continue;
    const ids: number[] = [];
    for (const bi of directChildren(border, 'borderitem')) {
      const item = numAttr(bi, 'item');
      if (item != null) ids.push(item);
    }
    map.set(id, ids);
  }
  return map;
}

function buildItemBrushIndex(
  groundsDoc: Document,
  wallsDoc: Document,
  doodadsDoc: Document,
  borderItems: Map<number, number[]>
): Map<number, ItemBrushRef> {
  const idx = new Map<number, ItemBrushRef>();
  const set = (id: number, ref: ItemBrushRef) => {
    if (!idx.has(id)) idx.set(id, ref);
  };
  const grounds = topLevel(groundsDoc, 'brush');
  const groundRef = (el: Element, name: string): ItemBrushRef => ({
    name,
    kind: 'ground',
    look: brushLook(el),
    paint: groundPaintId(el)
  });
  for (const el of grounds) {
    const name = el.getAttribute('name');
    if (!name) continue;
    const ref = groundRef(el, name);
    for (const item of directChildren(el, 'item')) for (const id of expandRange(item)) set(id, ref);
  }
  for (const el of grounds) {
    const name = el.getAttribute('name');
    if (!name) continue;
    const ref = groundRef(el, name);
    for (const bEl of [...directChildren(el, 'border'), ...directChildren(el, 'optional')]) {
      const bid = numAttr(bEl, 'id');
      if (bid == null) continue;
      for (const iid of borderItems.get(bid) ?? []) set(iid, ref);
    }
  }
  for (const el of topLevel(wallsDoc, 'brush')) {
    const wallType = el.getAttribute('type');
    if (wallType !== 'wall' && wallType !== 'wall decoration') continue;
    const name = el.getAttribute('name');
    if (!name) continue;
    const look = brushLook(el);
    for (const door of el.querySelectorAll('door')) {
      const open = door.getAttribute('open') === 'true' || door.getAttribute('open') === '1';
      for (const id of expandRange(door)) set(id, { name, kind: 'door', look: id, paint: id, open });
    }
    const ref: ItemBrushRef = { name, kind: 'wall', look, paint: look };
    for (const item of el.querySelectorAll('item')) for (const id of expandRange(item)) set(id, ref);
  }
  for (const el of topLevel(doodadsDoc, 'brush')) {
    const type = el.getAttribute('type');
    if (type !== 'doodad' && type !== 'table' && type !== 'carpet') continue;
    const name = el.getAttribute('name');
    if (!name) continue;
    const look = brushLook(el);
    const ref: ItemBrushRef = { name, kind: type, look, paint: look };
    for (const item of el.querySelectorAll('item')) for (const id of expandRange(item)) set(id, ref);
  }
  return idx;
}

export async function loadBrushIndex(dir = defaultDataDir()): Promise<BrushIndex> {
  const [groundsDoc, wallsDoc, doodadsDoc] = await Promise.all([
    readXml(dir, 'grounds.xml'),
    readXml(dir, 'walls.xml'),
    readXml(dir, 'doodads.xml')
  ]);
  const index: BrushIndex = new Map();
  indexBrushes(groundsDoc, 'ground', index);
  indexBrushes(wallsDoc, 'wall', index);
  indexBrushes(doodadsDoc, 'doodad', index);
  return index;
}

function indexBrushes(doc: Document, kind: BrushKind, into: BrushIndex): void {
  for (const brushEl of topLevel(doc, 'brush')) {
    const name = brushEl.getAttribute('name');
    if (!name || into.has(name)) continue;
    into.set(name, { kind, look: brushLook(brushEl), paint: kind === 'ground' ? groundPaintId(brushEl) : undefined });
  }
}

function collectBrushSection(tsEl: Element, sectionTags: string[], index: BrushIndex): PaletteBrush[] {
  const tsName = tsEl.getAttribute('name') ?? '';
  const out: PaletteBrush[] = [];
  const seen = new Set<string>();
  for (const tag of sectionTags) {
    for (const section of directChildren(tsEl, tag)) {
      for (const ref of directChildren(section, 'brush')) {
        const refName = ref.getAttribute('name');
        if (!refName) continue;
        const entry = index.get(refName);
        if (!entry || seen.has(refName)) continue;
        seen.add(refName);
        out.push({ key: `${tsName}:${refName}`, name: refName, kind: entry.kind, lookServerId: entry.look, paintServerId: entry.paint });
      }
      for (const item of directChildren(section, 'item')) {
        for (const id of expandRange(item)) {
          const k = `${tsName}:terrain-item:${id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ key: k, name: `Item ${id}`, kind: 'rawItem', lookServerId: id });
        }
      }
    }
  }
  return out;
}

function collectItemIds(
  tsEl: Element,
  tags: string[],
  keyTag: string,
  into?: Set<number>,
  flagIndex?: FlagIndex
): PaletteBrush[] {
  const tsName = tsEl.getAttribute('name') ?? '';
  const out: PaletteBrush[] = [];
  const seen = new Set<number>();
  const push = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    into?.add(id);
    out.push({ key: `${tsName}:${keyTag}:${id}`, name: `Item ${id}`, kind: 'rawItem', lookServerId: id });
  };
  for (const tag of tags) {
    for (const section of directChildren(tsEl, tag)) {
      for (const item of directChildren(section, 'item')) for (const id of expandRange(item)) push(id);
      if (flagIndex) {
        for (const flag of directChildren(section, 'flag')) {
          for (const id of flagIndex.get(flag.getAttribute('name') ?? '') ?? []) push(id);
        }
      }
    }
  }
  return out;
}

const ITEM_SECTION_TAGS = ['items', 'items_and_raw'];
const RAW_SECTION_TAGS = ['raw', 'terrain_and_raw', 'doodad_and_raw', 'items_and_raw', 'collections_and_raw'];

function collectItems(tsEl: Element, flagIndex?: FlagIndex): PaletteBrush[] {
  return collectItemIds(tsEl, ITEM_SECTION_TAGS, 'item', undefined, flagIndex);
}

function collectRaw(tsEl: Element, claimed: Set<number>, flagIndex?: FlagIndex): PaletteBrush[] {
  return collectItemIds(tsEl, RAW_SECTION_TAGS, 'raw', claimed, flagIndex);
}

function buildOthersTileset(serverIds: number[], claimed: Set<number>): PaletteTileset | null {
  const brushes: PaletteBrush[] = [];
  for (const id of serverIds) {
    if (claimed.has(id)) continue;
    brushes.push({ key: `Others:raw:${id}`, name: `Item ${id}`, kind: 'rawItem', lookServerId: id });
  }
  return brushes.length ? { name: 'Others', brushes } : null;
}

const CREATURE_GROUP_LABELS: Record<string, string> = { monster: 'Monsters', npc: 'NPCs' };

function buildCreatureTilesets(doc: Document): PaletteTileset[] {
  const groups = new Map<string, PaletteBrush[]>();
  for (const c of doc.querySelectorAll('creature')) {
    const looktype = numAttr(c, 'looktype');
    if (looktype == null || looktype === 0) continue;
    const name = c.getAttribute('name') ?? '';
    const type = c.getAttribute('type') ?? 'monster';
    const list = groups.get(type) ?? [];
    list.push({
      key: `creature:${name}`,
      name,
      kind: 'creature',
      lookType: looktype,
      isNpc: type === 'npc',
      creature: {
        type: looktype,
        head: numAttr(c, 'lookhead'),
        body: numAttr(c, 'lookbody'),
        legs: numAttr(c, 'looklegs'),
        feet: numAttr(c, 'lookfeet')
      }
    });
    groups.set(type, list);
  }
  return [...groups.entries()]
    .map(([type, brushes]) => ({ name: CREATURE_GROUP_LABELS[type] ?? type, brushes }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function allServerIds(): Promise<number[]> {
  try {
    return await invoke<number[]>('all_server_ids');
  } catch {
    return [];
  }
}

export async function loadPalette(dir = defaultDataDir(), items?: Map<number, Thing>): Promise<PaletteData> {
  const [tilesetsDoc, groundsDoc, wallsDoc, doodadsDoc, creaturesDoc, bordersDoc, serverIds] = await Promise.all([
    readXml(dir, 'tilesets.xml'),
    readXmlOptional(dir, 'grounds.xml', 'materials'),
    readXmlOptional(dir, 'walls.xml', 'materials'),
    readXmlOptional(dir, 'doodads.xml', 'materials'),
    readXmlOptional(dir, 'creatures.xml', 'creatures'),
    readXml(dir, 'borders.xml').catch(() => null),
    allServerIds()
  ]);

  itemBrushIndex = buildItemBrushIndex(groundsDoc, wallsDoc, doodadsDoc, bordersDoc ? parseBorderItems(bordersDoc) : new Map());

  const flagIndex = items ? await buildFlagIndex(serverIds, items) : undefined;

  const index: BrushIndex = new Map();
  indexBrushes(groundsDoc, 'ground', index);
  indexBrushes(wallsDoc, 'wall', index);
  indexBrushes(doodadsDoc, 'doodad', index);

  const data: PaletteData = {
    terrain: [],
    doodad: [],
    item: [],
    raw: [],
    creature: [],
    waypoints: [],
    houses: [],
    zones: [],
    generator: []
  };
  const claimed = new Set<number>();

  for (const tsEl of topLevel(tilesetsDoc, 'tileset')) {
    const name = tsEl.getAttribute('name') ?? '';
    const terrain = collectBrushSection(tsEl, ['terrain', 'terrain_and_raw'], index);
    const doodad = collectBrushSection(tsEl, ['doodad', 'doodad_and_raw'], index);
    const item = collectItems(tsEl, flagIndex);
    const raw = collectRaw(tsEl, claimed, flagIndex);
    if (terrain.length) data.terrain.push({ name, brushes: terrain });
    if (doodad.length) data.doodad.push({ name, brushes: doodad });
    if (item.length) data.item.push({ name, brushes: item });
    if (raw.length) data.raw.push({ name, brushes: raw });
  }

  const others = buildOthersTileset(serverIds, claimed);
  if (others) data.raw.push(others);

  data.creature = buildCreatureTilesets(creaturesDoc);

  return data;
}
