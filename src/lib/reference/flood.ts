export interface ReferenceGrid {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

const FLOOD_LIMIT = 250_000;

export function sampleReferenceGrid(img: HTMLImageElement, tilesWide: number): ReferenceGrid | null {
  if (!img.naturalWidth || !img.naturalHeight) return null;
  const w = Math.max(1, Math.round(tilesWide));
  const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

const matches = (data: Uint8ClampedArray, a: number, b: number, limit: number) => {
  if (data[a + 3] < 8 || data[b + 3] < 8) return data[a + 3] < 8 && data[b + 3] < 8;
  const dr = data[a] - data[b];
  const dg = data[a + 1] - data[b + 1];
  const db = data[a + 2] - data[b + 2];
  return dr * dr + dg * dg + db * db <= limit;
};

export interface FloodOptions {
  tolerance: number;
  contiguous: boolean;
  blocked?: Uint8Array | null;
}

const isBlocked = (blocked: Uint8Array | null | undefined, cell: number) =>
  blocked != null && (blocked[cell >> 3] & (1 << (cell & 7))) !== 0;

export function floodImage(grid: ReferenceGrid, seedX: number, seedY: number, opts: FloodOptions): { x: number; y: number }[] {
  const { w, h, data } = grid;
  if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return [];
  const reach = (opts.tolerance / 100) * 441;
  const limit = reach * reach;
  const start = seedY * w + seedX;
  if (isBlocked(opts.blocked, start)) return [];
  const seed = start * 4;
  const found: { x: number; y: number }[] = [];

  if (!opts.contiguous) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = y * w + x;
        if (!isBlocked(opts.blocked, cell) && matches(data, seed, cell * 4, limit)) found.push({ x, y });
      }
    }
    return found;
  }

  const seen = new Uint8Array(w * h);
  const queue: number[] = [start];
  seen[start] = 1;
  while (queue.length > 0 && found.length < FLOOD_LIMIT) {
    const cell = queue.pop()!;
    const cx = cell % w;
    const cy = (cell - cx) / w;
    found.push({ x: cx, y: cy });
    const neighbours = [cy > 0 ? cell - w : -1, cx > 0 ? cell - 1 : -1, cx < w - 1 ? cell + 1 : -1, cy < h - 1 ? cell + w : -1];
    for (const next of neighbours) {
      if (next < 0 || seen[next]) continue;
      seen[next] = 1;
      if (!isBlocked(opts.blocked, next) && matches(data, seed, next * 4, limit)) queue.push(next);
    }
  }
  return found;
}
