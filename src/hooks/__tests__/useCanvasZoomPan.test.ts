// useCanvasZoomPan — direct wheel handler tests (post-revert of rAF coalescer).
// Verifies:
//   1. Viewport stays finite across aggressive wheel deltas (no NaN/Infinity).
//   2. Clamp to [MIN_ZOOM, MAX_ZOOM] holds even for very large |deltaY|.
//   3. Cursor-anchored pan remains coherent at extreme zoom.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasZoomPan } from '../useCanvasZoomPan';

function makeWheelEvent(deltaY: number, cx = 50, cy = 50): WheelEvent {
  const fakeTarget = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
  } as unknown as HTMLCanvasElement;
  return {
    deltaY,
    clientX: cx,
    clientY: cy,
    currentTarget: fakeTarget,
    preventDefault: vi.fn(),
  } as unknown as WheelEvent;
}

describe('useCanvasZoomPan — direct wheel (post-revert)', () => {
  it('one ordinary zoom-in event yields finite viewport', () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    act(() => {
      result.current.handlers.onWheel(makeWheelEvent(-100, 50, 50));
    });
    const vp = result.current.viewport;
    expect(Number.isFinite(vp.zoom)).toBe(true);
    expect(Number.isFinite(vp.panX)).toBe(true);
    expect(Number.isFinite(vp.panY)).toBe(true);
    expect(vp.zoom).toBeGreaterThan(1);
  });

  it('aggressive zoom-in (deltaY=-10000) stays inside the zoom clamp', () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    act(() => {
      result.current.handlers.onWheel(makeWheelEvent(-10000, 50, 50));
    });
    const vp = result.current.viewport;
    expect(Number.isFinite(vp.zoom)).toBe(true);
    expect(vp.zoom).toBeLessThanOrEqual(20);
    expect(vp.zoom).toBeGreaterThanOrEqual(0.05);
  });

  it('repeated aggressive zoom-in events never corrupt to NaN/Infinity', () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    for (let i = 0; i < 20; i++) {
      act(() => {
        result.current.handlers.onWheel(makeWheelEvent(-5000, 50, 50));
      });
    }
    const vp = result.current.viewport;
    expect(Number.isFinite(vp.zoom)).toBe(true);
    expect(Number.isFinite(vp.panX)).toBe(true);
    expect(Number.isFinite(vp.panY)).toBe(true);
    expect(vp.zoom).toBeLessThanOrEqual(20);
  });

  it('zoom-in then pan recovers a valid pan delta', () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    act(() => {
      result.current.handlers.onWheel(makeWheelEvent(-10000, 50, 50));
    });
    const zoomedVp = result.current.viewport;
    act(() => {
      result.current.handlers.onMouseDown({ button: 0, clientX: 0, clientY: 0 } as unknown as MouseEvent);
      result.current.handlers.onMouseMove({ clientX: 10, clientY: 10 } as unknown as MouseEvent);
    });
    const pannedVp = result.current.viewport;
    expect(pannedVp.panX).toBe(zoomedVp.panX + 10);
    expect(pannedVp.panY).toBe(zoomedVp.panY + 10);
  });

  it('zoom-out from MAX_ZOOM returns a lower zoom', () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    // Zoom to max
    act(() => {
      result.current.handlers.onWheel(makeWheelEvent(-100000, 50, 50));
    });
    expect(result.current.viewport.zoom).toBe(20);
    // Zoom out
    act(() => {
      result.current.handlers.onWheel(makeWheelEvent(+100, 50, 50));
    });
    expect(result.current.viewport.zoom).toBeLessThan(20);
    expect(Number.isFinite(result.current.viewport.zoom)).toBe(true);
  });

  // Phase 11.1 post-ship defense — locks the sanitizeViewport invariant.
  // If a non-finite value ever leaked in (e.g. a wheel event with NaN deltaY
  // or an external caller passing bad coords), the setViewport wrapper must
  // fall back to the previous value per-axis so ctx.setTransform never sees
  // NaN/±Infinity. Without this, the canvas blanks self-perpetuatingly.
  describe('setViewport — defense against non-finite values', () => {
    it('NaN zoom falls back to previous zoom', () => {
      const { result } = renderHook(() => useCanvasZoomPan({ zoom: 2, panX: 10, panY: 20 }));
      act(() => { result.current.setViewport({ zoom: NaN, panX: 50, panY: 50 }); });
      expect(result.current.viewport.zoom).toBe(2);
      expect(result.current.viewport.panX).toBe(50);
      expect(result.current.viewport.panY).toBe(50);
    });

    it('Infinity pan values fall back per-axis', () => {
      const { result } = renderHook(() => useCanvasZoomPan({ zoom: 2, panX: 10, panY: 20 }));
      act(() => { result.current.setViewport({ zoom: 3, panX: Infinity, panY: -Infinity }); });
      expect(result.current.viewport.zoom).toBe(3);
      expect(result.current.viewport.panX).toBe(10);
      expect(result.current.viewport.panY).toBe(20);
    });

    it('sanitizer reapplies zoom clamp even on finite out-of-range input', () => {
      const { result } = renderHook(() => useCanvasZoomPan());
      act(() => { result.current.setViewport({ zoom: 999, panX: 0, panY: 0 }); });
      expect(result.current.viewport.zoom).toBe(20);
      act(() => { result.current.setViewport({ zoom: -5, panX: 0, panY: 0 }); });
      expect(result.current.viewport.zoom).toBe(0.05);
    });
  });
});
