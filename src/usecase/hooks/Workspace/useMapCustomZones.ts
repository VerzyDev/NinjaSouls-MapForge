import React from 'react';

import { hasSidecars } from '~/lib/map/sidecars';
import { MapCustomZones } from '~/domain/customZone';
import { loadCustomZones, customZonesPath } from '~/adapter/customZones';

interface CustomZoneSource {
  id: string;
  path?: string;
}

export interface MapCustomZonesApi {
  customZones: MapCustomZones | null;
  setCustomZones: React.Dispatch<React.SetStateAction<MapCustomZones | null>>;
}

export const useMapCustomZones = (active: CustomZoneSource | null): MapCustomZonesApi => {
  const [customZones, setCustomZones] = React.useState<MapCustomZones | null>(null);

  React.useEffect(() => {
    if (!active?.path || !hasSidecars(active.path)) {
      setCustomZones(null);
      return;
    }
    let cancelled = false;
    void loadCustomZones(customZonesPath(active.path)).then((zones) => {
      if (!cancelled) setCustomZones(zones);
    });
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.path]);

  return { customZones, setCustomZones };
};
