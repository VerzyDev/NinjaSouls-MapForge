import React from 'react';

import { Position } from '~/domain/map';
import { KeybindId } from '~/domain/keybinds';
import { getSetting, setSetting } from '~/adapter/settings';
import { isKeybind, matchKeybind } from '~/usecase/keybinds';
import { BrushOption, zoneBrushOption } from '~/adapter/biomes';
import { ToolId, EraserMode, isZoneTool } from '~/domain/tools';
import { ResolvedBiome, GenerateOptions } from '~/domain/biome';
import { MountainOptions, ResolvedMountain } from '~/domain/mountain';
import { setDoodadThickness as applyDoodadThickness } from '~/adapter/map';
import { BrushKind, ActiveBrush, isRevealFriendly, PaletteCategoryId } from '~/domain/palette';

import {
  HuntArea,
  HuntMeta,
  HuntMonster,
  PaletteReveal,
  GenerateSignal,
  ReferenceImage,
  HuntViewPreview,
  ToolContextValue,
  HuntPreviewParams,
  HuntPreviewSignal,
  ToolProviderProps,
  HuntRescatterSignal,
  PaletteCategorySignal
} from './types';

const ToolContext = React.createContext({} as ToolContextValue);

const TOOL_KEYBINDS = {
  'tool.borderize': 'borderize',
  'tool.bucket': 'bucket',
  'tool.wand': 'wand'
} as const satisfies Partial<Record<KeybindId, ToolId>>;

const TOOL_KEYBIND_IDS = Object.keys(TOOL_KEYBINDS) as (keyof typeof TOOL_KEYBINDS)[];

const optionKey = (o: BrushOption): string => o.key ?? (o.lookType != null ? `creature:${o.name}` : `tile:${o.paintId}`);

const brushKey = (b: ActiveBrush): string => b.key;

const brushToOption = (b: ActiveBrush): BrushOption => ({
  key: b.key,
  name: b.name,
  kind: b.kind,
  serverId: b.serverId ?? 0,
  paintId: b.serverId ?? 0,
  isGround: b.isGround,
  lookType: b.lookType,
  isNpc: b.isNpc,
  head: b.head,
  body: b.body,
  legs: b.legs,
  feet: b.feet
});

const optionToBrush = (o: BrushOption): ActiveBrush => ({
  key: optionKey(o),
  name: o.name,
  kind: o.kind as BrushKind,
  serverId: o.lookType != null ? undefined : o.paintId,
  isGround: o.isGround ?? o.kind === 'ground',
  lookType: o.lookType,
  isNpc: o.isNpc,
  head: o.head,
  body: o.body,
  legs: o.legs,
  feet: o.feet
});

