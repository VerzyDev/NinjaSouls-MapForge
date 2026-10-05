import { X, Plus } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { Hint } from '~/components/commons/ui/tooltip';

export interface MapTabInfo {
  id: string;
  title: string;
  path?: string;
}

interface MapTabsProps {
  activeId: string | null;
  disabled?: boolean;
  tabs: MapTabInfo[];
  dirtyIds: Set<string>;
  onNew: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

const MapTabs = ({ tabs, activeId, dirtyIds, disabled, onNew, onSelect, onClose }: MapTabsProps) => {
  return (
    <div className="flex h-7 flex-shrink-0 items-stretch overflow-x-auto border-b border-border/50 bg-secondary/80">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const unsaved = dirtyIds.has(tab.id) || !tab.path;
        return (
          <div
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'group flex max-w-44 flex-shrink-0 cursor-default items-center gap-2 border-r border-border/50 pl-3 pr-1.5 text-xs',
              isActive ? 'bg-card text-foreground' : 'text-muted-foreground hover:bg-card/40'
            )}
          >
            <span className={cn('truncate', unsaved && 'italic')}>{tab.title}</span>
            <button
              title={unsaved ? 'Unsaved changes - click to close' : 'Close'}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className={cn(
                'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded hover:bg-foreground/15 hover:text-foreground',
                isActive || unsaved ? 'text-muted-foreground' : 'text-transparent group-hover:text-muted-foreground'
              )}
            >
              {unsaved ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-current group-hover:hidden" />
                  <X className="hidden h-3 w-3 group-hover:block" />
                </>
              ) : (
                <X className="h-3 w-3" />
              )}
            </button>
          </div>
        );
      })}

      <Hint side="bottom" label="New map">
        <button
          onClick={onNew}
          disabled={disabled}
          className="flex w-8 flex-shrink-0 items-center justify-center text-muted-foreground hover:bg-card/40 hover:text-foreground disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </Hint>
    </div>
  );
};

export default MapTabs;
