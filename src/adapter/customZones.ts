import { invoke } from '@tauri-apps/api/core';

import { MapCustomZones, CustomZoneFile, toCustomZoneFile, fromCustomZoneFile, emptyMapCustomZones } from '~/domain/customZone';

export const CUSTOM_ZONES_FILE = 'zones.json';

export const customZonesPath = (mapPath: string): string => {
  const dir = mapPath.replace(/[^\\/]+$/, '');
  const stem = (mapPath.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '');
  return `${dir}${stem}-zones/${CUSTOM_ZONES_FILE}`;
};

export async function loadCustomZones(path: string): Promise<MapCustomZones> {
  let content: string;
  try {
    content = await invoke<string>('read_file_text', { path });
  } catch {
    return emptyMapCustomZones();
  }
  try {
    return fromCustomZoneFile(JSON.parse(content) as CustomZoneFile);
  } catch {
    return emptyMapCustomZones();
  }
}

export const serializeCustomZones = (zones: MapCustomZones): string => `${JSON.stringify(toCustomZoneFile(zones), null, '\t')}\n`;

export async function saveCustomZones(path: string, zones: MapCustomZones): Promise<void> {
  await invoke('write_file_text', { path, contents: serializeCustomZones(zones) });
}
