// Phase 11.1 — Folder-hull cache keyed on (settledAt, zoom-bucket).
//
// D-08..D-11 / D-15: cache the expensive per-directory hull bundle
// (paddedHullPoints → polygonHull → smoothHullLine → polygonCentroid)
// so a settled graph does not re-run O(n log n) convex-hull math every
// animation frame during a wheel-zoom burst. The coarse invalidation
// contract (D-09): any change to node positions evicts the WHOLE cache;
// positions are only written via commitSettledPositions, which bumps
// settledAt atomically. Zoom is bucketed at 0.1 granularity because
// current padding (25/zoom) is zoom-dependent — world-space-constant
// padding would be a visual-behavior change and is out of scope.
//
// Public surface:
//   - getHullCache(nodes, zoom, settledAt) → Map<dirKey, HullCacheEntry>
//   - _resetHullCacheForTest() — test-only cache eviction
//
// Invariant: kind === 'bridge' nodes are excluded from hull membership.
// Bridges are pinned on the y=0 boundary line and would drag folder centroids
// toward it if included. Enforced inside the group-by-dirKey loop below.

import { polygonHull, polygonCentroid } from 'd3-polygon';
import { line, curveCatmullRomClosed } from 'd3-shape';
import type { GraphNode } from '../../stores/radarStore';

// Phase 11.1 — duplicate of GraphRenderer.ts::shouldRenderHullAtZoom to avoid
// a circular import (hullCache → GraphRenderer → hullCache). The three-tier
// zoom gate is small and stable; if it changes, update both copies. The
// filter MUST run inside the cache build — without it, we pay convex-hull +
// Catmull-Rom + Path2D construction for every deep-nested directory even
// though drawFolderHulls skips them at paint time, which dominated the
// per-rebuild cost on user hardware.
function shouldBuildHullAtZoom(dirDepth: number, zoom: number): boolean {
  if (zoom < 0.6) return dirDepth === 0;
  if (zoom < 2) return dirDepth <= 2;
  return true;
}

export interface HullCacheEntry {
  /** Pre-computed closed Catmull-Rom spline Path2D. null when <3 hull points. */
  smoothPath: Path2D | null;
  /** Centroid for label placement. For <3-node dirs, mean of node positions. */
  cx: number;
  cy: number;
  /** True when the directory had <3 nodes and drew as a circle fallback. */
  isCircleFallback: boolean;
  /** Depth from repo root — drives shouldRenderHullAtZoom gating. */
  dirDepth: number;
}

// Module-level state. Cleared on any (settledAt, zoom-bucket) change.
let cacheEpoch: string = '__sentinel__'; // never matches a real composite key
let cache: Map<string, HullCacheEntry> = new Map();

// Allocated once at module load; reused across rebuilds.
const smoothHullLine = line().curve(curveCatmullRomClosed.alpha(0.5));

function paddedHullPoints(
  nodePoints: [number, number][],
  radius: number,
  resolution = 10,
): [number, number][] {
  const result: [number, number][] = [];
  for (const [x, y] of nodePoints) {
    for (let i = 0; i < resolution; i++) {
      const a = (i / resolution) * Math.PI * 2;
      result.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius]);
    }
  }
  return result;
}

/**
 * Resolve per-directory hull bundles, rebuilding the cache on any change
 * to (settledAt, zoom-bucket). Zoom-bucket granularity is 0.1.
 */
export function getHullCache(
  nodes: GraphNode[],
  zoom: number,
  settledAt: number | null,
): Map<string, HullCacheEntry> {
  const zoomBucket = Math.round(zoom * 10) / 10;
  const epoch = `${settledAt ?? 'null'}|${zoomBucket}`;
  if (epoch === cacheEpoch) return cache;

  cacheEpoch = epoch;
  cache = new Map();

  // Group nodes by dirKey. Skip empty-dirKey roots and uninitialized positions.
  const byDir = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    if (n.dirKey === '') continue;
    if (n.kind === 'bridge') continue;
    const arr = byDir.get(n.dirKey) ?? [];
    arr.push(n);
    byDir.set(n.dirKey, arr);
  }

  const paddingRadius = 25 / zoom;
  for (const [dirKey, members] of byDir) {
    const dirDepth = members[0].dirDepth;
    // Skip hulls that drawFolderHulls would filter out anyway at the current
    // zoom. Computing them here is pure waste and dominated the cache-miss
    // cost for deeply-nested repos.
    if (!shouldBuildHullAtZoom(dirDepth, zoom)) continue;
    const pts = members.map((n) => [n.x!, n.y!] as [number, number]);
    const padded = paddedHullPoints(pts, paddingRadius);
    const hull = polygonHull(padded);
    if (hull && hull.length >= 3) {
      const pathStr = smoothHullLine(hull);
      const smoothPath = pathStr ? new Path2D(pathStr) : null;
      const [cx, cy] = polygonCentroid(hull);
      cache.set(dirKey, { smoothPath, cx, cy, isCircleFallback: false, dirDepth });
    } else {
      const cx = members.reduce((s, n) => s + (n.x ?? 0), 0) / members.length;
      const cy = members.reduce((s, n) => s + (n.y ?? 0), 0) / members.length;
      cache.set(dirKey, { smoothPath: null, cx, cy, isCircleFallback: true, dirDepth });
    }
  }
  return cache;
}

/** Test-only — force a cache eviction. */
export function _resetHullCacheForTest(): void {
  cacheEpoch = '__sentinel__';
  cache = new Map();
}
