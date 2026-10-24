import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { House } from '~/domain/house';
import { Thing } from '~/domain/thing';
import { cornerOf } from '~/usecase/dock';
import Toolbar from '~/components/Toolbar';
import MapTabs from '~/components/MapTabs';
import { MapHouses } from '~/domain/house';
import MapTowns from '~/components/MapTowns';
import IdMarkers from '~/components/IdMarkers';
import MapCanvas from '~/components/MapCanvas';
import Workspace from '~/components/Workspace';
import { openDataDir } from '~/adapter/assets';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { hasSidecars } from '~/lib/map/sidecars';
import ToolsPanel from '~/components/ToolsPanel';
import JumpToItem from '~/components/JumpToItem';
import { reloadScripts } from '~/adapter/scripts';
import { initKeybinds } from '~/usecase/keybinds';
import AboutDialog from '~/components/AboutDialog';
import { MIN_ZOOM, MAX_ZOOM } from '~/usecase/zoom';
import { openReplaceItem } from '~/adapter/windows';
import PalettePanel from '~/components/PalettePanel';
import { serializeHouseXml } from '~/adapter/houses';
import ScriptEditor from '~/components/ScriptEditor';
import { Town, MapView, Position } from '~/domain/map';
import MapProperties from '~/components/MapProperties';
import MapStatistics from '~/components/MapStatistics';
import MinimapExport from '~/components/MinimapExport';
import AssetsMissing from '~/components/AssetsMissing';
import { Button } from '~/components/commons/ui/button';
import { useSetting } from '~/usecase/hooks/useSetting';
import ReferenceImage from '~/components/ReferenceImage';
import { serializeSpawnXml } from '~/usecase/spawnEdits';
import { CHUNK } from '~/components/MapCanvas/constants';
import { isLuaEnabled } from '~/usecase/util/luaSettings';
import { formatPosition } from '~/usecase/positionFormat';
import ShortcutsDialog from '~/components/ShortcutsDialog';
import { Waypoint, MapWaypoints } from '~/domain/waypoint';
import { serializeWaypointXml } from '~/adapter/waypoints';
import Minimap, { MinimapApi } from '~/components/Minimap';
import PanelDockMenu from '~/components/Dock/PanelDockMenu';
import { useDock } from '~/usecase/hooks/Workspace/useDock';
import { SPRITE_SIZE, getSpriteIndex } from '~/domain/tibia';
import { PanelId, baseKind, panelMeta } from '~/domain/dock';
import { loadHouses, setModelHouses } from '~/adapter/houses';
import Preferences, { TabId } from '~/components/Preferences';
import { MapSpawns, buildMapSpawns } from '~/domain/creature';
import PanelBoundary from '~/components/commons/PanelBoundary';
import SaveProgressModal from '~/components/SaveProgressModal';
import { loadSpawns, setModelSpawns } from '~/adapter/creatures';
import CreatureDataDialog from '~/components/CreatureDataDialog';
import StatusBar, { StatusBarApi } from '~/components/StatusBar';
import { useMapTabs } from '~/usecase/hooks/Workspace/useMapTabs';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { TooltipProvider } from '~/components/commons/ui/tooltip';
import ItemPropertiesPanel from '~/components/ItemPropertiesPanel';
import { useAutoSave } from '~/usecase/hooks/Workspace/useAutoSave';
import { useTool, ToolProvider } from '~/usecase/context/ToolContext';
import { useMapSpawns } from '~/usecase/hooks/Workspace/useMapSpawns';
import { useMapHouses } from '~/usecase/hooks/Workspace/useMapHouses';
import { HoverInfo, SelectedItem } from '~/components/MapCanvas/types';
import { addWaypoint, nextWaypointName } from '~/usecase/waypointEdits';
import { useMapCreatures } from '~/usecase/hooks/Workspace/useMapCreatures';
import { useMapWaypoints } from '~/usecase/hooks/Workspace/useMapWaypoints';
import { useAppShortcuts } from '~/usecase/hooks/Workspace/useAppShortcuts';
import { AssetsProvider, useAssetsBundle } from '~/usecase/context/AssetsContext';
import { useReplaceItemWindow } from '~/usecase/hooks/Workspace/useReplaceItemWindow';
import ImportMapDialog, { HouseImportMode, ImportMapRequest } from '~/components/ImportMapDialog';
import { useEditorSettings, EditorSettingsProvider } from '~/usecase/context/EditorSettingsContext';
import { houseSizes, importLoad, importCommit, importCancel, importPreview, ImportPreview } from '~/adapter/map';
import { getTowns, packChunkKey, stripActionIds, stripUniqueIds, getMapProperties, setMapProperties } from '~/adapter/map';
import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription
} from '~/components/commons/ui/dialog';

import './styles/index.css';

const dirOf = (path: string) => path.replace(/[^\\/]+$/, '');
const spawnFileFallback = (path: string) => (path.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '-spawn.xml');

const spriteBlockFor = (
  clientId: number,
  items: Map<number, Thing>,
  sprites: Map<number, LoadedSprite>,
  cellPx: number,
  cache: Map<number, Uint8ClampedArray | null>
): Uint8ClampedArray | null => {
  if (clientId === 0) return null;
  const hit = cache.get(clientId);
  if (hit !== undefined) return hit;
  const thing = items.get(clientId);
  const spriteId = thing ? thing.spriteIndex[getSpriteIndex(thing, 0, 0, 0, 0, 0, 0, 0)] : 0;
  const spr = spriteId ? sprites.get(spriteId) : undefined;
  if (!spr || spr.empty) {
    cache.set(clientId, null);
    return null;
  }
  const block = new Uint8ClampedArray(cellPx * cellPx * 4);
  for (let by = 0; by < cellPx; by++) {
    const sy = ((by * SPRITE_SIZE) / cellPx) | 0;
    for (let bx = 0; bx < cellPx; bx++) {
      const sx = ((bx * SPRITE_SIZE) / cellPx) | 0;
      const so = (sy * SPRITE_SIZE + sx) * 4;
      const bo = (by * cellPx + bx) * 4;
      block[bo] = spr.rgba[so];
      block[bo + 1] = spr.rgba[so + 1];
      block[bo + 2] = spr.rgba[so + 2];
      block[bo + 3] = spr.rgba[so + 3];
    }
  }
  cache.set(clientId, block);
  return block;
};

