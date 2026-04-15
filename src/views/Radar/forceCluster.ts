// D-11: Custom d3 force pulling each node toward its parent-directory centroid.
// Strength scales linearly with directory depth (deeper = tighter cluster) per
// 07-CONTEXT.md D-11 and 07-RESEARCH.md §Pattern 2 (lines 256-309).
// Per-tick centroid recomputation — O(n) per tick, negligible at 10k
// relative to Barnes-Hut charge (RESEARCH line 311).
//
// Prior art: observablehq.com/@nbremer/custom-cluster-force-layout
//            github.com/ericsoco/d3-force-cluster
//
// Implementation notes:
//   - `forceCluster` is invoked by d3-force's simulation with the current
//     alpha; each call nudges node velocities toward the parent-dir centroid.
//   - We honor d3's force interface: `(alpha)` callable, `initialize(nodes)`,
//     `strength` getter/setter that chains on set.

import type { SimulationNodeDatum } from 'd3-force';

export interface ClusterNode extends SimulationNodeDatum {
  dirKey: string;
  dirDepth: number;
}

export interface ClusterForce {
  (alpha: number): void;
  initialize: (nodes: ClusterNode[]) => void;
  strength: ((v: number) => ClusterForce) & (() => number);
}

// Tuning constants — exported so tests and tuning panels can reference
// them without magic numbers (RESEARCH §Pattern 2 lines 278-279).
export const FORCE_CLUSTER_BASE_STRENGTH = 0.08;
export const FORCE_CLUSTER_DEPTH_WEIGHT = 0.4;

/** Pure function: `strength(depth) = base * (1 + depth * 0.4)` (D-11). */
export function depthMultiplier(depth: number): number {
  return 1 + depth * FORCE_CLUSTER_DEPTH_WEIGHT;
}

export function forceCluster(): ClusterForce {
  let nodes: ClusterNode[] = [];
  let strength = FORCE_CLUSTER_BASE_STRENGTH;

  function centroids(): Map<string, { cx: number; cy: number; n: number }> {
    const acc = new Map<string, { cx: number; cy: number; n: number }>();
    for (const node of nodes) {
      const e = acc.get(node.dirKey) ?? { cx: 0, cy: 0, n: 0 };
      e.cx += node.x ?? 0;
      e.cy += node.y ?? 0;
      e.n += 1;
      acc.set(node.dirKey, e);
    }
    for (const e of acc.values()) {
      e.cx /= e.n;
      e.cy /= e.n;
    }
    return acc;
  }

  const force = ((alpha: number) => {
    const cs = centroids();
    for (const node of nodes) {
      const c = cs.get(node.dirKey);
      if (!c) continue;
      const k = strength * depthMultiplier(node.dirDepth) * alpha;
      node.vx = (node.vx ?? 0) + (c.cx - (node.x ?? 0)) * k;
      node.vy = (node.vy ?? 0) + (c.cy - (node.y ?? 0)) * k;
    }
  }) as ClusterForce;

  force.initialize = (n: ClusterNode[]) => {
    nodes = n;
  };
  force.strength = ((v?: number) => {
    if (v === undefined) return strength;
    strength = v;
    return force;
  }) as ClusterForce['strength'];

  return force;
}
