import { test, expect } from 'bun:test';

import { ResolvedBiome } from '~/domain/biome';
import { ResolvedMountain } from '~/domain/mountain';

import { planMountain } from './generateMountain';
import { Cell, components, planGeneration, ensureConnected, pruneThinBlotches } from './generate';

function rect(w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push({ x, y });
  return out;
}

const grass: ResolvedBiome = {
  name: 'Grass',
  ground: { name: 'grass', serverId: 100, isGround: true, isDoodad: false },
  blotches: [{ ref: { name: 'dirt', serverId: 101, isGround: true, isDoodad: false }, intensity: 0.5 }],
  scatters: [{ ref: { name: 'tree', serverId: 200, isGround: false, isDoodad: true }, chance: 60, layer: 'high', cluster: true }]
};

const sand: ResolvedBiome = {
  name: 'Sand',
  ground: { name: 'sand', serverId: 300, isGround: true, isDoodad: false },
  blotches: [],
  scatters: [{ ref: { name: 'rock', serverId: 400, isGround: false, isDoodad: true }, chance: 20, layer: 'high', cluster: true }]
};

const opts = { seed: 42, density: 1, blotches: true, biomeScale: 0.07 };

test('carve reconnects two halves split by a solid wall', () => {
  const region = new Set<string>();
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) region.add(`${x},${y}`);
  const blocked = new Set<string>();
  for (let y = 0; y < 5; y++) blocked.add(`2,${y}`);

  expect(components(region, blocked).length).toBe(2);
  ensureConnected(region, blocked, () => {});
  expect(components(region, blocked).length).toBe(1);
});

test('plan is deterministic for a fixed seed', async () => {
  const a = await planGeneration(rect(20, 20), [grass], opts, 7);
  const b = await planGeneration(rect(20, 20), [grass], opts, 7);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test('generated region stays fully walkable after carve', async () => {
  const region = new Set(rect(30, 30).map((c) => `${c.x},${c.y}`));
  const plan = await planGeneration(rect(30, 30), [grass], { seed: 7, density: 1.5, blotches: false, biomeScale: 0.07 }, 7);
  const blockLayer = plan.layers.find((l) => l.serverId === 200);
  const blocked = new Set<string>();
  if (blockLayer) for (let i = 0; i < blockLayer.xs.length; i++) blocked.add(`${blockLayer.xs[i]},${blockLayer.ys[i]}`);
  expect(components(region, blocked).length).toBeLessThanOrEqual(1);
});

test('every region tile gets exactly one ground (biome or blotch)', async () => {
  const tiles = rect(15, 15);
  const plan = await planGeneration(tiles, [grass], opts, 7);
  const ground = new Set<string>();
  for (const layer of plan.layers) {
    if (!layer.isGround) continue;
    for (let i = 0; i < layer.xs.length; i++) ground.add(`${layer.xs[i]},${layer.ys[i]}`);
  }
  expect(ground.size).toBe(tiles.length);
});

test('multi-biome covers every tile once and uses both grounds', async () => {
  const tiles = rect(40, 40);
  const plan = await planGeneration(tiles, [grass, sand], { seed: 5, density: 1, blotches: false, biomeScale: 0.07 }, 7);
  const ground = new Map<string, number>();
  for (const layer of plan.layers) {
    if (!layer.isGround) continue;
    for (let i = 0; i < layer.xs.length; i++) {
      const k = `${layer.xs[i]},${layer.ys[i]}`;
      ground.set(k, (ground.get(k) ?? 0) + 1);
    }
  }
  expect(ground.size).toBe(tiles.length);
  expect([...ground.values()].every((n) => n === 1)).toBe(true);
  const groundIds = new Set(plan.layers.filter((l) => l.isGround).map((l) => l.serverId));
  expect(groundIds.has(100)).toBe(true);
  expect(groundIds.has(300)).toBe(true);
});

const mountain: ResolvedMountain = {
  name: 'Rock',
  ground: { name: 'mountain', serverId: 918, isGround: true, isDoodad: false },
  stairs: { name: 'stairs', serverId: 459, isGround: true, isDoodad: false }
};

const forest: ResolvedBiome = {
  name: 'Forest',
  ground: { name: 'grass', serverId: 100, isGround: true, isDoodad: false },
  blotches: [],
  scatters: [
    { ref: { name: 'tree', serverId: 200, isGround: false, isDoodad: true }, chance: 30, layer: 'high', cluster: true },
    { ref: { name: 'flower', serverId: 500, isGround: false, isDoodad: true }, chance: 40, layer: 'low', cluster: false }
  ]
};

test('low vegetation fills tiles and never lands on a high-veg trunk', async () => {
  const plan = await planGeneration(rect(30, 30), [forest], { seed: 3, density: 1, blotches: false, biomeScale: 0.07 }, 7);
  const high = new Set<string>();
  const low = new Set<string>();
  for (const l of plan.layers) {
    if (l.isGround) continue;
    const set = l.serverId === 200 ? high : l.serverId === 500 ? low : null;
    if (!set) continue;
    for (let i = 0; i < l.xs.length; i++) set.add(`${l.xs[i]},${l.ys[i]}`);
  }
  expect(low.size).toBeGreaterThan(0);
  expect(high.size).toBeGreaterThan(0);
  for (const k of low) expect(high.has(k)).toBe(false);
});

test('high veg never repeats 3 identical in a straight line', async () => {
  const dense: ResolvedBiome = {
    name: 'Dense',
    ground: { name: 'g', serverId: 1, isGround: true, isDoodad: false },
    blotches: [],
    scatters: [
      { ref: { name: 'tree', serverId: 7, isGround: false, isDoodad: true }, chance: 100, layer: 'high', cluster: false }
    ]
  };
  const plan = await planGeneration(rect(20, 20), [dense], { seed: 1, density: 1, blotches: false, biomeScale: 0.07 }, 7);
  const set = new Set<string>();
  for (const l of plan.layers) {
    if (l.isGround || l.serverId !== 7) continue;
    for (let i = 0; i < l.xs.length; i++) set.add(`${l.xs[i]},${l.ys[i]}`);
  }
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];
  for (const k of set) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of dirs) {
      const triple = set.has(`${x - dx},${y - dy}`) && set.has(`${x - 2 * dx},${y - 2 * dy}`);
      expect(triple).toBe(false);
    }
  }
});

