export const GROUND_LAYER = 7;
export const MAP_MAX_LAYER = 15;
export const MAP_MIN_LAYER = 0;

let floorShiftX = 1;
let floorShiftY = 1;

export function setFloorShift(x: number, y: number): void {
  floorShiftX = Number.isFinite(x) ? x : 1;
  floorShiftY = Number.isFinite(y) ? y : 1;
}

export function floorShift(): { x: number; y: number } {
  return { x: floorShiftX, y: floorShiftY };
}

export interface FloorRange {
  startZ: number;
  endZ: number;
}

export function visibleFloorRange(current: number): FloorRange {
  const floor = Math.min(MAP_MAX_LAYER, Math.max(MAP_MIN_LAYER, current));
  const startZ = floor <= GROUND_LAYER ? GROUND_LAYER : Math.min(MAP_MAX_LAYER, floor + 2);
  return { startZ, endZ: floor };
}

export type SelectionMode = 'current' | 'lower' | 'visible';

export interface FloorBox {
  z: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export function selectionFloorBoxes(
  current: number,
  mode: SelectionMode,
  compensate: boolean,
  ax: number,
  ay: number,
  bx: number,
  by: number
): FloorBox[] {
  const deepest = mode === 'current' ? current : mode === 'lower' ? MAP_MAX_LAYER : visibleFloorRange(current).startZ;
  const boxes: FloorBox[] = [];
  for (let z = current; z <= deepest; z++) {
    const shiftX = compensate ? (z - current) * floorShiftX : 0;
    const shiftY = compensate ? (z - current) * floorShiftY : 0;
    const fax = ax - shiftX;
    const fay = ay - shiftY;
    const fbx = bx - shiftX;
    const fby = by - shiftY;
    if (Math.max(fax, fbx) < 0 || Math.max(fay, fby) < 0) continue;
    boxes.push({ z, ax: Math.max(0, fax), ay: Math.max(0, fay), bx: Math.max(0, fbx), by: Math.max(0, fby) });
  }
  return boxes;
}
