import React from 'react';
import {
  X,
  Eye,
  Plus,
  Brush,
  Route,
  MapPin,
  Repeat,
  Trash2,
  Grid3x3,
  Sparkles,
  Crosshair,
  RotateCcw,
  LucideIcon,
  SquareDashed
} from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { MapSpawns } from '~/domain/creature';
import { PaletteTileset } from '~/domain/palette';
import { Input } from '~/components/commons/ui/input';
import { Hint } from '~/components/commons/ui/tooltip';
import { Button } from '~/components/commons/ui/button';
import { useTool } from '~/usecase/context/ToolContext';
import { HuntConfig, loadHuntConfig } from '~/adapter/preferences';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';
import { HuntMode, HuntMonster, CustomZoneMode } from '~/usecase/context/ToolContext/types';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';
import {
  MapCustomZones,
  customZoneLabel,
  customZoneColor,
  sortCustomZones,
  nextCustomZoneId,
  customZoneMatcher,
  emptyMapCustomZones,
  customZoneTileCounts,
  DEFAULT_CUSTOM_ZONE_RANGE
} from '~/domain/customZone';

import CreatureSelect, { CreatureImage } from './CreatureSelect';

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="px-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{children}</span>
);

interface ToggleProps {
  hint: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const Toggle = ({ hint, active, onClick, children }: ToggleProps) => (
  <Hint label={hint}>
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1 rounded px-1 py-1 text-[10px]',
        active ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
      )}
    >
      {children}
    </button>
  </Hint>
);

const Notice = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-md border border-amber-400/40 bg-amber-400/5 p-2 text-[10px] leading-relaxed text-amber-400/90">
    {children}
  </div>
);

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className="tabular-nums text-foreground">{value}</span>
  </div>
);

const RECTANGLE = 'rect';

const PAINT_MODES: { mode: CustomZoneMode; label: string; help: string }[] = [
  { mode: 'brush', label: 'Brush', help: 'Paint tile by tile. Ctrl erases, Ctrl+wheel changes the brush size.' },
  {
    mode: 'fill',
    label: 'Fill',
    help: 'Click a walkable tile to grab the whole connected hall. Stops at walls and trees. Ctrl-click erases.'
  },
  { mode: 'polygon', label: 'Polygon', help: 'Click the corners, then the first corner or Enter to fill. Ctrl erases.' }
];

