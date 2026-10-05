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