export const ToolProvider = ({ children }: ToolProviderProps) => {
  const [activeTool, setActiveToolState] = React.useState<ToolId>('select');
  const [activeBrush, setActiveBrush] = React.useState<ActiveBrush | null>(null);
  const [activeTile, setActiveTile] = React.useState<BrushOption | null>(null);
  const [secondaryTile, setSecondaryTile] = React.useState<BrushOption | null>(null);
  const [brushSize, setBrushSize] = React.useState(1);
  const [brushShape, setBrushShape] = React.useState<BrushShape>('circle');
  const [doodadThickness, setDoodadThicknessState] = React.useState<number | null>(null);
  const appliedTile = React.useRef<string | null>(null);
  const tileRestored = React.useRef(false);
  const secondaryRestored = React.useRef(false);
  const activeTileRef = React.useRef(activeTile);
  const secondaryTileRef = React.useRef(secondaryTile);
  activeTileRef.current = activeTile;
  secondaryTileRef.current = secondaryTile;
  const [activeHouseId, setActiveHouse] = React.useState<number | null>(null);
  const [pickingPosition, setPickingPosition] = React.useState(false);
  const [pinPosition, setPinPosition] = React.useState<Position | null>(null);
  const [ctrlErase, setCtrlErase] = React.useState(false);
  const [eraserMode, setEraserMode] = React.useState<EraserMode>('items');
  const [reveal, setReveal] = React.useState<PaletteReveal | null>(null);
  const [paletteCategory, setPaletteCategoryState] = React.useState<PaletteCategorySignal | null>(null);
  const [generateSignal, setGenerateSignal] = React.useState<GenerateSignal | null>(null);
  const [generationProgress, setGenerationProgress] = React.useState<string | null>(null);
  const [huntSignal, setHuntSignal] = React.useState<HuntPreviewSignal | null>(null);
  const [huntMeta, setHuntMeta] = React.useState<HuntMeta | null>(null);
  const [huntArea, setHuntArea] = React.useState<HuntArea | null>(null);
  const [huntAreaSelecting, setHuntAreaSelecting] = React.useState(false);
  const [huntEditing, setHuntEditing] = React.useState(false);
  const [huntView, setHuntView] = React.useState<HuntViewPreview>({ show: false, w: 15, h: 11 });
  const [huntMonsters, setHuntMonsters] = React.useState<HuntMonster[]>([]);
  const [huntRescatterSignal, setHuntRescatterSignal] = React.useState<HuntRescatterSignal | null>(null);
  const [huntGenerateNonce, setHuntGenerateNonce] = React.useState(0);
  const [huntClearNonce, setHuntClearNonce] = React.useState(0);
  const [referenceImage, setReferenceImageState] = React.useState<ReferenceImage | null>(null);

  const setReferenceImage = React.useCallback((image: ReferenceImage | null) => {
    setReferenceImageState((prev) => {
      if (prev && prev.src !== image?.src) URL.revokeObjectURL(prev.src);
      return image;
    });
  }, []);

  const patchReferenceImage = React.useCallback((patch: Partial<ReferenceImage>) => {
    setReferenceImageState((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  React.useEffect(() => {
    const sync = (e: KeyboardEvent) => setCtrlErase(e.ctrlKey);
    const clear = () => setCtrlErase(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const swapTiles = React.useCallback(() => {
    const a = activeTileRef.current;
    setActiveTile(secondaryTileRef.current);
    setSecondaryTile(a);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isKeybind(e, 'tool.swapTiles')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      swapTiles();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [swapTiles]);

  const setActiveTool = React.useCallback((tool: ToolId) => {
    setActiveToolState(tool);
    if (tool !== 'house' && tool !== 'house_exit') setActiveHouse(null);
    if (isZoneTool(tool)) setActiveTile(zoneBrushOption(tool));
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchKeybind(e, TOOL_KEYBIND_IDS);
      if (!id) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setActiveTool(TOOL_KEYBINDS[id]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setActiveTool]);

  const selectBrush = React.useCallback((brush: ActiveBrush | null) => {
    setActiveBrush(brush);
    setActiveToolState(brush ? 'brush' : 'select');
    setActiveHouse(null);
    if (brush) setActiveTile(brushToOption(brush));
  }, []);

  React.useEffect(() => {
    if (!activeTile) return;
    const key = optionKey(activeTile);
    const changed = appliedTile.current !== key;
    appliedTile.current = key;
    if (activeTool === 'pen') return;
    if (activeTile.zoneTool) {
      if (changed && activeTool !== activeTile.zoneTool) setActiveToolState(activeTile.zoneTool);
      return;
    }
    if (isZoneTool(activeTool)) {
      if (changed) setActiveToolState('brush');
      return;
    }
    if (activeTool !== 'brush') return;
    if (activeBrush && brushKey(activeBrush) === key) return;
    setActiveBrush(optionToBrush(activeTile));
  }, [activeTool, activeTile, activeBrush]);

  React.useEffect(() => {
    getSetting<BrushOption | null>('activeTile', null)
      .then((saved) => {
        if (saved && typeof saved.paintId === 'number') {
          appliedTile.current = optionKey(saved);
          setActiveTile(saved);
        }
      })
      .catch(() => void 0)
      .finally(() => {
        tileRestored.current = true;
      });
  }, []);

  React.useEffect(() => {
    if (!tileRestored.current) return;
    setSetting('activeTile', activeTile).catch(() => void 0);
  }, [activeTile]);

  React.useEffect(() => {
    getSetting<BrushOption | null>('secondaryTile', null)
      .then((saved) => {
        if (saved && typeof saved.paintId === 'number') setSecondaryTile(saved);
      })
      .catch(() => void 0)
      .finally(() => {
        secondaryRestored.current = true;
      });
  }, []);

  React.useEffect(() => {
    if (!secondaryRestored.current) return;
    setSetting('secondaryTile', secondaryTile).catch(() => void 0);
  }, [secondaryTile]);

  const revealInPalette = React.useCallback((category: PaletteCategoryId, serverId: number, name?: string) => {
    setReveal((r) => ({ category, serverId, name, nonce: (r?.nonce ?? 0) + 1 }));
  }, []);

  const paletteRegistry = React.useRef(new Map<string, PaletteCategoryId>());

  const registerPalette = React.useCallback((id: string, category: PaletteCategoryId) => {
    paletteRegistry.current.set(id, category);
  }, []);

  const unregisterPalette = React.useCallback((id: string) => {
    paletteRegistry.current.delete(id);
  }, []);

  const shouldHandleReveal = React.useCallback((id: string) => {
    const reg = paletteRegistry.current;
    const mine = reg.get(id);
    if (mine === undefined) return false;
    if (isRevealFriendly(mine)) return true;
    const friendly = [...reg.values()].some(isRevealFriendly);
    if (friendly) return false;
    const fallback = [...reg.keys()].sort()[0];
    return id === fallback;
  }, []);

  const setPaletteCategory = React.useCallback((category: PaletteCategoryId) => {
    setPaletteCategoryState((p) => ({ category, nonce: (p?.nonce ?? 0) + 1 }));
  }, []);

  const requestGenerate = React.useCallback(
    (
      biomes: ResolvedBiome[],
      opts: GenerateOptions,
      mountain: ResolvedMountain | null = null,
      mountainOpts: MountainOptions | null = null
    ) => {
      setGenerateSignal((s) => ({ biomes, opts, mountain, mountainOpts, nonce: (s?.nonce ?? 0) + 1 }));
    },
    []
  );

  const requestHuntPreview = React.useCallback((params: HuntPreviewParams) => {
    setHuntSignal((s) => ({ ...params, nonce: (s?.nonce ?? 0) + 1 }));
  }, []);

  const requestHuntRescatter = React.useCallback((params: Omit<HuntRescatterSignal, 'nonce'>) => {
    setHuntRescatterSignal((s) => ({ ...params, nonce: (s?.nonce ?? 0) + 1 }));
  }, []);

  const setDoodadThickness = React.useCallback((percent: number | null) => {
    setDoodadThicknessState(percent);
    applyDoodadThickness(percent ?? -1).catch((err) => console.error('Failed to set doodad thickness', err));
  }, []);

  const requestHuntGenerate = React.useCallback(() => setHuntGenerateNonce((n) => n + 1), []);
  const requestHuntClear = React.useCallback(() => setHuntClearNonce((n) => n + 1), []);

  const value = React.useMemo<ToolContextValue>(
    () => ({
      activeTool,
      activeBrush,
      activeTile,
      secondaryTile,
      brushSize,
      brushShape,
      doodadThickness,
      activeHouseId,
      pickingPosition,
      setPickingPosition,
      pinPosition,
      setPinPosition,
      ctrlErase,
      eraserMode,
      reveal,
      paletteCategory,
      referenceImage,
      setReferenceImage,
      patchReferenceImage,
      generateSignal,
      generationProgress,
      setGenerationProgress,
      requestGenerate,
      huntSignal,
      huntMeta,
      huntArea,
      huntAreaSelecting,
      huntEditing,
      huntView,
      huntMonsters,
      huntRescatterSignal,
      huntGenerateNonce,
      huntClearNonce,
      requestHuntPreview,
      requestHuntRescatter,
      requestHuntGenerate,
      requestHuntClear,
      setHuntMeta,
      setHuntArea,
      setHuntAreaSelecting,
      setHuntEditing,
      setHuntView,
      setHuntMonsters,
      setActiveTool,
      selectBrush,
      setActiveTile,
      setSecondaryTile,
      swapTiles,
      setBrushSize,
      setBrushShape,
      setDoodadThickness,
      setActiveHouse,
      setEraserMode,
      revealInPalette,
      setPaletteCategory,
      registerPalette,
      unregisterPalette,
      shouldHandleReveal
    }),
    [
      activeTool,
      activeBrush,
      activeTile,
      secondaryTile,
      brushSize,
      brushShape,
      doodadThickness,
      setDoodadThickness,
      activeHouseId,
      pickingPosition,
      setPickingPosition,
      pinPosition,
      setPinPosition,
      ctrlErase,
      eraserMode,
      reveal,
      paletteCategory,
      referenceImage,
      setReferenceImage,
      patchReferenceImage,
      generateSignal,
      generationProgress,
      setGenerationProgress,
      requestGenerate,
      huntSignal,
      huntMeta,
      huntArea,
      huntAreaSelecting,
      huntEditing,
      huntView,
      huntMonsters,
      huntRescatterSignal,
      huntGenerateNonce,
      huntClearNonce,
      requestHuntPreview,
      requestHuntRescatter,
      requestHuntGenerate,
      requestHuntClear,
      setHuntMeta,
      setHuntArea,
      setHuntAreaSelecting,
      setHuntEditing,
      setHuntView,
      setHuntMonsters,
      setActiveTool,
      selectBrush,
      setActiveTile,
      setSecondaryTile,
      swapTiles,
      setBrushSize,
      setBrushShape,
      setActiveHouse,
      setEraserMode,
      revealInPalette,
      setPaletteCategory,
      registerPalette,
      unregisterPalette,
      shouldHandleReveal
    ]
  );

  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
};

export const useTool = () => React.useContext(ToolContext);
