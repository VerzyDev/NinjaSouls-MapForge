export type Mask = boolean[][];

export interface Point {
  x: number;
  y: number;
}

export function nearestWalkable(mask: Mask, cx: number, cy: number, maxR: number): Point | null {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  if (cy >= 0 && cy < h && cx >= 0 && cx < w && mask[cy][cx]) return { x: cx, y: cy };
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (y >= 0 && y < h && x >= 0 && x < w && mask[y][x]) return { x, y };
      }
    }
  }
  return null;
}

export function coverageMask(mask: Mask, cover: Point[], halfW: number, halfH: number): Mask {
  const gh = mask.length;
  const gw = gh ? mask[0].length : 0;
  const out: Mask = Array.from({ length: gh }, () => new Array(gw).fill(false));
  for (const c of cover) {
    const y0 = Math.max(0, c.y - halfH);
    const y1 = Math.min(gh - 1, c.y + halfH);
    const x0 = Math.max(0, c.x - halfW);
    const x1 = Math.min(gw - 1, c.x + halfW);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mask[y][x]) out[y][x] = true;
  }
  return out;
}

export const HUNT_SPAWN_RADIUS = 1;

export interface Spacing {
  blocked: Uint8Array;
  w: number;
  h: number;
  reach: number;
}

export function createSpacing(mask: Mask, radius = HUNT_SPAWN_RADIUS): Spacing {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  return { blocked: new Uint8Array(w * h), w, h, reach: radius * 2 };
}

const isFree = (sp: Spacing, p: Point) => !sp.blocked[p.y * sp.w + p.x];

function claim(sp: Spacing, p: Point) {
  for (let y = Math.max(0, p.y - sp.reach); y <= Math.min(sp.h - 1, p.y + sp.reach); y++) {
    for (let x = Math.max(0, p.x - sp.reach); x <= Math.min(sp.w - 1, p.x + sp.reach); x++) sp.blocked[y * sp.w + x] = 1;
  }
}

export function scatterPoints(mask: Mask, count: number, rand: () => number, spacing?: Spacing): Point[] {
  const gh = mask.length;
  const gw = gh ? mask[0].length : 0;
  const walkable: Point[] = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (mask[y][x]) walkable.push({ x, y });
  return spreadAmong(walkable, count, rand, spacing);
}

const SAMPLES = 24;

export function spreadAmong(candidates: Point[], count: number, rand: () => number, spacing?: Spacing): Point[] {
  let pool = spacing ? candidates.filter((p) => isFree(spacing, p)) : candidates;
  if (pool.length === 0 || count <= 0) return [];
  if (!spacing && pool.length <= count) return [...pool];
  const out: Point[] = [];
  const take = (p: Point) => {
    out.push(p);
    if (spacing) claim(spacing, p);
  };
  take(pool[Math.floor(rand() * pool.length)]);
  while (out.length < count) {
    if (spacing) pool = pool.filter((p) => isFree(spacing, p));
    if (pool.length === 0) break;
    let best: Point | null = null;
    let bestD = -1;
    const exhaustive = pool.length <= SAMPLES * 2;
    const tries = exhaustive ? pool.length : SAMPLES;
    for (let k = 0; k < tries; k++) {
      const c = exhaustive ? pool[k] : pool[Math.floor(rand() * pool.length)];
      let d = Infinity;
      for (const q of out) {
        const dd = Math.max(Math.abs(q.x - c.x), Math.abs(q.y - c.y));
        if (dd < d) d = dd;
        if (d <= bestD) break;
      }
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best || bestD < 1) break;
    take(best);
  }
  return out;
}

export interface BoxTile extends Point {
  box: number;
}

const STEPS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

function nearestSource(mask: Mask, sources: Point[]): Int32Array {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const owner = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  sources.forEach((n, i) => {
    if (!mask[n.y]?.[n.x]) return;
    const k = n.y * w + n.x;
    if (owner[k] !== -1) return;
    owner[k] = i;
    queue.push(k);
  });
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny][nx]) continue;
      if (dx !== 0 && dy !== 0 && !mask[cy][nx] && !mask[ny][cx]) continue;
      const ni = ny * w + nx;
      if (owner[ni] !== -1) continue;
      owner[ni] = owner[cur];
      queue.push(ni);
    }
  }
  return owner;
}

