// Phase 11 — pure d3-force orchestration core (D-22, D-23).
// Factory returns { init, topology, updateConfig, pin, unpin, tick,
// returnBuffer, dispose } driven by callbacks rather than postMessage.
// No references to self / postMessage / Worker / DOM — enforced by CI
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
