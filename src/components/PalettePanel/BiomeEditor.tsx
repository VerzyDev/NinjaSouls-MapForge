import React from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

import { BiomeDef } from '~/domain/biome';
import { Input } from '~/components/commons/ui/input';
import { Button } from '~/components/commons/ui/button';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { saveBiomes, BrushOption, loadBiomeDefs, loadBrushOptions } from '~/adapter/biomes';

import BrushSelect from './BrushSelect';

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="px-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{children}</span>
);

const BiomeEditor = ({ onClose }: { onClose: () => void }) => {
  const { dataDir } = useAssetsBundle();
  const [defs, setDefs] = React.useState<BiomeDef[]>([]);
  const [options, setOptions] = React.useState<BrushOption[]>([]);
  const [idx, setIdx] = React.useState(0);
  const loadedRef = React.useRef(false);
  const dirtyRef = React.useRef(false);
  const defsRef = React.useRef<BiomeDef[]>([]);
  defsRef.current = defs;

  React.useEffect(
    () => () => {
      if (loadedRef.current && dirtyRef.current) {
        saveBiomes(defsRef.current, dataDir).catch((err) => console.error('Failed to save biomes', err));
      }
    },
    [dataDir]
  );

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([loadBiomeDefs(dataDir), loadBrushOptions(dataDir)])
      .then(([d, o]) => {
        if (cancelled) return;
        setDefs(d);
        setOptions(o);
        loadedRef.current = true;
      })
      .catch((err) => console.error('Failed to load biome editor data', err));
    return () => {
      cancelled = true;
    };
  }, [dataDir]);

  React.useEffect(() => {
    if (!loadedRef.current || !dirtyRef.current) return;
    const t = setTimeout(() => {
      saveBiomes(defs, dataDir).catch((err) => console.error('Failed to save biomes', err));
    }, 400);
    return () => clearTimeout(t);
  }, [defs, dataDir]);

  const groundOptions = React.useMemo(() => options.filter((o) => o.kind === 'ground'), [options]);

  const current = defs[idx] ?? null;
  const patch = (next: Partial<BiomeDef>) => {
    dirtyRef.current = true;
    setDefs((prev) => prev.map((b, i) => (i === idx ? { ...b, ...next } : b)));
  };

  const addBiome = () => {
    dirtyRef.current = true;
    const ground = options.find((o) => o.kind === 'ground')?.name ?? '';
    setDefs((prev) => [...prev, { name: `Biome ${prev.length + 1}`, ground, blotches: [], scatters: [] }]);
    setIdx(defs.length);
  };

  const deleteBiome = () => {
    dirtyRef.current = true;
    setDefs((prev) => prev.filter((_, i) => i !== idx));
    setIdx((i) => Math.max(0, i - 1));
  };

  const setScatter = (j: number, next: Partial<BiomeDef['scatters'][number]>) =>
    patch({ scatters: current!.scatters.map((s, i) => (i === j ? { ...s, ...next } : s)) });

  const addScatter = () => patch({ scatters: [...current!.scatters, { brush: '', chance: 10, layer: 'low', cluster: false }] });
  const removeScatter = (j: number) => patch({ scatters: current!.scatters.filter((_, i) => i !== j) });

  const setBlotch = (j: number, next: Partial<BiomeDef['blotches'][number]>) =>
    patch({ blotches: current!.blotches.map((b, i) => (i === j ? { ...b, ...next } : b)) });
  const addBlotch = () => patch({ blotches: [...current!.blotches, { brush: groundOptions[0]?.name ?? '', intensity: 0.5 }] });
  const removeBlotch = (j: number) => patch({ blotches: current!.blotches.filter((_, i) => i !== j) });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Edit biomes</span>
        <button title="Back" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <select
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground"
        >
          {defs.length === 0 && <option value={0}>No biomes</option>}
          {defs.map((b, i) => (
            <option key={i} value={i}>
              {b.name}
            </option>
          ))}
        </select>
        <Button size="icon" variant="outline" title="Add biome" onClick={addBiome} className="h-8 w-8 shrink-0">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          disabled={!current}
          title="Delete biome"
          onClick={deleteBiome}
          className="h-8 w-8 shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {current && (
        <>
          <div className="flex flex-col gap-1">
            <SectionLabel>Name</SectionLabel>
            <Input value={current.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <SectionLabel>Ground</SectionLabel>
            <BrushSelect value={current.ground} options={groundOptions} onChange={(v) => patch({ ground: v })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <SectionLabel>Blotch grounds (optional)</SectionLabel>
              <button onClick={addBlotch} className="text-[10px] text-primary hover:underline">
                + Add
              </button>
            </div>
            {current.blotches.map((b, j) => (
              <div key={j} className="flex items-center gap-1">
                <div className="flex-1">
                  <BrushSelect
                    value={b.brush}
                    placeholder="ground"
                    options={groundOptions}
                    onChange={(v) => setBlotch(j, { brush: v })}
                  />
                </div>
                <button title="Remove" onClick={() => removeBlotch(j)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <SectionLabel>Scatter</SectionLabel>
              <button onClick={addScatter} className="text-[10px] text-primary hover:underline">
                + Add
              </button>
            </div>
            <p className="px-0.5 text-[10px] leading-relaxed text-muted-foreground">
              Low fills walkable groundcover between trees. High is blocking, clustered, with paths kept open. Cluster groups a
              brush into patches instead of spreading evenly.
            </p>
            {current.scatters.map((s, j) => (
              <div key={j} className="flex flex-col gap-1 rounded-md border border-border/50 p-1.5">
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <BrushSelect
                      value={s.brush}
                      options={options}
                      placeholder="brush"
                      onChange={(v) => setScatter(j, { brush: v })}
                    />
                  </div>
                  <button
                    title="Remove"
                    onClick={() => removeScatter(j)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={s.chance}
                    title="Chance %"
                    className="h-7 w-16"
                    onChange={(e) => setScatter(j, { chance: Number(e.target.value) || 0 })}
                  />
                  <select
                    title="Layer"
                    value={s.layer}
                    onChange={(e) => setScatter(j, { layer: e.target.value as 'low' | 'high' })}
                    className="h-7 rounded-md border border-border bg-input px-1.5 text-[11px] text-foreground"
                  >
                    <option value="low">Low</option>
                    <option value="high">High</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                    <Checkbox checked={s.cluster} onCheckedChange={(v) => setScatter(j, { cluster: v === true })} />
                    cluster
                  </label>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default BiomeEditor;
