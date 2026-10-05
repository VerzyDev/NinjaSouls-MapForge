import React from 'react';
import { createPortal } from 'react-dom';
import { X, GripHorizontal } from 'lucide-react';

import { getSetting, setSetting } from '~/adapter/settings';

import { SpawnForm } from '../types';

interface SpawnPropertiesFormProps {
  initial: SpawnForm;
  onSubmit: (form: SpawnForm) => void;
  onCancel: () => void;
}

interface Pos {
  x: number;
  y: number;
}

const POS_KEY = 'spawnPropertiesPos';
const DEFAULT_POS: Pos = { x: 96, y: 96 };
let cachedPos: Pos | null = null;

const SpawnPropertiesForm = ({ initial, onSubmit, onCancel }: SpawnPropertiesFormProps) => {
  const [form, setForm] = React.useState<SpawnForm>(initial);
  const [pos, setPos] = React.useState<Pos>(cachedPos ?? DEFAULT_POS);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<Pos | null>(null);

  React.useEffect(() => setForm(initial), [initial]);

  const clampToView = React.useCallback((p: Pos): Pos => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 200;
    return {
      x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - w)),
      y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - h))
    };
  }, []);

  React.useLayoutEffect(() => {
    setPos((p) => clampToView(p));
  }, [clampToView]);

  React.useEffect(() => {
    if (cachedPos) return;
    let cancelled = false;
    void getSetting<Pos | null>(POS_KEY, null).then((p) => {
      if (p && !cancelled) {
        cachedPos = p;
        setPos(clampToView(p));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clampToView]);

  const field = (key: 'radius' | 'spawntime', value: number) => setForm({ ...form, [key]: Math.max(1, value) });

  const onHeaderDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos(clampToView({ x: ev.clientX - d.x, y: ev.clientY - d.y }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragRef.current = null;
      setPos((p) => {
        cachedPos = p;
        void setSetting(POS_KEY, p);
        return p;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return createPortal(
    <div
      ref={panelRef}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[100] w-60 overflow-hidden rounded-lg border border-border bg-card shadow-island-lg"
    >
      <div
        onMouseDown={onHeaderDown}
        className="flex h-7 cursor-move select-none items-center gap-1.5 border-b border-border/50 bg-secondary/80 px-2"
      >
        <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/60" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Spawn properties</h2>
        <button
          onClick={onCancel}
          className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-item-hover hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <form
        className="flex flex-col gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
        <div className="text-[11px] text-muted-foreground">
          Center {initial.x}, {initial.y}, {initial.z}
        </div>
        <div className="flex gap-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Spawn size
            <input
              min={1}
              type="number"
              value={form.radius}
              onChange={(e) => field('radius', Number(e.target.value))}
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Spawn time (s)
            <input
              min={1}
              type="number"
              value={form.spawntime}
              onChange={(e) => field('spawntime', Number(e.target.value))}
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Cancel
          </button>
          <button type="submit" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/85">
            Apply
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};

export default SpawnPropertiesForm;
