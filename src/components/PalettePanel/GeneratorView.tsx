import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Dices, Sparkles } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { ResolvedBiome } from '~/domain/biome';
import { PaletteTileset } from '~/domain/palette';
import { Input } from '~/components/commons/ui/input';
import { resolveMountain } from '~/adapter/mountains';
import { useTool } from '~/usecase/context/ToolContext';
import { Button } from '~/components/commons/ui/button';
import { Slider } from '~/components/commons/ui/slider';
import { getSetting, setSetting } from '~/adapter/settings';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { loadBiomes, BrushOption, loadBrushOptions } from '~/adapter/biomes';

import HuntView from './HuntView';
import BrushImage from './BrushImage';
import BiomeEditor from './BiomeEditor';
import BrushSelect from './BrushSelect';

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="px-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{children}</span>
);

const SeedField = ({ seed, onSeed }: { seed: number; onSeed: (n: number) => void }) => (
  <div className="flex flex-col gap-1">
    <SectionLabel>Seed</SectionLabel>
    <div className="flex items-center gap-1.5">
      <Input value={seed} type="number" className="flex-1" onChange={(e) => onSeed(Number(e.target.value) | 0)} />
      <Button
        size="icon"
        variant="outline"
        title="Randomize seed"
        className="h-8 w-8 shrink-0"
        onClick={() => onSeed(Math.floor(Math.random() * 1_000_000))}
      >
        <Dices className="h-3.5 w-3.5" />
      </Button>
    </div>
  </div>
);

const DensityField = ({ density, onDensity }: { density: number; onDensity: (n: number) => void }) => (
  <div className="flex flex-col gap-1.5">
    <SectionLabel>Density {Math.round(density * 100)}%</SectionLabel>
    <Slider max={2} min={0.1} step={0.05} value={[density]} onValueChange={([v]) => onDensity(v)} />
  </div>
);