const PLACEMENTS: {
  mode: HuntMode;
  label: string;
  icon: LucideIcon;
  help: (n: number, lure: number) => string;
}[] = [
  {
    mode: 'rotation',
    label: 'Rotation',
    icon: Repeat,
    help: (n, lure) =>
      `Keep walking the route and lure as you go: any ${lure} tiles of it pull at most ${n} monsters. Monsters only spawn where the route can pull them.`
  },
  {
    mode: 'box',
    label: 'Box spots',
    icon: Crosshair,
    help: (n) =>
      `Stand on a point and fight: each box point gets its own ${n} monsters on screen, and nothing spawns away from the points.`
  },
  {
    mode: 'density',
    label: 'Density',
    icon: Grid3x3,
    help: (n) => `No pattern, just an even spread: about ${n} monsters per screen across the whole route.`
  }
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface HuntViewProps {
  creatureTilesets?: PaletteTileset[];
  zones: MapCustomZones | null;
  spawns: MapSpawns | null;
  onEditZones: (next: MapCustomZones) => void;
}

const HuntView = ({ creatureTilesets, zones, spawns, onEditZones }: HuntViewProps) => {
  const {
    huntMeta,
    huntArea,
    huntMonsters,
    huntZoneId,
    huntAreaSelecting,
    activeTool,
    activeCustomZoneId,
    customZoneMode,
    zoneLayer,
    requestHuntPreview,
    requestHuntRescatter,
    requestHuntGenerate,
    requestHuntClear,
    requestHuntDeleteMonsters,
    setHuntAreaSelecting,
    setHuntEditing,
    setHuntRouteAdding,
    setHuntView,
    setHuntMonsters,
    setHuntZoneId: setZoneId,
    setActiveTool,
    setActiveCustomZone,
    setCustomZoneMode,
    setCustomZoneAllFloors,
    setZoneLayer
  } = useTool();
  const { spawnTime } = useEditorSettings();
  const [cfg, setCfg] = React.useState<HuntConfig | null>(null);
  const [mode, setMode] = React.useState<HuntMode>('rotation');
  const [lureLength, setLureLength] = React.useState<number | null>(null);
  const [spawntime, setSpawntime] = React.useState(spawnTime);
  const zoneId = huntZoneId ?? null;
  const [showView, setShowView] = React.useState(false);
  const zoneList = React.useMemo(() => sortCustomZones(zones?.list ?? []), [zones]);
  const tileCounts = React.useMemo(() => (zones ? customZoneTileCounts(zones) : new Map<number, number>()), [zones]);
  const zoneTiles = zoneId != null ? (tileCounts.get(zoneId) ?? 0) : 0;
  const zoneMonsters = React.useMemo(() => {
    if (zoneId == null || !spawns) return 0;
    const inZone = customZoneMatcher(zones, zoneId);
    return spawns.placements.filter((p) => !p.isNpc && inZone(p)).length;
  }, [spawns, zones, zoneId]);
  const painting = zoneId != null && activeTool === 'custom_zone' && zoneLayer === 'hunt' && activeCustomZoneId === zoneId;
  const total = huntMonsters.reduce((sum, m) => sum + m.count, 0);
  const layoutSize = total > 0 ? total : (cfg?.boxSize ?? 8);
  const lure = lureLength ?? cfg?.viewWidth ?? 21;

  const allMonsters = React.useMemo<HuntMonster[]>(() => {
    const seen = new Set<string>();
    const out: HuntMonster[] = [];
    for (const ts of creatureTilesets ?? []) {
      for (const b of ts.brushes) {
        if (b.kind !== 'creature' || b.isNpc || seen.has(b.name)) continue;
        seen.add(b.name);
        out.push({
          name: b.name,
          lookType: b.lookType ?? 0,
          head: b.creature?.head ?? 0,
          body: b.creature?.body ?? 0,
          legs: b.creature?.legs ?? 0,
          feet: b.creature?.feet ?? 0,
          spawntime: 60,
          count: 1
        });
      }
    }
    return out;
  }, [creatureTilesets]);

  const selectedNames = React.useMemo(() => new Set(huntMonsters.map((m) => m.name)), [huntMonsters]);
  const pickable = React.useMemo(() => allMonsters.filter((m) => !selectedNames.has(m.name)), [allMonsters, selectedNames]);

  const addMonster = (m: HuntMonster) => {
    const count = huntMonsters.length === 0 ? (cfg?.boxSize ?? 8) : 1;
    setHuntMonsters([...huntMonsters, { ...m, spawntime, count }]);
  };
  const patchMonster = (name: string, patch: Partial<HuntMonster>) =>
    setHuntMonsters(huntMonsters.map((x) => (x.name === name ? { ...x, ...patch } : x)));
  const removeMonster = (name: string) => setHuntMonsters(huntMonsters.filter((x) => x.name !== name));
  const applySpawntime = (v: number) => {
    setSpawntime(v);
    setHuntMonsters(huntMonsters.map((x) => ({ ...x, spawntime: v })));
  };

  React.useEffect(() => {
    loadHuntConfig()
      .then(setCfg)
      .catch((err) => console.error('Failed to load hunt config', err));
  }, []);

  React.useEffect(() => {
    setSpawntime(spawnTime);
  }, [spawnTime]);

  React.useEffect(() => {
    setHuntEditing(true);
    return () => setHuntEditing(false);
  }, [setHuntEditing]);

  const [routeAdding, setRouteAdding] = React.useState(false);
  const hasPreview = !!huntMeta;
  React.useEffect(() => {
    if (!hasPreview) setRouteAdding(false);
  }, [hasPreview]);

  React.useEffect(() => {
    setHuntRouteAdding(routeAdding);
    return () => setHuntRouteAdding(false);
  }, [routeAdding, setHuntRouteAdding]);

  React.useEffect(() => {
    setHuntView({ show: showView, w: cfg?.viewWidth ?? 21, h: cfg?.viewHeight ?? 11 });
  }, [showView, cfg, setHuntView]);

  const restoredZone = React.useRef(false);
  React.useEffect(() => {
    if (restoredZone.current || zoneList.length === 0) return;
    restoredZone.current = true;
    if (huntZoneId === null) return;
    if (!zoneList.some((z) => z.id === huntZoneId)) setZoneId(zoneList[0].id);
    setZoneLayer('hunt');
  }, [zoneList, huntZoneId, setZoneId, setZoneLayer]);

  React.useEffect(() => {
    if (!cfg || !huntMeta) return;
    requestHuntRescatter({
      mode,
      boxSize: layoutSize,
      lureLength: lure,
      viewW: cfg.viewWidth,
      viewH: cfg.viewHeight,
      aggroW: cfg.aggroWidth,
      aggroH: cfg.aggroHeight
    });
  }, [layoutSize, mode, lure]);

  const startPaint = (id: number) => {
    requestHuntClear();
    setHuntAreaSelecting(false);
    setZoneLayer('hunt');
    setCustomZoneAllFloors(false);
    setActiveCustomZone(id);
    setActiveTool('custom_zone');
  };

  const stopPaint = () => setActiveTool('select');

  const onZone = (v: string) => {
    const next = v === RECTANGLE ? null : Number(v);
    if (next === zoneId) return;
    if (painting) stopPaint();
    setZoneId(next);
    setHuntAreaSelecting(false);
    requestHuntClear();
    if (next != null) setZoneLayer('hunt');
  };

  const newZone = () => {
    const base = zones ?? emptyMapCustomZones();
    const id = nextCustomZoneId(base);
    onEditZones({ list: [...base.list, { id, ...DEFAULT_CUSTOM_ZONE_RANGE }], tiles: base.tiles });
    setZoneId(id);
    setCustomZoneMode('fill');
    startPaint(id);
  };

  const canPreview = !!cfg && (zoneId != null ? zoneTiles > 0 : !!huntArea);
  const rebuildRoute = () => {
    if (!cfg || !canPreview) return;
    if (painting) stopPaint();
    requestHuntPreview({
      area: huntArea,
      zoneId,
      mode,
      boxSize: layoutSize,
      lureLength: lure,
      viewW: cfg.viewWidth,
      viewH: cfg.viewHeight,
      aggroW: cfg.aggroWidth,
      aggroH: cfg.aggroHeight,
      spawntime
    });
  };

  const onPreview = () => {
    if (!cfg || !huntMeta?.edited) {
      rebuildRoute();
      return;
    }
    requestHuntRescatter({
      mode,
      boxSize: layoutSize,
      lureLength: lure,
      viewW: cfg.viewWidth,
      viewH: cfg.viewHeight,
      aggroW: cfg.aggroWidth,
      aggroH: cfg.aggroHeight
    });
  };

  const areaSize = huntArea ? `${huntArea.maxX - huntArea.minX + 1} x ${huntArea.maxY - huntArea.minY + 1}` : null;
  const unit = mode === 'rotation' ? 'per lure' : mode === 'box' ? 'per box' : 'per screen';
  const canGenerate = !!huntMeta && huntMeta.points > 0 && total > 0;
  const previewHint = !canPreview
    ? zoneId != null
      ? 'Paint the zone first'
      : 'Select an area first'
    : huntMeta?.edited
      ? 'Scatter the monsters again and keep your route.'
      : huntMeta
        ? 'Rebuild the route and scatter again.'
        : 'Draw the route and scatter the monsters. Nothing is written to the map yet.';
  const generateHint =
    total === 0
      ? 'Add a creature first'
      : !huntMeta
        ? 'Preview the hunt first'
        : zoneId != null
          ? "Write the monsters to the map, replacing the zone's current ones. NPCs stay. Ctrl+Z undoes."
          : 'Write the monsters to the map. Ctrl+Z undoes.';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Area</SectionLabel>
        <div className="flex gap-1">
          <Select onValueChange={onZone} value={zoneId == null ? RECTANGLE : String(zoneId)}>
            <SelectTrigger className="h-8 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zoneList.map((z) => (
                <SelectItem key={z.id} value={String(z.id)} textValue={customZoneLabel(z, 'Hunt zone')}>
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: customZoneColor(z, z.id) }} />
                    {customZoneLabel(z, 'Hunt zone')}
                    <span className="text-muted-foreground">{plural(tileCounts.get(z.id) ?? 0, 'tile')}</span>
                  </span>
                </SelectItem>
              ))}
              <SelectItem value={RECTANGLE}>Rectangle (no zone)</SelectItem>
            </SelectContent>
          </Select>
          <Hint label="New hunt zone. Hunt zones stay in the editor and never reach the server.">
            <Button size="sm" variant="outline" onClick={newZone} className="h-8 w-8 p-0">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Hint>
        </div>

        {zoneId != null ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border/50 p-1.5">
            <Hint label="Paint the walkable tiles of the hunt on every floor it uses. Tiles you leave out never get monsters.">
              <Button
                size="sm"
                variant={painting ? 'default' : 'outline'}
                onClick={() => (painting ? stopPaint() : startPaint(zoneId))}
              >
                <Brush className="h-3.5 w-3.5" />
                {painting ? 'Done painting' : zoneTiles > 0 ? 'Edit zone tiles' : 'Paint zone tiles'}
              </Button>
            </Hint>
            {painting && (
              <div className="flex gap-1">
                {PAINT_MODES.map((option) => (
                  <Toggle
                    key={option.mode}
                    hint={option.help}
                    active={customZoneMode === option.mode}
                    onClick={() => setCustomZoneMode(option.mode)}
                  >
                    {option.label}
                  </Toggle>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Button
            size="sm"
            variant={huntAreaSelecting ? 'default' : 'outline'}
            className={cn(huntAreaSelecting && 'animate-pulse')}
            onClick={() => {
              if (huntAreaSelecting) setHuntAreaSelecting(false);
              else if (huntArea) requestHuntClear();
              else setHuntAreaSelecting(true);
            }}
          >
            <SquareDashed className="h-3.5 w-3.5" />
            {huntAreaSelecting ? 'Click-drag on the map...' : areaSize ? `Area ${areaSize}` : 'Select area'}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Placement</SectionLabel>
        <div className="flex gap-1 rounded-md border border-border/50 p-0.5">
          {PLACEMENTS.map((option) => (
            <Toggle
              key={option.mode}
              active={mode === option.mode}
              onClick={() => setMode(option.mode)}
              hint={option.help(layoutSize, lure)}
            >
              <option.icon className="h-3 w-3 shrink-0" />
              {option.label}
            </Toggle>
          ))}
        </div>
        {mode === 'rotation' && (
          <Hint label="How many tiles of the route one lure takes. Longer lures spread the monsters further apart.">
            <label className="flex items-center justify-between gap-2 px-0.5 text-[10px] text-muted-foreground">
              Tiles per lure
              <Input
                min={3}
                value={lure}
                type="number"
                className="h-6 w-16 px-1 text-center text-[11px] tabular-nums"
                onChange={(e) => setLureLength(Math.max(3, Number(e.target.value) | 0))}
              />
            </label>
          </Hint>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <SectionLabel>Monsters</SectionLabel>
          {huntMonsters.length > 0 && (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {total} {unit}
            </span>
          )}
        </div>
        {allMonsters.length === 0 ? (
          <span className="rounded-md border border-dashed border-border/50 px-2 py-2 text-center text-[11px] text-muted-foreground">
            No creatures loaded for this map.
          </span>
        ) : (
          <CreatureSelect options={pickable} onPick={addMonster} placeholder="Add creature..." />
        )}
        {huntMonsters.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5 rounded-md border border-border/50 p-1.5">
            {huntMonsters.map((m) => (
              <div
                key={m.name}
                className="group relative flex flex-col items-center gap-1 rounded-md border border-border/50 bg-muted/20 p-1.5"
              >
                <Hint label={`Remove ${m.name}`}>
                  <button
                    onClick={() => removeMonster(m.name)}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground group-hover:flex"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Hint>
                <CreatureImage size={36} monster={m} />
                <Hint label={m.name}>
                  <span className="w-full truncate text-center text-[10px] text-foreground">{m.name}</span>
                </Hint>
                <Hint label={`${m.name} ${unit}`}>
                  <label className="flex w-full items-center gap-1 text-[9px] text-muted-foreground">
                    Qty
                    <Input
                      min={0}
                      type="number"
                      value={m.count}
                      className="h-6 px-1 text-center text-[11px] tabular-nums"
                      onChange={(e) => patchMonster(m.name, { count: Math.max(0, Number(e.target.value) | 0) })}
                    />
                  </label>
                </Hint>
                <Hint label={`${m.name} respawn in seconds`}>
                  <label className="flex w-full items-center gap-1 text-[9px] text-muted-foreground">
                    Resp
                    <Input
                      min={1}
                      type="number"
                      value={m.spawntime}
                      className="h-6 px-1 text-center text-[11px] tabular-nums"
                      onChange={(e) => patchMonster(m.name, { spawntime: Math.max(1, Number(e.target.value) | 0) })}
                    />
                  </label>
                </Hint>
              </div>
            ))}
          </div>
        )}
        {huntMonsters.length > 1 && (
          <label className="flex items-center justify-between gap-2 px-0.5 text-[10px] text-muted-foreground">
            Respawn for all (s)
            <Input
              min={1}
              type="number"
              value={spawntime}
              className="h-6 w-16 px-1 text-center text-[11px] tabular-nums"
              onChange={(e) => applySpawntime(Math.max(1, Number(e.target.value) | 0))}
            />
          </label>
        )}
      </div>

      <div className="flex gap-1.5">
        <Hint label={previewHint}>
          <span className="flex flex-1">
            <Button size="sm" variant="outline" className="flex-1" onClick={onPreview} disabled={!canPreview}>
              <Route className="h-3.5 w-3.5" />
              {huntMeta ? 'Re-roll' : 'Preview'}
            </Button>
          </span>
        </Hint>
        <Hint label={cfg ? `Show the ${cfg.viewWidth}x${cfg.viewHeight} player screen on each box point` : ''}>
          <span className="flex">
            <Button
              size="sm"
              onClick={() => setShowView((v) => !v)}
              variant={showView ? 'default' : 'outline'}
              disabled={!huntMeta || huntMeta.points === 0}
            >
              <Eye className="h-3.5 w-3.5" />
              View
            </Button>
          </span>
        </Hint>
      </div>

      {huntMeta && (
        <div className="flex gap-1.5">
          <Hint label="Click any walkable tile to add a route point. Drag a point to move it, right-click to remove it. The route keeps your order. Change floors to edit each floor's route.">
            <span className="flex flex-1">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => setRouteAdding((v) => !v)}
                variant={routeAdding ? 'default' : 'outline'}
              >
                <MapPin className="h-3.5 w-3.5" />
                Edit route
              </Button>
            </span>
          </Hint>
          {huntMeta.edited && (
            <Hint label="Throw away your edits and go back to the automatic route on every floor.">
              <span className="flex">
                <Button size="sm" variant="outline" onClick={rebuildRoute}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              </span>
            </Hint>
          )}
        </div>
      )}

      {huntMeta && huntMeta.points === 0 && !huntMeta.edited && <Notice>No walkable tiles in this area.</Notice>}

      {huntMeta && huntMeta.isolated > 0 && (
        <Notice>
          Ignored {plural(huntMeta.isolated, 'unreachable pocket')}: walkable tiles with no path to the rest of the hunt.
        </Notice>
      )}

      {huntMeta && huntMeta.short > 0 && (
        <Notice>
          {plural(huntMeta.short, 'box')} can&apos;t fit {total} monsters on screen. Drag the nearby points to a wider spot or
          right-click to remove them.
        </Notice>
      )}

      {huntMeta && huntMeta.points > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-border/50 p-2 text-[11px]">
          {huntMeta.floors.length > 1 && <Stat label="Floors" value={huntMeta.floors.join(', ')} />}
          {mode === 'rotation' ? (
            <>
              <Stat label="Lures per lap" value={huntMeta.lures} />
              <Stat label="Lap length" value={`${huntMeta.steps} tiles`} />
            </>
          ) : (
            <Stat label="Boxes" value={huntMeta.points} />
          )}
          <Stat label="Monsters" value={huntMeta.monsters} />
          {huntMeta.monsters > 0 && (
            <Stat label="Density" value={`1 per ${Math.round(huntMeta.walkable / huntMeta.monsters)} tiles`} />
          )}
          {mode !== 'rotation' && <Stat label="Route length" value={`${huntMeta.steps} tiles`} />}
        </div>
      )}

      <Hint label={generateHint}>
        <span className="flex">
          <Button size="sm" className="flex-1" disabled={!canGenerate} onClick={() => requestHuntGenerate()}>
            <Sparkles className="h-3.5 w-3.5" />
            {zoneId != null ? `Generate in zone ${zoneId}` : 'Generate'}
          </Button>
        </span>
      </Hint>

      {zoneId != null && zoneMonsters > 0 && (
        <Hint label={`Remove every monster in zone ${zoneId} on all floors, with their spawn areas. NPCs stay. Ctrl+Z undoes.`}>
          <Button
            size="sm"
            variant="outline"
            className="text-red-400 hover:text-red-300"
            onClick={() => requestHuntDeleteMonsters(zoneId)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete {plural(zoneMonsters, 'monster')}
          </Button>
        </Hint>
      )}
    </div>
  );
};

export default HuntView;
