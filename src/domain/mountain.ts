import { ResolvedRef } from '~/domain/biome';

export interface ResolvedMountain {
  name: string;
  ground: ResolvedRef;
  stairs: ResolvedRef | null;
}

export interface MountainOptions {
  seed: number;
  density: number;
  steps: number;
  scale: number;
  stairs: boolean;
}
