// Phase 4 Plan 05 -- Radar minimap overlay.
//
// Bottom-right corner, 160x120px. Shows full treemap overview with
// white rectangle indicator showing current viewport bounds.
// Click to jump viewport to that position.

import { useRef, useCallback, useMemo } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import {
  buildFileTree,
  computeTreemapLayout,
  graphNodesToTreeEntries,
} from '../../hooks/useTreemapLayout';

const MINIMAP_W = 160;
const MINIMAP_H = 120;
const MANIFEST_W = 280;

export function RadarMinimap() {
  const containerRef = useRef<HTMLDivElement>(null);
  // Phase 7 Plan 03: synthesize treemap entries from graphNodes until
  // Plan 06 rewrites this minimap against the graph bounding box (D-20).
  const graphNodes = useRadarStore((s) => s.graphNodes);
  const viewport = useRadarStore((s) => s.viewport);
  const setViewport = useRadarStore((s) => s.setViewport);
  const isManifestOpen = useRadarStore((s) => s.isManifestOpen);

  // Compute a tiny treemap layout at minimap scale
  const minimapRects = useMemo(() => {
    if (graphNodes.length === 0) return [];
    const entries = graphNodesToTreeEntries(graphNodes);
    const tree = buildFileTree(entries);
    return computeTreemapLayout(tree, MINIMAP_W, MINIMAP_H);
  }, [graphNodes]);

  // Viewport indicator rectangle (what part of the world is currently visible)
  // The main canvas shows world coordinates transformed by zoom and pan.
  // Visible area in world coords: x from -panX/zoom to (canvasW-panX)/zoom
  // We need to map world coords to minimap coords.
  // Assume the world is the same size as the main treemap (which uses canvas size).
  // For the minimap, we scale by minimapW/worldW.
  const canvasW = 800; // approximate main canvas width
  const canvasH = 600;
  const scaleX = MINIMAP_W / canvasW;
  const scaleY = MINIMAP_H / canvasH;

  const viewIndicator = useMemo(() => {
    const worldX0 = -viewport.panX / viewport.zoom;
    const worldY0 = -viewport.panY / viewport.zoom;
    const worldX1 = (canvasW - viewport.panX) / viewport.zoom;
    const worldY1 = (canvasH - viewport.panY) / viewport.zoom;

    return {
      left: Math.max(0, worldX0 * scaleX),
      top: Math.max(0, worldY0 * scaleY),
      width: Math.min(MINIMAP_W, (worldX1 - worldX0) * scaleX),
      height: Math.min(MINIMAP_H, (worldY1 - worldY0) * scaleY),
    };
  }, [viewport, scaleX, scaleY]);

  // Click to jump viewport
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Convert minimap coords to world coords
      const worldX = clickX / scaleX;
      const worldY = clickY / scaleY;

      // Center viewport on this world position
      const newPanX = canvasW / 2 - worldX * viewport.zoom;
      const newPanY = canvasH / 2 - worldY * viewport.zoom;

      setViewport({ panX: newPanX, panY: newPanY });
    },
    [scaleX, scaleY, viewport.zoom, setViewport],
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
      {/* Render tiny treemap rects */}
      {minimapRects
        .filter((r) => !r.isFile)
        .map((r) => (
          <div
            key={r.path}
            className="absolute border border-outline-variant/20"
            style={{
              left: r.x0,
              top: r.y0,
              width: r.x1 - r.x0,
              height: r.y1 - r.y0,
              backgroundColor: 'rgba(19, 19, 19, 0.6)',
            }}
          />
        ))}

      {/* Viewport indicator */}
      <div
        className="absolute border border-white/70 pointer-events-none"
        style={{
          left: viewIndicator.left,
          top: viewIndicator.top,
          width: viewIndicator.width,
          height: viewIndicator.height,
        }}
        data-testid="minimap-viewport-indicator"
      />
    </div>
  );
}
