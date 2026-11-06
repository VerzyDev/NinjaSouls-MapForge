import { Mask, Point } from './hunt';

const NEIGH: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

interface Bfs {
  dist: Int32Array;
  parent: Int32Array;
}

function bfs(mask: Mask, w: number, h: number, sx: number, sy: number): Bfs {
  const dist = new Int32Array(w * h).fill(-1);
  const parent = new Int32Array(w * h).fill(-1);
  const start = sy * w + sx;
  dist[start] = 0;
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of NEIGH) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny][nx]) continue;
      if (dx !== 0 && dy !== 0 && !mask[cy][nx] && !mask[ny][cx]) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[cur] + 1;
      parent[ni] = cur;
      queue.push(ni);
    }
  }
  return { dist, parent };
}

export interface RouteEdge {
  a: number;
  b: number;
  path: Point[];
  steps: number;
}

export interface HuntRoute {
  nodes: Point[];
  edges: RouteEdge[];
  totalSteps: number;
}

export interface HuntRouteRender {
  nodes: Point[];
  paths: Point[][];
}

function reconstruct(b: Bfs, w: number, from: number, to: number): Point[] {
  const path: Point[] = [];
  let cur = to;
  while (cur !== -1) {
    path.push({ x: cur % w, y: (cur / w) | 0 });
    if (cur === from) break;
    cur = b.parent[cur];
  }
  return path.reverse();
}

function mstForest(mask: Mask, nodes: Point[]): { edges: RouteEdge[]; totalSteps: number } {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const n = nodes.length;
  const idx = (p: Point) => p.y * w + p.x;
  const trees = nodes.map((nd) => bfs(mask, w, h, nd.x, nd.y));
  const inTree = new Array(n).fill(false);
  const edges: RouteEdge[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (inTree[seed]) continue;
    inTree[seed] = true;
    for (;;) {
      let bestI = -1;
      let bestJ = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!inTree[i]) continue;
        for (let j = 0; j < n; j++) {
          if (inTree[j]) continue;
          const d = trees[i].dist[idx(nodes[j])];
          if (d >= 0 && d < bestD) {
            bestD = d;
            bestI = i;
            bestJ = j;
          }
        }
      }
      if (bestJ === -1) break;
      inTree[bestJ] = true;
      edges.push({ a: bestI, b: bestJ, path: reconstruct(trees[bestI], w, idx(nodes[bestI]), idx(nodes[bestJ])), steps: bestD });
    }
  }
  return { edges, totalSteps: edges.reduce((s, e) => s + e.steps, 0) };
}

export function reachableFrom(mask: Mask, start: Point): Mask {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const out: Mask = Array.from({ length: h }, () => new Array(w).fill(false));
  if (!h || !w || !mask[start.y]?.[start.x]) return out;
  const b = bfs(mask, w, h, start.x, start.y);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (b.dist[y * w + x] >= 0) out[y][x] = true;
  return out;
}

export function connectRoute(mask: Mask, nodes: Point[]): HuntRoute {
  if (nodes.length === 0) return { nodes, edges: [], totalSteps: 0 };
  const { edges, totalSteps } = mstForest(mask, nodes);
  return { nodes, edges, totalSteps };
}

export function buildRoute(mask: Mask, nodes: Point[]): HuntRoute {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const n = nodes.length;
  if (n === 0) return { nodes, edges: [], totalSteps: 0 };
  const idx = (p: Point) => p.y * w + p.x;
  const trees = nodes.map((nd) => bfs(mask, w, h, nd.x, nd.y));
  const parent = nodes.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (trees[i].dist[idx(nodes[j])] >= 0) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  let component: number[] = [];
  for (const g of groups.values()) if (g.length > component.length) component = g;
  return connectRoute(
    mask,
    component.map((i) => nodes[i])
  );
}

export function keepMainAreas(walk: Mask, area: Mask, minTiles: number, anchors?: Mask): { mask: Mask; dropped: number } {
  const h = walk.length;
  const w = h ? walk[0].length : 0;
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!area[y][x] || !walk[y][x] || label[y * w + x] !== -1) continue;
      const id = sizes.length;
      const b = bfs(walk, w, h, x, y);
      let size = 0;
      for (let i = 0; i < w * h; i++) {
        if (b.dist[i] < 0) continue;
        label[i] = id;
        if (area[(i / w) | 0][i % w]) size++;
      }
      sizes.push(size);
    }
  }
  const largest = sizes.reduce((best, size, i) => (size > sizes[best] ? i : best), 0);
  const keep = sizes.map((size, i) => i === largest || size >= minTiles);
  if (anchors) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!anchors[y][x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const id = label[ny * w + nx];
            if (id !== -1) keep[id] = true;
          }
        }
      }
    }
  }
  const mask: Mask = area.map((row, y) => row.map((cell, x) => cell && label[y * w + x] !== -1 && keep[label[y * w + x]]));
  return { mask, dropped: keep.filter((k) => !k).length };
}

