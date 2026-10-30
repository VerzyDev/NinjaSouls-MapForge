export type PaletteCategoryId =
  | 'terrain'
  | 'doodad'
  | 'item'
  | 'raw'
  | 'creature'
  | 'waypoints'
  | 'houses'
  | 'zones'
  | 'generator';

export interface PaletteCategoryMeta {
  id: PaletteCategoryId;
  label: string;
}

export const PALETTE_CATEGORIES: PaletteCategoryMeta[] = [
  { id: 'terrain', label: 'Terrain Palette' },
  { id: 'doodad', label: 'Doodad Palette' },
  { id: 'item', label: 'Item Palette' },
  { id: 'raw', label: 'RAW Palette' },
  { id: 'creature', label: 'Creature Palette' },
  { id: 'waypoints', label: 'Waypoint Palette' },
  { id: 'houses', label: 'House Palette' },
  { id: 'zones', label: 'Zone Palette' },
  { id: 'generator', label: 'Generator' }
];

export const isRevealFriendly = (id: PaletteCategoryId): boolean => id !== 'generator';

export type BrushKind = 'ground' | 'wall' | 'doodad' | 'rawItem' | 'creature';

export type ItemBrushKind = 'ground' | 'wall' | 'door' | 'doodad' | 'table' | 'carpet';

export const ITEM_BRUSH_LABELS: Record<ItemBrushKind, string> = {
  ground: 'Select Groundbrush',
  wall: 'Select Wallbrush',
  door: 'Select Doorbrush',
  doodad: 'Select Doodadbrush',
  table: 'Select Tablebrush',
  carpet: 'Select Carpetbrush'
};

export interface CreatureLook {
  type: number;
  head?: number;
  body?: number;
  legs?: number;
  feet?: number;
}

export interface PaletteBrush {
  key: string;
  name: string;
  kind: BrushKind;
  lookServerId?: number;
  paintServerId?: number;
  lookType?: number;
  isNpc?: boolean;
  creature?: CreatureLook;
}

export interface PaletteTileset {
  name: string;
  brushes: PaletteBrush[];
}

export interface ActiveBrush {
  key: string;
  name: string;
  kind: BrushKind;
  serverId?: number;
  isGround: boolean;
  preview?: string;
  cols?: number;
  rows?: number;
  lookType?: number;
  isNpc?: boolean;
  head?: number;
  body?: number;
  legs?: number;
  feet?: number;
}

export type PaletteData = Record<PaletteCategoryId, PaletteTileset[]>;

export const emptyPalette = (): PaletteData =>
  PALETTE_CATEGORIES.reduce((acc, c) => {
    acc[c.id] = [];
    return acc;
  }, {} as PaletteData);
