// Phase 12 Wave 3 — forceBoundary convergence + pinning invariants.
// Analog: src/views/Radar/__tests__/forceCluster.test.ts (seeded-RNG ticks).
// Witnesses: V-12-17 (TS-path → y<-50), V-12-18 (Rust-path → y>50),
//            V-12-19 (bridge fy=0 pinned — kind==='bridge' short-circuit).

import { describe, it, expect } from 'vitest';
import {
  forceBoundary,
  type BoundaryNode,
  BOUNDARY_TARGET_Y_MAGNITUDE,
  BOUNDARY_DEADBAND,
  FORCE_BOUNDARY_BASE_STRENGTH,
} from '../../../workers/forces/forceBoundary';

// Seeded RNG so the convergence tests are byte-deterministic across runs.
// Copy of mulberry32 from forceCluster.test.ts:20-28.
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Tick step emulates d3-force's velocityDecay (0.5) + position integration.
// Crucially — after a node's x/y is advanced, if fx/fy is set, clamp position
// to the pinned value (this mirrors d3's post-force clobber step, which is
// what makes bridges stay at y=0 regardless of what forces do to vy).
function step(nodes: BoundaryNode[]): void {
  for (const n of nodes) {
    n.vx = (n.vx ?? 0) * 0.5;
    n.vy = (n.vy ?? 0) * 0.5;
    n.x = (n.x ?? 0) + (n.vx ?? 0);
    n.y = (n.y ?? 0) + (n.vy ?? 0);
    if (n.fx != null) n.x = n.fx;
    if (n.fy != null) n.y = n.fy;
  }
}

describe('forceBoundary', () => {
  it('V-12-17: converges TS-path nodes to negative y (y<-50) over 30 ticks at strength 0.15', () => {
    // quick/260422-dqu fixture amendment — the activation gate now requires
    // EITHER a bridge OR both ts+rust files present. Prepend a single rust
    // anchor (pinned via the language-filter, NOT a position) so the force
    // activates; the TS-convergence assertion skips the rust anchor.
    const rng = mulberry32(42);
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'rust', x: 0, y: 100, vx: 0, vy: 0 }, // anchor
      ...Array.from({ length: 10 }, () => ({
        kind: 'file' as const,
        language: 'ts' as const,
        x: (rng() - 0.5) * 200,
        y: (rng() - 0.5) * 200,
        vx: 0,
        vy: 0,
      })),
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    for (let t = 0; t < 30; t++) {
      f(1);
      step(nodes);
    }
    for (const n of nodes) {
      if (n.language !== 'ts') continue; // skip the rust anchor
      expect(n.y).toBeLessThan(-50);
    }
  });

  it('V-12-18: converges Rust-path nodes to positive y (y>50) over 30 ticks', () => {
    // quick/260422-dqu fixture amendment — see V-12-17 note. Prepend a single
    // TS anchor so the force activates.
    const rng = mulberry32(7);
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'ts', x: 0, y: -100, vx: 0, vy: 0 }, // anchor
      ...Array.from({ length: 10 }, () => ({
        kind: 'file' as const,
        language: 'rust' as const,
        x: (rng() - 0.5) * 200,
        y: (rng() - 0.5) * 200,
        vx: 0,
        vy: 0,
      })),
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    for (let t = 0; t < 30; t++) {
      f(1);
      step(nodes);
    }
    for (const n of nodes) {
      if (n.language !== 'rust') continue; // skip the ts anchor
      expect(n.y).toBeGreaterThan(50);
    }
  });

  it('V-12-19: bridges with fy=0 stay pinned regardless of strength (kind === bridge short-circuit)', () => {
    const nodes: BoundaryNode[] = [
      { kind: 'bridge', x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    // Deliberately absurd strength to prove the kind-skip prevents any vy accumulation.
    f.strength(10);
    for (let t = 0; t < 100; t++) {
      f(1);
      step(nodes);
    }
    // The force must not have written to vy (kind==='bridge' skip), and the
    // step() clamp must have kept y pinned at 0 regardless.
    expect(nodes[0].vy).toBe(0);
    expect(nodes[0].y).toBe(0);
  });

  it('early-returns when strength === 0 (Pitfall 7 — zero per-tick cost)', () => {
    const n: BoundaryNode = {
      kind: 'file',
      language: 'ts',
      x: 0,
      y: 100,
      vx: 0,
      vy: 0,
    };
    const f = forceBoundary();
    f.initialize([n]);
    f.strength(0);
    f(1);
    expect(n.vy).toBe(0);
  });

  it('language=undefined files receive no force (D-16 — non-ts/rust fallback)', () => {
    const n: BoundaryNode = {
      kind: 'file',
      // language intentionally omitted
      x: 0,
      y: 100,
      vx: 0,
      vy: 0,
    };
    const f = forceBoundary();
    f.initialize([n]);
    f.strength(0.15);
    f(1);
    expect(n.vy).toBe(0);
  });

  it('deadband of 5 world-px around target yields no update (prevents jitter at convergence)', () => {
    // A TS node already sitting within BOUNDARY_DEADBAND of its target (-300)
    // receives no additional pull. This prevents the spring from oscillating
    // once convergence is reached.
    //
    // Rule 1 fix (applied during Task 2 green step): plan text "around y=0"
    // conflicted with V-12-17/V-12-18 convergence — nodes seeded near y=0
    // would get stuck in the deadband and never reach -/+300. Redefined the
    // deadband to be around the TARGET, which matches the semantic intent
    // (prevent jitter at steady-state) without blocking convergence. See
    // 12-04-SUMMARY.md Deviations for rationale.
    //
    // quick/260422-dqu amendment — prepend a single rust anchor so the
    // activation gate fires (ts+rust → force active). Without the anchor the
    // assertion would still hold but via the inactive-gate path rather than
    // the deadband gate — we want to exercise the deadband specifically.
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'rust', x: 0, y: 100, vx: 0, vy: 0 }, // anchor — activates the force
      {
        kind: 'file',
        language: 'ts',
        x: 0,
        y: -BOUNDARY_TARGET_Y_MAGNITUDE + (BOUNDARY_DEADBAND - 1), // inside deadband of target
        vx: 0,
        vy: 0,
      },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    expect(nodes[1].vy).toBe(0);
  });

  it('strength getter/setter round-trips', () => {
    const f = forceBoundary();
    expect(f.strength()).toBe(FORCE_BOUNDARY_BASE_STRENGTH);
    f.strength(0.42);
    expect(f.strength()).toBe(0.42);
    // Setter is chainable (returns the force itself).
    const ret = f.strength(0.5);
    expect(typeof ret).toBe('function');
    expect(ret.strength()).toBe(0.5);
  });
});