test('mountain base sits on the grass floor and taller parts rise above', () => {
  const tiles = rect(40, 40);
  const plan = planMountain(tiles, mountain, { seed: 9, density: 1.5, steps: 3, scale: 0.05, stairs: true }, 7);
  const ground = plan.layers.filter((l) => l.isGround && l.serverId === 918);
  const baseCount = ground.filter((l) => l.z === 7).reduce((n, l) => n + l.xs.length, 0);
  const raisedCount = ground.filter((l) => l.z < 7).reduce((n, l) => n + l.xs.length, 0);
  expect(baseCount).toBeGreaterThan(0);
  expect(baseCount).toBeLessThan(tiles.length);
  expect(raisedCount).toBeGreaterThan(0);
  expect(plan.layers.some((l) => l.serverId === 459)).toBe(true);
});

test('thin 1-wide blotch fingers are pruned, 2-wide blobs kept', () => {
  const ref = { name: 'dirt', serverId: 101, isGround: true, isDoodad: false };
  const m = new Map<string, typeof ref>();
  for (let x = 0; x < 6; x++) m.set(`${x},0`, ref);
  for (let y = 0; y < 3; y++) for (let x = 10; x < 13; x++) m.set(`${x},${y}`, ref);
  m.set('20,20', ref);
  pruneThinBlotches(m);
  for (let x = 0; x < 6; x++) expect(m.has(`${x},0`)).toBe(false);
  expect(m.has('20,20')).toBe(false);
  expect(m.has('11,1')).toBe(true);
});

test('mountain places no stairs when toggle is off', () => {
  const plan = planMountain(rect(40, 40), mountain, { seed: 9, density: 1.5, steps: 3, scale: 0.05, stairs: false }, 7);
  expect(plan.layers.some((l) => l.serverId === 459)).toBe(false);
});
