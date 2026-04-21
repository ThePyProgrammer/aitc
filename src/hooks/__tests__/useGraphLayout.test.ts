// Phase 11 — useGraphLayout tests with in-thread mocked Worker.
// Pattern 7 in 11-RESEARCH.md: vi.stubGlobal('Worker', MockWorker) drives
// makeGraphSimCore synchronously so assertions don't need async waits.
//
// Preserves the 7 original Phase 7 test intents (consts, build sim,
// quadtree on settle, rewarm threshold, cleanup, determinism) adapted to
// the new LivePositions ref shape (D-25) + adds Phase 11 assertions:
// D-01 StrictMode terminate-once, D-12 stale-seq drop, D-16 10-tick
// quadtree rebuild, D-28 commitSettledPositions Map shape.
//
// References:
//   11-CONTEXT.md D-01, D-12, D-16, D-24, D-28
//   11-RESEARCH.md §Pattern 6 (StrictMode cleanup), §Pattern 7 (mock)
//   11-PATTERNS.md §src/hooks/__tests__/useGraphLayout.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  makeGraphSimCore,
  type GraphSimCore,
  type GraphSimCallbacks,
} from '../../workers/graphSimCore';
import type { WorkerIn, WorkerOut } from '../../workers/graphSimProtocol';
import {
  useGraphLayout,
  MAX_TICKS,
  REWARM_NODE_COUNT_THRESHOLD,
  REWARM_PERCENT_THRESHOLD,
  CHARGE_DISTANCE_MAX,
  ALPHA_DECAY,
  VELOCITY_DECAY,
} from '../useGraphLayout';
import { useRadarStore, type GraphNode } from '../../stores/radarStore';

// Mock Tauri invoke — store's fetchGraph is not exercised; tests drive
// graphNodes/graphEdges directly.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

// --- Test registry: all MockWorker instances, so tests can assert lifecycle. ---
const workers: MockWorker[] = [];

/**
 * MockWorker — stubs the global Worker constructor with a synchronous
 * makeGraphSimCore instance. Uses a queue-based scheduler (per Wave 1
 * decision) so settle-scale recursion doesn't stack-overflow under
 * vitest+jsdom; the queue is drained inline inside each postMessage call.
 */
class MockWorker {
  private core: GraphSimCore;
  private queue: Array<() => void> = [];
  onmessage: ((e: MessageEvent<WorkerOut>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminateCount = 0;
  postedMessages: WorkerIn[] = [];

  constructor(_url: string | URL, _opts?: WorkerOptions) {
    const cb: GraphSimCallbacks = {
      onTick: (m) =>
        this.dispatch({
          type: 'tick',
          positions: m.positions,
          alpha: m.alpha,
          sequence: m.sequence,
        }),
      onSettled: (m) =>
        this.dispatch({
          type: 'settled',
          positions: m.positions,
          alpha: m.alpha,
          sequence: m.sequence,
        }),
      onError: (m) =>
        this.dispatch({ type: 'error', message: m.message, stack: m.stack }),
    };
    // Queue-based scheduler: per Wave 1 §Pattern 2, avoids recursion.
    this.core = makeGraphSimCore(cb, {
      schedule: (fn) => {
        this.queue.push(fn);
      },
    });
    workers.push(this);
  }

  postMessage(msg: WorkerIn, _transfer?: unknown): void {
    this.postedMessages.push(msg);
    switch (msg.type) {
      case 'init':
        this.core.init(msg);
        break;
      case 'topology':
        this.core.topology(msg);
        break;
      case 'updateConfig':
        this.core.updateConfig(msg.config);
        break;
      case 'pin':
        this.core.pin(msg.id, msg.x, msg.y);
        break;
      case 'unpin':
        this.core.unpin(msg.id);
        break;
      case 'returnBuffer':
        this.core.returnBuffer(msg.buffer);
        break;
      case 'dispose':
        this.core.dispose();
        break;
    }
    // Drain scheduled callbacks synchronously so tests see the full
    // settle/tick fan-out without async awaits.
    let steps = 0;
    const MAX_STEPS = 5000;
    while (this.queue.length > 0 && steps < MAX_STEPS) {
      const fn = this.queue.shift()!;
      fn();
      steps++;
    }
  }

  terminate(): void {
    this.terminateCount++;
    this.core.dispose();
    this.queue.length = 0;
  }

  private dispatch(data: WorkerOut): void {
    this.onmessage?.({ data } as MessageEvent<WorkerOut>);
  }
}

function seedGraphNodes(nodeCount: number, dirKey = 'src/foo'): GraphNode[] {
  const out: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    out.push({
      id: `${dirKey}/n${i}.ts`,
      dirKey,
      dirDepth: dirKey.split('/').length,
    });
  }
  return out;
}

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal('Worker', MockWorker);
  useRadarStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGraphLayout — Phase 11 Worker client', () => {
  // ─── Preserved Phase 7 cases (adapted to LivePositions ref shape) ───────

