import React from 'react';
import { X, Eye, Route, Sparkles, SquareDashed } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { PaletteTileset } from '~/domain/palette';
import { Input } from '~/components/commons/ui/input';
import { Button } from '~/components/commons/ui/button';
import { useTool } from '~/usecase/context/ToolContext';
import { HuntMonster } from '~/usecase/context/ToolContext/types';
import { HuntConfig, loadHuntConfig } from '~/adapter/preferences';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';

import CreatureSelect, { CreatureImage } from './CreatureSelect';

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="px-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{children}</span>
);

const HuntView = ({ creatureTilesets }: { creatureTilesets?: PaletteTileset[] }) => {
  const {
    huntMeta,
    huntArea,
    huntMonsters,
    huntAreaSelecting,
    requestHuntPreview,
    requestHuntRescatter,
    requestHuntGenerate,
    requestHuntClear,
    setHuntAreaSelecting,
    setHuntEditing,
    setHuntView,
    setHuntMonsters
  } = useTool();
  const { spawnTime } = useEditorSettings();
  const [cfg, setCfg] = React.useState<HuntConfig | null>(null);
  const [boxSize, setBoxSize] = React.useState(8);
  const [spawntime, setSpawntime] = React.useState(spawnTime);

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
          spawntime: 60
        });
      }
    }
    return out;
  }, [creatureTilesets]);

  const selectedNames = React.useMemo(() => new Set(huntMonsters.map((m) => m.name)), [huntMonsters]);
  const pickable = React.useMemo(() => allMonsters.filter((m) => !selectedNames.has(m.name)), [allMonsters, selectedNames]);

  const addMonster = (m: HuntMonster) => {
    setHuntMonsters([...huntMonsters, { ...m, spawntime }]);
  };
  const applySpawntime = (v: number) => {
    setSpawntime(v);
    setHuntMonsters(huntMonsters.map((x) => ({ ...x, spawntime: v })));
  };
  const removeMonster = (name: string) => setHuntMonsters(huntMonsters.filter((x) => x.name !== name));
  const setMonsterSpawntime = (name: string, v: number) =>
    setHuntMonsters(huntMonsters.map((x) => (x.name === name ? { ...x, spawntime: v } : x)));
  const [showView, setShowView] = React.useState(false);

  React.useEffect(() => {
    loadHuntConfig()
      .then((c) => {
        setCfg(c);
        setBoxSize(c.boxSize);
      })
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
    setHuntView({ show: showView, w: cfg?.viewWidth ?? 15, h: cfg?.viewHeight ?? 11 });
  }, [showView, cfg, setHuntView]);

  React.useEffect(() => {
    if (!cfg || !huntMeta) return;
    requestHuntRescatter({ boxSize, viewW: cfg.viewWidth, viewH: cfg.viewHeight });
  }, [boxSize]);

  const onPreview = () => {
    if (!cfg || !huntArea) return;
    requestHuntPreview({ area: huntArea, viewW: cfg.viewWidth, viewH: cfg.viewHeight, boxSize, spawntime });
  };

  const areaSize = huntArea ? `${huntArea.maxX - huntArea.minX + 1} x ${huntArea.maxY - huntArea.minY + 1}` : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
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

      <div className="flex flex-col gap-1">
        <SectionLabel>Box size</SectionLabel>
        <Input
          min={1}
          type="number"
          value={boxSize}
          className="tabular-nums"
          onChange={(e) => setBoxSize(Math.max(1, Number(e.target.value) | 0))}
        />
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>Spawntime (s)</SectionLabel>
        <Input
          min={1}
          type="number"
          value={spawntime}
          className="tabular-nums"
          onChange={(e) => applySpawntime(Math.max(1, Number(e.target.value) | 0))}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Monsters {huntMonsters.length > 0 ? `(${huntMonsters.length})` : ''}</SectionLabel>
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
                title={m.name}
                className="group relative flex flex-col items-center gap-1 rounded-md border border-border/50 bg-muted/20 p-1.5"
              >
                <button
                  onClick={() => removeMonster(m.name)}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground group-hover:flex"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                <CreatureImage size={36} monster={m} />
                <Input
                  min={1}
                  type="number"
                  value={m.spawntime}
                  title={`${m.name} spawntime (s)`}
                  className="h-6 px-1 text-center text-[11px] tabular-nums"
                  onChange={(e) => setMonsterSpawntime(m.name, Math.max(1, Number(e.target.value) | 0))}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <Button size="sm" className="mt-1" variant="outline" onClick={onPreview} disabled={!cfg || !huntArea}>
        <Route className="h-3.5 w-3.5" />
        Preview route
      </Button>

      <Button
        size="sm"
        onClick={() => setShowView((v) => !v)}
        variant={showView ? 'default' : 'outline'}
        disabled={!huntMeta || huntMeta.points === 0}
      >
        <Eye className="h-3.5 w-3.5" />
        Player view {cfg ? `(${cfg.viewWidth}x${cfg.viewHeight})` : ''}
      </Button>

      {huntMeta && huntMeta.points === 0 && (
        <div className="rounded-md border border-amber-400/40 bg-amber-400/5 p-2 text-[10px] leading-relaxed text-amber-400/90">
          No walkable tiles in the selected area.
        </div>
      )}

      {huntMeta && huntMeta.points > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-border/50 p-2 text-[11px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Boxes</span>
            <span className="tabular-nums text-foreground">{huntMeta.points}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Route length</span>
            <span className="tabular-nums text-foreground">{huntMeta.steps} tiles</span>
          </div>
        </div>
      )}

      <Button
        size="sm"
        onClick={() => requestHuntGenerate()}
        disabled={!huntMeta || huntMeta.points === 0 || huntMonsters.length === 0}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Generate
      </Button>

      <p className="mt-auto pt-1 text-[10px] leading-relaxed text-muted-foreground">
        Select an area, then Preview to seed a route. Drag a box point to move it, click the line to add one, right-click a point
        to remove it. Spawntime seeds from Preferences - General and applies to every generated spawn. View, aggro and box
        defaults live in Preferences - Hunt.
      </p>
    </div>
  );
};

export default HuntView;
