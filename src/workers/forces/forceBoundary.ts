// Phase 12 Wave 3 — boundary-bifurcation custom d3-force.
// Pulls TS-language file nodes toward y = -BOUNDARY_TARGET_Y_MAGNITUDE and
// Rust-language file nodes toward y = +BOUNDARY_TARGET_Y_MAGNITUDE. Bridges
// (kind='bridge') are pinned by fy from the store, so this force short-
// circuits them to avoid wasted math — d3-force applies fy after all force
// callbacks run, so even if we wrote vy, the bridge position would still be
// clamped. Skipping is a perf + clarity win.
//
// Analog: src/views/Radar/forceCluster.ts (RESEARCH §Pattern 4 body shape).
// References: 12-CONTEXT.md D-10, D-13, D-16, D-29, D-30, D-37;
//             12-RESEARCH.md §Pattern 4 (spring math + deadband),
//                            §Pitfall 7 (zero-strength early-return).

import type { SimulationNodeDatum } from 'd3-force';

export interface BoundaryNode extends SimulationNodeDatum {
  kind?: 'file' | 'bridge';
  language?: 'ts' | 'rust';
}

export interface BoundaryForce {
  (alpha: number): void;
  initialize: (nodes: BoundaryNode[]) => void;
  strength: ((v: number) => BoundaryForce) & (() => number);
}

// Tuning constants — exported so tests and tuning panels can reference them
// without magic numbers (Phase 12 D-29, CONTEXT.md lines 120-140).
export const BOUNDARY_TARGET_Y_MAGNITUDE = 300;
export const BOUNDARY_DEADBAND = 5;
export const FORCE_BOUNDARY_BASE_STRENGTH = 0.15;

export function forceBoundary(): BoundaryForce {
  let nodes: BoundaryNode[] = [];
  let strength = FORCE_BOUNDARY_BASE_STRENGTH;
  // Phase 12 fix (quick/260422-dqu) — gate on presence of a meaningful FE/BE
  // divide. Three activation modes (computed once in initialize, not per-tick):
  //   (a) at least one bridge is present (Tauri IPC surface → boundary line
  //       + labels + slider all rendered per Task 1's gate);
  //   (b) at least one ts-classified AND one rust-classified file are
  //       present (pure polyglot Rust+TS repo with no Tauri binding, e.g. a
  //       standalone Rust crate + web frontend).
  // If only one side is classifiable (TS+Python, Rust+Go) OR the node set
  // contains only bridges, the force becomes a pure no-op — otherwise TS-
  // classified files on a repo with no Rust counterpart would float up
  // toward y=-300 while Python files (no classification) stayed near y=0,
  // producing the confusing half-visualization reported in 12-05 UAT.
  let inactive = false;

  const force = ((alpha: number) => {
    if (inactive) return;
    const k = strength * alpha;
    // RESEARCH §Pitfall 7 — zero-strength early-return. Avoids O(N) work
    // when the slider is dragged to 0 or when the simulation is in a
    // quiescent ramp-down phase.
    if (k === 0) return;

    for (const n of nodes) {
      // D-10: bridges are fy-pinned by the store; skipping short-circuits
      // wasted vy accumulation (d3-force overwrites vy with fy anyway, so
      // skipping is equivalent and cheaper).
      if (n.kind === 'bridge') continue;
      // D-16: files without a ts/rust classification (e.g. .md, .json, or
      // untyped fixtures) receive no boundary pull — they drift with the
      // other forces rather than being pushed to an arbitrary side.
      if (n.language !== 'ts' && n.language !== 'rust') continue;

      const targetY =
        n.language === 'ts'
          ? -BOUNDARY_TARGET_Y_MAGNITUDE
          : BOUNDARY_TARGET_Y_MAGNITUDE;
      const y = n.y ?? 0;
      const dy = targetY - y;
      // Deadband: when a node sits within ±BOUNDARY_DEADBAND of its target,
      // stop pulling. Prevents tick-to-tick jitter at the convergence point
      // (the force would otherwise perpetually nudge the node past the
      // target and back as vy oscillates).
      if (Math.abs(dy) < BOUNDARY_DEADBAND) continue;
      // Spring pull: accelerate vy toward the target, scaled by k (strength×alpha).
      // Min-clamp the distance so very-far nodes don't produce explosive
      // impulses in the first few chaotic ticks.
      n.vy =
        (n.vy ?? 0) +
        Math.sign(dy) * k * Math.min(Math.abs(dy), BOUNDARY_TARGET_Y_MAGNITUDE);
    }
  }) as BoundaryForce;

  force.initialize = (n: BoundaryNode[]) => {
    nodes = n;
    // quick/260422-dqu — compute activation once per node-set change.
    // Requires EITHER a bridge (Tauri IPC surface) OR both ts+rust files
    // present. Short-circuits as soon as a matching configuration is found.
    let hasBridge = false;
    let hasTs = false;
    let hasRust = false;
    for (const x of n) {
      if (x.kind === 'bridge') {
        hasBridge = true;
      } else if (x.language === 'ts') {
        hasTs = true;
      } else if (x.language === 'rust') {
        hasRust = true;
      }
      if (hasBridge || (hasTs && hasRust)) break;
    }
    inactive = !(hasBridge || (hasTs && hasRust));
  };
  force.strength = ((v?: number) => {
    if (v === undefined) return strength;
    strength = v;
    return force;
  }) as BoundaryForce['strength'];

  return force;
}
