import { invoke } from '@tauri-apps/api/core';

import { isJsonText } from '~/lib/map/sidecars';
import { parseHouseJson } from '~/lib/map/houseFile';
import { readSidecarText } from '~/adapter/sidecarText';
import { House, MapHouses, emptyMapHouses } from '~/domain/house';

const intAttr = (el: Element, name: string): number => Number(el.getAttribute(name) ?? 0);

const boolAttr = (el: Element, name: string): boolean => {
  const v = (el.getAttribute(name) ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
};

export async function getModelHouses(mapId: number): Promise<MapHouses> {
  return { list: await invoke<House[]>('get_houses', { mapId }) };
}

export async function setModelHouses(mapId: number, houses: MapHouses): Promise<void> {
  await invoke('set_houses', { mapId, houses: houses.list });
}

export async function loadHouses(path: string): Promise<MapHouses> {
  const content = await readSidecarText(path);
  if (content == null) return emptyMapHouses();
  if (isJsonText(content)) return { list: parseHouseJson(content) };

  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const list: House[] = [];
  for (const el of Array.from(doc.getElementsByTagName('house'))) {
    const id = intAttr(el, 'houseid');
    if (!id) continue;
    list.push({
      id,
      name: el.getAttribute('name') ?? `House #${id}`,
      townId: intAttr(el, 'townid'),
      rent: intAttr(el, 'rent'),
      guildhall: boolAttr(el, 'guildhall'),
      entryX: intAttr(el, 'entryx'),
      entryY: intAttr(el, 'entryy'),
      entryZ: intAttr(el, 'entryz')
    });
  }
  return { list };
}