const GeneratorPanel = () => {
  const { dataDir } = useAssetsBundle();
  const { requestGenerate, generationProgress, setGenerationProgress } = useTool();
  const busy = generationProgress != null;
  const [biomes, setBiomes] = React.useState<ResolvedBiome[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [seed, setSeed] = React.useState(1);
  const [density, setDensity] = React.useState(1);
  const [patchSize, setPatchSize] = React.useState(0.5);
  const [blotches, setBlotches] = React.useState(false);
  const [blotchIntensity, setBlotchIntensity] = React.useState<Record<string, number>>({});
  const [editing, setEditing] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  const [brushOptions, setBrushOptions] = React.useState<BrushOption[]>([]);
  const [mountainsOn, setMountainsOn] = React.useState(false);
  const [mountainName, setMountainName] = React.useState('');
  const [steps, setSteps] = React.useState(3);
  const [roughness, setRoughness] = React.useState(0.4);
  const [mountainDensity, setMountainDensity] = React.useState(1);
  const [stairs, setStairs] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    loadBiomes(dataDir)
      .then((list) => {
        if (cancelled) return;
        setBiomes(list);
        setSelected((s) => (s.size ? s : new Set(list[0] ? [list[0].name] : [])));
      })
      .catch((err) => console.error('Failed to load biomes', err));
    loadBrushOptions(dataDir)
      .then((list) => {
        if (cancelled) return;
        setBrushOptions(list);
        const grounds = list.filter((o) => o.kind === 'ground');
        setMountainName((n) => n || grounds.find((o) => o.name === 'mountain')?.name || grounds[0]?.name || '');
      })
      .catch((err) => console.error('Failed to load brushes', err));
    return () => {
      cancelled = true;
    };
  }, [dataDir, reloadKey]);

  const chosen = biomes.filter((b) => selected.has(b.name));
  const canBlotch = chosen.some((b) => b.blotches.length > 0);
  const bkey = (name: string, i: number) => `${name} ${i}`;
  const applyIntensity = (b: ResolvedBiome): ResolvedBiome => ({
    ...b,
    blotches: b.blotches.map((bl, i) => ({ ...bl, intensity: blotchIntensity[bkey(b.name, i)] ?? bl.intensity }))
  });
  const groundOptions = React.useMemo(() => brushOptions.filter((o) => o.kind === 'ground'), [brushOptions]);
  const hasStairs = brushOptions.some((o) => o.name === 'stairs');

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const onGenerate = async () => {
    if (selected.size === 0 || busy) return;
    setGenerationProgress('Preparing...');
    await invoke('load_materials', { dataDir }).catch((err) => console.error('load_materials failed', err));
    const [freshBiomes, freshBrushes] = await Promise.all([
      loadBiomes(dataDir).catch((err) => {
        console.error('Failed to reload biomes', err);
        return biomes;
      }),
      loadBrushOptions(dataDir).catch((err) => {
        console.error('Failed to reload brushes', err);
        return brushOptions;
      })
    ]);
    setBiomes(freshBiomes);
    setBrushOptions(freshBrushes);
    const chosenFresh = freshBiomes.filter((b) => selected.has(b.name));
    if (chosenFresh.length === 0) {
      setGenerationProgress(null);
      return;
    }
    const target = mountainsOn ? resolveMountain(mountainName, freshBrushes) : null;
    const mountainOpts = target ? { seed, density: mountainDensity, steps, scale: 0.03 + roughness * 0.07, stairs } : null;
    const blotchOn = blotches && chosenFresh.some((b) => b.blotches.length > 0);
    requestGenerate(
      blotchOn ? chosenFresh.map(applyIntensity) : chosenFresh,
      { seed, density, blotches: blotchOn, biomeScale: 0.12 - patchSize * 0.1 },
      target,
      mountainOpts
    );
  };

  if (editing) {
    return (
      <BiomeEditor
        onClose={() => {
          setEditing(false);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <SectionLabel>Biomes</SectionLabel>
          <button onClick={() => setEditing(true)} className="text-[10px] text-primary hover:underline">
            Edit
          </button>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-border/50 p-1">
          {biomes.length === 0 ? (
            <span className="px-1 py-2 text-center text-[11px] text-muted-foreground">No biomes</span>
          ) : (
            biomes.map((b) => (
              <label
                key={b.name}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-item-hover',
                  selected.has(b.name) ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <Checkbox checked={selected.has(b.name)} onCheckedChange={() => toggle(b.name)} />
                {b.name}
              </label>
            ))
          )}
        </div>
      </div>

      <SeedField seed={seed} onSeed={setSeed} />
      <DensityField density={density} onDensity={setDensity} />

      {chosen.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Patch size</SectionLabel>
          <Slider max={1} min={0} step={0.05} value={[patchSize]} onValueChange={([v]) => setPatchSize(v)} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 py-0.5">
          <Checkbox checked={blotches} disabled={!canBlotch} onCheckedChange={(v) => setBlotches(v === true)} />
          <span className="text-xs text-foreground">Blotches</span>
        </label>
        {blotches && canBlotch && (
          <div className="flex flex-col gap-2 rounded-md border border-border/50 p-2">
            {chosen.flatMap((b) =>
              b.blotches.map((bl, i) => {
                const k = bkey(b.name, i);
                const val = blotchIntensity[k] ?? bl.intensity;
                const label = chosen.length > 1 ? `${b.name} · ${bl.ref.name}` : bl.ref.name;
                return (
                  <div key={k} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <BrushImage size={20} option={brushOptions.find((o) => o.name === bl.ref.name) ?? null} />
                      <SectionLabel>
                        {label} {Math.round(val * 100)}%
                      </SectionLabel>
                    </div>
                    <Slider
                      max={1}
                      min={0}
                      step={0.05}
                      value={[val]}
                      onValueChange={([v]) => setBlotchIntensity((s) => ({ ...s, [k]: v }))}
                    />
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border/50 p-2">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={mountainsOn}
            disabled={groundOptions.length === 0}
            onCheckedChange={(v) => setMountainsOn(v === true)}
          />
          <span className="text-xs font-medium text-foreground">Mountains</span>
        </label>

        {mountainsOn && (
          <>
            <div className="flex flex-col gap-1">
              <SectionLabel>Ground</SectionLabel>
              <BrushSelect value={mountainName} options={groundOptions} onChange={setMountainName} placeholder="Select ground" />
            </div>

            <div className="flex flex-col gap-1.5">
              <SectionLabel>Height {steps} floors</SectionLabel>
              <Slider max={6} min={1} step={1} value={[steps]} onValueChange={([v]) => setSteps(v)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <SectionLabel>Roughness</SectionLabel>
              <Slider max={1} min={0} step={0.05} value={[roughness]} onValueChange={([v]) => setRoughness(v)} />
            </div>

            <DensityField density={mountainDensity} onDensity={setMountainDensity} />

            <label className="flex items-center gap-2 py-0.5">
              <Checkbox checked={stairs} disabled={!hasStairs} onCheckedChange={(v) => setStairs(v === true)} />
              <span className="text-xs text-foreground">Place stairs</span>
            </label>
          </>
        )}
      </div>

      <Button size="sm" className="mt-1" onClick={onGenerate} disabled={chosen.length === 0 || busy}>
        <Sparkles className="h-3.5 w-3.5" />
        Generate
      </Button>
      {generationProgress && <p className="text-center text-[11px] tabular-nums text-muted-foreground">{generationProgress}</p>}
    </div>
  );
};

type GenMode = 'terrain' | 'hunt';

const ModeToggle = ({ mode, onMode }: { mode: GenMode; onMode: (m: GenMode) => void }) => (
  <div className="flex flex-shrink-0 gap-1 p-2 pb-0">
    {(['terrain', 'hunt'] as GenMode[]).map((m) => (
      <button
        key={m}
        onClick={() => onMode(m)}
        className={cn(
          'flex-1 rounded-md border px-2 py-1 text-xs font-medium capitalize transition-colors',
          mode === m
            ? 'border-primary bg-primary/15 text-foreground'
            : 'border-border/50 text-muted-foreground hover:bg-item-hover'
        )}
      >
        {m}
      </button>
    ))}
  </div>
);

const GEN_MODE_KEY = 'generatorMode';

const GeneratorView = ({ creatureTilesets }: { creatureTilesets?: PaletteTileset[] }) => {
  const [mode, setMode] = React.useState<GenMode>('terrain');
  const restored = React.useRef(false);

  React.useEffect(() => {
    getSetting<GenMode>(GEN_MODE_KEY, 'terrain')
      .then((m) => {
        if (m === 'terrain' || m === 'hunt') setMode(m);
      })
      .catch(() => void 0)
      .finally(() => {
        restored.current = true;
      });
  }, []);

  React.useEffect(() => {
    if (!restored.current) return;
    setSetting(GEN_MODE_KEY, mode).catch(() => void 0);
  }, [mode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ModeToggle mode={mode} onMode={setMode} />
      {mode === 'hunt' ? (
        <HuntView creatureTilesets={creatureTilesets} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <GeneratorPanel />

          <p className="mt-auto pt-1 text-[10px] leading-relaxed text-muted-foreground">
            Select an area on the map, then Generate. Output goes into the selection on the current floor; mountains stack upward
            onto higher floors.
          </p>
        </div>
      )}
    </div>
  );
};

export default GeneratorView;
