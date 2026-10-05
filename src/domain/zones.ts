export const ZONE_PZ = 0x01;
export const ZONE_NOPVP = 0x04;
export const ZONE_NOLOGOUT = 0x08;
export const ZONE_PVP = 0x10;

export type ZoneToolId = 'zone_pz' | 'zone_nopvp' | 'zone_nologout' | 'zone_pvp';

export const ZONE_TOOL_FLAG: Record<ZoneToolId, number> = {
  zone_pz: ZONE_PZ,
  zone_nopvp: ZONE_NOPVP,
  zone_nologout: ZONE_NOLOGOUT,
  zone_pvp: ZONE_PVP
};

export const ZONE_TOOL_LABELS: Record<ZoneToolId, string> = {
  zone_pz: 'Protection zone',
  zone_nopvp: 'No-PVP zone',
  zone_nologout: 'No-logout zone',
  zone_pvp: 'PVP zone'
};

export const ZONE_TOOLS: ZoneToolId[] = ['zone_pz', 'zone_nopvp', 'zone_nologout', 'zone_pvp'];

export interface ZoneVisibility {
  pz: boolean;
  nopvp: boolean;
  nologout: boolean;
  pvp: boolean;
}

export const DEFAULT_ZONE_VISIBILITY: ZoneVisibility = {
  pz: true,
  nopvp: true,
  nologout: true,
  pvp: true
};

export function visibleZoneBits(flags: number, vis: ZoneVisibility): number {
  let out = 0;
  if (vis.pz && flags & ZONE_PZ) out |= ZONE_PZ;
  if (vis.nopvp && flags & ZONE_NOPVP) out |= ZONE_NOPVP;
  if (vis.nologout && flags & ZONE_NOLOGOUT) out |= ZONE_NOLOGOUT;
  if (vis.pvp && flags & ZONE_PVP) out |= ZONE_PVP;
  return out;
}