const buildImportSpriteThumbnail = async (
  preview: ImportPreview,
  items: Map<number, Thing>,
  sprPath: string,
  transparency: boolean
): Promise<HTMLCanvasElement | null> => {
  const { width, height, ground, top } = preview;
  if (width === 0 || height === 0) return null;

  const spriteIds: number[] = [];
  const seen = new Set<number>();
  for (const cid of [...ground, ...top]) {
    if (cid === 0 || seen.has(cid)) continue;
    seen.add(cid);
    const thing = items.get(cid);
    if (!thing) continue;
    const sid = thing.spriteIndex[getSpriteIndex(thing, 0, 0, 0, 0, 0, 0, 0)];
    if (sid) spriteIds.push(sid);
  }

  const sprites = new Map<number, LoadedSprite>();
  await loadSprites(sprPath, spriteIds, transparency, sprites).catch(() => undefined);

  const cellPx = Math.max(2, Math.min(8, Math.floor(2048 / Math.max(width, height))));
  const rowStride = cellPx * 4;
  const bW = width * cellPx;
  const bH = height * cellPx;
  const buf = new Uint8ClampedArray(bW * bH * 4);
  const cache = new Map<number, Uint8ClampedArray | null>();
  let drew = false;

  for (let i = 0; i < ground.length; i++) {
    const g = ground[i];
    const t = top[i];
    if (g === 0 && t === 0) continue;
    const cellX = (i % width) * cellPx;
    const cellY = Math.floor(i / width) * cellPx;

    const gb = spriteBlockFor(g, items, sprites, cellPx, cache);
    if (gb) {
      for (let by = 0; by < cellPx; by++) {
        const dst = ((cellY + by) * bW + cellX) * 4;
        buf.set(gb.subarray(by * rowStride, by * rowStride + rowStride), dst);
      }
      drew = true;
    }
    if (t !== 0 && t !== g) {
      const tb = spriteBlockFor(t, items, sprites, cellPx, cache);
      if (tb) {
        for (let p = 0; p < cellPx * cellPx; p++) {
          if (tb[p * 4 + 3] === 0) continue;
          const by = (p / cellPx) | 0;
          const bx = p % cellPx;
          const dst = ((cellY + by) * bW + cellX + bx) * 4;
          buf[dst] = tb[p * 4];
          buf[dst + 1] = tb[p * 4 + 1];
          buf[dst + 2] = tb[p * 4 + 2];
          buf[dst + 3] = tb[p * 4 + 3];
        }
        drew = true;
      }
    }
  }
  if (!drew) return null;

  const canvas = document.createElement('canvas');
  canvas.width = bW;
  canvas.height = bH;
  canvas.getContext('2d')?.putImageData(new ImageData(buf, bW, bH), 0, 0);
  return canvas;
};

