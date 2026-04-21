// Phase 4 canvas zoom/pan hook.
//
// VIZN-05: Provides viewport state and mouse handlers for Canvas 2D
// zoom (mouse wheel toward cursor) and pan (click-drag).
// Zoom clamped to [0.5, 20], factor 0.9/1.1 per scroll delta.
//
// Phase 11.1 revision: the rAF wheel coalescer added a full rAF tick of
// pipeline latency (wheel → rAF → setViewport → commit → next rAF →
// paint) which made zoom feel laggier than pre-11.1, even though the
// render itself became cheap after the hull cache (T3) landed. Reverted
// to direct setViewport per wheel event. Exponential factor
// Math.pow(ZOOM_OUT_FACTOR, deltaY/100) is preserved from T1 so the
// curve feels identical between single- and multi-event trackpad ticks.

import { useCallback, useRef, useState } from 'react';

export interface CanvasViewport {
  zoom: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
// Phase 11.1 (D-02 carryover): a negative deltaY yields a factor > 1
// (zoom in); positive deltaY yields < 1 (zoom out). The reciprocal
// constant (1.04) is encoded implicitly via Math.pow's sign handling,
// so we don't need a separate ZOOM_IN_FACTOR. Preserved the deltaY≈100
// → 1.04× step to match the pre-refactor single-event zoom curve.
const ZOOM_OUT_FACTOR = 1 / 1.04;

export function useCanvasZoomPan(initialViewport?: Partial<CanvasViewport>) {
  const [viewport, setViewport] = useState<CanvasViewport>({
    zoom: 1,
    panX: 0,
    panY: 0,
    ...initialViewport,
  });

  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLCanvasElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const deltaY = e.deltaY;
    setViewport((vp) => {
      const factor = Math.pow(ZOOM_OUT_FACTOR, deltaY / 100);
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
      const scale = newZoom / vp.zoom;
      const newPanX = cursorX - scale * (cursorX - vp.panX);
      const newPanY = cursorY - scale * (cursorY - vp.panY);
      return { zoom: newZoom, panX: newPanX, panY: newPanY };
    });
  }, []);

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
