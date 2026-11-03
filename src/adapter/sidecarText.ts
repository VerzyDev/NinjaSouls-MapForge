import { invoke } from '@tauri-apps/api/core';

import { jsonSidecarFile } from '~/lib/map/sidecars';

export async function readSidecarText(path: string): Promise<string | null> {
  const candidates = [...new Set([jsonSidecarFile(path), path])];
  for (const candidate of candidates) {
    try {
      return await invoke<string>('read_file_text', { path: candidate });
    } catch {
      continue;
    }
  }
  return null;
}
