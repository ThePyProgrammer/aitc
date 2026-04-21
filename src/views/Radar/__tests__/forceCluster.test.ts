// Plan 03 (D-11). Covers the custom d3 force that pulls each node
// toward its parent-directory centroid with linear depth-decay
// strength(depth) = base * (1 + depth * 0.4).
//
// References:
//   07-RESEARCH.md §Pattern 2 (lines 256-309)
//   07-CONTEXT.md D-11 (per-directory centroid gravity)
//   07-UI-SPEC motion timings (settle cadence owned by useGraphLayout)
import { describe, it, expect } from 'vitest';
import {
  forceCluster,
  depthMultiplier,
  FORCE_CLUSTER_BASE_STRENGTH,
  FORCE_CLUSTER_DEPTH_WEIGHT,
  type ClusterNode,
} from '../forceCluster';

// mulberry32 seeded RNG — keeps layout tests deterministic
// per 07-RESEARCH §Validation Determinism (lines 900-907).
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe('forceCluster (custom d3 force) — Plan 03', () => {
  it('depth-weight: strength(depth) = base * (1 + depth * 0.4) (D-11, RESEARCH §Pattern 2)', () => {
    // depthMultiplier is a pure fn extracted from the force body.
    expect(depthMultiplier(0)).toBe(1);
    expect(depthMultiplier(1)).toBeCloseTo(1.4, 10);
    expect(depthMultiplier(5)).toBeCloseTo(3, 10);
    expect(FORCE_CLUSTER_BASE_STRENGTH).toBe(0.08);
    expect(FORCE_CLUSTER_DEPTH_WEIGHT).toBe(0.4);
    // Regression check on the multiplier ratio (RESEARCH lines 263-264):
    //   depth=5 ≈ 3x stronger than depth=0.
    expect(depthMultiplier(5) / depthMultiplier(0)).toBeCloseTo(3, 5);
  });

  it('pulls each node toward its parent-dir centroid per tick', () => {
    // Seeded cluster of 4 nodes sharing dirKey='a'. With only the
    // cluster force active and alpha=1, after 100 ticks all nodes must
    // collapse onto a shared centroid.
    const rng = mulberry32(42);
    const nodes: ClusterNode[] = Array.from({ length: 4 }, () => ({
      dirKey: 'a',
      dirDepth: 2,
      x: (rng() - 0.5) * 200,
      y: (rng() - 0.5) * 200,
      vx: 0,
      vy: 0,
    }));

    const cluster = forceCluster();
    cluster.initialize(nodes);
    // Crank strength so a single-force simulation converges quickly —
    // the real simulation pairs this force with velocityDecay inside
    // useGraphLayout, so we emulate that here manually.
    cluster.strength(1.0);

    for (let tick = 0; tick < 200; tick++) {
      cluster(1);
      for (const n of nodes) {
        // Apply manual damping (d3-force's velocityDecay) so we don't
        // orbit the centroid forever.
        n.vx = (n.vx ?? 0) * 0.5;
        n.vy = (n.vy ?? 0) * 0.5;
        n.x = (n.x ?? 0) + (n.vx ?? 0);
        n.y = (n.y ?? 0) + (n.vy ?? 0);
      }
    }

    const cx = nodes.reduce((s, n) => s + (n.x ?? 0), 0) / nodes.length;
    const cy = nodes.reduce((s, n) => s + (n.y ?? 0), 0) / nodes.length;
    for (const n of nodes) {
      expect(Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy)).toBeLessThan(1);
    }
  });

  it('strength getter/setter round-trips and returns the force for chaining', () => {
    const f = forceCluster();
    // Default = FORCE_CLUSTER_BASE_STRENGTH.
    expect(f.strength()).toBe(FORCE_CLUSTER_BASE_STRENGTH);
    const returned = f.strength(0.1);
    expect(returned).toBe(f);
    expect(f.strength()).toBe(0.1);
  });

  it('files in the same directory cluster within 100 world units after settle (VIZN-05)', () => {
    // VIZN-05 regression: ten files in `src/foo` converge to a tight
    // cluster under the combined cluster+damping scheme below. The
    // full d3-force integration test lives in useGraphLayout.test.ts —
    // here we validate the force itself in isolation.
    const rng = mulberry32(7);
    const nodes: ClusterNode[] = Array.from({ length: 10 }, () => ({
      dirKey: 'src/foo',
      dirDepth: 2,
      x: (rng() - 0.5) * 400,
      y: (rng() - 0.5) * 400,
      vx: 0,
      vy: 0,
    }));
    const cluster = forceCluster();
    cluster.initialize(nodes);
    cluster.strength(0.5);

    for (let tick = 0; tick < 300; tick++) {
      cluster(1);
      for (const n of nodes) {
        n.vx = (n.vx ?? 0) * 0.5;
        n.vy = (n.vy ?? 0) * 0.5;
        n.x = (n.x ?? 0) + (n.vx ?? 0);
        n.y = (n.y ?? 0) + (n.vy ?? 0);
      }
    }

    // Mean pairwise distance must be well under 100 world units.
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
