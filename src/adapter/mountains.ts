import { BrushOption } from '~/adapter/biomes';
import { ResolvedMountain } from '~/domain/mountain';

const STAIRS_BRUSH = 'stairs';

export function resolveMountain(name: string, options: BrushOption[]): ResolvedMountain | null {
  const ground = options.find((o) => o.name === name);
  if (!ground) return null;
  const stairsOpt = options.find((o) => o.name === STAIRS_BRUSH);
  return {
    name: ground.name,
    ground: { name: ground.name, serverId: ground.paintId, isGround: true, isDoodad: false },
    stairs: stairsOpt ? { name: stairsOpt.name, serverId: stairsOpt.paintId, isGround: true, isDoodad: false } : null
  };
}
