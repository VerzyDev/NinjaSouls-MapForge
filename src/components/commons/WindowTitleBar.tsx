import React from 'react';
import { X, Minus, Square } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const WindowTitleBar = ({ title }: { title: string }) => {
  const win = getCurrentWindow();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    if (e.detail === 2) {
      void win.toggleMaximize();
      return;
    }
    void win.startDragging();
  };
  return (
    <div
      onMouseDown={onDragStart}
      className="flex h-8 flex-shrink-0 items-center border-b border-border/50 bg-toolbar-bg pl-3 pr-0"
    >
      <span className="text-xs font-semibold text-foreground">{title}</span>
      <div className="ml-auto flex items-center">
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
          onClick={() => void win.destroy()}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default WindowTitleBar;
