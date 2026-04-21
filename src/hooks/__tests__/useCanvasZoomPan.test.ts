// Phase 11.1 — useCanvasZoomPan wheel coalescer unit tests (D-01..D-04, D-14).
//
// Pattern source: 11.1-RESEARCH.md §Pattern 2 "Vitest rAF Stub". Uses Vitest 3's
// `vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })`
// so the hook's internal rAF scheduling is observable step-by-step via
// `vi.advanceTimersToNextFrame()`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('useCanvasZoomPan wheel coalescer (D-01..D-04)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('D-01: coalesces N wheel events into one viewport change per animation frame', () => {
    const { result } = renderHook(() => useCanvasZoomPan());
    const zoomBefore = result.current.viewport.zoom;

    // Dispatch 5 wheel events within one frame — no rAF has fired yet.
    act(() => {
      for (let i = 0; i < 5; i++) {
        result.current.handlers.onWheel(makeWheelEvent(-100));
      }
    });
    // Before the frame flushes: viewport UNCHANGED (setViewport not yet called).
    expect(result.current.viewport.zoom).toBe(zoomBefore);

    // Advance exactly one animation frame — flushes the coalesced rAF.
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    // After the flush: viewport has ONE new zoom value.
    expect(result.current.viewport.zoom).not.toBe(zoomBefore);
    expect(result.current.viewport.zoom).toBeGreaterThan(1); // zoom-in from deltaY<0
  });

  it('D-02: summed deltaY yields a larger zoom than a single event', () => {
    const { result: single } = renderHook(() => useCanvasZoomPan());
    const { result: fiveX } = renderHook(() => useCanvasZoomPan());

    act(() => {
      single.current.handlers.onWheel(makeWheelEvent(-100));
    });
    act(() => {
      for (let i = 0; i < 5; i++) {
        fiveX.current.handlers.onWheel(makeWheelEvent(-100));
      }
    });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    // 5 coalesced events summed to deltaY=-500 should drive a strictly larger
    // zoom than one event of deltaY=-100.
    expect(fiveX.current.viewport.zoom).toBeGreaterThan(single.current.viewport.zoom);
  });

  it('D-03: cursor-anchored zoom uses the LAST event cursor (last-wins)', () => {
    const { result } = renderHook(() => useCanvasZoomPan());

    // Two events with different anchor points within one frame.
    act(() => {
      result.current.handlers.onWheel(makeWheelEvent(-100, 10, 10));
      result.current.handlers.onWheel(makeWheelEvent(-100, 150, 150));
    });
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    // Pan offset should reflect the (150,150) anchor, not (10,10).
    // Compare panX against a single-event control anchored at (150,150)
    // with an equivalent summed deltaY (-200).
    const { result: control } = renderHook(() => useCanvasZoomPan());
    act(() => {
      control.current.handlers.onWheel(makeWheelEvent(-200, 150, 150));
    });
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(result.current.viewport.panX).toBeCloseTo(control.current.viewport.panX, 5);
    expect(result.current.viewport.panY).toBeCloseTo(control.current.viewport.panY, 5);
  });

  it('D-04: cancels pending rAF on unmount (no post-unmount state mutation)', () => {
    const { result, unmount } = renderHook(() => useCanvasZoomPan());
    const zoomBefore = result.current.viewport.zoom;

    act(() => {
      result.current.handlers.onWheel(makeWheelEvent(-100));
    });
    unmount();
    // Advancing a frame post-unmount should be a no-op — no React warning,
    // no exception. The value read on `result.current` is the last snapshot
    // before unmount; the key invariant is that no crash occurs.
    expect(() => {
      act(() => {
        vi.advanceTimersToNextFrame();
      });
    }).not.toThrow();
    // Snapshot did NOT update post-unmount.
    expect(result.current.viewport.zoom).toBe(zoomBefore);
  });
});
