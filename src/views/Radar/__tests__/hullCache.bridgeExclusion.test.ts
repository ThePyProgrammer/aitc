// Phase 22 Plan 01 (Wave 0 — RED) — hullCache bridge-exclusion witness test.
// Witness: W-22-03 (getHullCache excludes kind==="bridge" nodes across zoom buckets).

// Path2D polyfill for jsdom — MUST be at top, before any import that
// transitively loads hullCache.ts.
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as unknown as { Path2D: new (d?: string) => unknown }).Path2D =
    class Path2D {
      constructor(_d?: string) {}
    } as unknown as new (d?: string) => unknown;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

const hullSpy = vi.fn();
const centroidSpy = vi.fn();
vi.mock('d3-polygon', async () => {
  const actual = await vi.importActual<typeof import('d3-polygon')>('d3-polygon');
  return {
    ...actual,
    polygonHull: (...args: Parameters<typeof actual.polygonHull>) => {
      hullSpy(...args);
      return actual.polygonHull(...args);
    },
    polygonCentroid: (...args: Parameters<typeof actual.polygonCentroid>) => {
      centroidSpy(...args);
      return actual.polygonCentroid(...args);
    },
  };
});

import { getHullCache, _resetHullCacheForTest } from '../hullCache';
import type { GraphNode } from '../../../stores/radarStore';

describe('hullCache bridge exclusion (Phase 22 Fix 2, W-22-03)', () => {
  beforeEach(() => {
    _resetHullCacheForTest();
    hullSpy.mockClear();
    centroidSpy.mockClear();
  });

  it('W-22-03: getHullCache excludes kind==="bridge" nodes from hull membership', () => {
    // 3 file nodes in dir "src" + 1 bridge pinned at y=0 with the same dirKey.
    // File-only centroid: cy ≈ (10+10+20)/3 ≈ 13.33.
    // If bridge were included: cy ≈ (10+10+20+0)/4 ≈ 10.
    // Assert cy > 11 to distinguish unambiguously.
    // dirDepth=0 ensures shouldBuildHullAtZoom returns true at every zoom
    // bucket (zoom < 0.6 gates on dirDepth === 0 specifically).
    const nodes: GraphNode[] = [
      { id: 'src/a.ts', dirKey: 'src', dirDepth: 0, kind: 'file', x: 0, y: 10 } as GraphNode,
      { id: 'src/b.ts', dirKey: 'src', dirDepth: 0, kind: 'file', x: 10, y: 10 } as GraphNode,
      { id: 'src/c.ts', dirKey: 'src', dirDepth: 0, kind: 'file', x: 5, y: 20 } as GraphNode,
      { id: 'bridge:ping', dirKey: 'src', dirDepth: 0, kind: 'bridge', x: 5, y: 0 } as GraphNode,
    ];
    const result = getHullCache(nodes, 1.0, 1000);
    const entry = result.get('src');
    expect(entry).toBeDefined();
    expect(entry!.cy).toBeGreaterThan(11);
  });

  it('W-22-03: invariant holds across zoom buckets (cache-epoch sanity)', () => {
    // dirDepth=0 so shouldBuildHullAtZoom(0, zoom) returns true for every
    // bucket including zoom=0.5 (which gates deeper dirs off).
    const nodes: GraphNode[] = [
      { id: 'src/a.ts', dirKey: 'src', dirDepth: 0, kind: 'file', x: 0, y: 10 } as GraphNode,
      { id: 'src/b.ts', dirKey: 'src', dirDepth: 0, kind: 'file', x: 10, y: 10 } as GraphNode,
      { id: 'src/c.ts', dirKey: 'src', dirDepth: 0, kind: 'file', x: 5, y: 20 } as GraphNode,
      { id: 'bridge:ping', dirKey: 'src', dirDepth: 0, kind: 'bridge', x: 5, y: 0 } as GraphNode,
    ];
    for (const zoom of [0.5, 1.0, 2.0, 5.0]) {
      _resetHullCacheForTest();
      const entry = getHullCache(nodes, zoom, 1000).get('src');
      expect(entry).toBeDefined();
      expect(entry!.cy).toBeGreaterThan(11);
    }
  });

  it('W-22-03: bridge-only dirKey is dropped entirely (no cache entry)', () => {
    // Bridges stored in graphNodes carry dirKey='bridge' (Phase 12 D-10) which is
    // already excluded by the dirKey filter. But if some future data path tags a
    // bridge with a file dirKey AND no file siblings, the hull map should NOT
    // create an entry dominated by that bridge.
    const nodes: GraphNode[] = [
      { id: 'bridge:ping', dirKey: 'srcOnlyBridge', dirDepth: 1, kind: 'bridge', x: 5, y: 0 } as GraphNode,
    ];
    const result = getHullCache(nodes, 1.0, 1000);
    expect(result.has('srcOnlyBridge')).toBe(false);
  });
});
