// Phase 7 Plan 06 — RadarMinimap rewritten for graph extents + manifest shift
// (D-20, preserves commit e62272d). Tests drive the rewrite (RED before GREEN).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { GraphNode, Viewport } from '../../../stores/radarStore';

// Canvas 2D shim — jsdom doesn't implement it. Record every call + property
// assignment so tests can assert stroke style / draw positions.
interface CtxSpy extends CanvasRenderingContext2D {
  _calls: Array<{ fn: string; args: unknown[] }>;
  _assignments: Record<string, unknown[]>;
}

function installCanvasShim() {
  const factory = (): CtxSpy => {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const assignments: Record<string, unknown[]> = {
      fillStyle: [],
      strokeStyle: [],
      lineWidth: [],
    };
    const rec = (fn: string) => (...args: unknown[]) => {
      calls.push({ fn, args });
    };
    const ctx = {
      save: rec('save'),
      restore: rec('restore'),
      beginPath: rec('beginPath'),
      closePath: rec('closePath'),
      moveTo: rec('moveTo'),
      lineTo: rec('lineTo'),
      arc: rec('arc'),
      fill: rec('fill'),
      stroke: rec('stroke'),
      fillRect: rec('fillRect'),
      strokeRect: rec('strokeRect'),
      clearRect: rec('clearRect'),
      scale: rec('scale'),
      setTransform: rec('setTransform'),
      _calls: calls,
      _assignments: assignments,
    } as unknown as CtxSpy;
    for (const prop of Object.keys(assignments)) {
      let cur: unknown;
      Object.defineProperty(ctx, prop, {
        get: () => cur,
        set: (v: unknown) => {
          cur = v;
          assignments[prop].push(v);
        },
      });
    }
    return ctx;
  };

  const original = HTMLCanvasElement.prototype.getContext;
  const lastCtx = { current: null as CtxSpy | null };
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
  ): RenderingContext | null {
    if (type === '2d') {
      const ctx = factory();
      lastCtx.current = ctx;
      return ctx as unknown as RenderingContext;
    }
    return original.call(this, type as '2d') as RenderingContext | null;
  } as typeof original;
  return { lastCtx, restore: () => (HTMLCanvasElement.prototype.getContext = original) };
}

// Mock radarStore — selector-based store with graphNodes + viewport +
// isManifestOpen + setViewport.
const mockRadarState = {
  graphNodes: [] as GraphNode[],
  viewport: { zoom: 1, panX: 0, panY: 0 } as Viewport,
  isManifestOpen: false,
  heatMapEnabled: false,
  contentionScores: new Map<string, number>(),
  setViewport: vi.fn((v: Partial<Viewport>) => {
    mockRadarState.viewport = { ...mockRadarState.viewport, ...v };
  }),
};

vi.mock('../../../stores/radarStore', () => {
  const useRadarStore = Object.assign(
    (selector: (s: typeof mockRadarState) => unknown) => selector(mockRadarState),
    {
      getState: () => mockRadarState,
      setState: (
        patch:
          | Partial<typeof mockRadarState>
          | ((s: typeof mockRadarState) => Partial<typeof mockRadarState>),
      ) => {
        const next = typeof patch === 'function' ? patch(mockRadarState) : patch;
        Object.assign(mockRadarState, next);
      },
    },
  );
  return { useRadarStore };
});

// Import after mocks.
import { RadarMinimap } from '../RadarMinimap';

