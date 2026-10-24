export type KeybindGroup = 'File' | 'Edit' | 'Map' | 'Tools' | 'View' | 'Navigation';

export interface KeybindAction {
  id: string;
  label: string;
  group: KeybindGroup;
  defaults: string[];
}

export const KEYBIND_GROUPS: KeybindGroup[] = ['File', 'Edit', 'Map', 'Tools', 'View', 'Navigation'];

export const KEYBIND_ACTIONS = [
  { id: 'file.new', group: 'File', label: 'New map', defaults: ['Ctrl+N'] },
  { id: 'file.open', group: 'File', label: 'Open map', defaults: ['Ctrl+O'] },
  { id: 'file.save', group: 'File', label: 'Save', defaults: ['Ctrl+S'] },
  { id: 'file.saveAs', group: 'File', label: 'Save as', defaults: ['Ctrl+Shift+S'] },
  { id: 'file.closeTab', group: 'File', label: 'Close tab', defaults: ['Ctrl+Shift+W'] },
  { id: 'file.preferences', group: 'File', label: 'Preferences', defaults: ['Ctrl+,'] },
  { id: 'edit.undo', group: 'Edit', label: 'Undo', defaults: ['Ctrl+Z'] },
  { id: 'edit.redo', group: 'Edit', label: 'Redo', defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'edit.copy', group: 'Edit', label: 'Copy selection', defaults: ['Ctrl+C'] },
  { id: 'edit.cut', group: 'Edit', label: 'Cut selection', defaults: ['Ctrl+X'] },
  { id: 'edit.paste', group: 'Edit', label: 'Paste (click to place)', defaults: ['Ctrl+V'] },
  { id: 'edit.delete', group: 'Edit', label: 'Delete selection', defaults: ['Delete'] },
  { id: 'edit.clearSelection', group: 'Edit', label: 'Clear selection', defaults: ['Ctrl+D'] },
  { id: 'edit.jumpToItem', group: 'Edit', label: 'Jump to item', defaults: ['Ctrl+J'] },
  { id: 'edit.fillSelection', group: 'Edit', label: 'Fill selection with active brush', defaults: ['Alt+Backspace'] },
  { id: 'map.towns', group: 'Map', label: 'Edit towns', defaults: ['Ctrl+T'] },
  { id: 'map.properties', group: 'Map', label: 'Map properties', defaults: ['Ctrl+P'] },
  { id: 'map.statistics', group: 'Map', label: 'Map statistics', defaults: ['F8'] },
  { id: 'map.refreshAssets', group: 'Map', label: 'Refresh assets', defaults: ['F5'] },
  { id: 'map.shortcuts', group: 'Map', label: 'Keyboard shortcuts', defaults: ['F1'] },
  { id: 'tool.select', group: 'Tools', label: 'Select', defaults: ['V'] },
  { id: 'tool.brush', group: 'Tools', label: 'Brush', defaults: ['B'] },
  { id: 'tool.eraser', group: 'Tools', label: 'Eraser', defaults: ['E'] },
  { id: 'tool.borderize', group: 'Tools', label: 'Borderize', defaults: ['N'] },
  { id: 'tool.bucket', group: 'Tools', label: 'Bucket fill', defaults: ['G'] },
  { id: 'tool.wand', group: 'Tools', label: 'Magic wand', defaults: ['Ctrl+W'] },
  { id: 'tool.swapTiles', group: 'Tools', label: 'Swap primary and secondary tile', defaults: ['X'] },
  { id: 'view.minimap', group: 'View', label: 'Minimap', defaults: ['M'] },
  { id: 'view.shade', group: 'View', label: 'Shade lower floors', defaults: ['Q'] },
  { id: 'view.creatures', group: 'View', label: 'Creatures', defaults: ['F'] },
  { id: 'view.tooltips', group: 'View', label: 'Tooltips', defaults: ['Y'] },
  { id: 'view.blocking', group: 'View', label: 'Blocking tiles', defaults: ['O'] },
  { id: 'view.groundBlocksFill', group: 'View', label: 'Ground blocks fill', defaults: ['B'] },
  { id: 'view.floodContiguous', group: 'View', label: 'Contiguous flood fill', defaults: ['C'] },
  { id: 'view.cycleReference', group: 'View', label: 'Cycle reference image', defaults: ['R'] },
  { id: 'view.automagic', group: 'View', label: 'Automagic', defaults: ['Ctrl+A'] },
  { id: 'view.houses', group: 'View', label: 'Houses', defaults: ['Ctrl+H'] },
  { id: 'view.waypoints', group: 'View', label: 'Waypoints', defaults: ['Shift+W'] },
  { id: 'view.spawns', group: 'View', label: 'Spawns', defaults: ['Alt+S'] },
  { id: 'nav.floorUp', group: 'Navigation', label: 'Floor up', defaults: ['PageUp', 'Numpad+'] },
  { id: 'nav.floorDown', group: 'Navigation', label: 'Floor down', defaults: ['PageDown', 'Numpad-'] },
  { id: 'nav.zoomIn', group: 'Navigation', label: 'Zoom in', defaults: ['Ctrl+=', 'Numpad*'] },
  { id: 'nav.zoomOut', group: 'Navigation', label: 'Zoom out', defaults: ['Ctrl+-', 'Numpad/'] },
  { id: 'nav.zoomReset', group: 'Navigation', label: 'Reset zoom', defaults: ['Ctrl+0', 'Ctrl+Numpad0'] }
] as const satisfies readonly KeybindAction[];

export type KeybindId = (typeof KEYBIND_ACTIONS)[number]['id'];

export type Keybinds = Record<KeybindId, string[]>;

export const DEFAULT_KEYBINDS = Object.fromEntries(KEYBIND_ACTIONS.map((a) => [a.id, [...a.defaults]])) as Keybinds;

export const RESERVED_COMBOS = [
  'Tab',
  'Shift+Tab',
  'Escape',
  'Enter',
  'Space',
  'W',
  'A',
  'S',
  'D',
  'Up',
  'Down',
  'Left',
  'Right'
];

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
]);

const CODE_NAMES: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  NumpadAdd: 'Numpad+',
  NumpadSubtract: 'Numpad-',
  NumpadMultiply: 'Numpad*',
  NumpadDivide: 'Numpad/',
  NumpadDecimal: 'Numpad.',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
};

const keyName = (e: KeyboardEvent): string | null => {
  const code = e.code;
  if (!code) return e.key.length === 1 ? e.key.toUpperCase() : e.key || null;
  if (MODIFIER_CODES.has(code)) return null;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return CODE_NAMES[code] ?? code;
};

export const comboFromEvent = (e: KeyboardEvent): string | null => {
  const key = keyName(e);
  if (!key) return null;
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : ''].filter(Boolean);
  return [...mods, key].join('+');
};

export const comboParts = (combo: string): string[] => combo.split(/\+(?!$)/);
