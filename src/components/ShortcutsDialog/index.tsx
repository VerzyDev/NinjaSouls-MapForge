import { Button } from '~/components/commons/ui/button';
import { Shortcut, SHORTCUT_GROUPS } from '~/components/ShortcutsDialog/shortcuts';
import { Dialog, DialogTitle, DialogHeader, DialogContent, DialogDescription } from '~/components/commons/ui/dialog';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const Keys = ({ combo }: { combo: string }) => (
  <span className="flex items-center gap-0.5">
    {combo.split('+').map((key, i) => (
      <kbd
        key={i}
        className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-foreground"
      >
        {key}
      </kbd>
    ))}
  </span>
);

const ShortcutRow = ({ keys, label }: Shortcut) => (
  <div className="flex items-center justify-between gap-3 py-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="flex flex-shrink-0 items-center gap-1">
      {keys.map((combo, i) => (
        <span key={combo} className="flex items-center gap-1">
          {i > 0 && <span className="text-[10px] text-muted-foreground/60">or</span>}
          <Keys combo={combo} />
        </span>
      ))}
    </span>
  </div>
);

const ShortcutsDialog = ({ open, onOpenChange }: ShortcutsDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[80vh] max-w-[760px] flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b border-border/50 px-6 py-4">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription className="text-xs">Keyboard and mouse shortcuts available in the editor</DialogDescription>
      </DialogHeader>

      <div className="columns-1 gap-6 overflow-y-auto px-6 py-4 sm:columns-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="mb-5 break-inside-avoid">
            <h3 className="mb-1 text-[10px] uppercase tracking-wide text-primary">{group.title}</h3>
            <div className="divide-y divide-border/40">
              {group.items.map((item) => (
                <ShortcutRow keys={item.keys} label={item.label} key={item.label + item.keys[0]} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="flex items-center justify-end border-t border-border bg-muted/30 px-6 py-3">
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);

export default ShortcutsDialog;
