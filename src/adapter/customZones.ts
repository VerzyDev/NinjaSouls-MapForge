import { invoke } from '@tauri-apps/api/core';

import {
  MapCustomZones,
  CustomZoneFile,
  customZoneNames,
  toCustomZoneFile,
  fromCustomZoneFile,
  emptyMapCustomZones,
  withCustomZoneNames,
  withoutCustomZoneNames
} from '~/domain/customZone';

export const CUSTOM_ZONES_FILE = 'zones.json';

export const customZonesPath = (mapPath: string): string => {
  const dir = mapPath.replace(/[^\\/]+$/, '');
  const stem = (mapPath.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '');
  return `${dir}${stem}-zones/${CUSTOM_ZONES_FILE}`;
};

export const huntZonesPath = (mapPath: string): string => `${mapPath.replace(/\.otbm$/i, '')}-hunts.json`;

export const zoneNamesPath = (mapPath: string): string => `${mapPath.replace(/\.otbm$/i, '')}-zone-names.json`;

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

export const loadHuntZones = (mapPath: string): Promise<MapCustomZones> => loadCustomZones(huntZonesPath(mapPath));

export async function loadServerZones(mapPath: string): Promise<MapCustomZones> {
  const zones = await loadCustomZones(customZonesPath(mapPath));
  try {
    const content = await invoke<string>('read_file_text', { path: zoneNamesPath(mapPath) });
    return withCustomZoneNames(zones, JSON.parse(content));
  } catch {
    return zones;
  }
}

export async function saveServerZones(mapPath: string, zones: MapCustomZones): Promise<void> {
  await saveCustomZones(customZonesPath(mapPath), withoutCustomZoneNames(zones));
  await invoke('write_file_text', {
    path: zoneNamesPath(mapPath),
    contents: `${JSON.stringify(customZoneNames(zones), null, '\t')}\n`
  });
}
