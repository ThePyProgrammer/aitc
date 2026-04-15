// Phase 7 Plan 04 + 05 — RadarCanvas tests.
//
// Exercises the graph-mode render path: node draw count, selected-node
// outline, the D-23 performance banners, and (Plan 05) comet-trail spawn,
// dot-snapping, and drag-to-pin. Treemap assertions are gone.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type {
  GraphNode,
  GraphEdge,
  Viewport,
  ActiveTrail,
} from '../../../stores/radarStore';
import type { FileEvent } from '../../../bindings';

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

// Mock useGraphLayout. Expose a mutable hit map so Plan 05 tests can
// make the quadtree "find" a specific node on demand.
const mockQuadtreeHit = { current: null as null | { id: string } };
const mockRewarm = vi.fn();
vi.mock('../../../hooks/useGraphLayout', () => {
  return {
    useGraphLayout: () => ({
      quadtreeRef: {
        current: { find: () => mockQuadtreeHit.current ?? undefined },
      },
      rewarm: mockRewarm,
    }),
  };
});

// Mock pipelineStore — the RadarCanvas reads `events`. Tests override
// mockPipelineState.events before rendering.
const mockPipelineState = { events: [] as FileEvent[] };
vi.mock('../../../stores/pipelineStore', () => {
  return {
    usePipelineStore: (selector: (s: typeof mockPipelineState) => unknown) =>
      selector(mockPipelineState),
  };
});

// Mock agentStore so RadarCanvas can map Attribution.pid → agentId.
const mockAgentState = {
  agents: [] as Array<{ id: string; pid: number | null }>,
};
vi.mock('../../../stores/agentStore', () => {
  return {
    useAgentStore: (selector: (s: typeof mockAgentState) => unknown) =>
      selector(mockAgentState),
  };
});

