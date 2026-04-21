// Phase 11 — dedicated-worker shim for d3-force relocation (D-01, D-02, D-23).
// Thin (~50 LOC) postMessage router + buffer pool. All orchestration lives
// in graphSimCore.ts so the shim has minimal testable logic (D-22/D-23).
//
// Wave 0 stub: valid module declaration + lib reference. Wave 2 wires
// ctx.onmessage router and postMessage transfer plumbing (Example B in
// 11-RESEARCH.md and §graphSim.worker.ts in 11-PATTERNS.md).
//
// References: 11-CONTEXT.md D-01/D-02/D-23; 11-RESEARCH.md §Example B.
/// <reference lib="webworker" />

import { makeGraphSimCore } from './graphSimCore';
import type { WorkerIn, WorkerOut } from './graphSimProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Prevent "unused" errors on Wave 0 stub — real usage lands in Wave 2.
void ctx;
void makeGraphSimCore;
void (null as unknown as WorkerIn);
void (null as unknown as WorkerOut);

export {};
