const ZOOM_MAX_LEVEL = 16;
const ZOOM_OUT_DIVISORS = [2, 3, 4, 6, 8, 12, 16, 24, 32];

function buildLevels(): number[] {
  const set = new Set<number>();
  for (let n = 1; n <= ZOOM_MAX_LEVEL; n++) set.add(n);
  for (const fine of [0.6, 0.7, 0.8, 0.9, 1.5, 2.5, 3.5]) set.add(fine);
  for (const n of ZOOM_OUT_DIVISORS) set.add(1 / n);
  return [...set].sort((a, b) => a - b);
}

export const ZOOM_LEVELS = buildLevels();
export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

function nearestIndex(z: number): number {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const d = Math.abs(ZOOM_LEVELS[i] - z);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function snapZoom(z: number): number {
  return ZOOM_LEVELS[nearestIndex(z)];
}

export function stepZoom(z: number, dir: number): number {
  const i = nearestIndex(z);
  const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + Math.sign(dir)));
  return ZOOM_LEVELS[next];
}
