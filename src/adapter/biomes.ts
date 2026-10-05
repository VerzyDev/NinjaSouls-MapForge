import { invoke } from '@tauri-apps/api/core';

import { PaletteData } from '~/domain/palette';
import { defaultDataDir } from '~/adapter/assets';
import { BrushRef, loadBrushIndex } from '~/adapter/palette';
import { ZoneToolId, ZONE_TOOLS, ZONE_TOOL_LABELS } from '~/domain/zones';
import { GenLayer, BiomeDef, ResolvedRef, ResolvedBiome, ResolvedLayer, ResolvedBlotch } from '~/domain/biome';

function clampIntensity(raw: string | null): number {
  const n = Number(raw ?? '0.5');
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function sanitizeXml(text: string): string {
  return text.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(sanitizeXml(text), 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(error.textContent?.trim() || 'invalid XML');
  return doc;
}

function parseBiomesXml(text: string): BiomeDef[] {
  const doc = parseXml(text);
  const out: BiomeDef[] = [];
  for (const el of Array.from(doc.documentElement.children)) {
    if (el.tagName !== 'biome') continue;
    const name = el.getAttribute('name');
    const ground = el.getAttribute('ground');
    if (!name || !ground) continue;
    const scatters = Array.from(el.children)
      .filter((c) => c.tagName === 'scatter')
      .map((c) => ({
        brush: c.getAttribute('brush') ?? '',
        chance: Number(c.getAttribute('chance') ?? '0'),
        layer: c.getAttribute('layer') === 'high' ? ('high' as const) : ('low' as const),
        cluster: c.getAttribute('cluster') === 'true'
      }))
      .filter((s) => s.brush && Number.isFinite(s.chance));
    const blotches = Array.from(el.children)
      .filter((c) => c.tagName === 'blotch')
      .map((c) => ({ brush: c.getAttribute('brush') ?? '', intensity: clampIntensity(c.getAttribute('intensity')) }))
      .filter((b) => b.brush);
    const legacy = el.getAttribute('trail');
    if (legacy && !blotches.some((b) => b.brush === legacy)) blotches.unshift({ brush: legacy, intensity: 0.5 });
    out.push({ name, ground, blotches, scatters });
  }
  return out;
}

function resolveRef(name: string, index: Map<string, BrushRef>): ResolvedRef | null {
  const entry = index.get(name);
  const serverId = entry?.paint ?? entry?.look;
  if (!entry || serverId == null) return null;
  return { name, serverId, isGround: entry.kind === 'ground', isDoodad: entry.kind === 'doodad' };
}

function resolveBiome(def: BiomeDef, index: Map<string, BrushRef>): ResolvedBiome | null {
  const ground = resolveRef(def.ground, index);
  if (!ground) return null;
  const blotches = def.blotches
    .map((b) => {
      const ref = resolveRef(b.brush, index);
      return ref ? { ref, intensity: b.intensity } : null;
    })
    .filter((b): b is ResolvedBlotch => b !== null);
  const scatters: ResolvedLayer[] = [];
  for (const s of def.scatters) {
    const ref = resolveRef(s.brush, index);
    if (ref) scatters.push({ ref, chance: s.chance, layer: s.layer, cluster: s.cluster });
  }
  return { name: def.name, ground, blotches, scatters };
}

export async function loadBiomes(dir = defaultDataDir()): Promise<ResolvedBiome[]> {
  const [text, index] = await Promise.all([invoke<string>('read_file_text', { path: `${dir}/biomes.xml` }), loadBrushIndex(dir)]);
  return parseBiomesXml(text)
    .map((def) => resolveBiome(def, index))
    .filter((b): b is ResolvedBiome => b !== null);
}

export async function loadBiomeDefs(dir = defaultDataDir()): Promise<BiomeDef[]> {
  const text = await invoke<string>('read_file_text', { path: `${dir}/biomes.xml` }).catch(() => '<biomes></biomes>');
  return parseBiomesXml(text);
}

export interface BrushOption {
  key?: string;
  name: string;
  kind: string;
  serverId: number;
  paintId: number;
  isGround?: boolean;
  lookType?: number;
  isNpc?: boolean;
  head?: number;
  body?: number;
  legs?: number;
  feet?: number;
  zoneTool?: ZoneToolId;
}

export const ZONE_BRUSH_OPTIONS: BrushOption[] = ZONE_TOOLS.map((tool) => ({
  key: `zone:${tool}`,
  name: ZONE_TOOL_LABELS[tool],
  kind: 'zone',
  serverId: 0,
  paintId: 0,
  zoneTool: tool
}));

export const zoneBrushOption = (tool: ZoneToolId): BrushOption =>
  ZONE_BRUSH_OPTIONS.find((o) => o.zoneTool === tool) as BrushOption;

export function paletteBrushOptions(palette: PaletteData | null): BrushOption[] {
  if (!palette) return ZONE_BRUSH_OPTIONS;
  const byName = new Map<string, BrushOption>(ZONE_BRUSH_OPTIONS.map((o) => [o.name, o]));
  for (const category of Object.values(palette)) {
    for (const tileset of category) {
      for (const b of tileset.brushes) {
        if (byName.has(b.name)) continue;
        if (b.kind === 'creature') {
          if (b.lookType == null) continue;
          byName.set(b.name, {
            key: b.key,
            name: b.name,
            kind: b.kind,
            serverId: 0,
            paintId: 0,
            lookType: b.lookType,
            isNpc: b.isNpc,
            head: b.creature?.head,
            body: b.creature?.body,
            legs: b.creature?.legs,
            feet: b.creature?.feet
          });
          continue;
        }
        const look = b.lookServerId ?? b.paintServerId;
        if (look == null) continue;
        byName.set(b.name, {
          key: b.key,
          name: b.name,
          kind: b.kind,
          serverId: look,
          paintId: b.paintServerId ?? look,
          isGround: b.kind === 'ground'
        });
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadBrushOptions(dir = defaultDataDir()): Promise<BrushOption[]> {
  const index = await loadBrushIndex(dir);
  return [...index.entries()]
    .filter(([, e]) => e.look != null)
    .map(([name, e]) => ({ name, kind: e.kind, serverId: e.look as number, paintId: e.paint ?? (e.look as number) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function serializeBiomesXml(defs: BiomeDef[]): string {
  const lines = ['<biomes>'];
  for (const b of defs) {
    lines.push(`\t<biome name="${escapeAttr(b.name)}" ground="${escapeAttr(b.ground)}">`);
    for (const bl of b.blotches) {
      lines.push(`\t\t<blotch brush="${escapeAttr(bl.brush)}" intensity="${bl.intensity}"/>`);
    }
    for (const s of b.scatters) {
      lines.push(`\t\t<scatter brush="${escapeAttr(s.brush)}" chance="${s.chance}" layer="${s.layer}" cluster="${s.cluster}"/>`);
    }
    lines.push('\t</biome>');
  }
  lines.push('</biomes>', '');
  return lines.join('\n');
}

export async function saveBiomes(defs: BiomeDef[], dir = defaultDataDir()): Promise<void> {
  await invoke('write_file_text', { path: `${dir}/biomes.xml`, contents: serializeBiomesXml(defs) });
}

function encodeGenerate(mapId: number, automagic: boolean, dir: string, layers: GenLayer[]): ArrayBuffer {
  const enc = new TextEncoder();
  const dirBytes = enc.encode(dir);
  const brushes = layers.map((l) => enc.encode(l.brush));
  let size = 4 + 1 + 2 + dirBytes.length + 4;
  for (let i = 0; i < layers.length; i++) size += 2 + 1 + 1 + 2 + brushes[i].length + 4 + layers[i].xs.length * 4;

  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;
  dv.setUint32(o, mapId, true);
  o += 4;
  dv.setUint8(o, automagic ? 1 : 0);
  o += 1;
  dv.setUint16(o, dirBytes.length, true);
  o += 2;
  bytes.set(dirBytes, o);
  o += dirBytes.length;
  dv.setUint32(o, layers.length, true);
  o += 4;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    dv.setUint16(o, l.serverId, true);
    o += 2;
    dv.setUint8(o, (l.isGround ? 1 : 0) | (l.isDoodad ? 2 : 0));
    o += 1;
    dv.setUint8(o, l.z);
    o += 1;
    dv.setUint16(o, brushes[i].length, true);
    o += 2;
    bytes.set(brushes[i], o);
    o += brushes[i].length;
    dv.setUint32(o, l.xs.length, true);
    o += 4;
    for (let k = 0; k < l.xs.length; k++) {
      dv.setUint16(o, l.xs[k], true);
      o += 2;
    }
    for (let k = 0; k < l.ys.length; k++) {
      dv.setUint16(o, l.ys[k], true);
      o += 2;
    }
  }
  return buf;
}

export async function generateApply(
  mapId: number,
  layers: GenLayer[],
  automagic: boolean,
  dir = defaultDataDir()
): Promise<[number, number][]> {
  return invoke<[number, number][]>('generate_apply', encodeGenerate(mapId, automagic, dir, layers));
}
