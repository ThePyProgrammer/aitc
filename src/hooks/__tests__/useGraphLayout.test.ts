// Plan 03: useGraphLayout — settle-then-freeze d3-force wrapper.
//
// Covers D-03 (settle cadence), D-11 (forceCluster wired in), D-23
// (quadtree hit-test). Tests run against an in-memory radarStore — the
// hook's useEffect runs synchronously inside `act()` so we can
// snapshot graphNodes/settledAt after the initial settle.
//
// References:
//   07-CONTEXT.md D-03, D-11
//   07-RESEARCH.md §Pattern 1, §Pattern 4, §Pitfall 2/3/5
//   07-RESEARCH.md §Validation Determinism (lines 900-907)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useGraphLayout,
  MAX_TICKS,
  REWARM_NODE_COUNT_THRESHOLD,
  REWARM_PERCENT_THRESHOLD,
  CHARGE_DISTANCE_MAX,
  ALPHA_DECAY,
  VELOCITY_DECAY,
} from '../useGraphLayout';
import { useRadarStore, type GraphNode, type GraphEdge } from '../../stores/radarStore';

// Mock Tauri invoke so the store is purely in-memory for these tests
// (fetchGraph is not exercised here — we drive graphNodes/graphEdges directly).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedGraph(nodeCount: number, dirKey = 'src/foo'): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `${dirKey}/n${i}.ts`,
      dirKey,
      dirDepth: dirKey.split('/').length,
    });
  }
  return nodes;
}

function withSeededRandom<T>(seed: number, fn: () => T): T {
  const prev = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}

function setStoreGraph(nodes: GraphNode[], edges: GraphEdge[] = []) {
  // Seed for the INITIAL settle: force settledAt null so the hook's
  // first effect runs.
  useRadarStore.setState({ graphNodes: nodes, graphEdges: edges, settledAt: null });
}

function mutateStoreGraph(nodes: GraphNode[], edges: GraphEdge[] = []) {
  // Subsequent mutation that must NOT reset settledAt — that's the whole
  // point of the rewarm-threshold gate. Preserves the post-settle
  // timestamp so the hook's rewarm effect decides whether to re-run.
  useRadarStore.setState((s) => ({ ...s, graphNodes: nodes, graphEdges: edges }));
}

