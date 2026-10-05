import { ZoneToolId } from '~/domain/zones';

export type HouseToolId = 'house' | 'house_exit';

export type ToolId = 'select' | 'brush' | 'pen' | 'eraser' | 'borderize' | 'bucket' | 'wand' | 'spawn' | ZoneToolId | HouseToolId;

export interface ToolMeta {
  id: ToolId;
  label: string;
}

export const TOOLS: ToolMeta[] = [
  { id: 'select', label: 'Select' },
  { id: 'brush', label: 'Brush' },
  { id: 'pen', label: 'Pen - click to add points, drag for curves, Enter/double-click to apply, Esc to cancel' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'borderize', label: 'Borderize (N) - paint to reborder tiles' },
  {
    id: 'bucket',
    label:
      'Fill (G) - flood the area under the cursor with the active brush, Ctrl inverts contiguous, Alt to ignore the reference image'
  },
  {
    id: 'wand',
    label: 'Magic wand (Ctrl+W) - select the area under the cursor, Ctrl inverts contiguous, Alt to ignore the reference image'
  },
  { id: 'spawn', label: 'Spawn' },
  { id: 'zone_pz', label: 'Protection zone (Ctrl-drag to erase)' },
  { id: 'zone_nopvp', label: 'No-PVP zone (Ctrl-drag to erase)' },
  { id: 'zone_nologout', label: 'No-logout zone (Ctrl-drag to erase)' },
  { id: 'zone_pvp', label: 'PVP zone (Ctrl-drag to erase)' }
];

export type EraserMode = 'items' | 'ground' | 'creatures' | 'duplicates';

export interface EraserModeMeta {
  id: EraserMode;
  label: string;
}

export const ERASER_MODES: EraserModeMeta[] = [
  { id: 'items', label: 'Erase items (keep ground)' },
  { id: 'ground', label: 'Erase ground only' },
  { id: 'creatures', label: 'Erase creatures and spawns' },
  { id: 'duplicates', label: 'Erase duplicated items' }
];

export const isZoneTool = (id: ToolId): id is ZoneToolId => id.startsWith('zone_');

export const isHouseTool = (id: ToolId): id is HouseToolId => id === 'house' || id === 'house_exit';
