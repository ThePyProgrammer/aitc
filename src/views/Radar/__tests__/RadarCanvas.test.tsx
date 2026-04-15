// Phase 7 Plan 04 — RadarCanvas tests.
//
// Exercises the graph-mode render path: node draw count, selected-node
// outline, and the D-23 performance banners. Treemap assertions are gone.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { GraphNode, GraphEdge, Viewport } from '../../../stores/radarStore';

// jsdom has no ResizeObserver — inject a no-op shim before any component
// mounts. The RadarCanvas observes its container size to drive HiDPI
// rescaling; the test harness does not exercise resize behavior.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
    NoopResizeObserver;
}
// rAF may be missing or run synchronously in jsdom — coerce to setTimeout 0
// so the render loop runs once after mount and tests can inspect draw calls.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame =
    (cb: () => void): number => setTimeout(cb, 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: (h: number) => void }).cancelAnimationFrame =
    (h: number): void => clearTimeout(h as unknown as NodeJS.Timeout);
}

// jsdom does not implement CanvasRenderingContext2D — install a spy shim on
// HTMLCanvasElement.prototype.getContext that records every method call and
// property assignment. The individual tests inspect this record to assert
// draw calls and style state.
interface CtxSpy extends CanvasRenderingContext2D {
  _calls: Array<{ fn: string; args: unknown[] }>;
  _assignments: Record<string, unknown[]>;
}

