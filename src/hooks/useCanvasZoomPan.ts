// Phase 4 canvas zoom/pan hook.
//
// VIZN-05: Provides viewport state and mouse handlers for Canvas 2D
// zoom (mouse wheel toward cursor) and pan (click-drag).
// Zoom clamped to [0.5, 20], factor 0.9/1.1 per scroll delta.

import { useCallback, useRef, useState } from 'react';

export interface CanvasViewport {
  zoom: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 20;
const ZOOM_IN_FACTOR = 1.1;
const ZOOM_OUT_FACTOR = 0.9;

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
    // Capture event-derived values before setViewport: native event
    // currentTarget is nulled after dispatch, and React 19 StrictMode
    // re-invokes state updaters — either would throw on e.currentTarget.
    const target = e.currentTarget as HTMLCanvasElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const deltaY = e.deltaY;
    setViewport((vp) => {
      const factor = deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
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
