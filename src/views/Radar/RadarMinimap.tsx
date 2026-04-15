// Phase 7 Plan 06 — RadarMinimap graph-extents rewrite (D-20, FMON-05).
//
// Renders the bounding box of all settled graph nodes scaled into a 160×120px
// Canvas 2D surface with 2px padding. Shows the main canvas' viewport as a
// 1px primary-colored rectangle, and pans the main canvas when clicked.
//
// PRESERVES commit e62272d: shifts right=292px when the manifest panel is
// open, right=12px when closed, with a 200ms ease-in-out transition.
//
// The previous `<div>`-per-dot implementation ballooned the DOM at 10k+ nodes
// and couldn't render a crisp viewport rectangle stroke. Canvas 2D matches the
// main radar's render path and keeps the minimap at one DOM element regardless
// of graph size.

import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { heatTintIfActive, HEAT_BASELINE } from './HeatMapOverlay';

// UI-SPEC §Sizing minimap (160×120px, 2px padding, 2px node dot).
const MINIMAP_WIDTH = 160;
const MINIMAP_HEIGHT = 120;
const MINIMAP_PADDING = 2;
const NODE_DOT_SIZE = 2;

// UI-SPEC §Layout §Manifest shift — preserves commit e62272d.
// 280px panel width + 12px gutter = 292px right offset when open.
export const MANIFEST_OPEN_RIGHT = 292;
export const MANIFEST_CLOSED_RIGHT = 12;

// UI-SPEC §Color.
const VIEWPORT_STROKE = '#8eff71'; // primary
const BACKGROUND = 'rgba(32, 31, 31, 0.8)'; // surface-container-high at 80%

export interface RadarMinimapProps {
  canvasWidth: number;
  canvasHeight: number;
}

export function RadarMinimap({ canvasWidth, canvasHeight }: RadarMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const graphNodes = useRadarStore((s) => s.graphNodes);
  const viewport = useRadarStore((s) => s.viewport);
  const isManifestOpen = useRadarStore((s) => s.isManifestOpen);
  const heatMapEnabled = useRadarStore((s) => s.heatMapEnabled);
  const contentionScores = useRadarStore((s) => s.contentionScores);
  const setViewport = useRadarStore((s) => s.setViewport);

  // Compute bounding box once per node mutation.
  const bbox = useMemo(() => {
    if (graphNodes.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of graphNodes) {
      if (n.x === undefined || n.y === undefined) continue;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    if (minX === Infinity) return null;
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    return { minX, minY, maxX, maxY, w, h };
  }, [graphNodes]);

  // Render the minimap on every relevant state mutation.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_WIDTH * dpr;
    canvas.height = MINIMAP_HEIGHT * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    if (!bbox) return;

    const innerW = MINIMAP_WIDTH - 2 * MINIMAP_PADDING;
    const innerH = MINIMAP_HEIGHT - 2 * MINIMAP_PADDING;
    const sx = innerW / bbox.w;
    const sy = innerH / bbox.h;

    // Draw node dots — each 2×2 px, tinted if heat map enabled and the file
    // has an active contention score.
    for (const n of graphNodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const px = MINIMAP_PADDING + (n.x - bbox.minX) * sx;
      const py = MINIMAP_PADDING + (n.y - bbox.minY) * sy;
      const score = contentionScores.get(n.id) ?? 0;
      const tint = heatTintIfActive(score, heatMapEnabled);
      // When no heat, keep dots subtle (outline-variant) so the viewport
      // rectangle remains the dominant overlay.
      ctx.fillStyle = tint === HEAT_BASELINE ? 'rgba(73, 72, 71, 0.6)' : tint;
      ctx.fillRect(px, py, NODE_DOT_SIZE, NODE_DOT_SIZE);
    }

    // Viewport rectangle — map the currently-visible world region onto the
    // minimap. Main canvas uses screen = world * zoom + pan, so the visible
    // world rect is [-pan/zoom, (canvas - pan)/zoom].
    const wMinX = -viewport.panX / viewport.zoom;
    const wMaxX = (canvasWidth - viewport.panX) / viewport.zoom;
    const wMinY = -viewport.panY / viewport.zoom;
    const wMaxY = (canvasHeight - viewport.panY) / viewport.zoom;
    const rx = MINIMAP_PADDING + (wMinX - bbox.minX) * sx;
    const ry = MINIMAP_PADDING + (wMinY - bbox.minY) * sy;
    const rw = (wMaxX - wMinX) * sx;
    const rh = (wMaxY - wMinY) * sy;
    ctx.strokeStyle = VIEWPORT_STROKE;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);
  }, [
    bbox,
    graphNodes,
    viewport,
    heatMapEnabled,
    contentionScores,
    canvasWidth,
    canvasHeight,
  ]);

  // Click-to-pan: project the click position back to world coords and center
  // the main canvas on it.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!bbox) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // jsdom often returns zero-sized rects; fall back to the declared
      // minimap size so tests can exercise the click handler.
      const rectW = rect.width || MINIMAP_WIDTH;
      const rectH = rect.height || MINIMAP_HEIGHT;
      const cx = ((e.clientX - rect.left) * MINIMAP_WIDTH) / rectW;
      const cy = ((e.clientY - rect.top) * MINIMAP_HEIGHT) / rectH;
      const innerW = MINIMAP_WIDTH - 2 * MINIMAP_PADDING;
      const innerH = MINIMAP_HEIGHT - 2 * MINIMAP_PADDING;
      const worldX = bbox.minX + ((cx - MINIMAP_PADDING) / innerW) * bbox.w;
      const worldY = bbox.minY + ((cy - MINIMAP_PADDING) / innerH) * bbox.h;
      setViewport({
        panX: canvasWidth / 2 - worldX * viewport.zoom,
        panY: canvasHeight / 2 - worldY * viewport.zoom,
      });
    },
    [bbox, canvasWidth, canvasHeight, viewport.zoom, setViewport],
  );

  return (
    <div
      ref={containerRef}
      data-testid="radar-minimap"
      className="absolute border border-outline/20 overflow-hidden z-40 transition-[right] duration-200 ease-in-out"
      style={{
        bottom: 12,
        right: isManifestOpen ? MANIFEST_OPEN_RIGHT : MANIFEST_CLOSED_RIGHT,
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{
          width: MINIMAP_WIDTH,
          height: MINIMAP_HEIGHT,
          display: 'block',
          cursor: 'crosshair',
        }}
      />
    </div>
  );
}
