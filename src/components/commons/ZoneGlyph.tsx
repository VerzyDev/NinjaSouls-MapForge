import { ComponentType } from 'react';
import { IconSwords, IconLogout, IconSwordOff, IconShieldHalf } from '@tabler/icons-react';

import { ZoneToolId } from '~/domain/zones';

const ZONE_ICONS: Record<ZoneToolId, ComponentType<{ className?: string }>> = {
  zone_pz: IconShieldHalf,
  zone_nopvp: IconSwordOff,
  zone_nologout: IconLogout,
  zone_pvp: IconSwords
};

const ZoneGlyph = ({ tool, size = 20 }: { tool: ZoneToolId; size?: number }) => {
  const Icon = ZONE_ICONS[tool];
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center text-primary">
      <Icon className="h-[70%] w-[70%]" />
    </span>
  );
};

export default ZoneGlyph;
