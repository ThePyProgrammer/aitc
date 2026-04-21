// Phase 12 Wave 2 target: boundary-bifurcation custom d3-force.
// Wave 0 scaffold: BoundaryForce contract + constants + no-op tick body.
// Analog: src/views/Radar/forceCluster.ts (D-30 deferred relocation per Phase 11; D-37).
//
// Wave 2 will fill in the spring math (distance-based pull toward targetY by
// language, with a deadband of ±5 world-px around y=0 and an early-return when
// strength === 0 per RESEARCH §Pitfall 7).

import type { SimulationNodeDatum } from 'd3-force';

export interface BoundaryNode extends SimulationNodeDatum {
  kind: 'file' | 'bridge';
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

  const force = ((_alpha: number) => {
    // Wave 2 fills in: spring math with deadband, targetY by language,
    // early-return if strength === 0 (RESEARCH Pitfall 7).
    void nodes; // noUnusedLocals guard until Wave 2
  }) as BoundaryForce;

  force.initialize = (n: BoundaryNode[]) => {
    nodes = n;
  };
  force.strength = ((v?: number) => {
    if (v === undefined) return strength;
    strength = v;
    return force;
  }) as BoundaryForce['strength'];

  return force;
}
