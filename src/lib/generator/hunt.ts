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

const ROOM_CLEARANCES = [2, 1];
const ROOM_MIN_TILES = 16;
const ROOM_MIN_MONSTERS = 2;
const ROOM_TILES_FOR_FULL_LURE = 128;
const ROOM_PILLAR_TILES = 9;

function erode(mask: Mask): Mask {
  return mask.map((row, y) => row.map((cell, x) => cell && STEPS.every(([dx, dy]) => mask[y + dy]?.[x + dx])));
}

function withoutPillars(mask: Mask): Mask {
  const solid = mask.map((row) => [...row]);
  const seen = mask.map((row) => row.map(() => false));
  mask.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell || seen[y][x]) return;
      seen[y][x] = true;
      const blob: Point[] = [{ x, y }];
      for (let head = 0; head < blob.length; head++) {
        for (const [dx, dy] of STEPS) {
          const nx = blob[head].x + dx;
          const ny = blob[head].y + dy;
          if (ny < 0 || nx < 0 || ny >= mask.length || nx >= row.length || mask[ny][nx] || seen[ny][nx]) continue;
          seen[ny][nx] = true;
          blob.push({ x: nx, y: ny });
        }
      }
      if (blob.length <= ROOM_PILLAR_TILES) for (const p of blob) solid[p.y][p.x] = true;
    });
  });
  return solid;
}

export function findRooms(mask: Mask): Point[][] {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const solid = withoutPillars(mask);
  const owner = new Int32Array(w * h).fill(-1);
  const rooms: Point[][] = [];
  const take = (x: number, y: number, room: number) => {
    owner[y * w + x] = room;
    rooms[room].push({ x, y });
  };
  for (const clearance of ROOM_CLEARANCES) {
    let core: Mask = solid.map((row, y) => row.map((cell, x) => cell && owner[y * w + x] === -1));
    for (let i = 0; i < clearance; i++) core = erode(core);
    const first = rooms.length;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!core[y][x] || owner[y * w + x] !== -1) continue;
        const room = rooms.length;
        rooms.push([]);
        take(x, y, room);
        for (let head = 0; head < rooms[room].length; head++) {
          const p = rooms[room][head];
          for (const [dx, dy] of STEPS.slice(0, 4)) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (core[ny]?.[nx] && owner[ny * w + nx] === -1) take(nx, ny, room);
          }
        }
      }
    }
    for (let i = 0; i < clearance; i++) {
      for (let room = first; room < rooms.length; room++) {
        for (const p of [...rooms[room]]) {
          for (const [dx, dy] of STEPS) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (solid[ny]?.[nx] && owner[ny * w + nx] === -1) take(nx, ny, room);
          }
        }
      }
    }
  }
  return rooms.map((room) => room.filter((p) => mask[p.y][p.x])).filter((room) => room.length > 0);
}

export function roomTarget(tiles: number, perLure: number): number {
  if (tiles < ROOM_MIN_TILES) return 0;
  const byArea = Math.round((tiles * perLure) / ROOM_TILES_FOR_FULL_LURE);
  return Math.min(perLure, Math.max(ROOM_MIN_MONSTERS, byArea));
}

export function nodePerRoom(mask: Mask, nodes: Point[]): Point[] {
  const out = [...nodes];
  for (const room of findRooms(mask)) {
    if (room.length < ROOM_MIN_TILES) continue;
    const inside = new Set(room.map((p) => `${p.x},${p.y}`));
    if (nodes.some((n) => inside.has(`${n.x},${n.y}`))) continue;
    const cx = room.reduce((sum, p) => sum + p.x, 0) / room.length;
    const cy = room.reduce((sum, p) => sum + p.y, 0) / room.length;
    const dist = (p: Point) => Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy));
    out.push(room.reduce((best, p) => (dist(p) < dist(best) ? p : best)));
  }
  return out;
}

export interface LureRules {
  perLure: number;
  lureLength: number;
  aggroW: number;
  aggroH: number;
}

export interface RouteStop {
  loop: number;
  index: number;
}

const LURE_GAPS = [8, 5, 0];
const LURE_STRIDE = 2;
const ROOM_LURE_SHARE = 0.75;

function shuffle<T>(items: T[], rand: () => number) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