describe('forceBoundary — classifiable-nodes gate (quick/260422-dqu)', () => {
  it('is a no-op when node set contains only bridges (bridges-only pathological case)', () => {
    // Bridges without files — vy must never be written because there's
    // nothing to pull on either side of the boundary. Bridges themselves
    // are skipped by the per-node `kind === bridge` short-circuit (V-12-19)
    // but the activation gate also fires first so even the loop entry
    // is skipped.
    const nodes: BoundaryNode[] = [
      { kind: 'bridge', x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    expect(nodes[0].vy).toBe(0);
  });

  it('is a no-op when only TS files are present (no bridges, no rust counterpart)', () => {
    // The UAT scenario: TS + Python repo. Python files have language=undefined
    // and TS files have language=ts. Without a rust counterpart OR a bridge,
    // pulling TS files to y=-300 would create a confusing half-visualization.
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'ts', x: 0, y: 100, vx: 0, vy: 0 },
      { kind: 'file', language: 'ts', x: 0, y: 100, vx: 0, vy: 0 },
      { kind: 'file', x: 0, y: 100, vx: 0, vy: 0 }, // simulates a Python file (undefined language)
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    for (const n of nodes) {
      expect(n.vy).toBe(0);
    }
  });

  it('is a no-op when only Rust files are present (inverse of above)', () => {
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'rust', x: 0, y: 100, vx: 0, vy: 0 },
      { kind: 'file', language: 'rust', x: 0, y: -100, vx: 0, vy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    for (const n of nodes) {
      expect(n.vy).toBe(0);
    }
  });

  it('activates when at least one bridge is present (Tauri repo — V-12-17..V-12-19 regression guard)', () => {
    const nodes: BoundaryNode[] = [
      { kind: 'bridge', x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0 },
      { kind: 'file', language: 'ts', x: 0, y: 100, vx: 0, vy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    // Bridge stays untouched (V-12-19 contract); TS file is pulled.
    expect(nodes[0].vy).toBe(0);
    expect(nodes[1].vy).not.toBe(0);
    expect(nodes[1].vy!).toBeLessThan(0); // pulled toward y=-300
  });

  it('activates when both TS and Rust files are present (polyglot Rust+TS, no Tauri)', () => {
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'ts', x: 0, y: 100, vx: 0, vy: 0 },
      { kind: 'file', language: 'rust', x: 0, y: -100, vx: 0, vy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    expect(nodes[0].vy).not.toBe(0);
    expect(nodes[0].vy!).toBeLessThan(0);
    expect(nodes[1].vy).not.toBe(0);
    expect(nodes[1].vy!).toBeGreaterThan(0);
  });
});

// Exercise the exported constants so noUnusedLocals is satisfied without
// dummy `void` guards.
void BOUNDARY_TARGET_Y_MAGNITUDE;