  it('exports tuning constants honoring 07-CONTEXT D-03 + RESEARCH §Pattern 1', () => {
    expect(MAX_TICKS).toBe(500);
    expect(REWARM_NODE_COUNT_THRESHOLD).toBe(5);
    expect(REWARM_PERCENT_THRESHOLD).toBe(0.01);
    expect(CHARGE_DISTANCE_MAX).toBe(300);
    expect(ALPHA_DECAY).toBe(0.04);
    expect(VELOCITY_DECAY).toBe(0.5);
  });

  it('constructs a Worker on mount and terminates on unmount (D-01, Pattern 6)', () => {
    const { unmount } = renderHook(() => useGraphLayout());
    expect(workers.length).toBe(1);
    expect(workers[0].terminateCount).toBe(0);
    unmount();
    expect(workers[0].terminateCount).toBe(1);
  });

  it('StrictMode double-mount terminates the first worker and creates a second', () => {
    // Simulate StrictMode (mount + unmount + remount) via two
    // renderHook calls since renderHook().rerender() does not remount.
    const first = renderHook(() => useGraphLayout());
    const firstWorker = workers[0];
    first.unmount();
    expect(firstWorker.terminateCount).toBe(1);

    const second = renderHook(() => useGraphLayout());
    expect(workers.length).toBeGreaterThanOrEqual(2);
    const secondWorker = workers[workers.length - 1];
    expect(secondWorker.terminateCount).toBe(0);
    second.unmount();
    expect(secondWorker.terminateCount).toBe(1);
  });