export function fillBoxes(
  mask: Mask,
  nodes: Point[],
  boxSize: number,
  halfW: number,
  halfH: number,
  rand: () => number,
  spacing?: Spacing
): BoxTile[] {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const owner = nearestSource(mask, nodes);
  const cells: Point[][] = nodes.map(() => []);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = owner[y * w + x];
      if (o === -1) continue;
      const n = nodes[o];
      if ((x === n.x && y === n.y) || Math.abs(x - n.x) > halfW || Math.abs(y - n.y) > halfH) continue;
      cells[o].push({ x, y });
    }
  }
  const out: BoxTile[] = [];
  cells.forEach((cell, box) => {
    for (const p of spreadAmong(cell, boxSize, rand, spacing)) out.push({ x: p.x, y: p.y, box });
  });
  return out;
}

export function lureSegments(loopLength: number, lureLength: number): number[] {
  const step = Math.max(1, lureLength);
  const count = Math.max(1, Math.ceil(loopLength / step));
  const size = loopLength / count;
  return Array.from({ length: loopLength }, (_, i) => Math.min(count - 1, Math.floor(i / size)));
}

export function fillRotation(
  mask: Mask,
  loop: Point[],
  perLure: number,
  lureLength: number,
  halfW: number,
  halfH: number,
  rand: () => number,
  firstLure = 0,
  spacing?: Spacing
): { tiles: BoxTile[]; lures: number; targets: number[] } {
  if (loop.length === 0) return { tiles: [], lures: 0, targets: [] };
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const segment = lureSegments(loop.length, lureLength);
  const lures = segment[segment.length - 1] + 1;
  const owner = nearestSource(mask, loop);
  const cells: Point[][] = Array.from({ length: lures }, () => []);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = owner[y * w + x];
      if (o === -1) continue;
      const src = loop[o];
      if (Math.abs(x - src.x) > halfW || Math.abs(y - src.y) > halfH) continue;
      cells[segment[o]].push({ x, y });
    }
  }
  const walked = new Array(lures).fill(0);
  for (const s of segment) walked[s]++;
  const screen = (halfW * 2 + 1) * (halfH * 2 + 1);
  const targets = cells.map((cell, lure) => {
    const byWalk = Math.round((perLure * walked[lure]) / Math.max(1, lureLength));
    const byFloor = lures === 1 ? Math.round((perLure * cell.length) / screen) : 0;
    return Math.min(perLure, Math.max(byWalk, byFloor));
  });
  const tiles: BoxTile[] = [];
  cells.forEach((cell, lure) => {
    for (const p of spreadAmong(cell, targets[lure], rand, spacing)) tiles.push({ x: p.x, y: p.y, box: firstLure + lure });
  });
  return { tiles, lures, targets };
}

const MIN_SCREEN_FLOOR = 0.25;

export function spreadPoints(mask: Mask, viewW: number, viewH: number): Point[] {
  const gh = mask.length;
  const gw = gh ? mask[0].length : 0;
  const cw = Math.max(1, viewW);
  const ch = Math.max(1, viewH);
  const minTiles = Math.ceil(cw * ch * MIN_SCREEN_FLOOR);
  const kept: Point[] = [];
  let fallback: { point: Point; tiles: number } | null = null;
  for (let y0 = 0; y0 < gh; y0 += ch) {
    for (let x0 = 0; x0 < gw; x0 += cw) {
      const cell: Point[] = [];
      for (let y = y0; y < Math.min(gh, y0 + ch); y++) for (let x = x0; x < Math.min(gw, x0 + cw); x++) if (mask[y][x]) cell.push({ x, y });
      if (cell.length === 0) continue;
      const mx = cell.reduce((sum, p) => sum + p.x, 0) / cell.length;
      const my = cell.reduce((sum, p) => sum + p.y, 0) / cell.length;
      let center = cell[0];
      let best = Infinity;
      for (const p of cell) {
        const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d < best) {
          best = d;
          center = p;
        }
      }
      if (cell.length >= minTiles) kept.push(center);
      else if (!fallback || cell.length > fallback.tiles) fallback = { point: center, tiles: cell.length };
    }
  }
  if (kept.length === 0 && fallback) kept.push(fallback.point);
  return kept;
}

export function interleaveCounts(counts: number[]): number[] {
  const total = counts.reduce((sum, c) => sum + Math.max(0, c), 0);
  const credit = counts.map(() => 0);
  const out: number[] = [];
  for (let step = 0; step < total; step++) {
    let best = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] <= 0) continue;
      credit[i] += counts[i];
      if (best === -1 || credit[i] > credit[best]) best = i;
    }
    credit[best] -= total;
    out.push(best);
  }
  return out;
}