export interface HuntLoop {
  order: number[];
  path: Point[];
}

function cycleLength(order: number[], dist: number[][]): number {
  let total = 0;
  for (let i = 0; i < order.length; i++) total += dist[order[i]][order[(i + 1) % order.length]];
  return total;
}

function improveCycle(order: number[], dist: number[][]): number[] {
  const n = order.length;
  if (n < 4) return order;
  let best = [...order];
  let improved = true;
  for (let pass = 0; improved && pass < 50; pass++) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = best[i === 0 ? n - 1 : i - 1];
        const b = best[i];
        const c = best[k];
        const d = best[(k + 1) % n];
        if (dist[a][c] + dist[b][d] < dist[a][b] + dist[c][d]) {
          best = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
          improved = true;
        }
      }
    }
  }
  return cycleLength(best, dist) <= cycleLength(order, dist) ? best : order;
}

function shortestTour(members: number[], dist: number[][]): number[] {
  const order = [members[0]];
  const left = new Set(members.slice(1));
  while (left.size) {
    const last = order[order.length - 1];
    let next = -1;
    for (const j of left) if (next === -1 || dist[last][j] < dist[last][next]) next = j;
    order.push(next);
    left.delete(next);
  }
  return improveCycle(order, dist);
}

export function insertionIndex(mask: Mask, nodes: Point[], p: Point): number {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const walk = bfs(mask, w, h, p.x, p.y).dist;
  let best = nodes.length;
  let bestCost = Infinity;
  nodes.forEach((a, i) => {
    const b = nodes[(i + 1) % nodes.length];
    const toA = walk[a.y * w + a.x];
    const toB = walk[b.y * w + b.x];
    if (toA < 0 || toB < 0) return;
    const cost = toA + toB - Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    if (cost < bestCost) {
      bestCost = cost;
      best = i + 1;
    }
  });
  return best;
}

export function buildLoops(mask: Mask, nodes: Point[], keepOrder = false): HuntLoop[] {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const n = nodes.length;
  if (n === 0) return [];
  const idx = (p: Point) => p.y * w + p.x;
  const trees = nodes.map((nd) => bfs(mask, w, h, nd.x, nd.y));
  const dist = nodes.map((_, i) => nodes.map((nd) => trees[i].dist[idx(nd)]));
  const seen = new Array(n).fill(false);
  const loops: HuntLoop[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (seen[seed]) continue;
    const members = nodes.map((_, j) => j).filter((j) => !seen[j] && (j === seed || dist[seed][j] >= 0));
    for (const j of members) seen[j] = true;
    const tour = keepOrder ? members : shortestTour(members, dist);
    const path: Point[] = [nodes[tour[0]]];
    if (tour.length > 1) {
      for (let i = 0; i < tour.length; i++) {
        const from = tour[i];
        const to = tour[(i + 1) % tour.length];
        const leg = reconstruct(trees[from], w, idx(nodes[from]), idx(nodes[to]));
        for (let s = 1; s < leg.length; s++) path.push(leg[s]);
      }
      path.pop();
    }
    loops.push({ order: tour, path });
  }
  return loops;
}

export function nodePerArea(mask: Mask, nodes: Point[]): Point[] {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const seen = new Uint8Array(w * h);
  const out = [...nodes];
  for (const n of nodes) {
    if (!mask[n.y]?.[n.x] || seen[n.y * w + n.x]) continue;
    const b = bfs(mask, w, h, n.x, n.y);
    for (let i = 0; i < w * h; i++) if (b.dist[i] >= 0) seen[i] = 1;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y][x] || seen[y * w + x]) continue;
      const b = bfs(mask, w, h, x, y);
      const tiles: Point[] = [];
      for (let i = 0; i < w * h; i++) {
        if (b.dist[i] < 0) continue;
        seen[i] = 1;
        tiles.push({ x: i % w, y: (i / w) | 0 });
      }
      const mx = tiles.reduce((sum, p) => sum + p.x, 0) / tiles.length;
      const my = tiles.reduce((sum, p) => sum + p.y, 0) / tiles.length;
      let best = tiles[0];
      for (const p of tiles) if ((p.x - mx) ** 2 + (p.y - my) ** 2 < (best.x - mx) ** 2 + (best.y - my) ** 2) best = p;
      out.push(best);
    }
  }
  return out;
}