export function stopsPulling(mask: Mask, loops: Point[][], c: Point, aggroW: number, aggroH: number): RouteStop[] {
  const w = mask[0].length;
  const halfW = Math.floor(aggroW / 2);
  const halfH = Math.floor(aggroH / 2);
  const reached = new Set([c.y * w + c.x]);
  const queue = [c];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    for (const [dx, dy] of STEPS) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (Math.abs(nx - c.x) > halfW || Math.abs(ny - c.y) > halfH || !mask[ny]?.[nx] || reached.has(ny * w + nx)) continue;
      if (dx !== 0 && dy !== 0 && !mask[p.y][nx] && !mask[ny][p.x]) continue;
      reached.add(ny * w + nx);
      queue.push({ x: nx, y: ny });
    }
  }
  const stops: RouteStop[] = [];
  loops.forEach((path, loop) => {
    path.forEach((p, index) => {
      if (reached.has(p.y * w + p.x)) stops.push({ loop, index });
    });
  });
  return stops;
}

function stretchesHit(stops: RouteStop[], loops: Point[][], lureLength: number): Map<number, Set<number>> {
  const hit = new Map<number, Set<number>>();
  for (const { loop, index } of stops) {
    const length = loops[loop].length;
    const span = Math.min(Math.max(1, lureLength), length);
    let starts = hit.get(loop);
    if (!starts) hit.set(loop, (starts = new Set()));
    for (let back = 0; back < span; back++) starts.add((index - back + length) % length);
  }
  return hit;
}

export function fillLures(mask: Mask, loops: Point[][], rules: LureRules, rand: () => number): { tiles: BoxTile[]; lures: number } {
  const { perLure, lureLength, aggroW, aggroH } = rules;
  if (perLure <= 0 || loops.length === 0) return { tiles: [], lures: 0 };
  const w = mask[0].length;
  const spacing = createSpacing(mask);
  const load = loops.map((path) => new Int32Array(path.length));
  const roomAt = new Map<number, number>();
  const roomLeft: number[] = [];
  findRooms(mask).forEach((room) => {
    if (room.length > aggroW * aggroH) return;
    for (const p of room) roomAt.set(p.y * w + p.x, roomLeft.length);
    roomLeft.push(roomTarget(room.length, perLure));
  });
  const pool: Point[] = [];
  mask.forEach((row, y) => {
    row.forEach((cell, x) => {
      const sampled = x % LURE_STRIDE === 0 && y % LURE_STRIDE === 0;
      if (cell && (sampled || roomAt.has(y * w + x))) pool.push({ x, y });
    });
  });
  shuffle(pool, rand);
  const placed: { point: Point; first: RouteStop }[] = [];
  const inRoom = (p: Point) => roomAt.has(p.y * w + p.x);
  const roomTiles = pool.filter(inRoom);
  const phases: [Point[], number][] = [
    [roomTiles, Math.ceil(perLure * ROOM_LURE_SHARE)],
    [pool.filter((p) => !inRoom(p)), perLure],
    [roomTiles, perLure]
  ];
  for (const [group, cap] of phases) {
    let open = group;
    for (const gap of LURE_GAPS) {
      const rejected: Point[] = [];
      for (const c of open) {
        const room = roomAt.get(c.y * w + c.x);
        if (!isFree(spacing, c) || (room !== undefined && roomLeft[room] <= 0)) continue;
        if (placed.some(({ point }) => Math.max(Math.abs(point.x - c.x), Math.abs(point.y - c.y)) < gap)) {
          rejected.push(c);
          continue;
        }
        const stops = stopsPulling(mask, loops, c, aggroW, aggroH);
        if (stops.length === 0) continue;
        const hit = stretchesHit(stops, loops, lureLength);
        const full = [...hit].some(([loop, starts]) => [...starts].some((start) => load[loop][start] >= cap));
        if (full) continue;
        for (const [loop, starts] of hit) for (const start of starts) load[loop][start]++;
        if (room !== undefined) roomLeft[room]--;
        claim(spacing, c);
        placed.push({ point: c, first: stops[0] });
      }
      open = rejected;
    }
  }
  placed.sort((a, b) => a.first.loop - b.first.loop || a.first.index - b.first.index);
  const tiles = placed.map(({ point }, i) => ({ ...point, box: Math.floor(i / perLure) }));
  return { tiles, lures: Math.ceil(tiles.length / perLure) };
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
