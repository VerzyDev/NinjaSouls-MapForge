import React from 'react';
import { X, Eye, Plus, Brush, Route, Sparkles, SquareDashed } from 'lucide-react';

import { cn } from '~/usecase/classNames';
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
  customZoneColor,
  sortCustomZones,
  nextCustomZoneId,
  emptyMapCustomZones,
  customZoneTileCounts,
  DEFAULT_CUSTOM_ZONE_RANGE
} from '~/domain/customZone';

import CreatureSelect, { CreatureImage } from './CreatureSelect';

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="px-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{children}</span>
);

const Toggle = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={cn(
      'flex-1 rounded px-1.5 py-1 text-[10px]',
      active ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
    )}
  >
    {children}
  </button>
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

const PLACEMENTS: { mode: HuntMode; label: string; help: (n: number, lure: number) => string }[] = [
  {
    mode: 'rotation',
    label: 'Rotation',
    help: (n, lure) =>
      `Walk the loop: every ${lure} tiles of the path have their own ${n} monsters on screen, so you can always pull ${n} and box.`
  },
  {
    mode: 'box',
    label: 'Box spots',
    help: (n) => `Every box point gets its own ${n} monsters on screen, for standing still and boxing.`
  },
  { mode: 'density', label: 'Density', help: (n) => `About ${n} monsters per screen, spread evenly over the route.` }
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface HuntViewProps {
  creatureTilesets?: PaletteTileset[];
  zones: MapCustomZones | null;
  onEditZones: (next: MapCustomZones) => void;
}

const HuntView = ({ creatureTilesets, zones, onEditZones }: HuntViewProps) => {
  const {
    huntMeta,
    huntArea,
    huntMonsters,
    huntAreaSelecting,
    activeTool,
    activeCustomZoneId,
    customZoneMode,
    zoneLayer,
    requestHuntPreview,
    requestHuntRescatter,
    requestHuntGenerate,
    requestHuntClear,
    setHuntAreaSelecting,
    setHuntEditing,
    setHuntView,
    setHuntMonsters,
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
  const [zoneId, setZoneId] = React.useState<number | null>(null);
  const [showView, setShowView] = React.useState(false);
  const zoneList = React.useMemo(() => sortCustomZones(zones?.list ?? []), [zones]);
  const tileCounts = React.useMemo(() => (zones ? customZoneTileCounts(zones) : new Map<number, number>()), [zones]);
  const zoneTiles = zoneId != null ? (tileCounts.get(zoneId) ?? 0) : 0;
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

  React.useEffect(() => {
    setHuntView({ show: showView, w: cfg?.viewWidth ?? 21, h: cfg?.viewHeight ?? 11 });
  }, [showView, cfg, setHuntView]);

  const pickedFirstZone = React.useRef(false);
  React.useEffect(() => {
    if (pickedFirstZone.current || zoneList.length === 0) return;
    pickedFirstZone.current = true;
    setZoneId(zoneList[0].id);
    setZoneLayer('hunt');
  }, [zoneList, setZoneLayer]);

  React.useEffect(() => {
    if (!cfg || !huntMeta) return;
    requestHuntRescatter({ mode, boxSize: layoutSize, lureLength: lure, viewW: cfg.viewWidth, viewH: cfg.viewHeight });
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
  const onPreview = () => {
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
      spawntime
    });
  };

  const areaSize = huntArea ? `${huntArea.maxX - huntArea.minX + 1} x ${huntArea.maxY - huntArea.minY + 1}` : null;
  const placement = PLACEMENTS.find((p) => p.mode === mode)!;
  const unit = mode === 'rotation' ? 'per lure' : mode === 'box' ? 'per box' : 'per screen';
  const groupWord = mode === 'rotation' ? 'lure' : 'box';

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
                <SelectItem key={z.id} value={String(z.id)} textValue={`Hunt zone ${z.id}`}>
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: customZoneColor(z, z.id) }} />
                    Hunt zone {z.id}
                    <span className="text-muted-foreground">{plural(tileCounts.get(z.id) ?? 0, 'tile')}</span>
                  </span>
                </SelectItem>
              ))}
              <SelectItem value={RECTANGLE}>Rectangle (no zone)</SelectItem>
            </SelectContent>
          </Select>
          <Hint label="New hunt zone">
            <Button size="sm" variant="outline" onClick={newZone} className="h-8 w-8 p-0">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Hint>
        </div>

        {zoneId != null ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border/50 p-1.5">
            <Button
              size="sm"
              variant={painting ? 'default' : 'outline'}
              onClick={() => (painting ? stopPaint() : startPaint(zoneId))}
            >
              <Brush className="h-3.5 w-3.5" />
              {painting ? 'Done painting' : zoneTiles > 0 ? 'Edit zone tiles' : 'Paint zone tiles'}
            </Button>
            {painting && (
              <>
                <div className="flex gap-1">
                  {PAINT_MODES.map((option) => (
                    <Toggle
                      key={option.mode}
                      active={customZoneMode === option.mode}
                      onClick={() => setCustomZoneMode(option.mode)}
                    >
                      {option.label}
                    </Toggle>
                  ))}
                </div>
                <span className="px-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {PAINT_MODES.find((o) => o.mode === customZoneMode)?.help}
                </span>
              </>
            )}
            {!painting && zoneTiles === 0 && (
              <span className="px-0.5 text-[10px] leading-relaxed text-muted-foreground">
                This zone is empty. Paint the walkable tiles of the hunt; tiles you leave out never get monsters.
              </span>
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
            <Toggle key={option.mode} active={mode === option.mode} onClick={() => setMode(option.mode)}>
              {option.label}
            </Toggle>
          ))}
        </div>
        <span className="px-0.5 text-[10px] leading-relaxed text-muted-foreground">{placement.help(layoutSize, lure)}</span>
        {mode === 'rotation' && (
          <label className="flex items-center justify-between gap-2 px-0.5 text-[10px] text-muted-foreground">
            Walk per lure (tiles)
            <Input
              min={3}
              value={lure}
              type="number"
              className="h-6 w-16 px-1 text-center text-[11px] tabular-nums"
              onChange={(e) => setLureLength(Math.max(3, Number(e.target.value) | 0))}
            />
          </label>
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
                <button
                  title={`Remove ${m.name}`}
                  onClick={() => removeMonster(m.name)}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground group-hover:flex"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                <CreatureImage size={36} monster={m} />
                <span title={m.name} className="w-full truncate text-center text-[10px] text-foreground">
                  {m.name}
                </span>
                <label title={`${m.name} ${unit}`} className="flex w-full items-center gap-1 text-[9px] text-muted-foreground">
                  Qty
                  <Input
                    min={0}
                    type="number"
                    value={m.count}
                    className="h-6 px-1 text-center text-[11px] tabular-nums"
                    onChange={(e) => patchMonster(m.name, { count: Math.max(0, Number(e.target.value) | 0) })}
                  />
                </label>
                <label
                  title={`${m.name} respawn in seconds`}
                  className="flex w-full items-center gap-1 text-[9px] text-muted-foreground"
                >
                  Resp
                  <Input
                    min={1}
                    type="number"
                    value={m.spawntime}
                    className="h-6 px-1 text-center text-[11px] tabular-nums"
                    onChange={(e) => patchMonster(m.name, { spawntime: Math.max(1, Number(e.target.value) | 0) })}
                  />
                </label>
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
        <Button size="sm" variant="outline" className="flex-1" onClick={onPreview} disabled={!canPreview}>
          <Route className="h-3.5 w-3.5" />
          {huntMeta ? 'Re-roll' : 'Preview'}
        </Button>
        <Hint label={cfg ? `Show the ${cfg.viewWidth}x${cfg.viewHeight} player screen on each box point` : ''}>
          <Button
            size="sm"
            onClick={() => setShowView((v) => !v)}
            variant={showView ? 'default' : 'outline'}
            disabled={!huntMeta || huntMeta.points === 0}
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </Button>
        </Hint>
      </div>

      {huntMeta && huntMeta.points === 0 && <Notice>No walkable tiles in this area.</Notice>}

      {huntMeta && huntMeta.isolated > 0 && (
        <Notice>
          Ignored {plural(huntMeta.isolated, 'unreachable pocket')}: walkable tiles with no path to the rest of the hunt.
        </Notice>
      )}

      {huntMeta && huntMeta.short > 0 && (
        <Notice>
          {plural(huntMeta.short, groupWord)} can&apos;t fit {total} monsters on screen. Drag the nearby points to a wider spot or
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

      <Button size="sm" onClick={() => requestHuntGenerate()} disabled={!huntMeta || huntMeta.points === 0 || total === 0}>
        <Sparkles className="h-3.5 w-3.5" />
        {zoneId != null ? `Generate in zone ${zoneId}` : 'Generate'}
      </Button>

      <p className="mt-auto pt-1 text-[10px] leading-relaxed text-muted-foreground">
        A zone covers every floor you painted; change floors to see and edit each route. Drag a box point to move it, click the
        route to add one, right-click to remove. Generating replaces the zone&apos;s monsters (NPCs stay); Ctrl+Z undoes. Hunt
        zones never reach the server.
      </p>
    </div>
  );
};

export default HuntView;
