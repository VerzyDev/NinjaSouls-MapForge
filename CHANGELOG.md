# Changelog

All notable changes to Map Forge are documented here. Sections are generated from semantic commits at release time.

## [0.2.0] - 2026-08-21

### Added

- Jump to item dialog with Ctrl+J.
- Replace item as a standalone window, plus a batch replace queue with scope and map-selection input.
- Bucket fill and magic wand tools.
- Reference image layer under the map.
- Export the minimap as one PNG per floor.
- Named client version picker in map properties.
- Town position picker and a map pin in the Towns dialog.
- Towns, houses and spawns for scripted maps.
- Item attributes now cross the Lua map read and write seam, driven by declared item capabilities instead of attribute-key guessing.
- Chunk-wise Lua format export and asset hot reload; Lua scripts re-run on webview reload.
- Keyboard shortcuts dialog in the Help menu.
- Tab and Shift+Tab cycle open map tabs, and tabs mark unsaved changes.
- Ctrl+click toggles tile selection; with a modifier it toggles only the top item, spawn or creature.
- Eraser mode that removes duplicated solid items, and Ctrl+Shift with a brush erases that brush's items in an area.
- Dedupe eraser skips items meant to stack.
- Wall decorations, doodad duplicate rules and alt-drag ground replace.
- Switch door action, locked door preference, and door erase restoring the wall.
- Doodad brush thickness with a custom override.
- Picker covers all brushes plus brush size and shape.
- Alt right-drag changes brush size.
- Brush ghost follows the brush shape and erase-mode color.
- Right-click cancels an in-progress move drag or any canvas gesture.
- Hunt panel spawntime field replaces the fixed hunt default.
- Apply and Revert buttons replace item properties autosave.
- Per-axis floor offset config.

### Fixed

- Palette reveal scrolls and selects reliably.
- Raw door items no longer morph into the wall's door, and doors transform walls and survive wall realignment.
- Raw brush no longer triggers autoborder.
- Wall brush drag paints only the box outline.
- Select creature stays available on spawn tiles.
- Empty tiles are dropped from the selection on copy and move.
- Right-click keeps an existing multi-tile selection.
- Selection is cleared when picking a brush.
- Magic wand moved to Ctrl+W; close tab is now Ctrl+Shift+W.
- Legacy OTB ids resolve to their client version.
- Spawn and waypoint indices rebuild when restoring the undo sidecar.
- Missing render flags fall back to the thing attribute bag.

### Changed

- Brighter brush ghosts.

## [0.1.3] - 2026-07-27

### Added

- Wall, door, table and carpet brushes in the tile context menu.
- Option to show the full sprite in palette thumbnails.

### Fixed

- Palette panel stays visible when assets or materials fail to load.

## [0.1.2] - 2026-07-21

### Added

- Import Map window with a numeric offset and house/spawn merge options, plus an optional manual (drag-to-place) mode.
- Editable item properties panel, including fluid recolor.
- Containers tab in the Map IDs panel, with sort and delete.
- Reveal a recent map in the file explorer.
- Strip all action or unique IDs from the map.
- Live box-selection size shown in the status bar.
- Edit map width and height.
- Scripted projects resolve asset paths from the .frg manifest before scripts run.
- Reload script files from the Lua dialog.
- Open the scripts folder from the Lua dialog.

### Fixed

- Asset and materials load failures are surfaced instead of failing silently.
- Border and wall client IDs stay valid for maps without an OTB.
- Ground brush rolls item variants by their declared chance.
- Project item DB takes priority, and non-OTB item DBs are discovered.
- Tooltips no longer clipped by panels.
- Renders the full declared map area and shades outside it.
- Assets-missing screen shows the scripted asset label.
- Lua scripts dialog header aligned with its close button.

### Performance

- Faster selection delete.
- Heavy map edits run off the main thread, keeping the UI responsive.
- Smoother, faster box-paint ghost.

### Changed

- Town editor is now a floating panel instead of a modal dialog.

## [0.1.1] - 2026-07-02

### Added

- Interactive map import with a sprite-LOD preview.
- Cross-map clipboard with a replace-on-paste option.
- Hunt generator with route editing and spawn scatter.
- Action and unique ID panel with teleport targets and tile highlighting.
- Borderize brush with mountain and gravel borders.
- Doodad brushes with randomized assembly.
- Virtualized, searchable tile and brush pickers with thumbnails.
- Optional border editing in the tileset editor, preserving border attributes.
- Ctrl+scroll to change floors on the map canvas.
- Configurable default floor (sea level) in editor preferences.
- Adjustable undo/redo history budget in preferences.
- Custom data-folder preference with an option to copy existing data.
- Confirmation prompt when closing with unsaved changes.
- Loaded client version shown in the assets-ready status.
- Redesigned preferences dialog with sidebar navigation and format examples.
- Versioned client data now bundled with the installer.

### Fixed

- Map import expands the map bounds and drops content at the cursor.
- Hangable item rotation.

### Changed

- DAT parsing now enforces OTFI extended and transparency flags.

## [0.1.0] - 2026-06-30

First public release of Map Forge.
