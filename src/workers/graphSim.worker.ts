// Phase 11 — dedicated-worker shim for d3-force relocation (D-01, D-02, D-23).
// Thin (~50 LOC) postMessage router + transfer-list plumbing. All orchestration
// lives in graphSimCore.ts so the shim has minimal testable logic (D-22/D-23).
// References: 11-CONTEXT.md D-01/D-02/D-13/D-23; 11-RESEARCH.md §Example B + §Pattern 2.
/// <reference lib="webworker" />

import { makeGraphSimCore } from './graphSimCore';
import type { WorkerIn, WorkerOut } from './graphSimProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const core = makeGraphSimCore(
  {
    onTick: (m) =>
      ctx.postMessage(
        { type: 'tick', positions: m.positions, alpha: m.alpha, sequence: m.sequence } satisfies WorkerOut,
        { transfer: [m.positions.buffer] },
      ),
    onSettled: (m) =>
      ctx.postMessage(
        { type: 'settled', positions: m.positions, alpha: m.alpha, sequence: m.sequence } satisfies WorkerOut,
        { transfer: [m.positions.buffer] },
      ),
    onError: (m) =>
      ctx.postMessage(
        { type: 'error', message: m.message, stack: m.stack } satisfies WorkerOut,
      ),
  },
  {
    // D-13 rationale (updated per RESEARCH Contradictions): decouple tick rate
    // from display vsync so the worker can saturate a non-main core (D-14).
    schedule: (fn) => { setTimeout(fn, 0); },
  },
);

ctx.onmessage = (evt: MessageEvent<WorkerIn>) => {
  const m = evt.data;
  switch (m.type) {
    case 'init':         core.init(m); break;
    case 'topology':     core.topology(m); break;
    case 'updateConfig': core.updateConfig(m.config); break;
    case 'pin':          core.pin(m.id, m.x, m.y); break;
    case 'unpin':        core.unpin(m.id); break;
    case 'returnBuffer': core.returnBuffer(m.buffer); break;
    case 'dispose':      core.dispose(); ctx.close(); break;
    default: {
      const _exhaustive: never = m;
      void _exhaustive;
    }
  }
};

export {};
