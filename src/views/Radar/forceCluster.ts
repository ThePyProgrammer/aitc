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

// ───── Cluster collision force ─────
// Prevents folder hulls from overlapping by treating each cluster as a
// bounding circle (centroid + max-member-distance + padding) and pushing
// overlapping clusters apart along their centroid-to-centroid axis.

export interface ClusterCollideForce {
  (alpha: number): void;
  initialize: (nodes: ClusterNode[]) => void;
  padding: ((v: number) => ClusterCollideForce) & (() => number);
  strength: ((v: number) => ClusterCollideForce) & (() => number);
}

export const CLUSTER_COLLIDE_PADDING = 30; // world-space px between hull edges
export const CLUSTER_COLLIDE_STRENGTH = 0.7;

export function forceClusterCollide(): ClusterCollideForce {
  let nodes: ClusterNode[] = [];
  let padding = CLUSTER_COLLIDE_PADDING;
  let strength = CLUSTER_COLLIDE_STRENGTH;

  interface ClusterBounds {
    cx: number;
    cy: number;
    r: number; // max distance from centroid to any member + padding
    members: ClusterNode[];
  }

  function computeBounds(): Map<string, ClusterBounds> {
    // Pass 1: accumulate centroids.
    const acc = new Map<string, { sx: number; sy: number; n: number; members: ClusterNode[] }>();
    for (const node of nodes) {
      if (node.dirKey === '') continue;
      const e = acc.get(node.dirKey) ?? { sx: 0, sy: 0, n: 0, members: [] };
      e.sx += node.x ?? 0;
      e.sy += node.y ?? 0;
      e.n += 1;
      e.members.push(node);
      acc.set(node.dirKey, e);
    }
    // Pass 2: compute radii.
    const bounds = new Map<string, ClusterBounds>();
    for (const [key, e] of acc) {
      if (e.n === 0) continue;
      const cx = e.sx / e.n;
      const cy = e.sy / e.n;
      let maxR = 0;
      for (const m of e.members) {
        const dx = (m.x ?? 0) - cx;
        const dy = (m.y ?? 0) - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxR) maxR = d;
      }
      bounds.set(key, { cx, cy, r: maxR + padding, members: e.members });
    }
    return bounds;
  }

  const force = ((alpha: number) => {
    const bounds = computeBounds();
    const clusters = Array.from(bounds.entries());
    // O(n²) over clusters — typically <100 directories, so ~5k comparisons max.
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const [, a] = clusters[i];
        const [, b] = clusters[j];
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = a.r + b.r;
        if (dist >= minDist) continue;
        // Overlap detected — push apart along centroid axis.
        const overlap = (minDist - dist) * 0.5;
        const k = strength * alpha;
        const ux = (dx / dist) * overlap * k;
        const uy = (dy / dist) * overlap * k;
        // Apply to all members of each cluster (move cluster A left, B right).
        for (const m of a.members) {
          m.vx = (m.vx ?? 0) - ux;
          m.vy = (m.vy ?? 0) - uy;
        }
        for (const m of b.members) {
          m.vx = (m.vx ?? 0) + ux;
          m.vy = (m.vy ?? 0) + uy;
        }
      }
    }
  }) as ClusterCollideForce;

  force.initialize = (n: ClusterNode[]) => {
    nodes = n;
  };
  force.padding = ((v?: number) => {
    if (v === undefined) return padding;
    padding = v;
    return force;
  }) as ClusterCollideForce['padding'];
  force.strength = ((v?: number) => {
    if (v === undefined) return strength;
    strength = v;
    return force;
  }) as ClusterCollideForce['strength'];

  return force;
}

// ───── Cluster attraction force ─────

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
