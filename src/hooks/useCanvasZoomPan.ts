// Phase 4 canvas zoom/pan hook.
//
// VIZN-05: Provides viewport state and mouse handlers for Canvas 2D
// zoom (mouse wheel toward cursor) and pan (click-drag).
// Zoom clamped to [0.5, 20], factor 0.9/1.1 per scroll delta.
//
// Phase 11.1 (D-01..D-04, D-14): wheel events are now rAF-coalesced.
// A high-rate wheel burst (trackpads emit 120Hz / 240Hz) accumulates
// deltaY across a single frame (D-02 sum) with last-wins cursor anchor
// (D-03), then flushes exactly one setViewport per rAF (D-01). The
// useRafCoalesced hook's useEffect cleanup cancels any pending rAF on
// unmount so no setViewport fires on a dead component (D-04).

import { useCallback, useRef, useState } from 'react';
import { useRafCoalesced } from './useRafCoalesced';

export interface CanvasViewport {
  zoom: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
// Phase 11.1 (D-02): ZOOM_OUT_FACTOR drives the exponential curve
// Math.pow(ZOOM_OUT_FACTOR, deltaY/100). A negative deltaY naturally
// yields a factor > 1 (zoom in); a positive deltaY yields < 1 (zoom
// out). The reciprocal constant (1.04) is encoded implicitly via
// Math.pow's sign handling, so we no longer need a separate
// ZOOM_IN_FACTOR const. Preserved the deltaY≈100 → 1.04× matching the
// pre-refactor single-event zoom step.
const ZOOM_OUT_FACTOR = 1 / 1.04;

interface PendingWheel {
  deltaY: number;
  cursorX: number;
  cursorY: number;
}

export function useCanvasZoomPan(initialViewport?: Partial<CanvasViewport>) {
  const [viewport, setViewport] = useState<CanvasViewport>({
    zoom: 1,
    panX: 0,
    panY: 0,
    ...initialViewport,
  });

  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Phase 11.1 — coalesce wheel events through rAF (D-01..D-04).
  // Sum deltaY across all events within a frame (D-02) but keep last-event
  // cursor anchor (D-03). Flush exactly once per rAF in the callback below.
  // Exponential factor (Math.pow(ZOOM_OUT_FACTOR, deltaY/100)) keeps the
  // zoom curve continuous whether 1 or N events were coalesced; matches
  // the pre-refactor curve at deltaY≈100 → 1.04× step. Sign of deltaY
  // alone drives zoom-in vs zoom-out via Math.pow, replacing the previous
  // ZOOM_IN_FACTOR / ZOOM_OUT_FACTOR branch.
  const enqueueWheel = useRafCoalesced<PendingWheel>((p) => {
    setViewport((vp) => {
      const factor = Math.pow(ZOOM_OUT_FACTOR, p.deltaY / 100);
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
      const scale = newZoom / vp.zoom;
      const newPanX = p.cursorX - scale * (p.cursorX - vp.panX);
      const newPanY = p.cursorY - scale * (p.cursorY - vp.panY);
      return { zoom: newZoom, panX: newPanX, panY: newPanY };
    });
  });

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      // Capture event-derived values before the rAF flush: native event
      // currentTarget is nulled after dispatch, and React 19 StrictMode
      // may re-invoke updaters.
      const target = e.currentTarget as HTMLCanvasElement | null;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const deltaY = e.deltaY;
      enqueueWheel((prev) =>
        prev
          ? { deltaY: prev.deltaY + deltaY, cursorX, cursorY } // D-02 sum + D-03 last-wins
          : { deltaY, cursorX, cursorY },
      );
    },
    [enqueueWheel],
  );

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return; // left button only
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setViewport((vp) => ({
      ...vp,
      panX: vp.panX + dx,
      panY: vp.panY + dy,
    }));
  }, []);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => ({
      x: (screenX - viewport.panX) / viewport.zoom,
      y: (screenY - viewport.panY) / viewport.zoom,
    }),
    [viewport.panX, viewport.panY, viewport.zoom],
  );

  return {
    viewport,
    setViewport,
    handlers: { onWheel, onMouseDown, onMouseMove, onMouseUp },
    screenToWorld,
  };
}
