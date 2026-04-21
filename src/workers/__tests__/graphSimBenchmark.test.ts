// Phase 11 — performance benchmark harness (D-31..D-34).
// Gated behind RUN_BENCHMARKS=1 to keep `npm run test` fast; developers opt in.
// Wave 0 scaffold; Wave 3 implements the per-tick wall-clock cost
// measurement (fallback when jsdom can't observe longtask) + per-frame
// bracketing. References: 11-RESEARCH.md §Performance Benchmark Harness.

import { describe, it } from 'vitest';

describe.skipIf(!process.env.RUN_BENCHMARKS)('graphSimCore — perf harness (D-31..D-34)', () => {
  it.todo('5k-node settle: zero >50ms long tasks on main (D-31)');
  it.todo('worker drives ≥30 effective ticks/sec at 5k nodes (D-33)');
  it.todo('main-frame render cost 95p < 2ms (D-32)');
  it.todo('in-flight transfer count stays ≤2 under steady state (D-34)');
});
