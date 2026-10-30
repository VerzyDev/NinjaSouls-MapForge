import React from 'react';

import { loadKeybinds, saveKeybinds } from '~/adapter/preferences';
import { Keybinds, KeybindId, comboFromEvent, comboFromMouse, mouseButtonName, DEFAULT_KEYBINDS } from '~/domain/keybinds';

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

const isBound = (combo: string) => Object.values(current).some((combos) => combos.includes(combo));

const routeMouseButton = (e: MouseEvent) => {
  const name = mouseButtonName(e.button);
  if (!name) return;
  const synthetic = new KeyboardEvent('keydown', {
    code: name,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    cancelable: true
  });
  window.dispatchEvent(synthetic);
  if (synthetic.defaultPrevented || isBound(comboFromMouse(e) ?? '')) {
    e.preventDefault();
    e.stopPropagation();
  }
};

const blockHistoryButtons = (e: MouseEvent) => {
  if (e.button === 3 || e.button === 4) e.preventDefault();
};

export const initKeybinds = () => {
  window.addEventListener('mousedown', routeMouseButton, true);
  window.addEventListener('mouseup', blockHistoryButtons, true);
  return loadKeybinds().then(notify);
};

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