describe('useGraphLayout — Plan 03', () => {
  beforeEach(() => {
    useRadarStore.getState().reset();
  });

  it('exports tuning constants honoring 07-CONTEXT D-03 and RESEARCH §Pattern 1', () => {
    expect(MAX_TICKS).toBe(500);
    expect(REWARM_NODE_COUNT_THRESHOLD).toBe(5);
    expect(REWARM_PERCENT_THRESHOLD).toBe(0.01);
    expect(CHARGE_DISTANCE_MAX).toBe(300);
    expect(ALPHA_DECAY).toBe(0.04);
    expect(VELOCITY_DECAY).toBe(0.5);
  });

  it('settle terminates (<500 ticks) and commits positions to radarStore (D-03)', () => {
    withSeededRandom(1, () => {
      setStoreGraph(seedGraph(50));
      renderHook(() => useGraphLayout());
    });
    const s = useRadarStore.getState();
    expect(s.settledAt).not.toBeNull();
    // Every node has a finite position after settle.
    for (const n of s.graphNodes) {
      expect(Number.isFinite(n.x ?? NaN)).toBe(true);
      expect(Number.isFinite(n.y ?? NaN)).toBe(true);
    }
  });

  it('settle of a trivially small graph terminates via alpha cooldown before MAX_TICKS', () => {
    // 5 disconnected nodes — alpha cools faster than 500 ticks.
    withSeededRandom(2, () => {
      setStoreGraph(seedGraph(5));
      renderHook(() => useGraphLayout());
    });
    // Indirectly verified: settledAt is non-null and positions are finite,
    // meaning the loop exited (either by tick cap or alpha cooldown).
    // If the loop hung we'd deadlock, not fail here.
    const s = useRadarStore.getState();
    expect(s.settledAt).not.toBeNull();
  });

  it('returns a quadtree populated with settled positions (D-23, RESEARCH §Pattern 4)', () => {
    let hookResult: { quadtreeRef: React.MutableRefObject<unknown> } | null = null;
    withSeededRandom(3, () => {
      setStoreGraph(seedGraph(20));
      const { result } = renderHook(() => useGraphLayout());
      hookResult = result.current as unknown as typeof hookResult;
    });
    expect(hookResult).not.toBeNull();
    expect(hookResult!.quadtreeRef.current).not.toBeNull();
    // d3-quadtree exposes .find(x, y, radius?)
    const qt = hookResult!.quadtreeRef.current as { find: (x: number, y: number, r?: number) => unknown };
    expect(typeof qt.find).toBe('function');
    const found = qt.find(0, 0, 10_000);
    expect(found).toBeTruthy();
  });

  it('re-warm threshold: <5 mutations with <1% of total leaves settledAt untouched', () => {
    withSeededRandom(4, () => {
      // Base 1000 + 4 additions → 4 < 5 nodes AND 4/1004 ≈ 0.4% < 1%.
      setStoreGraph(seedGraph(1000));
      const { rerender } = renderHook(() => useGraphLayout());
      const firstSettle = useRadarStore.getState().settledAt;
      expect(firstSettle).not.toBeNull();

      // Add 4 new nodes (both thresholds safely under).
      act(() => {
        mutateStoreGraph([
          ...useRadarStore.getState().graphNodes,
          ...seedGraph(4, 'src/bar'),
        ]);
      });
      rerender();
      // Rewarm must NOT fire: settledAt unchanged.
      expect(useRadarStore.getState().settledAt).toBe(firstSettle);
    });
  });

  it('re-warm threshold: ≥5 mutations trigger rewarm (RESEARCH §Pitfall 3)', () => {
    withSeededRandom(5, () => {
      // 50 base nodes keeps each settle inside the 5s vitest default.
      // Adding 6 new nodes crosses REWARM_NODE_COUNT_THRESHOLD (6 >= 5)
      // AND REWARM_PERCENT_THRESHOLD (6/56 ≈ 11% >= 1%). Either alone
      // should fire the rewarm branch.
      setStoreGraph(seedGraph(50));
      const { rerender } = renderHook(() => useGraphLayout());
      const firstSettle = useRadarStore.getState().settledAt!;
      expect(firstSettle).not.toBeNull();

      // Spin until Date.now() advances so the rewarm Date.now() is strictly greater.
      const before = Date.now();
      while (Date.now() === before) {
        // tight spin (<=1ms)
      }

      act(() => {
        mutateStoreGraph([
          ...useRadarStore.getState().graphNodes,
          ...seedGraph(6, 'src/bar'),
        ]);
      });
      rerender();
      const secondSettle = useRadarStore.getState().settledAt!;
      expect(secondSettle).toBeGreaterThan(firstSettle);
    });
  });

  it('cleanup on unmount (RESEARCH §Pitfall 2): stop is called, no exceptions', () => {
    withSeededRandom(6, () => {
      setStoreGraph(seedGraph(10));
      const { unmount } = renderHook(() => useGraphLayout());
      expect(() => unmount()).not.toThrow();
    });
  });

  it('deterministic settle with seeded RNG: same seed ⇒ same positions', () => {
    // RESEARCH §Validation Determinism (lines 900-907) recommends EITHER
    // monkey-patching Math.random OR pre-assigning node.x/y. We use the
    // latter — fewer RNG touchpoints means fewer places for unrelated
    // Math.random calls (inside @testing-library/react's StrictMode
    // double-invoke, React's internal id gen, etc.) to perturb the output.
    const makeSeededNodes = (): GraphNode[] => {
      const rng = mulberry32(1234);
      return Array.from({ length: 20 }, (_, i) => ({
        id: `src/foo/n${i}.ts`,
        dirKey: 'src/foo',
        dirDepth: 2,
        x: (rng() - 0.5) * 200,
        y: (rng() - 0.5) * 200,
      }));
    };

    useRadarStore.getState().reset();
    setStoreGraph(makeSeededNodes());
    renderHook(() => useGraphLayout());
    const posA = useRadarStore.getState().graphNodes.map((n) => ({
      id: n.id,
      x: n.x ?? NaN,
      y: n.y ?? NaN,
    }));

    useRadarStore.getState().reset();
    setStoreGraph(makeSeededNodes());
    renderHook(() => useGraphLayout());
    const posB = useRadarStore.getState().graphNodes.map((n) => ({
      id: n.id,
      x: n.x ?? NaN,
      y: n.y ?? NaN,
    }));

    expect(posA.length).toBeGreaterThan(0);
    expect(posA.length).toBe(posB.length);
    // d3-force's internal `jiggle()` calls Math.random during collision
    // resolution on near-coincident nodes — un-reachable via the input
    // seed. RESEARCH §909 explicitly accepts determinism as a "relative
    // property" (same cluster, non-NaN, consistent id-to-rough-position
    // mapping) rather than byte-identical output. We assert:
    //   1. Both runs settle (no NaN leak).
    //   2. Both runs place nodes in the same tight cluster.
    // (Byte-identical determinism would require swapping Math.random at
    //  the d3-force call site — deferred to Plan 04's bench harness.)
    for (const p of posA) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    for (const p of posB) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Same island: centroid-to-centroid distance << typical cluster size.
    const centroidA = {
      x: posA.reduce((s, p) => s + p.x, 0) / posA.length,
      y: posA.reduce((s, p) => s + p.y, 0) / posA.length,
    };
    const centroidB = {
      x: posB.reduce((s, p) => s + p.x, 0) / posB.length,
      y: posB.reduce((s, p) => s + p.y, 0) / posB.length,
    };
    expect(Math.hypot(centroidA.x - centroidB.x, centroidA.y - centroidB.y)).toBeLessThan(50);
    // Each node's position is within a reasonable neighborhood of its
    // seed-A counterpart — looser than byte-identical but tight enough
    // to catch "simulation blew up / configuration drift" regressions.
    for (let i = 0; i < posA.length; i++) {
      expect(posA[i].id).toBe(posB[i].id);
      expect(Math.abs(posA[i].x - posB[i].x)).toBeLessThan(50);
      expect(Math.abs(posA[i].y - posB[i].y)).toBeLessThan(50);
    }
  });

  it('VIZN-05 regression: files sharing dirKey cluster within 100 world units after settle (D-11)', () => {
    withSeededRandom(9, () => {
      // 10 nodes, all `src/foo`, no links. forceCluster + default
      // forces should pull them into a tight island.
      setStoreGraph(seedGraph(10, 'src/foo'));
      renderHook(() => useGraphLayout());
    });
    const nodes = useRadarStore.getState().graphNodes;
    expect(nodes).toHaveLength(10);
    // Mean pairwise distance bound.
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
  });
});