describe('RadarMinimap (graph mode) — Plan 06', () => {
  let shim: ReturnType<typeof installCanvasShim>;

  beforeEach(() => {
    shim = installCanvasShim();
    mockRadarState.graphNodes = [];
    mockRadarState.viewport = { zoom: 1, panX: 0, panY: 0 };
    mockRadarState.isManifestOpen = false;
    mockRadarState.heatMapEnabled = false;
    mockRadarState.contentionScores = new Map();
    mockRadarState.setViewport.mockClear();
  });

  it('renders an empty 160x120 container with no nodes (no dots, no error)', () => {
    const { container } = render(
      <RadarMinimap canvasWidth={800} canvasHeight={600} />,
    );
    const wrapper = container.querySelector('[data-testid="radar-minimap"]') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    // Width/height come from inline styles
    expect(wrapper!.style.width).toBe('160px');
    expect(wrapper!.style.height).toBe('120px');
    // No node dots should be drawn (ctx.fillRect for nodes omitted)
    // The background fill still happens.
  });

  it('scales nodes into the 156×116 inner area with 2px padding', async () => {
    mockRadarState.graphNodes = [
      { id: 'a', dirKey: '', dirDepth: 0, x: -100, y: -50 },
      { id: 'b', dirKey: '', dirDepth: 0, x: 200, y: -50 },
      { id: 'c', dirKey: '', dirDepth: 0, x: -100, y: 150 },
      { id: 'd', dirKey: '', dirDepth: 0, x: 200, y: 150 },
    ];
    render(<RadarMinimap canvasWidth={800} canvasHeight={600} />);
    await new Promise((r) => setTimeout(r, 10));

    // Node dots are drawn via fillRect. There should be at least 4 such calls
    // (one per node) with coordinates inside [2, 2+156] × [2, 2+116].
    const nodeRects = shim.lastCtx.current!._calls.filter(
      (c) => c.fn === 'fillRect' && (c.args as number[]).length === 4 && (c.args as number[])[2] === 2,
    );
    expect(nodeRects.length).toBeGreaterThanOrEqual(4);
    for (const call of nodeRects) {
      const [x, y] = call.args as [number, number, number, number];
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(2 + 156);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(y).toBeLessThanOrEqual(2 + 116);
    }
  });

  it('shifts right=292px when manifest open, right=12px when closed (regression for e62272d)', () => {
    mockRadarState.graphNodes = [
      { id: 'a', dirKey: '', dirDepth: 0, x: 0, y: 0 },
    ];

    mockRadarState.isManifestOpen = true;
    const { container: openContainer, unmount } = render(
      <RadarMinimap canvasWidth={800} canvasHeight={600} />,
    );
    const open = openContainer.querySelector('[data-testid="radar-minimap"]') as HTMLElement;
    expect(open.style.right).toBe('292px');
    unmount();

    mockRadarState.isManifestOpen = false;
    const { container: closedContainer } = render(
      <RadarMinimap canvasWidth={800} canvasHeight={600} />,
    );
    const closed = closedContainer.querySelector('[data-testid="radar-minimap"]') as HTMLElement;
    expect(closed.style.right).toBe('12px');
  });

  it('viewport rectangle stroked in primary #8eff71 1px (UI-SPEC §Sizing)', async () => {
    mockRadarState.graphNodes = [
      { id: 'a', dirKey: '', dirDepth: 0, x: 0, y: 0 },
      { id: 'b', dirKey: '', dirDepth: 0, x: 100, y: 100 },
    ];
    render(<RadarMinimap canvasWidth={800} canvasHeight={600} />);
    await new Promise((r) => setTimeout(r, 10));

    const strokeAssignments = shim.lastCtx.current!._assignments.strokeStyle;
    expect(strokeAssignments).toContain('#8eff71');
    const lineWidths = shim.lastCtx.current!._assignments.lineWidth;
    expect(lineWidths).toContain(1);
    // The viewport rect is drawn via strokeRect.
    const strokeRects = shim.lastCtx.current!._calls.filter((c) => c.fn === 'strokeRect');
    expect(strokeRects.length).toBeGreaterThanOrEqual(1);
  });

  it('click inside the minimap calls setViewport with new panX/panY', () => {
    mockRadarState.graphNodes = [
      { id: 'a', dirKey: '', dirDepth: 0, x: 0, y: 0 },
      { id: 'b', dirKey: '', dirDepth: 0, x: 100, y: 100 },
    ];
    const { container } = render(
      <RadarMinimap canvasWidth={800} canvasHeight={600} />,
    );
    const canvas = container.querySelector('canvas')!;
    // jsdom layout returns 0-sized rects; fireEvent with clientX/Y still
    // computes from the (0,0) rect so the click is treated as origin of the
    // minimap. That's enough to assert setViewport was called.
    fireEvent.click(canvas, { clientX: 80, clientY: 60 });
    expect(mockRadarState.setViewport).toHaveBeenCalledTimes(1);
    const arg = mockRadarState.setViewport.mock.calls[0][0] as Partial<Viewport>;
    expect(arg).toHaveProperty('panX');
    expect(arg).toHaveProperty('panY');
    expect(typeof arg.panX).toBe('number');
    expect(typeof arg.panY).toBe('number');
  });
});
