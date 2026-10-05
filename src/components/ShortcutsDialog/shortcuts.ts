export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'File',
    items: [
      { keys: ['Ctrl+N'], label: 'New map' },
      { keys: ['Ctrl+O'], label: 'Open map' },
      { keys: ['Ctrl+S'], label: 'Save' },
      { keys: ['Ctrl+Shift+S'], label: 'Save as' },
      { keys: ['Ctrl+Shift+W'], label: 'Close tab' },
      { keys: ['Ctrl+,'], label: 'Preferences' }
    ]
  },
  {
    title: 'Edit',
    items: [
      { keys: ['Ctrl+Z'], label: 'Undo' },
      { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], label: 'Redo' },
      { keys: ['Ctrl+C'], label: 'Copy selection' },
      { keys: ['Ctrl+X'], label: 'Cut selection' },
      { keys: ['Ctrl+V'], label: 'Paste (click to place)' },
      { keys: ['Delete'], label: 'Delete selection' },
      { keys: ['Ctrl+D'], label: 'Clear selection' },
      { keys: ['Ctrl+J'], label: 'Jump to item' },
      { keys: ['Alt+Backspace'], label: 'Fill selection with active brush' },
      { keys: ['Esc'], label: 'Cancel paste, pen path or selection' }
    ]
  },
  {
    title: 'Map',
    items: [
      { keys: ['Ctrl+T'], label: 'Edit towns' },
      { keys: ['Ctrl+P'], label: 'Map properties' },
      { keys: ['F8'], label: 'Map statistics' },
      { keys: ['F5'], label: 'Refresh assets' },
      { keys: ['F1'], label: 'Keyboard shortcuts' }
    ]
  },
  {
    title: 'Tools',
    items: [
      { keys: ['V'], label: 'Select' },
      { keys: ['B'], label: 'Brush' },
      { keys: ['E'], label: 'Eraser' },
      { keys: ['N'], label: 'Borderize' },
      { keys: ['G'], label: 'Bucket fill' },
      { keys: ['Ctrl+W'], label: 'Magic wand' },
      { keys: ['X'], label: 'Swap primary and secondary tile' }
    ]
  },
  {
    title: 'View',
    items: [
      { keys: ['M'], label: 'Minimap' },
      { keys: ['Q'], label: 'Shade lower floors' },
      { keys: ['F'], label: 'Creatures' },
      { keys: ['Y'], label: 'Tooltips' },
      { keys: ['O'], label: 'Blocking tiles' },
      { keys: ['B'], label: 'Ground blocks fill' },
      { keys: ['C'], label: 'Contiguous flood fill' },
      { keys: ['R'], label: 'Cycle reference image' },
      { keys: ['Ctrl+A'], label: 'Automagic' },
      { keys: ['Ctrl+H'], label: 'Houses' },
      { keys: ['Shift+W'], label: 'Waypoints' },
      { keys: ['Alt+S'], label: 'Spawns' }
    ]
  },
  {
    title: 'Navigation',
    items: [
      { keys: ['Tab', 'Shift+Tab'], label: 'Next / previous map tab' },
      { keys: ['Arrows', 'W A S D'], label: 'Pan the map' },
      { keys: ['Page Up', 'Numpad +'], label: 'Floor up' },
      { keys: ['Page Down', 'Numpad -'], label: 'Floor down' },
      { keys: ['Ctrl+Wheel'], label: 'Change floor' },
      { keys: ['Wheel'], label: 'Zoom' },
      { keys: ['Ctrl++', 'Numpad *'], label: 'Zoom in' },
      { keys: ['Ctrl+-', 'Numpad /'], label: 'Zoom out' },
      { keys: ['Ctrl+0'], label: 'Reset zoom' },
      { keys: ['Space+Drag', 'Middle Drag'], label: 'Pan the map' }
    ]
  },
  {
    title: 'Mouse',
    items: [
      { keys: ['Left Click'], label: 'Paint, place or select' },
      { keys: ['Shift+Drag'], label: 'Box select (hold Ctrl to add)' },
      { keys: ['Ctrl+Left Click'], label: 'Erase the active brush while painting' },
      { keys: ['Right Click'], label: 'Select tile and open context menu' },
      { keys: ['Alt+Right Drag'], label: 'Change brush size' },
      { keys: ['Alt+Left Click'], label: 'Flood fill ignoring the reference image' },
      { keys: ['Double Click'], label: 'Finish the pen path' }
    ]
  }
];
