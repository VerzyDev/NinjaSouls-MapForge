import React from 'react';
import { X, Plus, RotateCcw } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { Button } from '~/components/commons/ui/button';
import { useKeybinds, updateKeybinds } from '~/usecase/keybinds';
import { Shortcut, FIXED_SHORTCUTS } from '~/components/ShortcutsDialog/shortcuts';
import { Dialog, DialogTitle, DialogHeader, DialogContent, DialogDescription } from '~/components/commons/ui/dialog';
import {
  KeybindId,
  comboParts,
  comboFromEvent,
  KEYBIND_GROUPS,
  RESERVED_COMBOS,
  KEYBIND_ACTIONS,
  DEFAULT_KEYBINDS
} from '~/domain/keybinds';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const sameCombos = (a: string[], b: string[]) => a.join('|') === b.join('|');

const labelOf = (id: KeybindId) => KEYBIND_ACTIONS.find((a) => a.id === id)?.label ?? id;

const Keys = ({ combo }: { combo: string }) => (
  <span className="flex items-center gap-0.5">
    {comboParts(combo).map((key, i) => (
      <kbd
        key={i}
        className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-foreground"
      >
        {key}
      </kbd>
    ))}
  </span>
);

const Or = () => <span className="text-[10px] text-muted-foreground/60">or</span>;

const ShortcutRow = ({ keys, label }: Shortcut) => (
  <div className="flex min-h-7 items-center justify-between gap-3 py-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="flex flex-shrink-0 items-center gap-1">
      {keys.map((combo, i) => (
        <span key={combo} className="flex items-center gap-1">
          {i > 0 && <Or />}
          <Keys combo={combo} />
        </span>
      ))}
    </span>
  </div>
);

interface KeybindRowProps {
  label: string;
  combos: string[];
  isDefault: boolean;
  recording: boolean;
  conflicts: (combo: string) => KeybindId[];
  onRecord: () => void;
  onRemove: (combo: string) => void;
  onReset: () => void;
}

const KeybindRow = ({ label, combos, isDefault, recording, conflicts, onRecord, onRemove, onReset }: KeybindRowProps) => (
  <div className="group flex min-h-7 items-center justify-between gap-3 py-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
      {combos.map((combo, i) => {
        const others = conflicts(combo);
        return (
          <span key={combo} className="flex items-center gap-1">
            {i > 0 && <Or />}
            <span
              title={others.length ? `Also bound to: ${others.map(labelOf).join(', ')}` : undefined}
              className={cn('flex items-center gap-0.5 rounded', others.length && 'outline outline-1 outline-amber-500/80')}
            >
              <Keys combo={combo} />
              <button
                title="Remove"
                onClick={() => onRemove(combo)}
                className="hidden text-muted-foreground hover:text-foreground group-hover:block"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </span>
        );
      })}
      {recording ? (
        <span className="rounded border border-primary px-1.5 py-0.5 text-[10px] leading-none text-primary">
          Press keys or a mouse button...
        </span>
      ) : (
        <button
          onClick={onRecord}
          title="Add shortcut"
          className={cn(
            'rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground',
            combos.length ? 'invisible group-hover:visible' : ''
          )}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      <button
        onClick={onReset}
        title="Restore default"
        className={cn(
          'rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground',
          isDefault ? 'hidden' : 'invisible group-hover:visible'
        )}
      >
        <RotateCcw className="h-3 w-3" />
      </button>
    </span>
  </div>
);

const ShortcutsDialog = ({ open, onOpenChange }: ShortcutsDialogProps) => {
  const keybinds = useKeybinds();
  const [recording, setRecording] = React.useState<KeybindId | null>(null);
  const [error, setError] = React.useState('');

  const owners = React.useMemo(() => {
    const map = new Map<string, KeybindId[]>();
    for (const id of Object.keys(keybinds) as KeybindId[]) {
      for (const combo of keybinds[id]) map.set(combo, [...(map.get(combo) ?? []), id]);
    }
    return map;
  }, [keybinds]);

  const set = (id: KeybindId, combos: string[]) => void updateKeybinds({ ...keybinds, [id]: combos });

  const allDefault = (Object.keys(keybinds) as KeybindId[]).every((id) => sameCombos(keybinds[id], DEFAULT_KEYBINDS[id]));

  React.useEffect(() => {
    if (!open) setRecording(null);
    setError('');
  }, [open]);

  React.useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (RESERVED_COMBOS.includes(combo)) {
        setError(`${combo} is reserved by the editor`);
        return;
      }
      setError('');
      setRecording(null);
      if (!keybinds[recording].includes(combo)) set(recording, [...keybinds[recording], combo]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, keybinds]);

  const record = (id: KeybindId) => {
    setError('');
    setRecording(id);
  };

  const groups = [...KEYBIND_GROUPS, 'Mouse'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-[760px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/50 px-6 py-4">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs">
            Hover a shortcut to add, remove or restore keys. Middle and side mouse buttons can be recorded too. Left and right
            click, Tab, Esc, Enter, Space, arrows and WASD are fixed.
          </DialogDescription>
        </DialogHeader>

        <div className="columns-1 gap-6 overflow-y-auto px-6 py-4 sm:columns-2">
          {groups.map((group) => (
            <section key={group} className="mb-5 break-inside-avoid">
              <h3 className="mb-1 text-[10px] uppercase tracking-wide text-primary">{group}</h3>
              <div className="divide-y divide-border/40">
                {KEYBIND_ACTIONS.filter((a) => a.group === group).map(({ id, label }) => (
                  <KeybindRow
                    key={id}
                    label={label}
                    combos={keybinds[id]}
                    onRecord={() => record(id)}
                    recording={recording === id}
                    onReset={() => set(id, [...DEFAULT_KEYBINDS[id]])}
                    isDefault={sameCombos(keybinds[id], DEFAULT_KEYBINDS[id])}
                    conflicts={(combo) => (owners.get(combo) ?? []).filter((o) => o !== id)}
                    onRemove={(combo) =>
                      set(
                        id,
                        keybinds[id].filter((c) => c !== combo)
                      )
                    }
                  />
                ))}
                {(FIXED_SHORTCUTS[group] ?? []).map((item) => (
                  <ShortcutRow keys={item.keys} label={item.label} key={item.label + item.keys[0]} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-3">
          <span className="text-xs text-destructive">{error}</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={allDefault}
              className="h-8 text-xs"
              onClick={() => void updateKeybinds({ ...DEFAULT_KEYBINDS })}
            >
              Restore defaults
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShortcutsDialog;
