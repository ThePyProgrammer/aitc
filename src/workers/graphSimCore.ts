// Phase 11 — pure d3-force orchestration core (D-22, D-23).
// Factory returns { init, topology, updateConfig, pin, unpin, tick,
// returnBuffer, dispose } driven by callbacks rather than message-posting.
// No references to worker globals / messaging APIs / DOM — enforced by CI
// grep assertion (see 11-RESEARCH.md §Validation Architecture).
//
// Wave 0 stub: exports are valid; methods are no-ops. Wave 1 fleshes out.
//
// References: 11-CONTEXT.md D-22/D-23; 11-RESEARCH.md §Example A;
//             11-PATTERNS.md §graphSimCore.ts.

import { type SimulationLinkDatum } from 'd3-force';
import { type ClusterNode } from '../views/Radar/forceCluster';
import type {
  InitMessage,
  TopologyMessage,
  ForceConfig,
} from './graphSimProtocol';

export interface SimNode extends ClusterNode {
  id: string;
}

export interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  kind: string;
}

export interface GraphSimCallbacks {
  onTick: (msg: { positions: Float32Array; alpha: number; sequence: number }) => void;
  onSettled: (msg: { positions: Float32Array; alpha: number; sequence: number }) => void;
  onError: (msg: { message: string; stack?: string }) => void;
}

export interface GraphSimCore {
  init(msg: InitMessage): void;
  topology(msg: TopologyMessage): void;
  updateConfig(cfg: ForceConfig): void;
  pin(id: string, x: number, y: number): void;
  unpin(id: string): void;
  tick(): void;
  returnBuffer(buf: ArrayBuffer): void;
  dispose(): void;
}

export interface MakeGraphSimCoreOpts {
  schedule?: (fn: () => void) => void;
}

/**
 * Transferable Float32Array buffer pool (D-05, D-06, D-09, D-34).
 * - Eager allocation: 3 × Float32Array(N*2) at construction (RESEARCH
 *   §Pattern 3 "Spare-buffer allocation — Recommend eager at init").
 * - acquire() returns a buffer or null when all 3 are outstanding.
 * - returnBuffer(arrayBuffer) re-wraps into the pool after validating
 *   byteLength (ASVS V5 — malformed buffers dropped, replacement
 *   allocated so the 3-buffer invariant survives).
 * Based on 11-RESEARCH.md §Pattern 3 + §Pitfall 4 (detached-buffer
 * writes) + §Security Domain (size validation).
 */
export interface BufferPool {
  acquire(): Float32Array | null;
  returnBuffer(buf: ArrayBuffer): boolean;
  outstandingCount(): number;
  totalAllocated(): number;
}

export function createBufferPool(nodeCount: number): BufferPool {
  const expectedByteLength = nodeCount * 2 * 4;
  const pool: Float32Array[] = [
    new Float32Array(nodeCount * 2),
    new Float32Array(nodeCount * 2),
    new Float32Array(nodeCount * 2),
  ];
  let outstanding = 0;
  const allocated = 3;

  return {
    acquire(): Float32Array | null {
      if (outstanding >= 3) return null; // D-09 cap + D-34 ceiling
      const b = pool.pop();
      if (!b || b.byteLength === 0) return null;
      outstanding++;
      return b;
    },
    returnBuffer(buf: ArrayBuffer): boolean {
      // ASVS V5 — drop malformed buffers, allocate a replacement so
      // the pool invariant (3 total allocations) survives.
      if (buf.byteLength !== expectedByteLength) {
        if (pool.length + outstanding < allocated) {
          pool.push(new Float32Array(nodeCount * 2));
        }
        outstanding = Math.max(0, outstanding - 1);
        return false;
      }
      pool.push(new Float32Array(buf));
      outstanding = Math.max(0, outstanding - 1);
      return true;
    },
    outstandingCount(): number {
      return outstanding;
    },
    totalAllocated(): number {
      return allocated;
    },
  };
}

/**
 * Wave 0 stub. Wave 1 replaces the body with the full factory from
 * 11-RESEARCH.md §Example A + §Pattern 2 + §Pattern 3 (ping-pong pool).
 */
export function makeGraphSimCore(
  _cb: GraphSimCallbacks,
  _opts?: MakeGraphSimCoreOpts,
): GraphSimCore {
  return {
    init(_msg: InitMessage): void {},
    topology(_msg: TopologyMessage): void {},
    updateConfig(_cfg: ForceConfig): void {},
    pin(_id: string, _x: number, _y: number): void {},
    unpin(_id: string): void {},
    tick(): void {},
    returnBuffer(_buf: ArrayBuffer): void {},
    dispose(): void {},
  };
}