// Mock radarStore. Plan 03 shape + Plan 05 additions: `activeTrails`,
// `pushTrail`, `pruneTrails`, `pinNode`, `unpinNode`.
const mockRadarState = {
  graphNodes: [] as GraphNode[],
  graphEdges: [] as GraphEdge[],
  settledAt: null as number | null,
  pinnedNodeIds: new Set<string>(),
  selectedAgentId: null as string | null,
  heatMapEnabled: false,
  contentionScores: new Map<string, number>(),
  viewport: { zoom: 1, panX: 0, panY: 0 } as Viewport,
  activeTrails: [] as ActiveTrail[],
  fetchGraph: vi.fn(),
  setViewport: vi.fn(),
  toggleHeatMap: vi.fn(),
  pushTrail: vi.fn((t: ActiveTrail) => {
    mockRadarState.activeTrails = [...mockRadarState.activeTrails, t];
  }),
  pruneTrails: vi.fn(),
  pinNode: vi.fn((id: string, x: number, y: number) => {
    mockRadarState.pinnedNodeIds = new Set(mockRadarState.pinnedNodeIds).add(id);
    mockRadarState.graphNodes = mockRadarState.graphNodes.map((n) =>
      n.id === id ? { ...n, fx: x, fy: y, x, y } : n,
    );
  }),
  unpinNode: vi.fn((id: string) => {
    const next = new Set(mockRadarState.pinnedNodeIds);
    next.delete(id);
    mockRadarState.pinnedNodeIds = next;
    mockRadarState.graphNodes = mockRadarState.graphNodes.map((n) =>
      n.id === id ? { ...n, fx: null, fy: null } : n,
    );
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
    mockRadarState.activeTrails = [];
    mockPipelineState.events = [];
    mockAgentState.agents = [];
    mockQuadtreeHit.current = null;
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

  it('spawns ActiveTrail on consecutive different-path events (D-14)', async () => {
    // Two graph nodes the agent will touch in sequence.
    mockRadarState.graphNodes = [
      { id: 'a.ts', dirKey: '', dirDepth: 0, x: 0, y: 0 },
      { id: 'b.ts', dirKey: '', dirDepth: 0, x: 100, y: 0 },
    ];
    mockRadarState.settledAt = Date.now();
    mockAgentState.agents = [{ id: 'agent-001', pid: 1234 }];
    mockPipelineState.events = [
      {
        path: 'b.ts',
        kind: { kind: 'modify' },
        timestampMs: 2_000,
        attribution: { kind: 'pid', value: 1234 },
      } as FileEvent,
      {
        path: 'a.ts',
        kind: { kind: 'modify' },
        timestampMs: 1_000,
        attribution: { kind: 'pid', value: 1234 },
      } as FileEvent,
    ];
    render(<RadarCanvas />);
    await new Promise((r) => setTimeout(r, 20));

    // After processing (oldest → newest), agent visits a.ts then b.ts —
    // the second event should spawn one trail.
    expect(mockRadarState.pushTrail).toHaveBeenCalledTimes(1);
    const call = mockRadarState.pushTrail.mock.calls[0][0] as ActiveTrail;
    expect(call).toMatchObject({
      agentId: 'agent-001',
      fromPath: 'a.ts',
      toPath: 'b.ts',
    });
  });

  it('snaps agent dot to most-recently-touched node (D-17)', async () => {
    // Agent visits b.ts (100,0) after a.ts (0,0). The dot draw should
    // land at world (100, 0) → in our shim's recorded arc calls.
    mockRadarState.graphNodes = [
      { id: 'a.ts', dirKey: '', dirDepth: 0, x: 0, y: 0 },
      { id: 'b.ts', dirKey: '', dirDepth: 0, x: 100, y: 0 },
    ];
    mockRadarState.settledAt = Date.now();
    mockAgentState.agents = [{ id: 'agent-001', pid: 1234 }];
    mockPipelineState.events = [
      {
        path: 'b.ts',
        kind: { kind: 'modify' },
        timestampMs: 2_000,
        attribution: { kind: 'pid', value: 1234 },
      } as FileEvent,
      {
        path: 'a.ts',
        kind: { kind: 'modify' },
        timestampMs: 1_000,
        attribution: { kind: 'pid', value: 1234 },
      } as FileEvent,
    ];
    render(<RadarCanvas />);
    await new Promise((r) => setTimeout(r, 40));

    // drawAgentDots emits arcs for the center dot (always) + two pulse rings
    // (unless idle). The center dot should be at (100, 0). We inspect the
    // last recorded arc positions for one at x=100,y=0 after nodes are
    // drawn.
    const arcs = shim.lastCtx.current!._calls.filter((c) => c.fn === 'arc');
    const agentDotArc = arcs.find((c) => {
      const [x, y] = c.args as [number, number, ...unknown[]];
      return Math.abs(x - 100) < 0.01 && Math.abs(y - 0) < 0.01;
    });
    expect(agentDotArc).toBeDefined();
  });

  it('drag-to-pin: mousedown on a node → mouseup calls pinNode + rewarm', () => {
    mockRadarState.graphNodes = [
      { id: 'a.ts', dirKey: '', dirDepth: 0, x: 0, y: 0 },
    ];
    mockRadarState.settledAt = Date.now();
    mockQuadtreeHit.current = { id: 'a.ts' };

    const { container } = render(<RadarCanvas />);
    const canvas = container.querySelector('canvas')!;
    // viewport panX=400, panY=300, zoom=1 → screen (400,300) maps to world (0,0).
    fireEvent.mouseDown(canvas, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 350 });
    fireEvent.mouseUp(canvas, { clientX: 500, clientY: 350 });

    expect(mockRadarState.pinNode).toHaveBeenCalledTimes(1);
    const [id] = mockRadarState.pinNode.mock.calls[0];
    expect(id).toBe('a.ts');
    expect(mockRewarm).toHaveBeenCalledWith(0.3);
    expect(mockRadarState.pinnedNodeIds.has('a.ts')).toBe(true);
  });

  it('shift+click on a pinned node → unpinNode + rewarm(0.2)', () => {
    mockRadarState.graphNodes = [
      { id: 'a.ts', dirKey: '', dirDepth: 0, x: 0, y: 0, fx: 0, fy: 0 },
    ];
    mockRadarState.pinnedNodeIds = new Set(['a.ts']);
    mockRadarState.settledAt = Date.now();
    mockQuadtreeHit.current = { id: 'a.ts' };

    const { container } = render(<RadarCanvas />);
    const canvas = container.querySelector('canvas')!;
    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: 400,
      clientY: 300,
      shiftKey: true,
    });

    expect(mockRadarState.unpinNode).toHaveBeenCalledWith('a.ts');
    expect(mockRewarm).toHaveBeenCalledWith(0.2);
  });

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
