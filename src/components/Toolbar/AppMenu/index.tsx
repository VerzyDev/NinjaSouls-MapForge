import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  Save,
  Package,
  FilePlus,
  Keyboard,
  ImageDown,
  ImagePlus,
  RefreshCw,
  FileInput,
  FolderOpen,
  FolderOpenDot
} from 'lucide-react';

import { openDataDir } from '~/adapter/assets';
import { PALETTE_CATEGORIES } from '~/domain/palette';
import { openTilesetEditor } from '~/adapter/windows';
import { useTool } from '~/usecase/context/ToolContext';
import { TOOLTIP_TYPE_GROUPS } from '~/domain/tooltips';
import { useKeybinds, keybindLabel } from '~/usecase/keybinds';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';
import { openProject, PROJECT_EXT, closeProject, RecentProject, recentProjects, clearRecentProjects } from '~/adapter/project';
import {
  MenuState,
  MapMenuActions,
  EditMenuActions,
  FileMenuActions,
  HelpMenuActions,
  WindowMenuActions
} from '~/components/Toolbar/types';
import {
  Menubar,
  MenubarSub,
  MenubarMenu,
  MenubarItem,
  MenubarLabel,
  MenubarContent,
  MenubarTrigger,
  MenubarShortcut,
  MenubarSeparator,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarCheckboxItem
} from '~/components/commons/ui/menubar';

interface AppMenuProps {
  state: MenuState;
  file: FileMenuActions;
  edit: EditMenuActions;
  map: MapMenuActions;
  window: WindowMenuActions;
  help: HelpMenuActions;
}

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

const categoryLabel = (label: string) => label.replace(/ Palette$/, '');

