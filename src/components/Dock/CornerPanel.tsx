import React from 'react';

import Resizer from '~/components/Dock/Resizer';
import { PanelMeta, MapCorner, ResizeSide, CORNER_MARGIN } from '~/domain/dock';
import DockablePanel, { DragHandleProps } from '~/components/Dock/DockablePanel';

interface CornerPanelProps {
  meta: PanelMeta;
  width: number;
  height: number;
  corner: MapCorner;
  guarded?: boolean;
  onResizeEnd?: () => void;
  onResizeStart?: () => void;
  onResize: (side: ResizeSide, dx: number, dy: number) => void;
  children: (handle: DragHandleProps) => React.ReactNode;
}

const HANDLES: Record<MapCorner, { side: ResizeSide; dir: 'x' | 'y' | 'xy' }[]> = {
  'top-left': [
    { side: 'right', dir: 'x' },
    { side: 'bottom', dir: 'y' },
    { side: 'bottom-right', dir: 'xy' }
  ],
  'top-right': [
    { side: 'left', dir: 'x' },
    { side: 'bottom', dir: 'y' },
    { side: 'bottom-left', dir: 'xy' }
  ],
  'bottom-left': [
    { side: 'right', dir: 'x' },
    { side: 'top', dir: 'y' },
    { side: 'top-right', dir: 'xy' }
  ],
  'bottom-right': [
    { side: 'left', dir: 'x' },
    { side: 'top', dir: 'y' },
    { side: 'top-left', dir: 'xy' }
  ]
};

const positionStyle = (corner: MapCorner, width: number, height: number): React.CSSProperties => {
  const m = CORNER_MARGIN;
  if (corner === 'top-left') return { width, height, top: m, left: m };
  if (corner === 'top-right') return { width, height, top: m, right: m };
  if (corner === 'bottom-left') return { width, height, bottom: m, left: m };
  return { width, height, bottom: m, right: m };
};

const CornerPanel = ({
  meta,
  width,
  height,
  corner,
  guarded,
  onResizeEnd,
  onResizeStart,
  onResize,
  children
}: CornerPanelProps) => {
  return (
    <div
      style={positionStyle(corner, width, height)}
      className="absolute z-20 rounded-lg shadow-[0_10px_40px_-5px_rgba(0,0,0,0.65)] ring-1 ring-black/40"
    >
      <DockablePanel meta={meta} guarded={guarded} className="h-full">
        {children}
      </DockablePanel>
      {meta.resizable &&
        HANDLES[corner].map(({ side, dir }) => (
          <Resizer
            dir={dir}
            key={side}
            side={side}
            onResizeEnd={onResizeEnd}
            onResizeStart={onResizeStart}
            onResize={({ dx, dy }) => onResize(side, dx, dy)}
          />
        ))}
    </div>
  );
};

export default CornerPanel;
