import React from 'react';

import { matchKeybind } from '~/usecase/keybinds';

interface ShortcutActions {
  activeId: string | null;
  handleNew: () => void;
  handleOpen: () => void;
  handleSave: () => void;
  handleSaveAs: () => void;
  closeTab: (id: string) => void;
  cycleTab: (forward: boolean) => void;
  openEditTowns: () => void;
  openJumpToItem: () => void;
  openPreferences: () => void;
  toggleMinimap: () => void;
  openMapProperties: () => void;
  openMapStatistics: () => void;
  openShortcuts: () => void;
  refreshAssets: () => void;
  toggleShade: () => void;
  toggleAutomagic: () => void;
  toggleCreatures: () => void;
  toggleTooltips: () => void;
  toggleBlocking: () => void;
  toggleHouses: () => void;
  toggleWaypoints: () => void;
  toggleSpawns: () => void;
  cycleReference: () => void;
  toggleGroundBlocksFill: () => void;
  toggleFloodContiguous: () => void;
}

const APP_KEYBINDS = [
  'file.new',
  'file.open',
  'file.save',
  'file.saveAs',
  'file.closeTab',
  'file.preferences',
  'edit.jumpToItem',
  'map.towns',
  'map.properties',
  'map.statistics',
  'map.refreshAssets',
  'map.shortcuts',
  'view.minimap',
  'view.shade',
  'view.creatures',
  'view.tooltips',
  'view.blocking',
  'view.groundBlocksFill',
  'view.floodContiguous',
  'view.cycleReference',
  'view.automagic',
  'view.houses',
  'view.waypoints',
  'view.spawns'
] as const;

type AppKeybind = (typeof APP_KEYBINDS)[number];

const MODAL_SELECTOR = '[role="dialog"],[role="alertdialog"]';
const FOCUS_TRAP_SELECTOR = `${MODAL_SELECTOR},[role="menu"],[role="listbox"],[role="combobox"]`;

export const useAppShortcuts = (actions: ShortcutActions) => {
  const ref = React.useRef(actions);
  ref.current = actions;

  React.useEffect(() => {
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (t?.closest(FOCUS_TRAP_SELECTOR) || document.querySelector(MODAL_SELECTOR)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      ref.current.cycleTab(!e.shiftKey);
    };
    window.addEventListener('keydown', onTab, true);
    return () => window.removeEventListener('keydown', onTab, true);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (t?.isContentEditable && (e.ctrlKey || e.metaKey)) return;
      const id = matchKeybind(e, APP_KEYBINDS);
      if (!id) return;
      const a = ref.current;
      if (id === 'file.closeTab' && !a.activeId) return;
      e.preventDefault();
      const run: Record<AppKeybind, () => void> = {
        'file.new': a.handleNew,
        'file.open': a.handleOpen,
        'file.save': a.handleSave,
        'file.saveAs': a.handleSaveAs,
        'file.closeTab': () => a.activeId && a.closeTab(a.activeId),
        'file.preferences': a.openPreferences,
        'edit.jumpToItem': a.openJumpToItem,
        'map.towns': a.openEditTowns,
        'map.properties': a.openMapProperties,
        'map.statistics': a.openMapStatistics,
        'map.refreshAssets': a.refreshAssets,
        'map.shortcuts': a.openShortcuts,
        'view.minimap': a.toggleMinimap,
        'view.shade': a.toggleShade,
        'view.creatures': a.toggleCreatures,
        'view.tooltips': a.toggleTooltips,
        'view.blocking': a.toggleBlocking,
        'view.groundBlocksFill': a.toggleGroundBlocksFill,
        'view.floodContiguous': a.toggleFloodContiguous,
        'view.cycleReference': a.cycleReference,
        'view.automagic': a.toggleAutomagic,
        'view.houses': a.toggleHouses,
        'view.waypoints': a.toggleWaypoints,
        'view.spawns': a.toggleSpawns
      };
      run[id]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
};
