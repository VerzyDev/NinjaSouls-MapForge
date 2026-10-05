import { fbm } from '~/lib/generator/noise';
import { TILE } from '~/components/MapCanvas/constants';

export interface PenPoint {
  x: number;
  y: number;
}

export interface PenAnchor {
  p: PenPoint;
  hIn: PenPoint;
  hOut: PenPoint;
}

export type PenHot = { type: 'anchor'; index: number } | { type: 'handle'; index: number; handle: 'in' | 'out' };

const STEP = TILE * 0.5;

function dist(a: PenPoint, b: PenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cubic(a: PenPoint, c1: PenPoint, c2: PenPoint, b: PenPoint, t: number): PenPoint {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
    y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y
  };
}

export function sampleBezierPath(anchors: PenAnchor[]): PenPoint[] {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return [anchors[0].p];
  const out: PenPoint[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const c1 = { x: a.p.x + a.hOut.x, y: a.p.y + a.hOut.y };
    const c2 = { x: b.p.x + b.hIn.x, y: b.p.y + b.hIn.y };
    const len = dist(a.p, c1) + dist(c1, c2) + dist(c2, b.p);
    const steps = Math.min(400, Math.max(8, Math.ceil(len / STEP)));
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) out.push(cubic(a.p, c1, c2, b.p, s / steps));
  }
  return out;
}

export interface PathOptions {
  seed?: number;
  widthJitter?: number;
  edgeRough?: number;
}

const EDGE_SCALE = 0.55;

function edgeOffset(tx: number, ty: number, seed: number): number {
  const coarse = fbm(tx * EDGE_SCALE, ty * EDGE_SCALE, seed + 777, 3) - 0.5;
  const fine = fbm(tx * EDGE_SCALE * 2.7 + 11, ty * EDGE_SCALE * 2.7, seed + 333, 2) - 0.5;
  return Math.max(-1, Math.min(1, (coarse + 0.5 * fine) * 3.4));
}

export function pathTiles(points: PenPoint[], width: number, opts: PathOptions = {}): { xs: number[]; ys: number[] } {
  const seed = opts.seed ?? 0;
  const jitter = opts.widthJitter ?? 1;
  const edge = opts.edgeRough ?? 1;
  const set = new Set<string>();
  const base = Math.max(1.4, width * 0.9);
  const amp = 0.7 + 0.7 * edge;

  const stamp = (wx: number, wy: number, ux: number, uy: number, arcTiles: number) => {
    const widthN = fbm(arcTiles * 0.16, seed * 0.03 + 5.1, seed + 91, 3);
    const wander = (fbm(arcTiles * 0.11 + 3.7, seed * 0.05 + 1.3, seed + 211, 2) - 0.5) * base * 0.8;
    const hw = Math.max(1.3, base * (0.55 + 1.0 * jitter * widthN));
    const ox = -uy * wander;
    const oy = ux * wander;
    const cx = Math.floor((wx + ox) / TILE);
    const cy = Math.floor((wy + oy) / TILE);
    const reach = Math.ceil(hw + amp) + 1;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= hw * 0.6) {
          set.add(`${cx + dx},${cy + dy}`);
          continue;
        }
        if (d > hw + amp) continue;
        const o = edgeOffset(cx + dx, cy + dy, seed);
        if (d <= hw + (o > 0 ? o * 0.5 : o) * amp) set.add(`${cx + dx},${cy + dy}`);
      }
    }
  };

  let arc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      const b1 = points[1] ?? points[0];
      const len0 = dist(points[0], b1) || 1;
      stamp(points[0].x, points[0].y, (b1.x - points[0].x) / len0, (b1.y - points[0].y) / len0, 0);
      continue;
    }
    const a = points[i - 1];
    const b = points[i];
    const segLen = dist(a, b);
    const ux = (b.x - a.x) / (segLen || 1);
    const uy = (b.y - a.y) / (segLen || 1);
    const n = Math.max(1, Math.ceil(segLen / (STEP * 0.6)));
    for (let s = 1; s <= n; s++) {
      const f = s / n;
      stamp(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, ux, uy, (arc + segLen * f) / TILE);
    }
    arc += segLen;
  }

  for (const k of [...set]) {
    const [x, y] = k.split(',').map(Number);
    let n = 0;
    if (set.has(`${x + 1},${y}`)) n++;
    if (set.has(`${x - 1},${y}`)) n++;
    if (set.has(`${x},${y + 1}`)) n++;
    if (set.has(`${x},${y - 1}`)) n++;
    if (n <= 1) set.delete(k);
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const k of set) {
    const [x, y] = k.split(',').map(Number);
    xs.push(x);
    ys.push(y);
  }
  return { xs, ys };
}
