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

export function scatterPoints(mask: Mask, count: number, rand: () => number): Point[] {
  const gh = mask.length;
  const gw = gh ? mask[0].length : 0;
  const walkable: Point[] = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (mask[y][x]) walkable.push({ x, y });
  if (walkable.length === 0 || count <= 0) return [];
  const n = Math.min(count, walkable.length);
  const out: Point[] = [walkable[Math.floor(rand() * walkable.length)]];
  const K = 24;
  while (out.length < n) {
    let best: Point | null = null;
    let bestD = -1;
    for (let k = 0; k < K; k++) {
      const c = walkable[Math.floor(rand() * walkable.length)];
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
    out.push(best);
  }
  return out;
}

export function spreadPoints(mask: Mask, viewW: number, viewH: number): Point[] {
  const minX = Math.max(1, Math.round((viewW * 2) / 3));
  const minY = Math.max(1, Math.round((viewH * 2) / 3));
  const gh = mask.length;
  const gw = gh ? mask[0].length : 0;
  const kept: Point[] = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!mask[y][x]) continue;
      if (kept.every((q) => Math.abs(q.x - x) >= minX || Math.abs(q.y - y) >= minY)) kept.push({ x, y });
    }
  }
  return kept;
}
