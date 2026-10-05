import { X, Minus, Square } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

import AppMenu from '~/components/Toolbar/AppMenu';
import { useUpdater } from '~/usecase/hooks/useUpdater';
import { UpdateIndicator } from '~/components/UpdateIndicator';
import { MenuState, MapMenuActions, EditMenuActions, FileMenuActions, WindowMenuActions } from '~/components/Toolbar/types';

interface ToolbarProps {
  state: MenuState;
  file: FileMenuActions;
  edit: EditMenuActions;
  map: MapMenuActions;
  window: WindowMenuActions;
  onAbout: () => void;
  onShortcuts: () => void;
  onStatus: (message: string) => void;
}

const Toolbar = ({ state, file, edit, map, window: windowActions, onAbout, onShortcuts, onStatus }: ToolbarProps) => {
  const win = getCurrentWindow();
  const updater = useUpdater();
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleCheckUpdates = async () => {
    onStatus('Checking for updates...');
    const result = await updater.checkForUpdate();
    if (result === 'up-to-date') onStatus("You're on the latest version");
    else if (result === 'error') onStatus('Could not check for updates');
  };

  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, [role="menuitem"], input')) return;
    if (e.detail === 2) {
      void win.toggleMaximize();
      return;
    }

    const onMove = () => {
      cleanup();
      void win.startDragging();
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', cleanup);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
  };

  return (
    <div
      onMouseDown={onDragStart}
      className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-border/50 bg-toolbar-bg pl-1.5 pr-3"
    >
      <AppMenu
        map={map}
        edit={edit}
        file={file}
        state={state}
        window={windowActions}
        help={{ onAbout, onShortcuts, onCheckUpdates: () => void handleCheckUpdates() }}
      />

      <div onMouseDown={stop} className="ml-auto flex items-center pr-2">
        <UpdateIndicator updater={updater} />
      </div>

      <div className="-mr-3 flex items-center">
        <button
          onMouseDown={stop}
          onClick={() => win.minimize()}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onMouseDown={stop}
          onClick={() => win.toggleMaximize()}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          onMouseDown={stop}
          onClick={file.onRequestExit}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
