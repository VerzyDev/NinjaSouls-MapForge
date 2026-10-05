import { invoke } from '@tauri-apps/api/core';

import { MinimapImage, ExportedMinimapFloor } from '~/domain/map';

function toUint8(response: Uint8Array | ArrayBuffer): Uint8Array {
  return response instanceof Uint8Array ? response : new Uint8Array(response);
}

export async function setMinimapPalette(colors: number[]): Promise<void> {
  await invoke('set_minimap_palette', { colors });
}

export async function exportMinimap(
  mapId: number,
  floors: number[],
  dir: string,
  baseName: string
): Promise<ExportedMinimapFloor[]> {
  return invoke<ExportedMinimapFloor[]>('export_minimap', { mapId, floors, dir, baseName });
}

export async function fetchMinimap(mapId: number, z: number, x: number, y: number, w: number, h: number): Promise<MinimapImage> {
  const response = await invoke<Uint8Array | ArrayBuffer>('get_minimap', { mapId, z, x, y, w, h });
  const u8 = toUint8(response);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const minX = view.getUint16(0, true);
  const minY = view.getUint16(2, true);
  const width = view.getUint16(4, true);
  const height = view.getUint16(6, true);
  const data = u8.subarray(8, 8 + width * height);
  return { minX, minY, width, height, data };
}
