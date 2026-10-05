import { Slider } from '~/components/commons/ui/slider';
import { useTool } from '~/usecase/context/ToolContext';
import { Checkbox } from '~/components/commons/ui/checkbox';

const DEFAULT_PERCENT = 50;

const DoodadThickness = () => {
  const { doodadThickness, setDoodadThickness } = useTool();
  const enabled = doodadThickness !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Checkbox
          checked={enabled}
          className="h-3 w-3"
          onCheckedChange={(v) => setDoodadThickness(v === true ? DEFAULT_PERCENT : null)}
        />
        Custom thickness {enabled ? `${doodadThickness}%` : ''}
      </label>
      <Slider
        min={1}
        step={1}
        max={100}
        disabled={!enabled}
        value={[doodadThickness ?? DEFAULT_PERCENT]}
        onValueChange={([v]) => setDoodadThickness(v)}
      />
    </div>
  );
};

export default DoodadThickness;