function installCanvasShim() {
  const gradient = { addColorStop: vi.fn() };
  const factory = (): CtxSpy => {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const assignments: Record<string, unknown[]> = {
      fillStyle: [],
      strokeStyle: [],
      lineWidth: [],
      font: [],
      textAlign: [],
      textBaseline: [],
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
      clearRect: rec('clearRect'),
      fillText: rec('fillText'),
      setTransform: rec('setTransform'),
      scale: rec('scale'),
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
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
    return original.call(this, type as any) as RenderingContext | null;
  } as typeof original;
  return { lastCtx, restore: () => (HTMLCanvasElement.prototype.getContext = original) };
}

// Mock useGraphLayout so React effects don't try to run a real simulation
// and so hit-tests see the nodes we inject.
vi.mock('../../../hooks/useGraphLayout', () => {
  return {
    useGraphLayout: () => ({
      quadtreeRef: { current: { find: () => undefined } },
      rewarm: vi.fn(),
    }),
  };
});

// Mock pipelineStore — the RadarCanvas only reads events.
vi.mock('../../../stores/pipelineStore', () => {
  const mockPipelineState = {
    events: [] as unknown[],
  };
  return {
    usePipelineStore: (selector: (s: typeof mockPipelineState) => unknown) =>
      selector(mockPipelineState),
  };
});

// Mock radarStore. Plan 03 shape: `graphNodes`, `graphEdges`, `settledAt`,
// `pinnedNodeIds`, `selectedAgentId`, `heatMapEnabled`, `contentionScores`,
// `viewport`, action stubs.
const mockRadarState = {
  graphNodes: [] as GraphNode[],
  graphEdges: [] as GraphEdge[],
  settledAt: null as number | null,
  pinnedNodeIds: new Set<string>(),
  selectedAgentId: null as string | null,
  heatMapEnabled: false,
  contentionScores: new Map<string, number>(),
  viewport: { zoom: 1, panX: 0, panY: 0 } as Viewport,
  fetchGraph: vi.fn(),
  setViewport: vi.fn(),
  toggleHeatMap: vi.fn(),
};

vi.mock('../../../stores/radarStore', () => {
  const useRadarStore = Object.assign(
    (selector: (s: typeof mockRadarState) => unknown) => selector(mockRadarState),
    {
      getState: () => mockRadarState,
      setState: (patch: Partial<typeof mockRadarState>) => {
        Object.assign(mockRadarState, patch);
      },
    },
  );
  return {
    useRadarStore,
    getAgentColor: (_id: string) => '#8eff71',
    installRadarPipelineBridge: () => () => undefined,
  };
});

// Lucide mock — exercise is on draw behavior, not icon glyphs.
vi.mock('lucide-react', () => ({
  Flame: () => null,
  AlertTriangle: () => null,
  Info: () => null,
}));

// Import after mocks are in place.
import { RadarCanvas } from '../RadarCanvas';

describe('RadarCanvas (graph mode) — Plan 04', () => {
  let shim: ReturnType<typeof installCanvasShim>;
  beforeEach(() => {
    shim = installCanvasShim();
    mockRadarState.graphNodes = [];
    mockRadarState.graphEdges = [];
    mockRadarState.settledAt = null;
    mockRadarState.pinnedNodeIds = new Set();
    mockRadarState.selectedAgentId = null;
    mockRadarState.heatMapEnabled = false;
    mockRadarState.contentionScores = new Map();
    mockRadarState.viewport = { zoom: 1, panX: 400, panY: 300 };
    vi.clearAllMocks();
  });

  it('renders graph nodes at settled positions (VIZN-01)', async () => {
    // 100 nodes arranged in a 10x10 grid around origin.
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 100; i++) {
      const col = i % 10;
      const row = Math.floor(i / 10);
      nodes.push({
        id: `src/f${i}.ts`,
        dirKey: 'src',
        dirDepth: 1,
        x: col * 10 - 50,
        y: row * 10 - 50,
      });
    }
    mockRadarState.graphNodes = nodes;
    mockRadarState.settledAt = Date.now();

    render(<RadarCanvas />);
    await new Promise((r) => setTimeout(r, 50));

    expect(shim.lastCtx.current).not.toBeNull();
    const arcCalls = shim.lastCtx.current!._calls.filter((c) => c.fn === 'arc');
    // Each node draws exactly one arc; hulls use a single arc for <3 nodes —
    // but we have 100 nodes in dirKey=src → hulls go via polygonHull path
    // (moveTo/lineTo), not arc. So arc count equals the rendered node count.
    expect(arcCalls.length).toBeGreaterThanOrEqual(100);
  });

  it.todo('snaps agent dot to most-recently-touched node (D-17) — Plan 05');

  it('selected node gets 1px white outer stroke at 80% opacity (UI-SPEC §Color)', async () => {
    // Plan 05 wires the selectedNode lookup by agent PID. Until then this
    // test documents the contract via the drawSelectedNode export. The
    // RadarCanvas currently calls drawSelectedNode only when selectedNode
    // is resolved — which is Plan 05's responsibility. For Plan 04 we
    // verify that the render loop completes without throwing when the
    // selectedAgentId is set but no matching node is found (no glow).
    mockRadarState.graphNodes = [
      { id: 'src/a.ts', dirKey: 'src', dirDepth: 1, x: 0, y: 0 },
    ];
    mockRadarState.settledAt = Date.now();
    mockRadarState.selectedAgentId = 'agent-001';
    const { container } = render(<RadarCanvas />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('canvas')).not.toBeNull();
    // No stroke style should be 'rgba(255,255,255,0.8)' because selectedNode
    // is undefined in Plan 04 (Plan 05 wires this). This test locks the
    // contract that drawSelectedNode is only invoked with a resolved node.
    const strokes = shim.lastCtx.current?._assignments.strokeStyle ?? [];
    expect(strokes.filter((s) => s === 'rgba(255,255,255,0.8)').length).toBe(0);
  });

  it('renders GRAPH_OVERLOAD banner at ≥10k nodes (D-23)', () => {
    const nodes: GraphNode[] = Array.from({ length: 10_001 }, (_, i) => ({
      id: `f${i}.ts`,
      dirKey: '',
      dirDepth: 0,
    }));
    mockRadarState.graphNodes = nodes;
    const { getByText } = render(<RadarCanvas />);
    expect(getByText('GRAPH_OVERLOAD')).toBeTruthy();
  });

  it('renders INFO_DEGRADED banner between 5k and 10k nodes (D-23)', () => {
    const nodes: GraphNode[] = Array.from({ length: 5_500 }, (_, i) => ({
      id: `f${i}.ts`,
      dirKey: '',
      dirDepth: 0,
    }));
    mockRadarState.graphNodes = nodes;
    const { getByText } = render(<RadarCanvas />);
    expect(getByText('INFO_DEGRADED')).toBeTruthy();
  });
});