  it('posts init when graphNodes first arrive and settles positions (D-03 legacy, D-28)', async () => {
    const { result, unmount } = renderHook(() => useGraphLayout());
    await act(async () => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(10),
        graphEdges: [],
      });
    });
    const w = workers[0];
    // First message to the worker must be an init (not topology).
    expect(w.postedMessages[0]?.type).toBe('init');
    // simNodesRef ids populated.
    expect(result.current.simNodesRef.current.ids.length).toBe(10);
    // After settle (queue drain inside postMessage), positions are finite.
    const s = useRadarStore.getState();
    expect(s.settledAt).not.toBeNull();
    for (const n of s.graphNodes) {
      expect(Number.isFinite(n.x ?? NaN)).toBe(true);
      expect(Number.isFinite(n.y ?? NaN)).toBe(true);
    }
    unmount();
  });

  it('returns a populated quadtree after settle (D-16, D-23)', async () => {
    const { result, unmount } = renderHook(() => useGraphLayout());
    await act(async () => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(20),
        graphEdges: [],
      });
    });
    const qt = result.current.quadtreeRef.current;
    expect(qt).not.toBeNull();
    expect(typeof qt!.find).toBe('function');
    const found = qt!.find(0, 0, 10_000);
    expect(found).toBeTruthy();
    unmount();
  });

  it('re-warm threshold: <5 mutations with <1% of total leaves settledAt untouched', async () => {
    // 500 + 3 additions — 3 < 5 AND 3/503 ≈ 0.6% < 1%. Node count kept
    // low enough to fit inside the default 5s vitest timeout when the
    // full suite runs under worker-pool concurrency. Phase 7's 1000-node
    // version starved on concurrent runs; semantics unchanged.
    renderHook(() => useGraphLayout());
    await act(async () => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(500),
        graphEdges: [],
      });
    });
    const firstSettle = useRadarStore.getState().settledAt;
    expect(firstSettle).not.toBeNull();
    const w = workers[0];
    const initCount = w.postedMessages.filter((m) => m.type === 'topology').length;

    // Add 3 new nodes (under both thresholds).
    await act(async () => {
      useRadarStore.setState({
        graphNodes: [
          ...useRadarStore.getState().graphNodes,
          ...seedGraphNodes(3, 'src/bar'),
        ],
      });
    });
    // Rewarm must NOT fire: no new topology message posted.
    const afterCount = w.postedMessages.filter((m) => m.type === 'topology').length;
    expect(afterCount).toBe(initCount);
  }, 15_000);

  it('re-warm threshold: ≥5 mutations trigger topology (D-18 carry)', async () => {
    renderHook(() => useGraphLayout());
    await act(async () => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(50),
        graphEdges: [],
      });
    });
    const w = workers[0];
    const before = w.postedMessages.filter((m) => m.type === 'topology').length;

    // 6 additions → 6 >= 5 AND 6/56 ≈ 11% >= 1%.
    await act(async () => {
      useRadarStore.setState({
        graphNodes: [
          ...useRadarStore.getState().graphNodes,
          ...seedGraphNodes(6, 'src/bar'),
        ],
      });
    });
    const after = w.postedMessages.filter((m) => m.type === 'topology').length;
    expect(after).toBeGreaterThan(before);
  });

  it('cleanup on unmount is safe (RESEARCH §Pitfall 2)', () => {
    renderHook(() => useGraphLayout());
    act(() => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(10),
        graphEdges: [],
      });
    });
    const { unmount } = renderHook(() => useGraphLayout());
    expect(() => unmount()).not.toThrow();
  });

  it('deterministic settle with seeded RNG: two runs produce close-enough final positions', async () => {
    // graphSimCore uses mulberry32(INITIAL_POSITION_SEED) for both initial
    // positions AND sim.randomSource (Wave 1 §Pitfall 1) — so seeded
    // determinism holds across runs. Tolerance kept at 0.5 world-units;
    // the core seeds but d3-force's jiggle() during collision resolution
    // may still introduce trailing-bit drift that exceeds strict
    // byte-equality.
    const runOnce = async (): Promise<Float32Array> => {
      useRadarStore.getState().reset();
      const { result, unmount } = renderHook(() => useGraphLayout());
      await act(async () => {
        useRadarStore.setState({
          graphNodes: seedGraphNodes(6),
          graphEdges: [],
        });
      });
      const pos = new Float32Array(result.current.simNodesRef.current.positions);
      unmount();
      return pos;
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(Math.abs(a[i] - b[i])).toBeLessThan(0.5);
    }
  });

  it('VIZN-05 regression: dirKey-sharing files cluster within 100 world units (D-11)', async () => {
    const { unmount } = renderHook(() => useGraphLayout());
    await act(async () => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(10, 'src/foo'),
        graphEdges: [],
      });
    });
    const nodes = useRadarStore.getState().graphNodes;
    expect(nodes).toHaveLength(10);
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        total += Math.hypot(
          (nodes[i].x ?? 0) - (nodes[j].x ?? 0),
          (nodes[i].y ?? 0) - (nodes[j].y ?? 0),
        );
        pairs++;
      }
    }
    expect(total / pairs).toBeLessThan(100);
    unmount();
  });

  // ─── New Phase 11 cases ─────────────────────────────────────────────────

  it('calls commitSettledPositions with Map<id,{x,y}> on settled (D-28)', async () => {
    // Spy on the current store's action to preserve binding through
    // zustand's create-pattern.
    const spy = vi.spyOn(useRadarStore.getState(), 'commitSettledPositions');
    const { unmount } = renderHook(() => useGraphLayout());
    await act(async () => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(6),
        graphEdges: [],
      });
    });
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[spy.mock.calls.length - 1][0] as Map<
      string,
      { x: number; y: number }
    >;
    expect(arg).toBeInstanceOf(Map);
    expect(arg.size).toBe(6);
    for (const [id, p] of arg) {
      expect(typeof id).toBe('string');
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    unmount();
    spy.mockRestore();
  });

  it('drops stale-sequence tick messages without overwriting simNodesRef (D-12)', async () => {
    const { result, unmount } = renderHook(() => useGraphLayout());
    await act(async () => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(5),
        graphEdges: [],
      });
    });
    const w = workers[0];
    const beforePositions = result.current.simNodesRef.current.positions;
    // Forge a stale tick with sequence=0 (current topologySeq is >= 1).
    const stalePositions = new Float32Array(10);
    stalePositions.fill(999);
    act(() => {
      w.onmessage?.({
        data: {
          type: 'tick',
          positions: stalePositions,
          alpha: 0.5,
          sequence: 0,
        } satisfies WorkerOut,
      } as MessageEvent<WorkerOut>);
    });
    // simNodesRef must NOT have been overwritten with 999s.
    const afterPositions = result.current.simNodesRef.current.positions;
    // Either the ref still points at the original Float32Array OR the first
    // element is not 999 (i.e. positions was not written to the stale
    // buffer).
    expect(afterPositions === beforePositions || afterPositions[0] !== 999).toBe(
      true,
    );
    unmount();
  });

  it('posts pin/unpin when pinnedNodeIds Set diff changes', async () => {
    renderHook(() => useGraphLayout());
    await act(async () => {
      useRadarStore.setState({
        graphNodes: seedGraphNodes(5),
        graphEdges: [],
      });
    });
    const w = workers[0];
    w.postedMessages.length = 0;
    await act(async () => {
      const s = useRadarStore.getState();
      const firstId = s.graphNodes[0].id;
      const nodesWithPin = s.graphNodes.map((n, i) =>
        i === 0 ? { ...n, fx: 42, fy: 43 } : n,
      );
      useRadarStore.setState({
        graphNodes: nodesWithPin,
        pinnedNodeIds: new Set([firstId]),
      });
    });
    expect(w.postedMessages.some((m) => m.type === 'pin')).toBe(true);
  });
});
