// Phase 12 Wave 2 target: forceBoundary convergence + pinning invariants.
// Analog: src/views/Radar/__tests__/forceCluster.test.ts
// Witnesses: V-12-17 (TS-path → y<-50), V-12-18 (Rust-path → y>50), V-12-19 (bridge fy=0 pinned).

import { describe, it } from 'vitest';
import {
  forceBoundary,
  BOUNDARY_TARGET_Y_MAGNITUDE,
  BOUNDARY_DEADBAND,
  FORCE_BOUNDARY_BASE_STRENGTH,
} from '../../../workers/forces/forceBoundary';

// noUnusedLocals guards until Wave 2 consumes these.
// Wave 2 will re-add `type BoundaryForce, type BoundaryNode` to the import
// when mkBoundaryNode() / signature-bearing helpers land.
void forceBoundary;
void BOUNDARY_TARGET_Y_MAGNITUDE;
void BOUNDARY_DEADBAND;
void FORCE_BOUNDARY_BASE_STRENGTH;

// mulberry32 seeded RNG — copy from forceCluster.test.ts:20-28 in Wave 2.
// function mulberry32(seed: number) { /* … */ }

describe('forceBoundary', () => {
  it.todo('V-12-17: converges TS-path nodes to negative y (y<-50) over 30 ticks at strength 0.15');
  it.todo('V-12-18: converges Rust-path nodes to positive y (y>50) over 30 ticks');
  it.todo('V-12-19: bridges with fy=0 stay pinned regardless of strength (kind !== file short-circuit)');
  it.todo('early-returns when strength === 0 (Pitfall 7 — zero per-tick cost)');
  it.todo('language=undefined files receive no force (D-16 — non-ts/rust fallback)');
  it.todo('deadband of 5 world-px around y=0 yields no update');
  it.todo('strength getter/setter round-trips');
});
