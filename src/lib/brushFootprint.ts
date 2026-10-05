export type BrushShape = 'circle' | 'square';
export type TileList = { xs: number[]; ys: number[] };

export const BRUSH_SIZE_MIN = 1;
export const BRUSH_SIZE_MAX = 5;
export const BRUSH_SIZE_STEP = 0.5;

export const clampBrushSize = (size: number): number =>
  Math.min(BRUSH_SIZE_MAX, Math.max(BRUSH_SIZE_MIN, Math.round(size / BRUSH_SIZE_STEP) * BRUSH_SIZE_STEP));

export const footprintReach = (brushSize: number): number => Math.max(0, Math.round(brushSize) - 1);

export function footprintMaskSvg(reach: number, shape: BrushShape, fill: string, stroke: string): string {
  const span = 2 * reach + 1;
  const inside = (dx: number, dy: number) =>
    Math.abs(dx) <= reach && Math.abs(dy) <= reach && (shape !== 'circle' || Math.hypot(dx, dy) <= reach + 0.001);
  const cells: string[] = [];
  const edges: string[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (!inside(dx, dy)) continue;
      const x = dx + reach;
      const y = dy + reach;
      cells.push(`M${x} ${y}h1v1h-1z`);
      if (!inside(dx, dy - 1)) edges.push(`M${x} ${y}h1`);
      if (!inside(dx, dy + 1)) edges.push(`M${x} ${y + 1}h1`);
      if (!inside(dx - 1, dy)) edges.push(`M${x} ${y}v1`);
      if (!inside(dx + 1, dy)) edges.push(`M${x + 1} ${y}v1`);
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" preserveAspectRatio="none">` +
    `<path d="${cells.join('')}" fill="${fill}"/>` +
    `<path d="${edges.join('')}" fill="none" stroke="${stroke}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function brushFootprint(cx: number, cy: number, brushSize: number, shape: BrushShape = 'circle'): TileList {
  const reach = footprintReach(brushSize);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (shape === 'circle' && Math.hypot(dx, dy) > reach + 0.001) continue;
      xs.push(cx + dx);
      ys.push(cy + dy);
    }
  }
  return { xs, ys };
}
