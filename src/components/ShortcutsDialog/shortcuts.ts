export interface Shortcut {
  keys: string[];
  label: string;
}

export const FIXED_SHORTCUTS: Record<string, Shortcut[]> = {
  Edit: [{ keys: ['Esc'], label: 'Cancel paste, pen path or selection' }],
  Navigation: [
    { keys: ['Tab', 'Shift+Tab'], label: 'Next / previous map tab' },
    { keys: ['Arrows', 'W A S D'], label: 'Pan the map' },
    { keys: ['Ctrl+Wheel'], label: 'Change floor' },
    { keys: ['Wheel'], label: 'Zoom' },
    { keys: ['Space+Drag', 'Middle Drag'], label: 'Pan the map' }
  ],
  Mouse: [
    { keys: ['Left Click'], label: 'Paint, place or select' },
    { keys: ['Shift+Drag'], label: 'Box select (hold Ctrl to add)' },
    { keys: ['Ctrl+Left Click'], label: 'Erase the active brush while painting' },
    { keys: ['Right Click'], label: 'Select tile and open context menu' },
    { keys: ['Alt+Right Drag'], label: 'Change brush size' },
    { keys: ['Alt+Left Click'], label: 'Flood fill ignoring the reference image' },
    { keys: ['Double Click'], label: 'Finish the pen path' }
  ]
};
