import React from 'react';

import { TILE } from '~/components/MapCanvas/constants';
import { MapScene } from '~/usecase/hooks/MapCanvas/useMapScene';
import { MapCamera } from '~/usecase/hooks/MapCanvas/useMapCamera';
import { ReferenceImage } from '~/usecase/context/ToolContext/types';

interface ReferenceOverlayProps {
  scene: MapScene;
  camera: MapCamera;
  image: ReferenceImage;
  onCommit: (patch: Partial<ReferenceImage>) => void;
}

const ReferenceOverlay = ({ scene, camera, image, onCommit }: ReferenceOverlayProps) => {
  React.useEffect(() => {
    scene.refImage.current = {
      src: image.src,
      x: image.x,
      y: image.y,
      tilesWide: image.tilesWide,
      opacity: image.opacity,
      tolerance: image.tolerance,
      visible: image.visible,
      front: image.front
    };
    return () => {
      scene.refImage.current = null;
    };
  }, [image]);

  const drag = (e: React.MouseEvent, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    const live = scene.refImage.current;
    if (!live) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = live.x;
    const originY = live.y;
    const originW = live.tilesWide;

    const move = (ev: MouseEvent) => {
      const unit = TILE * camera.zoomRef.current;
      const dx = (ev.clientX - startX) / unit;
      const dy = (ev.clientY - startY) / unit;
      if (mode === 'move') {
        live.x = ev.altKey ? originX + dx : Math.round(originX + dx);
        live.y = ev.altKey ? originY + dy : Math.round(originY + dy);
      } else {
        const next = originW + dx;
        live.tilesWide = Math.max(1, ev.altKey ? next : Math.round(next));
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onCommit(mode === 'move' ? { x: live.x, y: live.y } : { tilesWide: live.tilesWide });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <>
      <div
        ref={scene.refImageBoxRef}
        style={{ transformOrigin: 'top left' }}
        className="pointer-events-none absolute left-0 top-0 hidden"
      >
        <img
          alt=""
          aria-hidden
          ref={scene.refImageElRef}
          style={{ imageRendering: 'pixelated' }}
          className="block h-auto w-full select-none"
        />
      </div>
      <div
        ref={scene.refImageFrameRef}
        style={{ transformOrigin: 'top left', zIndex: 2 }}
        className="pointer-events-none absolute left-0 top-0 hidden"
      >
        {image.unlocked && (
          <>
            <div
              onMouseDown={(e) => drag(e, 'move')}
              className="pointer-events-auto absolute inset-0 cursor-move border border-dashed border-primary/70"
            />
            <div
              onMouseDown={(e) => drag(e, 'resize')}
              className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-primary-foreground bg-primary shadow"
            />
          </>
        )}
      </div>
    </>
  );
};

export default ReferenceOverlay;
