// Phase 11.1 — hullCache unit tests (D-08..D-11, D-15).

// Path2D polyfill for jsdom (Canvas 2D constructors not available in test env).
// MUST be at the top, BEFORE any import that transitively loads hullCache.ts.
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as unknown as { Path2D: new (d?: string) => unknown }).Path2D =
    class Path2D {
      constructor(_d?: string) {}
    } as unknown as new (d?: string) => unknown;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// D-15: polygonHull is invoked inside hullCache.getHullCache. ESM module
// namespaces are read-only in Vitest, so vi.spyOn(d3polygon, 'polygonHull')
// throws "Cannot redefine property". Instead, vi.mock() replaces the import
// with a spy-able wrapper that counts calls through hullSpy. RESEARCH §Pattern 3
// anticipated this via the "Deviation Rule 3 - Blocker" note in the plan's
// VALIDATION ledger — see SUMMARY.
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

const nodes: GraphNode[] = [
  { id: 'src/a.ts', dirKey: 'src', dirDepth: 1, x: 0, y: 0 } as GraphNode,
  { id: 'src/b.ts', dirKey: 'src', dirDepth: 1, x: 10, y: 0 } as GraphNode,
  { id: 'src/c.ts', dirKey: 'src', dirDepth: 1, x: 5, y: 10 } as GraphNode,
  { id: 'src/d.ts', dirKey: 'src', dirDepth: 1, x: 5, y: 5 } as GraphNode,
];

describe('hullCache (D-08..D-11)', () => {
  beforeEach(() => {
    _resetHullCacheForTest();
    hullSpy.mockClear();
    centroidSpy.mockClear();
  });

  it('D-08: calls polygonHull once per dir when settledAt + zoom unchanged', () => {
    getHullCache(nodes, 1.0, 1000);
    getHullCache(nodes, 1.0, 1000);
    expect(hullSpy).toHaveBeenCalledTimes(1); // one dir × one call
  });

  it('D-09: rebuilds when settledAt changes', () => {
    getHullCache(nodes, 1.0, 1000);
    getHullCache(nodes, 1.0, 2000);
    expect(hullSpy).toHaveBeenCalledTimes(2);
  });

  it('D-09: rebuilds when settledAt becomes null (fetchGraph path)', () => {
    getHullCache(nodes, 1.0, 1000);
    getHullCache(nodes, 1.0, null);
    expect(hullSpy).toHaveBeenCalledTimes(2);
  });

  it('D-11 corollary: rebuilds on zoom-bucket change (documented tradeoff)', () => {
    getHullCache(nodes, 1.0, 1000); // bucket 1.0
    getHullCache(nodes, 1.05, 1000); // bucket 1.1 — different bucket
    expect(hullSpy).toHaveBeenCalledTimes(2);
  });

  it('D-11 corollary: does NOT rebuild when zoom stays in the same bucket', () => {
    getHullCache(nodes, 1.01, 1000); // bucket 1.0
    getHullCache(nodes, 1.04, 1000); // bucket 1.0 (Math.round(1.04*10)/10 = 1.0)
    expect(hullSpy).toHaveBeenCalledTimes(1);
  });

  it('D-08: cache entry bundle contains smoothPath, cx, cy, isCircleFallback, dirDepth', () => {
    const result = getHullCache(nodes, 1.0, 1000);
    const entry = result.get('src');
    expect(entry).toBeDefined();
    expect(entry!.isCircleFallback).toBe(false); // 4 nodes → hull
    expect(entry!.dirDepth).toBe(1);
    expect(typeof entry!.cx).toBe('number');
    expect(typeof entry!.cy).toBe('number');
  });
});
