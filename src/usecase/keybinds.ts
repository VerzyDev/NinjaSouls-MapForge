import React from 'react';

import { loadKeybinds, saveKeybinds } from '~/adapter/preferences';
import { Keybinds, KeybindId, comboFromEvent, DEFAULT_KEYBINDS } from '~/domain/keybinds';

let current: Keybinds = DEFAULT_KEYBINDS;
const listeners = new Set<() => void>();

const notify = (next: Keybinds) => {
  current = next;
  listeners.forEach((l) => l());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getKeybinds = () => current;

export const initKeybinds = () => loadKeybinds().then(notify);

export const updateKeybinds = (next: Keybinds) => {
  notify(next);
  return saveKeybinds(next);
};

export const useKeybinds = () => React.useSyncExternalStore(subscribe, getKeybinds);

export const keybindLabel = (keybinds: Keybinds, id: KeybindId) => keybinds[id][0] ?? '';

export const withKeybind = (label: string, keybinds: Keybinds, id: KeybindId) => {
  const combo = keybindLabel(keybinds, id);
  return combo ? `${label} (${combo})` : label;
};

export const matchKeybind = <T extends KeybindId>(e: KeyboardEvent, ids: readonly T[]): T | undefined => {
  const combo = comboFromEvent(e);
  if (!combo) return undefined;
  return ids.find((id) => current[id].includes(combo));
};

export const isKeybind = (e: KeyboardEvent, id: KeybindId) => matchKeybind(e, [id]) !== undefined;
