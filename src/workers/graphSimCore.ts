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

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import {
  forceCluster,
  forceClusterCollide,
  type ClusterNode,
} from '../views/Radar/forceCluster';
import { forceBoundary, type BoundaryNode } from './forces/forceBoundary';
import type {
  InitMessage,
  TopologyMessage,
  ForceConfig,
} from './graphSimProtocol';
import {
  LINK_DISTANCE,
  CHARGE_THETA,
  CHARGE_DISTANCE_MAX,
  COLLIDE_RADIUS,
  ALPHA_DECAY,
  VELOCITY_DECAY,
  MAX_TICKS,
  FORCE_CONFIG_ALPHA,
  INITIAL_POSITION_SEED,
} from './graphSimConfig';

/**
 * mulberry32 PRNG — byte-deterministic across the simulation core and
 * tests (RESEARCH §Don't Hand-Roll / §Pitfall 1). Seed comes from the
 * shared INITIAL_POSITION_SEED so worker + unit tests produce identical
 * initial positions every run.
 */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Phase 12: widened to carry BoundaryNode (kind/language) alongside ClusterNode
// (dirKey/dirDepth) so forceBoundary can route nodes by language.
export interface SimNode extends ClusterNode, BoundaryNode {
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
 * Pure d3-force orchestration factory (D-22, D-23). See 11-RESEARCH.md
 * §Example A + §Pattern 2 (manual tick loop) + §Pattern 3 (ping-pong
 * buffer pool) + §Pattern 4 (sequence counter).
 *
 * The returned core exposes 8 methods and drives d3-force via callbacks
 * rather than message-posting — the Wave 2 worker shim wires the
 * callbacks to transfer-based messaging at the worker boundary.
 */
export function makeGraphSimCore(
  cb: GraphSimCallbacks,
  opts?: MakeGraphSimCoreOpts,
): GraphSimCore {
  // Declare `scheduled` BEFORE `schedule` so the default scheduler's
  // closure captures the already-initialised outer binding (TDZ fix
  // per 11-02-PLAN pseudocode + checker feedback #5).
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  const schedule =
    opts?.schedule ??
    ((fn: () => void) => {
      // Default scheduler — setTimeout(fn, 0) yields to the event loop
      // between ticks (RESEARCH §Pattern 2, §Pitfall 3). Stores the
      // timer id on the outer binding so dispose() can cancel it.
      scheduled = setTimeout(fn, 0);
    });

  let sim: Simulation<SimNode, SimEdge> | null = null;
  let simNodes: SimNode[] = [];
  let ids: string[] = [];
  let idIndex: Map<string, number> = new Map();
  let sequence = 0;
  let paused = true;
  let pool: BufferPool | null = null;
  let tickCount = 0;

  function writePositions(buf: Float32Array): void {
    for (let i = 0; i < simNodes.length; i++) {
      buf[i * 2] = simNodes[i].x ?? 0;
      buf[i * 2 + 1] = simNodes[i].y ?? 0;
    }
  }

  function emitTick(): void {
    if (!pool || !sim) return;
    const buf = pool.acquire();
    if (!buf) return; // backpressure — D-09 skip
    writePositions(buf);
    cb.onTick({ positions: buf, alpha: sim.alpha(), sequence });
  }

  function emitSettled(): void {
    if (!sim) return;
    if (!pool) return;
    const buf = pool.acquire();
    if (!buf) {
      // Rare — main holds all 3. Allocate a one-off and call it done.
      const standalone = new Float32Array(simNodes.length * 2);
      writePositions(standalone);
      cb.onSettled({ positions: standalone, alpha: sim.alpha(), sequence });
      return;
    }
    writePositions(buf);
    cb.onSettled({ positions: buf, alpha: sim.alpha(), sequence });
  }

  function tickLoop(): void {
    if (!sim || paused) return;
    try {
      if (sim.alpha() <= sim.alphaMin()) {
        paused = true;
        emitSettled();
        return;
      }
      sim.tick();
      tickCount++;
      emitTick();
      schedule(tickLoop);
    } catch (err) {
      paused = true;
      cb.onError({
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  function buildSim(
    nodes: InitMessage['nodes'],
    edges: InitMessage['edges'],
    cfg: ForceConfig,
  ): void {
    const rng = mulberry32(INITIAL_POSITION_SEED);
    simNodes = nodes.map((n, i) => ({
      id: n.id,
      dirKey: n.dirKey,
      dirDepth: n.dirDepth,
      // Phase 12 (D-10, D-16): propagate kind + language so forceBoundary
      // can skip bridges + route files by language. Default undefined kind
      // to 'file' for BC with any Phase-7-era payloads on the wire.
      kind: n.kind ?? 'file',
      language: n.language,
      // RESEARCH §Pitfall 1 — move useGraphLayout.ts:107-108 initial
      // position seeding into the core so tests are byte-deterministic.
      x: (rng() - 0.5) * 200,
      y: (rng() - 0.5) * 200,
      fx: n.fx ?? undefined,
      fy: n.fy ?? undefined,
      index: i,
    } as SimNode));
    ids = simNodes.map((n) => n.id);
    idIndex = new Map(ids.map((id, i) => [id, i]));
    const simEdges: SimEdge[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
    }));

    sim = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(simEdges)
          .id((n) => (n as SimNode).id)
          .distance(LINK_DISTANCE)
          .strength(cfg.linkStrength),
      )
      .force(
        'charge',
        forceManyBody<SimNode>()
          .strength(cfg.chargeStrength)
          .theta(CHARGE_THETA)
          .distanceMax(CHARGE_DISTANCE_MAX),
      )
      .force('center', forceCenter(0, 0).strength(cfg.centerStrength))
      .force('collide', forceCollide(COLLIDE_RADIUS))
      .force('cluster', forceCluster().strength(cfg.clusterStrength))
      .force('clusterCollide', forceClusterCollide())
      // Phase 12 (D-29, D-37): forceBoundary registered alongside forceCluster.
      // buildSim is the only place where the force is newly instantiated —
      // updateConfig mutates .strength() on the existing instance.
      .force('boundary', forceBoundary().strength(cfg.boundaryStrength))
      .alphaDecay(ALPHA_DECAY)
      .velocityDecay(VELOCITY_DECAY)
      .stop();
    sim.randomSource(mulberry32(INITIAL_POSITION_SEED));

    // (Re)allocate buffer pool for the new node count.
    pool = createBufferPool(simNodes.length);
    tickCount = 0;
  }

  function fastSettle(): void {
    if (!sim) return;
    for (let i = 0; i < MAX_TICKS && sim.alpha() > sim.alphaMin(); i++) {
      sim.tick();
    }
  }

  return {
    init(msg: InitMessage): void {
      if (scheduled !== null) {
        clearTimeout(scheduled);
        scheduled = null;
      }
      sequence = msg.sequence;
      buildSim(msg.nodes, msg.edges, msg.config);
      sim!.alpha(msg.alpha);
      if (msg.fastSettle) fastSettle();
      paused = false;
      emitTick();
      schedule(tickLoop);
    },

    topology(msg: TopologyMessage): void {
      if (scheduled !== null) {
        clearTimeout(scheduled);
        scheduled = null;
      }
      sequence = msg.sequence;
      buildSim(msg.nodes, msg.edges, msg.config);
      // Matches existing rewarm behavior: reheat to FORCE_CONFIG_ALPHA,
      // run a bounded fast-settle, then resume the tick loop.
      sim!.alpha(FORCE_CONFIG_ALPHA);
      fastSettle();
      paused = false;
      emitTick();
      schedule(tickLoop);
    },

    updateConfig(cfg: ForceConfig): void {
      if (!sim) return;
      (sim.force('link') as ReturnType<typeof forceLink>).strength(
        cfg.linkStrength,
      );
      (sim.force('charge') as ReturnType<typeof forceManyBody>).strength(
        cfg.chargeStrength,
      );
      (sim.force('center') as ReturnType<typeof forceCenter>).strength(
        cfg.centerStrength,
      );
      (sim.force('cluster') as ReturnType<typeof forceCluster>).strength(
        cfg.clusterStrength,
      );
      // Phase 12 (D-29, D-30, D-37): update boundary strength in place.
      // The force instance was registered in buildSim; here we just tune it.
      (sim.force('boundary') as ReturnType<typeof forceBoundary>).strength(
        cfg.boundaryStrength,
      );
      sim.alpha(FORCE_CONFIG_ALPHA).restart();
      if (paused) {
        paused = false;
        schedule(tickLoop);
      }
      // Emit a tick immediately so consumers observe the reheated alpha.
      emitTick();
    },

    pin(id: string, x: number, y: number): void {
      const i = idIndex.get(id);
      if (i === undefined || !sim) return;
      const n = simNodes[i];
      n.fx = x;
      n.fy = y;
      n.x = x;
      n.y = y;
      if (paused) {
        sim.alpha(FORCE_CONFIG_ALPHA).restart();
        paused = false;
        schedule(tickLoop);
      }
    },

    unpin(id: string): void {
      const i = idIndex.get(id);
      if (i === undefined) return;
      simNodes[i].fx = null;
      simNodes[i].fy = null;
    },

    tick(): void {
      // Test-only synchronous step; does NOT call schedule.
      if (!sim) return;
      sim.tick();
      tickCount++;
      emitTick();
    },

    returnBuffer(buf: ArrayBuffer): void {
      pool?.returnBuffer(buf);
    },

    dispose(): void {
      paused = true;
      if (scheduled !== null) {
        clearTimeout(scheduled);
        scheduled = null;
      }
      sim?.stop();
      sim = null;
      simNodes = [];
      ids = [];
      idIndex.clear();
      pool = null;
    },
  };
}
