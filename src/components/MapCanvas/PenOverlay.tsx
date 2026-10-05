import React from 'react';

import { PenHot, PenPoint, PenAnchor } from '~/lib/pen/path';
import { MapCamera } from '~/usecase/hooks/MapCanvas/useMapCamera';

interface PenRefs {
  anchorsRef: React.MutableRefObject<PenAnchor[]>;
  hoverRef: React.MutableRefObject<PenPoint | null>;
  hotRef: React.MutableRefObject<PenHot | null>;
}

const PenOverlay = ({ camera, pen }: { camera: MapCamera; pen: PenRefs }) => {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    let raf = 0;
    const loop = () => {
      force();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const camX = camera.ref.current.x;
  const camY = camera.ref.current.y;
  const zoom = camera.zoomRef.current;
  const sx = (wx: number) => (wx - camX) * zoom;
  const sy = (wy: number) => (wy - camY) * zoom;

  const anchors = pen.anchorsRef.current;
  const hover = pen.hoverRef.current;
  const hot = pen.hotRef.current;
  if (anchors.length === 0) return null;

  let hotPoint: PenPoint | null = null;
  if (hot && hot.index < anchors.length) {
    const a = anchors[hot.index];
    if (hot.type === 'handle')
      hotPoint = hot.handle === 'out' ? { x: a.p.x + a.hOut.x, y: a.p.y + a.hOut.y } : { x: a.p.x + a.hIn.x, y: a.p.y + a.hIn.y };
    else hotPoint = a.p;
  }

  let d = `M ${sx(anchors[0].p.x)} ${sy(anchors[0].p.y)}`;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    d += ` C ${sx(a.p.x + a.hOut.x)} ${sy(a.p.y + a.hOut.y)} ${sx(b.p.x + b.hIn.x)} ${sy(b.p.y + b.hIn.y)} ${sx(b.p.x)} ${sy(b.p.y)}`;
  }

  const last = anchors[anchors.length - 1];

  return (
    <svg className="pointer-events-none absolute left-0 top-0 h-full w-full">
      <path d={d} fill="none" strokeWidth={2} stroke="#38bdf8" />
      {hover && (
        <line
          opacity={0.6}
          strokeWidth={1}
          x2={sx(hover.x)}
          y2={sy(hover.y)}
          stroke="#38bdf8"
          x1={sx(last.p.x)}
          y1={sy(last.p.y)}
          strokeDasharray="4 4"
        />
      )}
      {anchors.map((a, i) => {
        const px = sx(a.p.x);
        const py = sy(a.p.y);
        const hasHandle = a.hOut.x !== 0 || a.hOut.y !== 0;
        return (
          <g key={i}>
            {hasHandle && (
              <>
                <line x1={px} y1={py} strokeWidth={1} stroke="#7dd3fc" x2={sx(a.p.x + a.hOut.x)} y2={sy(a.p.y + a.hOut.y)} />
                <line x1={px} y1={py} strokeWidth={1} stroke="#7dd3fc" x2={sx(a.p.x + a.hIn.x)} y2={sy(a.p.y + a.hIn.y)} />
                <circle r={3} fill="#7dd3fc" cx={sx(a.p.x + a.hOut.x)} cy={sy(a.p.y + a.hOut.y)} />
                <circle r={3} fill="#7dd3fc" cx={sx(a.p.x + a.hIn.x)} cy={sy(a.p.y + a.hIn.y)} />
              </>
            )}
            <rect width={6} height={6} x={px - 3} y={py - 3} stroke="#fff" fill="#0ea5e9" strokeWidth={1} />
          </g>
        );
      })}
      {hotPoint && <circle r={8} fill="none" stroke="#fde047" strokeWidth={2.5} cx={sx(hotPoint.x)} cy={sy(hotPoint.y)} />}
    </svg>
  );
};

export default PenOverlay;
