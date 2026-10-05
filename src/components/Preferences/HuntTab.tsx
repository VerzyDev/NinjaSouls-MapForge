import { HuntConfig } from '~/adapter/preferences';
import { Input } from '~/components/commons/ui/input';

interface HuntTabProps {
  config: HuntConfig;
  onChange: (config: HuntConfig) => void;
}

const NumberRow = ({
  label,
  hint,
  value,
  min = 0,
  onChange
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  onChange: (n: number) => void;
}) => (
  <div className="flex items-center justify-between gap-4">
    <div className="flex flex-col">
      <span className="text-xs font-medium">{label}</span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
    <Input
      min={min}
      type="number"
      value={value}
      className="h-7 w-24 tabular-nums"
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) | 0))}
    />
  </div>
);

const HuntTab = ({ config, onChange }: HuntTabProps) => {
  const set = (patch: Partial<HuntConfig>) => onChange({ ...config, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <NumberRow min={1} label="View width" value={config.viewWidth} onChange={(v) => set({ viewWidth: v })} />
        <NumberRow min={1} label="View height" value={config.viewHeight} onChange={(v) => set({ viewHeight: v })} />
        <NumberRow min={1} label="Aggro width" value={config.aggroWidth} onChange={(v) => set({ aggroWidth: v })} />
        <NumberRow min={1} label="Aggro height" value={config.aggroHeight} onChange={(v) => set({ aggroHeight: v })} />
      </div>
    </div>
  );
};

export default HuntTab;