const App = () => {
  const {
    assets,
    palette,
    status,
    error,
    dataDir,
    version,
    project,
    assetLabel,
    clientConfigured,
    assetsMissing,
    retryAssets,
    reloading,
    minimapReady,
    switchVersion,
    setStatus,
    setError
  } = useAssetsBundle();
  const {
    copyPositionFormat,
    reloadGeneral,
    reloadEditor,
    toggleShade,
    toggleAutomagic,
    toggleCreatures,
    toggleTooltips,
    toggleBlocking,
    toggleHouses,
    toggleWaypoints,
    toggleSpawns,
    toggleGroundBlocksFill,
    toggleFloodContiguous,
    autoSave,
    autoSaveDelay
  } = useEditorSettings();
  const { setPaletteCategory, referenceImage, patchReferenceImage, selectBrush } = useTool();

  const cycleReference = () => {
    if (!referenceImage) return;
    if (!referenceImage.visible) patchReferenceImage({ visible: true, front: false });
    else if (!referenceImage.front) patchReferenceImage({ front: true });
    else patchReferenceImage({ visible: false, front: false });
  };

  const [minimapOpen, setMinimapOpen] = useSetting('minimapOpen', false);
  const [propertiesOpen, setPropertiesOpen] = useSetting('propertiesOpen', false);
  const [idMarkersOpen, setIdMarkersOpen] = useSetting('idMarkersOpen', false);
  const [selectedItem, setSelectedItem] = React.useState<SelectedItem | null>(null);
  const [placingWaypoint, setPlacingWaypoint] = React.useState<string | null>(null);
  const [townsOpen, setTownsOpen] = React.useState(false);
  const [mapPropsOpen, setMapPropsOpen] = React.useState(false);
  const [statsOpen, setStatsOpen] = React.useState(false);
  const [minimapExportOpen, setMinimapExportOpen] = React.useState(false);
  const [referenceOpen, setReferenceOpen] = React.useState(false);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [jumpToItemOpen, setJumpToItemOpen] = React.useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false);
  const [dangerousConfirm, setDangerousConfirm] = React.useState<'action-ids' | 'unique-ids' | null>(null);
  const [idMarkersVersion, setIdMarkersVersion] = React.useState(0);
  const [scriptsOpen, setScriptsOpen] = React.useState(false);
  const [preferencesOpen, setPreferencesOpen] = React.useState(false);
  const [prefsTab, setPrefsTab] = React.useState<TabId>('general');
  const openPreferences = React.useCallback((tab: TabId = 'general') => {
    setPrefsTab(tab);
    setPreferencesOpen(true);
  }, []);

  const savingRef = React.useRef(false);
  const mapViewRef = React.useRef<MapView | null>(null);
  const statusApiRef = React.useRef<StatusBarApi | null>(null);
  const minimapApiRef = React.useRef<MinimapApi | null>(null);
  const mapCenterRef = React.useRef<((x: number, y: number) => void) | null>(null);
  const mapHighlightRef = React.useRef<((x: number, y: number, z: number, clientId?: number) => void) | null>(null);
  const mapRefetchRef = React.useRef<((tagged: [number, number][]) => void) | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importGhost, setImportGhost] = React.useState<{
    width: number;
    height: number;
    minZ: number;
    maxZ: number;
    preview: HTMLCanvasElement | null;
  } | null>(null);
  const importCtx = React.useRef<{
    mapId: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    sourceHouses: House[];
    sourceSpawns: MapSpawns | null;
    houseMode: HouseImportMode;
  } | null>(null);
  const [importBusy, setImportBusy] = React.useState<{ value: number; label: string } | null>(null);
  const spawnsRef = React.useRef<MapSpawns | null>(null);
  const spawnsDirty = React.useRef(false);
  const waypointsRef = React.useRef<MapWaypoints | null>(null);
  const waypointsDirty = React.useRef(false);
  const waypointEditRef = React.useRef<((next: MapWaypoints) => void) | null>(null);
  const housesRef = React.useRef<MapHouses | null>(null);
  const housesDirty = React.useRef(false);
  const activeIdRef = React.useRef<string | null>(null);
  const [dirtyIds, setDirtyIds] = React.useState<Set<string>>(new Set());
  const dirtyTabs = React.useRef(dirtyIds);
  dirtyTabs.current = dirtyIds;
  const autoSaveTouch = React.useRef<() => void>(() => undefined);
  const markActiveDirty = React.useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    setDirtyIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    autoSaveTouch.current();
  }, []);
  const clearDirty = React.useCallback((id: string) => {
    setDirtyIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const cursorRef = React.useRef<{ x: number; y: number; z: number } | null>(null);
  const handleHover = React.useCallback((info: HoverInfo | null) => {
    statusApiRef.current?.setHover(info);
    if (info) cursorRef.current = { x: info.x, y: info.y, z: info.z };
  }, []);
  const handleSelect = React.useCallback((item: SelectedItem | null) => {
    setSelectedItem(item);
    statusApiRef.current?.setSelectedItem(item);
  }, []);
  const handleStatus = React.useCallback((message: string) => statusApiRef.current?.flash(message), []);

  const persistSpawns = React.useCallback(async (mapId: number, path: string) => {
    if (!spawnsDirty.current || !spawnsRef.current) return;
    const props = await getMapProperties(mapId).catch(() => null);
    let file = props?.spawnFile ?? '';
    if (!file) {
      file = spawnFileFallback(path);
      if (props) {
        await setMapProperties(mapId, {
          width: props.width,
          height: props.height,
          description: props.description,
          spawnFile: file,
          houseFile: props.houseFile,
          otbmVersion: props.otbmVersion,
          itemsMinor: props.itemsMinor
        }).catch(() => undefined);
      }
    }
    await invoke('write_file_text', { path: dirOf(path) + file, contents: serializeSpawnXml(spawnsRef.current) });
    spawnsDirty.current = false;
  }, []);

  const persistWaypoints = React.useCallback(async (path: string) => {
    if (!waypointsDirty.current || !waypointsRef.current) return;
    const file = (path.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '-waypoint.xml');
    await invoke('write_file_text', { path: dirOf(path) + file, contents: serializeWaypointXml(waypointsRef.current) });
    waypointsDirty.current = false;
  }, []);

  const persistHouses = React.useCallback(async (mapId: number, path: string) => {
    if (!housesDirty.current || !housesRef.current) return;
    const props = await getMapProperties(mapId).catch(() => null);
    let file = props?.houseFile ?? '';
    if (!file) {
      file = (path.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '-house.xml');
      if (props) {
        await setMapProperties(mapId, {
          width: props.width,
          height: props.height,
          description: props.description,
          spawnFile: props.spawnFile,
          houseFile: file,
          otbmVersion: props.otbmVersion,
          itemsMinor: props.itemsMinor
        }).catch(() => undefined);
      }
    }
    const sizes = await houseSizes(mapId).catch(() => ({}));
    await invoke('write_file_text', { path: dirOf(path) + file, contents: serializeHouseXml(housesRef.current, sizes) });
    housesDirty.current = false;
  }, []);

  const pushModelSidecars = React.useCallback(async (mapId: number, path: string) => {
    if (hasSidecars(path)) return;
    if (spawnsDirty.current && spawnsRef.current) await setModelSpawns(mapId, spawnsRef.current);
    if (housesDirty.current && housesRef.current) await setModelHouses(mapId, housesRef.current);
  }, []);

  const persistSidecars = React.useCallback(
    async (mapId: number, path: string) => {
      if (hasSidecars(path)) {
        await persistSpawns(mapId, path);
        await persistWaypoints(path);
        await persistHouses(mapId, path);
      }
      spawnsDirty.current = false;
      housesDirty.current = false;
      waypointsDirty.current = false;
      if (activeIdRef.current) clearDirty(activeIdRef.current);
    },
    [persistSpawns, persistWaypoints, persistHouses, clearDirty]
  );

  const {
    tabs,
    recent,
    active,
    activeId,
    itemNames,
    busy,
    progress,
    saving,
    setActiveId,
    closeTab,
    openPath,
    handleOpen,
    handleNew,
    handleSave,
    handleSaveAs,
    autoSaveActive,
    clearRecent,
    setFloorZ,
    setZoom,
    setView,
    patchActiveMap,
    refreshItems
  } = useMapTabs(assets, {
    setStatus,
    setError,
    onBeforeSave: pushModelSidecars,
    onAfterSave: persistSidecars,
    version,
    switchVersion,
    retryAssets
  });

  activeIdRef.current = activeId;

  autoSaveTouch.current = useAutoSave({
    mode: autoSave,
    delaySeconds: autoSaveDelay,
    isDirty: () => !!active?.path && dirtyTabs.current.has(active.id),
    isBusy: () => busy || !!saving,
    save: autoSaveActive
  });

  const cycleTab = React.useCallback(
    (forward: boolean) => {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      if (idx < 0) return;
      const next = (idx + (forward ? 1 : -1) + tabs.length) % tabs.length;
      setActiveId(tabs[next].id);
    },
    [tabs, activeId, setActiveId]
  );

  const {
    creatureDb,
    creatureTilesets,
    needsPicker: creatureNeedsPicker,
    resolving: creatureResolving,
    pickDir: pickCreatureDir,
    rescan: rescanCreatures
  } = useMapCreatures(active ? { id: active.id, path: active.path } : null, assets?.creatures ?? null, handleStatus);
  const [creatureDirSkipped, setCreatureDirSkipped] = React.useState<Set<string>>(new Set());
  const showCreatureDirDialog = creatureNeedsPicker && !creatureResolving && active != null && !creatureDirSkipped.has(active.id);
  const skipCreatureDir = React.useCallback(() => {
    setCreatureDirSkipped((prev) => (active ? new Set(prev).add(active.id) : prev));
  }, [active]);

  const { spawns, setSpawns } = useMapSpawns(
    active ? { id: active.id, path: active.path, mapId: active.map.id } : null,
    creatureDb
  );
  spawnsRef.current = spawns;

  const handleEditSpawns = React.useCallback(
    (next: MapSpawns) => {
      setSpawns(next);
      spawnsDirty.current = true;
      markActiveDirty();
    },
    [setSpawns, markActiveDirty]
  );

  const markWaypointsMigrated = React.useCallback(() => {
    waypointsDirty.current = true;
  }, []);

  const { waypoints, setWaypoints } = useMapWaypoints(
    active ? { id: active.id, path: active.path, mapId: active.map.id } : null,
    markWaypointsMigrated
  );
  waypointsRef.current = waypoints;

  const handleEditWaypoints = React.useCallback(
    (next: MapWaypoints) => {
      setWaypoints(next);
      waypointsDirty.current = true;
      markActiveDirty();
    },
    [setWaypoints, markActiveDirty]
  );

  const { houses, setHouses } = useMapHouses(active ? { id: active.id, path: active.path, mapId: active.map.id } : null);
  housesRef.current = houses;

  const [towns, setTownList] = React.useState<Town[]>([]);
  const activeMapId = active?.map.id ?? null;

  const executeDangerousAction = React.useCallback(async () => {
    if (activeMapId == null || !dangerousConfirm) return;
    const count = dangerousConfirm === 'action-ids' ? await stripActionIds(activeMapId) : await stripUniqueIds(activeMapId);
    const label = dangerousConfirm === 'action-ids' ? 'action' : 'unique';
    handleStatus(count > 0 ? `Stripped ${count} ${label} ID${count === 1 ? '' : 's'}` : `No ${label} IDs found`);
    if (count > 0) {
      markActiveDirty();
      setIdMarkersVersion((v) => v + 1);
    }
    setDangerousConfirm(null);
  }, [activeMapId, dangerousConfirm, handleStatus, markActiveDirty]);
  React.useEffect(() => {
    if (activeMapId === null) {
      setTownList([]);
      return;
    }
    let cancelled = false;
    void getTowns(activeMapId)
      .then((list) => {
        if (!cancelled) setTownList(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeMapId, townsOpen]);

  const gotoHouse = (h: House) => gotoPosition(h.entryX, h.entryY, h.entryZ);

  const handleEditHouses = React.useCallback(
    (next: MapHouses) => {
      setHouses(next);
      housesDirty.current = true;
      markActiveDirty();
    },
    [setHouses, markActiveDirty]
  );

  const markHousesDirty = React.useCallback(() => {
    housesDirty.current = true;
    markActiveDirty();
  }, [markActiveDirty]);

  const commitImport = React.useCallback(
    async (opts: {
      mapId: number;
      dx: number;
      dy: number;
      dz: number;
      sourceHouses: House[];
      sourceSpawns: MapSpawns | null;
      houseMode: HouseImportMode;
    }) => {
      const { mapId, dx, dy, dz, sourceHouses, sourceSpawns, houseMode } = opts;
      const importHouses = houseMode !== 'none';

      const existing = housesRef.current ?? { list: [] };
      const existingIds = new Set(existing.list.map((h) => h.id));
      const houseIdMap: Record<number, number> = {};
      let nextHouseId = existing.list.reduce((max, h) => Math.max(max, h.id), 0);
      for (const h of sourceHouses) {
        const remap = houseMode === 'insert' || (houseMode === 'smart' && existingIds.has(h.id));
        if (remap) {
          nextHouseId += 1;
          houseIdMap[h.id] = nextHouseId;
        } else {
          houseIdMap[h.id] = h.id;
        }
      }

      handleStatus('Importing map...');
      setImportBusy({ value: 0, label: 'Injecting tiles...' });
      const unlisten = await listen<number>('import_progress', (e) =>
        setImportBusy({ value: e.payload, label: 'Injecting tiles...' })
      );
      try {
        const result = await importCommit({
          mapId,
          dx,
          dy,
          dz,
          houseIdMap,
          importTowns: true,
          importWaypoints: true,
          importHouses
        });
        patchActiveMap({
          bounds: { minX: result.bounds[0], minY: result.bounds[1], maxX: result.bounds[2], maxY: result.bounds[3] },
          floors: result.floors
        });
        mapRefetchRef.current?.(result.touched);

        if (sourceHouses.length > 0) {
          const remappedHouses: House[] = sourceHouses.map((h) => ({
            ...h,
            id: houseIdMap[h.id] ?? h.id,
            townId: result.townIdMap[h.townId] ?? h.townId,
            entryX: h.entryX + dx,
            entryY: h.entryY + dy,
            entryZ: h.entryZ + dz
          }));
          setHouses({ list: [...existing.list, ...remappedHouses] });
          housesDirty.current = true;
        }

        if (sourceSpawns) {
          const cur = spawnsRef.current;
          const areas = (cur?.areas ?? []).concat(
            sourceSpawns.areas.map((a) => ({ x: a.x + dx, y: a.y + dy, z: a.z + dz, radius: a.radius }))
          );
          const placements = (cur?.placements ?? []).concat(
            sourceSpawns.placements.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy, z: p.z + dz }))
          );
          setSpawns(buildMapSpawns(areas, placements));
          spawnsDirty.current = true;
        }

        if (result.townsMerged > 0 || result.waypointsMerged > 0) {
          waypointsDirty.current = true;
          if (activeMapId != null) {
            void getTowns(activeMapId)
              .then(setTownList)
              .catch(() => undefined);
          }
        }

        markActiveDirty();
        handleStatus(
          `Imported ${result.tilesImported} tiles, ${result.townsMerged} towns, ${result.waypointsMerged} waypoints` +
            (result.tilesDiscarded > 0 ? ` (${result.tilesDiscarded} out of bounds)` : '')
        );
      } catch (e) {
        handleStatus(`Import commit failed: ${e}`);
      } finally {
        unlisten();
        setImportBusy(null);
      }
    },
    [activeMapId, handleStatus, markActiveDirty, patchActiveMap, setHouses, setSpawns]
  );

  const runImport = React.useCallback(
    async (req: ImportMapRequest) => {
      if (!active) return;
      const mapId = active.map.id;
      const importHouses = req.houseMode !== 'none';

      setImportBusy({ value: 0, label: 'Reading map file...' });
      const unlistenLoad = await listen<number>('import_load_progress', (e) =>
        setImportBusy({ value: e.payload, label: 'Reading map file...' })
      );
      let info;
      let sourceHouses: House[] = [];
      let sourceSpawns: MapSpawns | null = null;
      try {
        info = await importLoad(req.path);
        const dir = dirOf(req.path);
        const base = (req.path.split(/[\\/]/).pop() ?? '').replace(/\.otbm$/i, '');
        const [housesRaw, spawnsRaw] = await Promise.all([
          importHouses ? loadHouses(`${dir}${base}-house.xml`).catch(() => ({ list: [] })) : Promise.resolve({ list: [] }),
          req.spawnMode !== 'none' && creatureDb
            ? loadSpawns(`${dir}${base}-spawn.xml`, creatureDb).catch(() => null)
            : Promise.resolve(null)
        ]);
        sourceHouses = housesRaw.list;
        sourceSpawns = spawnsRaw;
      } catch (e) {
        unlistenLoad();
        setImportBusy(null);
        handleStatus(`Import failed: ${e}`);
        return;
      }

      if (req.placeMode === 'ghost') {
        importCtx.current = {
          mapId,
          minX: info.minX,
          minY: info.minY,
          maxX: info.maxX,
          maxY: info.maxY,
          sourceHouses,
          sourceSpawns,
          houseMode: req.houseMode
        };
        const width = Math.max(1, info.maxX - info.minX + 1);
        const height = Math.max(1, info.maxY - info.minY + 1);
        const minZ = info.floors[0] ?? 7;
        const maxZ = info.floors[info.floors.length - 1] ?? minZ;
        setImportBusy({ value: 1, label: 'Building preview...' });
        const preview = assets
          ? await importPreview(active.floorZ)
              .then((p) => buildImportSpriteThumbnail(p, assets.items, assets.sprPath, assets.transparency))
              .catch(() => null)
          : null;
        unlistenLoad();
        setImportBusy(null);
        setImportGhost({ width, height, minZ, maxZ, preview });
        handleStatus(
          `Import: ${info.tileCount} tiles, ${info.townCount} towns, ${info.waypointCount} waypoints - click to drop, Esc to cancel`
        );
        return;
      }

      unlistenLoad();
      await commitImport({
        mapId,
        dx: req.offsetX,
        dy: req.offsetY,
        dz: 0,
        sourceHouses,
        sourceSpawns,
        houseMode: req.houseMode
      });
    },
    [active, assets, commitImport, creatureDb, handleStatus]
  );

  const handleImportDrop = React.useCallback(
    async (pos: Position) => {
      const ctx = importCtx.current;
      if (!ctx) return;
      importCtx.current = null;
      setImportGhost(null);
      const w = ctx.maxX - ctx.minX + 1;
      const h = ctx.maxY - ctx.minY + 1;
      const ax = Math.max(0, Math.min(pos.x, 65536 - w));
      const ay = Math.max(0, Math.min(pos.y, 65536 - h));
      await commitImport({
        mapId: ctx.mapId,
        dx: ax - ctx.minX,
        dy: ay - ctx.minY,
        dz: 0,
        sourceHouses: ctx.sourceHouses,
        sourceSpawns: ctx.sourceSpawns,
        houseMode: ctx.houseMode
      });
    },
    [commitImport]
  );

  const handleImportCancel = React.useCallback(() => {
    void importCancel().catch(() => undefined);
    importCtx.current = null;
    setImportGhost(null);
  }, []);

  const importFloor = active?.floorZ;
  React.useEffect(() => {
    if (!importCtx.current || importFloor == null || !assets) return;
    let cancelled = false;
    void importPreview(importFloor)
      .then((p) => buildImportSpriteThumbnail(p, assets.items, assets.sprPath, assets.transparency))
      .then((preview) => {
        if (cancelled) return;
        setImportGhost((prev) => (prev ? { ...prev, preview } : prev));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [importFloor, assets]);

  const isContentReady = (id: PanelId) => {
    const kind = baseKind(id);
    if (kind === 'minimap') return minimapOpen && !!assets && !!active && minimapReady;
    if (kind === 'properties') return propertiesOpen && !!assets && !!active;
    if (kind === 'idmarkers') return idMarkersOpen && !!assets && !!active;
    return kind === 'tools' || !!(assets && palette);
  };

  const dock = useDock(isContentReady);

  const toggleMinimap = () => {
    if (!minimapOpen) dock.ensureMinimapOnScreen();
    setMinimapOpen((v) => !v);
  };
  const closeMinimap = () => setMinimapOpen(false);

  const ensurePropertiesPlaced = React.useCallback(() => {
    const placed = [...dock.layout.left.flat(), ...dock.layout.right.flat(), ...Object.keys(dock.layout.float)];
    if (!placed.includes('properties')) dock.floatPanel('properties');
  }, [dock]);

  const toggleProperties = React.useCallback(() => {
    setPropertiesOpen((prev) => {
      if (!prev) ensurePropertiesPlaced();
      return !prev;
    });
  }, [ensurePropertiesPlaced]);

  const openProperties = React.useCallback(() => {
    ensurePropertiesPlaced();
    setPropertiesOpen(true);
  }, [ensurePropertiesPlaced]);

  const ensureIdMarkersPlaced = React.useCallback(() => {
    const placed = [...dock.layout.left.flat(), ...dock.layout.right.flat(), ...Object.keys(dock.layout.float)];
    if (!placed.includes('idmarkers')) dock.floatPanel('idmarkers');
  }, [dock]);

  const toggleIdMarkers = React.useCallback(() => {
    setIdMarkersOpen((prev) => {
      if (!prev) ensureIdMarkersPlaced();
      return !prev;
    });
  }, [ensureIdMarkersPlaced, setIdMarkersOpen]);

  const editWaypoints = (next: MapWaypoints) => (waypointEditRef.current ?? handleEditWaypoints)(next);

  const gotoWaypoint = (wp: Waypoint) => gotoPosition(wp.x, wp.y, wp.z);

  const copyWaypointPosition = (wp: Waypoint) =>
    navigator.clipboard?.writeText(formatPosition(copyPositionFormat, { x: wp.x, y: wp.y, z: wp.z })).catch(() => undefined);

  const addWaypointAtCenter = () => {
    if (!active) return;
    const v = mapViewRef.current;
    const pos = v
      ? {
          x: Math.floor((v.camX + v.vw / (2 * v.zoom)) / 32),
          y: Math.floor((v.camY + v.vh / (2 * v.zoom)) / 32),
          z: active.floorZ
        }
      : { x: active.center.x, y: active.center.y, z: active.floorZ };
    const wps = waypointsRef.current ?? { list: [], byChunk: new Map() };
    const name = nextWaypointName(wps);
    editWaypoints(addWaypoint(wps, name, pos));
    setPlacingWaypoint(name);
  };

  const openEditTowns = () => {
    if (active) setTownsOpen((v) => !v);
  };

  const openMapProperties = () => {
    if (active) setMapPropsOpen(true);
  };

  const openMapStatistics = () => {
    if (active) setStatsOpen(true);
  };

  const openMinimapExport = () => {
    if (active) setMinimapExportOpen(true);
  };

  const gotoPosition = (x: number, y: number, z: number, clientId?: number) => {
    setFloorZ(z);
    mapCenterRef.current?.(x, y);
    mapHighlightRef.current?.(x, y, z, clientId);
  };

  const pendingItemsRefresh = React.useRef(false);

  const refreshEverything = React.useCallback(() => {
    pendingItemsRefresh.current = true;
    selectBrush(null);
    void rescanCreatures();
    retryAssets();
    handleStatus('Reloading assets...');
  }, [rescanCreatures, retryAssets, handleStatus, selectBrush]);

  React.useEffect(() => {
    if (!assets || !pendingItemsRefresh.current) return;
    pendingItemsRefresh.current = false;
    void refreshItems();
  }, [assets]);

  useReplaceItemWindow({
    itemNames,
    mapId: active?.map.id ?? null,
    title: active?.title ?? null,
    floorZ: active?.floorZ ?? 7,
    onReplaced: (result) => {
      handleStatus(result.total > 0 ? `Replaced ${result.total} item${result.total === 1 ? '' : 's'}` : 'No items replaced');
      if (result.total === 0) return;
      markActiveDirty();
      mapRefetchRef.current?.(result.touched);
    }
  });

  useAppShortcuts({
    activeId,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    closeTab,
    cycleTab,
    toggleMinimap,
    openEditTowns,
    openJumpToItem: () => setJumpToItemOpen(true),
    openMapProperties,
    openMapStatistics,
    openShortcuts: () => setShortcutsOpen(true),
    openPreferences: () => openPreferences(),
    refreshAssets: refreshEverything,
    toggleShade,
    toggleAutomagic,
    toggleCreatures,
    toggleTooltips,
    toggleBlocking,
    toggleHouses,
    toggleWaypoints,
    toggleSpawns,
    cycleReference,
    toggleGroundBlocksFill,
    toggleFloodContiguous
  });

  savingRef.current = !!saving;

  const requestExit = React.useCallback(() => {
    if (savingRef.current) return;
    if (dirtyTabs.current.size > 0) setCloseConfirmOpen(true);
    else void getCurrentWindow().destroy();
  }, []);

  React.useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (savingRef.current) {
        event.preventDefault();
        return;
      }
      if (dirtyTabs.current.size === 0) return;
      event.preventDefault();
      setCloseConfirmOpen(true);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  React.useEffect(() => {
    setSelectedItem(null);
    statusApiRef.current?.setSelectedItem(null);
    spawnsDirty.current = false;
    waypointsDirty.current = false;
    housesDirty.current = false;
    setPlacingWaypoint(null);
  }, [activeId]);

  const panelMenu = (id: PanelId) => {
    if (!panelMeta(id).cornerDockable) return null;
    return (
      <PanelDockMenu
        corner={cornerOf(dock.layout, id)}
        onFloat={() => dock.floatPanel(id)}
        onPick={(c) => dock.dockToCorner(id, c)}
      />
    );
  };

  const renderPanelContent = (id: PanelId, handle?: DragHandleProps) => {
    const kind = baseKind(id);
    if (kind === 'tools') {
      return <ToolsPanel dragHandle={handle} />;
    }
    if (kind === 'palette') {
      const isPrimary = id === 'palette';
      return (
        <PalettePanel
          panelId={id}
          towns={towns}
          houses={houses}
          primary={isPrimary}
          dragHandle={handle}
          waypoints={waypoints}
          onGotoHouse={gotoHouse}
          onGotoWaypoint={gotoWaypoint}
          onEditWaypoints={editWaypoints}
          onEditHouses={handleEditHouses}
          onAddWaypoint={addWaypointAtCenter}
          creatureTilesets={creatureTilesets}
          onPickCreatureDir={pickCreatureDir}
          creatureNeedsPicker={creatureNeedsPicker}
          onCopyWaypointPosition={copyWaypointPosition}
          onClose={isPrimary ? undefined : () => dock.closePanel(id)}
        />
      );
    }
    if (kind === 'properties' && assets && active && propertiesOpen) {
      return (
        <ItemPropertiesPanel
          item={selectedItem}
          dragHandle={handle}
          mapId={active.map.id}
          itemNames={itemNames}
          items={assets.items ?? null}
          handlers={{
            status: handleStatus,
            close: () => setPropertiesOpen(false),
            edited: () => {
              markActiveDirty();
              if (selectedItem) {
                mapRefetchRef.current?.([
                  [selectedItem.z, packChunkKey(Math.floor(selectedItem.x / CHUNK), Math.floor(selectedItem.y / CHUNK))]
                ]);
              }
            }
          }}
        />
      );
    }
    if (kind === 'idmarkers' && assets && active && idMarkersOpen) {
      return (
        <IdMarkers
          dragHandle={handle}
          mapId={active.map.id}
          onGoto={gotoPosition}
          version={idMarkersVersion}
          items={assets.items ?? null}
          onClose={() => setIdMarkersOpen(false)}
          onEdited={(tagged) => {
            markActiveDirty();
            if (tagged?.length) mapRefetchRef.current?.(tagged);
          }}
        />
      );
    }
    if (kind === 'minimap' && assets && active && minimapReady) {
      return (
        <Minimap
          key={active.id}
          dragHandle={handle}
          viewRef={mapViewRef}
          mapId={active.map.id}
          floorZ={active.floorZ}
          apiRef={minimapApiRef}
          onClose={closeMinimap}
          centerRef={mapCenterRef}
          paletteReady={minimapReady}
          headerMenu={panelMenu('minimap')}
        />
      );
    }
    return null;
  };

  const renderPanel = (id: PanelId, handle?: DragHandleProps) => {
    const content = renderPanelContent(id, handle);
    if (!content) return null;
    return (
      <PanelBoundary key={id} label={baseKind(id)}>
        {content}
      </PanelBoundary>
    );
  };

  const mapTabs = (
    <MapTabs
      tabs={tabs}
      onNew={handleNew}
      activeId={activeId}
      dirtyIds={dirtyIds}
      onSelect={setActiveId}
      disabled={busy || !assets}
      onClose={(id) => {
        clearDirty(id);
        closeTab(id);
      }}
    />
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toolbar
        onStatus={handleStatus}
        onAbout={() => setAboutOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        state={{
          recent,
          minimapOpen,
          idMarkersOpen,
          propertiesOpen,
          hasActive: !!active,
          loading: busy || !assets
        }}
        map={{
          onEditTowns: openEditTowns,
          onMapProperties: openMapProperties,
          onMapStatistics: openMapStatistics,
          onExportMinimap: openMinimapExport,
          onReferenceImage: () => setReferenceOpen(true)
        }}
        window={{
          onNewPalette: dock.newPalette,
          onToggleMinimap: toggleMinimap,
          onToggleIdMarkers: toggleIdMarkers,
          onToggleProperties: toggleProperties,
          onSelectPaletteCategory: setPaletteCategory
        }}
        edit={{
          onJumpToItem: () => setJumpToItemOpen(true),
          onReplaceItems: () => void openReplaceItem(),
          onOpenScripts: () => setScriptsOpen(true),
          onOpenPreferences: () => openPreferences(),
          onStripActionIds: () => setDangerousConfirm('action-ids'),
          onStripUniqueIds: () => setDangerousConfirm('unique-ids')
        }}
        file={{
          onNew: handleNew,
          onOpen: handleOpen,
          onClearRecent: clearRecent,
          onRequestExit: requestExit,
          onSave: () => void handleSave(),
          onSaveAs: () => void handleSaveAs(),
          onImportMap: () => setImportOpen(true),
          onOpenRecent: (path) => void openPath(path),
          onCloseMap: () => activeId && closeTab(activeId)
        }}
      />

      <Preferences
        initialTab={prefsTab}
        open={preferencesOpen}
        onResetLayout={dock.resetLayout}
        onOpenChange={setPreferencesOpen}
        onSaved={() => {
          dock.reloadConfig();
          reloadGeneral();
          reloadEditor();
        }}
      />

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <JumpToItem open={jumpToItemOpen} onOpenChange={setJumpToItemOpen} />

      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>You have unsaved changes. Close without saving?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCloseConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void getCurrentWindow().destroy()}>
              Close without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dangerousConfirm !== null} onOpenChange={(open) => !open && setDangerousConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dangerousConfirm === 'action-ids' ? 'Strip All Action IDs' : 'Strip All Unique IDs'}</DialogTitle>
            <DialogDescription>
              This will remove every {dangerousConfirm === 'action-ids' ? 'action' : 'unique'} ID from all items in the map. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDangerousConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void executeDangerousAction()}>
              Strip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScriptEditor open={scriptsOpen} onOpenChange={setScriptsOpen} />

      <MapTowns
        open={townsOpen}
        cursorRef={cursorRef}
        onGoto={gotoPosition}
        onSaved={markActiveDirty}
        mapId={active?.map.id ?? null}
        onClose={() => setTownsOpen(false)}
      />

      <MapProperties
        open={mapPropsOpen}
        mapId={active?.map.id ?? null}
        onOpenChange={setMapPropsOpen}
        onSaved={() => {
          if (activeMapId === null) return;
          void getMapProperties(activeMapId).then((p) => patchActiveMap({ width: p.width, height: p.height }));
        }}
      />

      <MapStatistics
        spawns={spawns}
        open={statsOpen}
        waypoints={waypoints}
        onOpenChange={setStatsOpen}
        mapId={active?.map.id ?? null}
      />

      <MinimapExport
        open={minimapExportOpen}
        mapId={active?.map.id ?? null}
        floors={active?.map.floors ?? []}
        currentFloor={active?.floorZ ?? 7}
        onOpenChange={setMinimapExportOpen}
        defaultName={(active?.title ?? 'minimap').replace(/\.[^.]+$/, '')}
      />

      <ReferenceImage
        open={referenceOpen}
        onOpenChange={setReferenceOpen}
        center={active ? { x: active.center.x, y: active.center.y } : null}
      />

      <Workspace dock={dock} tabs={mapTabs} progress={progress} renderPanel={renderPanel}>
        {active && assets ? (
          <MapCanvas
            key={active.id}
            spawns={spawns}
            houses={houses}
            map={active.map}
            zoom={active.zoom}
            viewRef={mapViewRef}
            itemNames={itemNames}
            onHover={handleHover}
            waypoints={waypoints}
            floorZ={active.floorZ}
            onZoomChange={setZoom}
            onViewChange={setView}
            onStatus={handleStatus}
            onSelect={handleSelect}
            centerRef={mapCenterRef}
            importGhost={importGhost}
            onFloorChange={setFloorZ}
            refetchRef={mapRefetchRef}
            initialCenter={active.center}
            paused={!!saving || reloading}
            highlightRef={mapHighlightRef}
            onImportDrop={handleImportDrop}
            onEditSpawns={handleEditSpawns}
            onEditHouses={handleEditHouses}
            onHousesDirty={markHousesDirty}
            waypointEditRef={waypointEditRef}
            placingWaypoint={placingWaypoint}
            onItemProperties={openProperties}
            onImportCancel={handleImportCancel}
            onEditWaypoints={handleEditWaypoints}
            onPlaceWaypoint={() => setPlacingWaypoint(null)}
            onEdit={(z) => {
              minimapApiRef.current?.markDirty(z);
              markActiveDirty();
            }}
          />
        ) : assetsMissing ? (
          <AssetsMissing
            error={error}
            dataDir={dataDir}
            onRetry={retryAssets}
            clientConfigured={clientConfigured}
            onOpenSettings={() => openPreferences(assetLabel ? 'assets' : 'client')}
            onOpenFolder={() => void openDataDir(dataDir.replace(/[\\/][^\\/]+$/, ''))}
            target={{ label: assetLabel ?? `version ${version}`, scripted: assetLabel !== null, project: project?.name ?? null }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {error ?? status}
          </div>
        )}
      </Workspace>

      <StatusBar
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        apiRef={statusApiRef}
        onZoomChange={setZoom}
        zoom={active?.zoom ?? 1}
        status={error ?? status}
        onFloorChange={setFloorZ}
        floorZ={active?.floorZ ?? 7}
      />

      {saving && <SaveProgressModal value={saving.value} label={saving.label} />}
      {importBusy && (
        <SaveProgressModal
          title="Importing map"
          value={importBusy.value}
          label={importBusy.label}
          note="Merging the imported map into the current one."
        />
      )}

      <CreatureDataDialog
        onClose={skipCreatureDir}
        onSelect={pickCreatureDir}
        open={showCreatureDirDialog}
        mapName={active?.path?.split(/[\\/]/).pop() ?? 'this map'}
      />

      <ImportMapDialog open={importOpen} onOpenChange={setImportOpen} onImport={(req) => void runImport(req)} />
    </div>
  );
};

const Root = () => (
  <AssetsProvider>
    <EditorSettingsProvider>
      <ToolProvider>
        <TooltipProvider delayDuration={300} skipDelayDuration={150}>
          <App />
        </TooltipProvider>
      </ToolProvider>
    </EditorSettingsProvider>
  </AssetsProvider>
);

if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.documentElement.classList.add('dark');
}

const isPageReload = () => {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === 'reload';
};

const mount = () => createRoot(document.getElementById('root')!).render(<Root />);

void initKeybinds();

if (isLuaEnabled() && isPageReload()) {
  reloadScripts()
    .catch((err) => console.error('lua reload failed', err))
    .finally(mount);
} else {
  mount();
}
