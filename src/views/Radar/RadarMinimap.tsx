// Phase 7 Plan 04 interim minimap — renders graph-node bounding box.
//
// D-04 forced the deletion of `useTreemapLayout`, so this component migrated
// off the squarified rects. It now renders a simple scaled scatter of
// settled graph nodes inside the 160x120 minimap surface. Plan 06 will do
// the full graph-extents + viewport-rect treatment (FMON-05, D-20) — this
// implementation preserves the bottom-right anchoring and the
// `right: isManifestOpen ? 292 : 12` shift from commit e62272d.

import { useRef, useCallback, useMemo } from 'react';
import { useRadarStore } from '../../stores/radarStore';

const MINIMAP_W = 160;
const MINIMAP_H = 120;
const MANIFEST_W = 280;
const PADDING = 4;

export function RadarMinimap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphNodes = useRadarStore((s) => s.graphNodes);
  const viewport = useRadarStore((s) => s.viewport);
  const setViewport = useRadarStore((s) => s.setViewport);
  const isManifestOpen = useRadarStore((s) => s.isManifestOpen);

  // Compute graph bounding box and the map-to-minimap scale factors.
  const { minX, minY, scaleX, scaleY, dots } = useMemo(() => {
    const settled = graphNodes.filter(
      (n) => n.x !== undefined && n.y !== undefined,
    );
    if (settled.length === 0) {
      return {
        minX: 0,
        minY: 0,
        scaleX: 1,
        scaleY: 1,
        dots: [] as Array<{ id: string; left: number; top: number }>,
      };
    }
    let nMinX = Infinity;
    let nMinY = Infinity;
    let nMaxX = -Infinity;
    let nMaxY = -Infinity;
    for (const n of settled) {
      if (n.x! < nMinX) nMinX = n.x!;
      if (n.y! < nMinY) nMinY = n.y!;
      if (n.x! > nMaxX) nMaxX = n.x!;
      if (n.y! > nMaxY) nMaxY = n.y!;
    }
    const worldW = Math.max(1, nMaxX - nMinX);
    const worldH = Math.max(1, nMaxY - nMinY);
    const sX = (MINIMAP_W - PADDING * 2) / worldW;
    const sY = (MINIMAP_H - PADDING * 2) / worldH;
    const dotList = settled.map((n) => ({
      id: n.id,
      left: PADDING + (n.x! - nMinX) * sX,
      top: PADDING + (n.y! - nMinY) * sY,
    }));
    return { minX: nMinX, minY: nMinY, scaleX: sX, scaleY: sY, dots: dotList };
  }, [graphNodes]);

  // Click: pan main viewport so the clicked world position sits at canvas center.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const worldX = (clickX - PADDING) / scaleX + minX;
      const worldY = (clickY - PADDING) / scaleY + minY;
      // Assume ~800x600 canvas for centering; Plan 06 will wire precise.
      const canvasCenterX = 400;
      const canvasCenterY = 300;
      setViewport({
        panX: canvasCenterX - worldX * viewport.zoom,
        panY: canvasCenterY - worldY * viewport.zoom,
      });
    },
    [scaleX, scaleY, minX, minY, setViewport, viewport.zoom],
  );

  if (graphNodes.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-3 border border-outline/20 cursor-crosshair z-40 overflow-hidden transition-[right] duration-200 ease-in-out"
      style={{
        width: MINIMAP_W,
        height: MINIMAP_H,
        right: isManifestOpen ? MANIFEST_W + 12 : 12,
        backgroundColor: 'rgba(14, 14, 14, 0.8)',
      }}
      onClick={handleClick}
      data-testid="radar-minimap"
    >
      {/* Render nodes as 2px dots. Plan 06 will upgrade this to a proper
          graph-extents rendering with viewport indicator. */}
      {dots.map((d) => (
        <div
          key={d.id}
          className="absolute w-[2px] h-[2px] bg-outline-variant/60 pointer-events-none"
          style={{ left: d.left, top: d.top }}
        />
      ))}
      <div
        className="absolute border border-white/40 pointer-events-none"
        style={{ left: 0, top: 0, width: MINIMAP_W, height: MINIMAP_H }}
        data-testid="minimap-viewport-indicator"
      />
    </div>
  );
}
