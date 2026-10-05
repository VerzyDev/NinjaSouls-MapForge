import React from 'react';

import { ChunkTooltips } from '~/domain/map';
import { TILE_CACHE_MAX, TILE_CACHE_LOW } from '~/components/MapCanvas/constants';

export interface ChunkTooltipsCache {
  data: React.MutableRefObject<Map<string, ChunkTooltips | null>>;
  lastUsed: React.MutableRefObject<Map<string, number>>;
  requested: React.MutableRefObject<Set<string>>;
  pending: React.MutableRefObject<Set<string>>;
  get: (cx: number, cy: number, z: number, tick: number) => ChunkTooltips | null | undefined;
  request: (cx: number, cy: number, z: number) => void;
  store: (key: string, tiles: ChunkTooltips | null, tick: number) => void;
  evict: (tick: number) => void;
  clear: () => void;
}

export function useChunkTooltips(): ChunkTooltipsCache {
  const data = React.useRef(new Map<string, ChunkTooltips | null>());
  const lastUsed = React.useRef(new Map<string, number>());
  const requested = React.useRef(new Set<string>());
  const pending = React.useRef(new Set<string>());

  function get(cx: number, cy: number, z: number, tick: number): ChunkTooltips | null | undefined {
    const k = `${z},${cx},${cy}`;
    const t = data.current.get(k);
    if (t !== undefined) lastUsed.current.set(k, tick);
    return t;
  }

  function request(cx: number, cy: number, z: number) {
    const k = `${z},${cx},${cy}`;
    if (requested.current.has(k)) return;
    requested.current.add(k);
    pending.current.add(k);
  }

  function store(key: string, tiles: ChunkTooltips | null, tick: number) {
    data.current.set(key, tiles);
    lastUsed.current.set(key, tick);
    requested.current.add(key);
  }

  function evict(tick: number) {
    if (data.current.size <= TILE_CACHE_MAX) return;
    const keys = [...data.current.keys()].sort((a, b) => (lastUsed.current.get(a) ?? 0) - (lastUsed.current.get(b) ?? 0));
    const toRemove = data.current.size - TILE_CACHE_LOW;
    let removed = 0;
    for (let i = 0; i < keys.length && removed < toRemove; i++) {
      const k = keys[i];
      if (lastUsed.current.get(k) === tick) break;
      data.current.delete(k);
      lastUsed.current.delete(k);
      requested.current.delete(k);
      removed++;
    }
  }

  function clear() {
    data.current.clear();
    lastUsed.current.clear();
    requested.current.clear();
    pending.current.clear();
  }

  return { data, lastUsed, requested, pending, get, request, store, evict, clear };
}
