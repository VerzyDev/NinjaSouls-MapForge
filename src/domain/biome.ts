export type VegLayer = 'low' | 'high';

export interface BiomeLayerDef {
  brush: string;
  chance: number;
  layer: VegLayer;
  cluster: boolean;
}

export interface BiomeBlotchDef {
  brush: string;
  intensity: number;
}

export interface BiomeDef {
  name: string;
  ground: string;
  blotches: BiomeBlotchDef[];
  scatters: BiomeLayerDef[];
}

export interface ResolvedRef {
  name: string;
  serverId: number;
  isGround: boolean;
  isDoodad: boolean;
}

export interface ResolvedLayer {
  ref: ResolvedRef;
  chance: number;
  layer: VegLayer;
  cluster: boolean;
}

export interface ResolvedBlotch {
  ref: ResolvedRef;
  intensity: number;
}

export interface ResolvedBiome {
  name: string;
  ground: ResolvedRef;
  blotches: ResolvedBlotch[];
  scatters: ResolvedLayer[];
}

export interface GenerateOptions {
  seed: number;
  density: number;
  blotches: boolean;
  biomeScale: number;
}

export interface GenLayer {
  serverId: number;
  isGround: boolean;
  isDoodad: boolean;
  brush: string;
  z: number;
  xs: number[];
  ys: number[];
}

export interface GenPlan {
  layers: GenLayer[];
}
