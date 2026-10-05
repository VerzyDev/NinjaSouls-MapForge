import React from 'react';

import { cn } from '~/usecase/classNames';
import { FinderGroup, FinderFilter } from '~/lib/itemFinder';

interface FilterSidebarProps {
  groups: Array<{ group: FinderGroup; filters: FinderFilter[] }>;
  active: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}

const FilterSidebar = ({ groups, active, onToggle, onClear }: FilterSidebarProps) => (
  <div className="flex w-56 flex-col border-r border-border bg-background/40">
    <div className="flex h-[52px] items-center justify-between border-b border-border px-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground">Filters</span>
        {active.size > 0 && (
          <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-medium tabular-nums text-foreground">
            {active.size}
          </span>
        )}
      </div>
      {active.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
      {groups.map(({ group, filters }) => (
        <div key={group.id} className="space-y-2">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            {group.label}
          </span>
          <div className="flex flex-wrap gap-1">
            {filters.map((filter) => (
              <button
                type="button"
                key={filter.id}
                onClick={() => onToggle(filter.id)}
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[11px] leading-5 transition-colors',
                  active.has(filter.id)
                    ? 'border-primary/70 bg-primary/20 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:bg-item-hover hover:text-foreground'
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default FilterSidebar;