const AppMenu = ({ state, file, edit, map, window: windowActions, help }: AppMenuProps) => {
  const { loading, hasActive, recent, minimapOpen, propertiesOpen, idMarkersOpen } = state;
  const {
    zoneVisibility,
    toggleZone,
    setAllZones,
    showRenderStats,
    toggleRenderStats,
    showBlocking,
    toggleBlocking,
    groundBlocksFill,
    toggleGroundBlocksFill,
    eraserLeaveUnique,
    toggleEraserLeaveUnique,
    floodContiguous,
    toggleFloodContiguous,
    showShade,
    toggleShade,
    showTooltips,
    toggleTooltips,
    showWaypoints,
    toggleWaypoints,
    tooltipTypes,
    toggleTooltipTypes,
    selectionMode,
    setSelectionMode,
    compensateSelection,
    toggleCompensateSelection
  } = useEditorSettings();
  const { dataDir, project } = useAssetsBundle();
  const keybinds = useKeybinds();
  const { referenceImage, patchReferenceImage } = useTool();
  const anyZoneVisible = zoneVisibility.pz || zoneVisibility.nopvp || zoneVisibility.nologout || zoneVisibility.pvp;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const pickProject = async () => {
    const selected = await open({
      multiple: false,
      title: 'Open project',
      filters: [{ name: 'Forge Project', extensions: [PROJECT_EXT] }]
    });
    if (!selected || typeof selected !== 'string') return;
    await openProject(selected);
    window.location.reload();
  };

  const handleCloseProject = async () => {
    await closeProject();
    window.location.reload();
  };

  const openRecentProject = async (path: string) => {
    await openProject(path);
    window.location.reload();
  };

  const [recentProjectList, setRecentProjectList] = React.useState<RecentProject[]>([]);

  React.useEffect(() => {
    void recentProjects()
      .then(setRecentProjectList)
      .catch(() => setRecentProjectList([]));
  }, []);

  const clearProjectHistory = () => {
    void clearRecentProjects()
      .then(() => setRecentProjectList([]))
      .catch(() => undefined);
  };

  return (
    <Menubar>
      <MenubarMenu value="file">
        <MenubarTrigger onMouseDown={stop}>File</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarItem disabled={loading} onSelect={file.onNew}>
            <FilePlus className="mr-2 h-3.5 w-3.5" />
            New Map
            <MenubarShortcut>{keybindLabel(keybinds, 'file.new')}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={loading} onSelect={file.onOpen}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            Open Map...
            <MenubarShortcut>{keybindLabel(keybinds, 'file.open')}</MenubarShortcut>
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger disabled={loading}>Open Recent</MenubarSubTrigger>
            <MenubarSubContent>
              {recent.length === 0 ? (
                <MenubarItem disabled>No recent maps</MenubarItem>
              ) : (
                <>
                  {recent.map((path) => (
                    <MenubarItem key={path} title={path} className="group pr-1" onSelect={() => file.onOpenRecent(path)}>
                      <span className="flex-1 truncate">{basename(path)}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void revealItemInDir(path);
                        }}
                        className="ml-2 inline-flex rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                      >
                        <FolderOpenDot className="h-3.5 w-3.5" />
                      </button>
                    </MenubarItem>
                  ))}
                  <MenubarSeparator />
                  <MenubarItem onSelect={file.onClearRecent}>Clear Recent</MenubarItem>
                </>
              )}
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem disabled={!hasActive} onSelect={file.onSave}>
            <Save className="mr-2 h-3.5 w-3.5" />
            Save
            <MenubarShortcut>{keybindLabel(keybinds, 'file.save')}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!hasActive} onSelect={file.onSaveAs}>
            Save As...
            <MenubarShortcut>{keybindLabel(keybinds, 'file.saveAs')}</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={file.onImportMap} disabled={!hasActive || loading}>
            <FileInput className="mr-2 h-3.5 w-3.5" />
            Import Map...
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>
              <Package className="mr-2 h-3.5 w-3.5" />
              Project
            </MenubarSubTrigger>
            <MenubarSubContent>
              {project && (
                <>
                  <MenubarLabel className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5" />
                    <span className="truncate">{project.name}</span>
                  </MenubarLabel>
                  <MenubarSeparator />
                </>
              )}
              <MenubarItem onSelect={() => void pickProject()}>Open Project...</MenubarItem>
              <MenubarItem disabled={!project} onSelect={() => void handleCloseProject()}>
                Close Project
              </MenubarItem>
              {recentProjectList.length > 0 && (
                <>
                  <MenubarSeparator />
                  {recentProjectList.map((entry) => (
                    <MenubarItem key={entry.path} title={entry.path} onSelect={() => void openRecentProject(entry.path)}>
                      {entry.name ?? basename(entry.path)}
                    </MenubarItem>
                  ))}
                  <MenubarSeparator />
                  <MenubarItem onSelect={clearProjectHistory}>Clear Recent Projects</MenubarItem>
                </>
              )}
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem disabled={!hasActive} onSelect={file.onCloseMap}>
            Close Map
            <MenubarShortcut>{keybindLabel(keybinds, 'file.closeTab')}</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={file.onRequestExit}>Exit</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="edit">
        <MenubarTrigger onMouseDown={stop}>Edit</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarSub>
            <MenubarSubTrigger>Selection Mode</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarCheckboxItem
                checked={compensateSelection}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={toggleCompensateSelection}
              >
                Compensate Selection
              </MenubarCheckboxItem>
              <MenubarSeparator />
              <MenubarCheckboxItem
                onSelect={(e) => e.preventDefault()}
                checked={selectionMode === 'current'}
                onCheckedChange={() => setSelectionMode('current')}
              >
                Current Floor
              </MenubarCheckboxItem>
              <MenubarCheckboxItem
                checked={selectionMode === 'lower'}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => setSelectionMode('lower')}
              >
                Lower Floors
              </MenubarCheckboxItem>
              <MenubarCheckboxItem
                onSelect={(e) => e.preventDefault()}
                checked={selectionMode === 'visible'}
                onCheckedChange={() => setSelectionMode('visible')}
              >
                Visible Floors
              </MenubarCheckboxItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem onSelect={edit.onJumpToItem}>
            Jump to Item...
            <MenubarShortcut>{keybindLabel(keybinds, 'edit.jumpToItem')}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!hasActive} onSelect={edit.onReplaceItems}>
            Replace Items...
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger disabled={!hasActive}>Dangerous</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem onSelect={edit.onStripActionIds}>Strip All Action IDs</MenubarItem>
              <MenubarItem onSelect={edit.onStripUniqueIds}>Strip All Unique IDs</MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem onSelect={edit.onOpenScripts}>Lua Scripts...</MenubarItem>
          <MenubarItem onSelect={edit.onOpenPreferences}>
            Preferences...
            <MenubarShortcut>{keybindLabel(keybinds, 'file.preferences')}</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="map">
        <MenubarTrigger onMouseDown={stop}>Map</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarItem disabled={!hasActive} onSelect={map.onEditTowns}>
            Edit Towns
            <MenubarShortcut>{keybindLabel(keybinds, 'map.towns')}</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!hasActive} onSelect={map.onMapProperties}>
            Properties...
            <MenubarShortcut>{keybindLabel(keybinds, 'map.properties')}</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!hasActive} onSelect={map.onMapStatistics}>
            Statistics
            <MenubarShortcut>{keybindLabel(keybinds, 'map.statistics')}</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!hasActive} onSelect={map.onExportMinimap}>
            <ImageDown className="mr-2 h-3.5 w-3.5" />
            Export Minimap...
          </MenubarItem>
          <MenubarItem disabled={!hasActive} onSelect={map.onReferenceImage}>
            <ImagePlus className="mr-2 h-3.5 w-3.5" />
            Reference Image...
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="view">
        <MenubarTrigger onMouseDown={stop}>View</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarCheckboxItem
            checked={zoneVisibility.pz}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleZone('pz')}
          >
            Show protection zones
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={zoneVisibility.nopvp}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleZone('nopvp')}
          >
            Show no-PVP zones
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={zoneVisibility.nologout}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleZone('nologout')}
          >
            Show no-logout zones
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={zoneVisibility.pvp}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleZone('pvp')}
          >
            Show PVP zones
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarItem onSelect={(e) => e.preventDefault()} onClick={() => setAllZones(!anyZoneVisible)}>
            {anyZoneVisible ? 'Hide all zones' : 'Show all zones'}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarCheckboxItem checked={showBlocking} onCheckedChange={toggleBlocking} onSelect={(e) => e.preventDefault()}>
            Show blocking
            <MenubarShortcut>{keybindLabel(keybinds, 'view.blocking')}</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            disabled={!referenceImage}
            checked={!!referenceImage?.visible}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(v) => patchReferenceImage({ visible: v })}
          >
            Show reference image
            <MenubarShortcut>{keybindLabel(keybinds, 'view.cycleReference')}</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            disabled={!referenceImage}
            checked={!!referenceImage?.front}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(v) => patchReferenceImage({ front: v })}
          >
            Reference above map
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={showShade} onCheckedChange={toggleShade} onSelect={(e) => e.preventDefault()}>
            Shade lower floors
            <MenubarShortcut>{keybindLabel(keybinds, 'view.shade')}</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={showWaypoints} onCheckedChange={toggleWaypoints} onSelect={(e) => e.preventDefault()}>
            Show waypoints
            <MenubarShortcut>{keybindLabel(keybinds, 'view.waypoints')}</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarLabel>Fill and magic wand</MenubarLabel>
          <MenubarCheckboxItem
            checked={floodContiguous}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={toggleFloodContiguous}
          >
            Contiguous area only
            <MenubarShortcut>{keybindLabel(keybinds, 'view.floodContiguous')}</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={groundBlocksFill}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={toggleGroundBlocksFill}
          >
            Ground already on the map blocks the fill
            <MenubarShortcut>{keybindLabel(keybinds, 'view.groundBlocksFill')}</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarLabel>Eraser</MenubarLabel>
          <MenubarCheckboxItem
            checked={eraserLeaveUnique}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={toggleEraserLeaveUnique}
          >
            Leave items with attributes untouched
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarCheckboxItem checked={showTooltips} onCheckedChange={toggleTooltips} onSelect={(e) => e.preventDefault()}>
            Show tooltips
            <MenubarShortcut>{keybindLabel(keybinds, 'view.tooltips')}</MenubarShortcut>
          </MenubarCheckboxItem>
          {TOOLTIP_TYPE_GROUPS.map((t) => (
            <MenubarCheckboxItem
              key={t.keys.join('-')}
              disabled={!showTooltips}
              onSelect={(e) => e.preventDefault()}
              checked={t.keys.every((k) => tooltipTypes[k])}
              onCheckedChange={() => toggleTooltipTypes(t.keys)}
            >
              {t.label}
            </MenubarCheckboxItem>
          ))}
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="window">
        <MenubarTrigger onMouseDown={stop}>Window</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarCheckboxItem
            checked={minimapOpen}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={windowActions.onToggleMinimap}
          >
            Minimap
            <MenubarShortcut>{keybindLabel(keybinds, 'view.minimap')}</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={propertiesOpen}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={windowActions.onToggleProperties}
          >
            Item Properties
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            disabled={!hasActive}
            checked={idMarkersOpen}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={windowActions.onToggleIdMarkers}
          >
            Map IDs
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => void openTilesetEditor()}>Tileset Editor...</MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={loading} onSelect={windowActions.onNewPalette}>
            New Palette
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger disabled={loading}>Palette</MenubarSubTrigger>
            <MenubarSubContent>
              {PALETTE_CATEGORIES.map((c) => (
                <MenubarItem key={c.id} onSelect={() => windowActions.onSelectPaletteCategory(c.id)}>
                  {categoryLabel(c.label)}
                </MenubarItem>
              ))}
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="help">
        <MenubarTrigger onMouseDown={stop}>Help</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarCheckboxItem checked={showRenderStats} onCheckedChange={toggleRenderStats} onSelect={(e) => e.preventDefault()}>
            Show render stats
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarItem disabled={!dataDir} onSelect={() => void openDataDir(dataDir.replace(/[\\/][^\\/]+$/, ''))}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            Open Data Folder
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={help.onShortcuts}>
            <Keyboard className="mr-2 h-3.5 w-3.5" />
            Keyboard Shortcuts
            <MenubarShortcut>{keybindLabel(keybinds, 'map.shortcuts')}</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={help.onCheckUpdates}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Check for Updates
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={help.onAbout}>About</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
};

export default AppMenu;
