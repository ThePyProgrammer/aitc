// D-01..D-04, D-12, D-16, D-18, D-25, D-27, D-28 — Phase 11 Worker-lifecycle
// client for the d3-force simulation. Replaces the Phase 7 main-thread
// simulation. Public UseGraphLayoutResult surface is preserved; only
// simNodesRef shape changes per D-25.
//
// The worker is to this hook what Channel<FileEventBatch> is to
// usePipelineChannel — a long-lived message source constructed in
// useEffect and torn down in cleanup (StrictMode-safe per Pattern 6).
//
// References: 11-CONTEXT.md D-01..D-04, D-12, D-16, D-18, D-25, D-27, D-28;
//             11-RESEARCH.md §Pattern 4 (sequence guard),
//                           §Pattern 6 (StrictMode cleanup),
//                           §Example B / §Pattern 7 (worker+mock shim);
//             11-PATTERNS.md §src/hooks/useGraphLayout.ts.

import { useEffect, useRef, type MutableRefObject } from 'react';
import { quadtree, type Quadtree } from 'd3-quadtree';
import {
  useRadarStore,
  type GraphNode,
  type ForceConfig,
} from '../stores/radarStore';
import {
  QUADTREE_REBUILD_TICK_INTERVAL,
  REWARM_NODE_COUNT_THRESHOLD,
  REWARM_PERCENT_THRESHOLD,
} from '../workers/graphSimConfig';
import type { WorkerIn, WorkerOut } from '../workers/graphSimProtocol';

// Re-export all Phase 7 tuning constants so existing test imports at
// useGraphLayout.test.ts:15-23 keep working (Wave 0 already did this).
export {
  LINK_DISTANCE,
  LINK_STRENGTH,
  CHARGE_STRENGTH,
  CHARGE_THETA,
  CHARGE_DISTANCE_MAX,
  CENTER_STRENGTH,
  COLLIDE_RADIUS,
  ALPHA_DECAY,
  VELOCITY_DECAY,
  MAX_TICKS,
  REWARM_NODE_COUNT_THRESHOLD,
  REWARM_PERCENT_THRESHOLD,
  REWARM_ALPHA,
  REWARM_MAX_TICKS,
  FORCE_CONFIG_ALPHA,
} from '../workers/graphSimConfig';

// D-25: hot-path position ref shape — consumed by RadarCanvas (Wave 3).
export interface LivePositions {
  ids: string[];
  positions: Float32Array;
  idIndex: Map<string, number>;
}

type QNode = { id: string; x: number; y: number };

export interface UseGraphLayoutResult {
  quadtreeRef: MutableRefObject<Quadtree<QNode> | null>;
  /** Ref to the live simulation positions — RadarCanvas reads this each rAF
   *  frame. See LivePositions shape above (D-25). */
  simNodesRef: MutableRefObject<LivePositions>;
  /** True while the simulation is actively ticking (alpha > alphaMin). */
  isSimulatingRef: MutableRefObject<boolean>;
  /** Callback to mark the canvas dirty — set by RadarCanvas. */
  markDirtyRef: MutableRefObject<() => void>;
}

function makeEmptyLivePositions(): LivePositions {
  return {
    ids: [],
    positions: new Float32Array(0),
    idIndex: new Map(),
  };
}

/**
 * shouldRewarm — carried from Phase 7 useGraphLayout.ts:207-220. Decides
 * whether node-id churn between two topology snapshots crosses the rewarm
 * threshold. Same semantics; thresholds now live in graphSimConfig.ts.
 */
function shouldRewarm(prev: Set<string>, next: Set<string>): boolean {
  let added = 0;
  let removed = 0;
  for (const id of next) if (!prev.has(id)) added++;
  for (const id of prev) if (!next.has(id)) removed++;
  const mutations = added + removed;
  if (mutations === 0) return false;
  const totalForPercent = Math.max(prev.size, next.size, 1);
  return (
    mutations >= REWARM_NODE_COUNT_THRESHOLD ||
    mutations / totalForPercent >= REWARM_PERCENT_THRESHOLD
  );
}

function sameConfig(a: ForceConfig, b: ForceConfig): boolean {
  return (
    a.centerStrength === b.centerStrength &&
    a.clusterStrength === b.clusterStrength &&
    a.linkStrength === b.linkStrength &&
    a.chargeStrength === b.chargeStrength &&
    // Phase 12 (D-30): boundaryStrength is part of the equality so slider
    // changes trigger updateConfig → alpha-restart in the worker.
    a.boundaryStrength === b.boundaryStrength
  );
}

export function useGraphLayout(): UseGraphLayoutResult {
  const workerRef = useRef<Worker | null>(null);
  const quadtreeRef = useRef<Quadtree<QNode> | null>(null);
  const simNodesRef = useRef<LivePositions>(makeEmptyLivePositions());
  const isSimulatingRef = useRef(false);
  const markDirtyRef = useRef<() => void>(() => {});
  // D-12 topology sequence counter — bumped on every init/topology post;
  // worker tags outbound messages with the current sequence so we can drop
  // stale ticks after a rewarm.
  const topologySeqRef = useRef(0);
  // Track the last ids-set we sent so the rewarm threshold logic can diff.
  const lastIdsRef = useRef<Set<string>>(new Set());
  // Track the last ForceConfig we sent so updateConfig doesn't loop on
  // unrelated store changes.
  const lastForceConfigRef = useRef<ForceConfig | null>(null);
  // D-16 per-tick quadtree rebuild counter.
  const tickCounterRef = useRef(0);

  function buildQuadtree(ids: string[], positions: Float32Array): Quadtree<QNode> {
    const nodes: QNode[] = [];
    for (let i = 0; i < ids.length; i++) {
      nodes.push({ id: ids[i], x: positions[i * 2], y: positions[i * 2 + 1] });
    }
    return quadtree<QNode>()
      .x((n) => n.x)
      .y((n) => n.y)
      .addAll(nodes);
  }

  function materializePositionMap(
    ids: string[],
    positions: Float32Array,
  ): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    for (let i = 0; i < ids.length; i++) {
      out.set(ids[i], { x: positions[i * 2], y: positions[i * 2 + 1] });
    }
    return out;
  }

  function returnBufferToWorker(buf: ArrayBuffer): void {
    const w = workerRef.current;
    if (!w) return;
    if (buf.byteLength === 0) return; // already detached
    try {
      w.postMessage(
        { type: 'returnBuffer', buffer: buf } satisfies WorkerIn,
        { transfer: [buf] },
      );
    } catch {
      // Buffer already detached or worker terminated — drop silently.
    }
  }

  function handleWorkerMessage(evt: MessageEvent<WorkerOut>): void {
    const msg = evt.data;
    // D-12 — stale message for a superseded topology. Return the buffer so
    // the pool can reuse it; don't write to simNodesRef.
    if (
      (msg.type === 'tick' || msg.type === 'settled') &&
      msg.sequence < topologySeqRef.current
    ) {
      returnBufferToWorker(msg.positions.buffer);
      return;
    }
    switch (msg.type) {
      case 'tick': {
        // D-25 hot-path: swap the positions Float32Array into simNodesRef
        // without going through Zustand. Preserve ids/idIndex which were
        // pinned at init/topology send time.
        const prev = simNodesRef.current.positions;
        simNodesRef.current = {
          ids: simNodesRef.current.ids,
          positions: msg.positions,
          idIndex: simNodesRef.current.idIndex,
        };
        // D-06 ping-pong: return the previously-held buffer for pool reuse.
        if (prev.byteLength > 0) {
          returnBufferToWorker(prev.buffer);
        }
        tickCounterRef.current++;
        // D-16 quadtree rebuild cadence during active sim.
        if (tickCounterRef.current % QUADTREE_REBUILD_TICK_INTERVAL === 0) {
          quadtreeRef.current = buildQuadtree(
            simNodesRef.current.ids,
            msg.positions,
          );
        }
        isSimulatingRef.current = true;
        markDirtyRef.current();
        break;
      }
      case 'settled': {
        const prev = simNodesRef.current.positions;
        simNodesRef.current = {
          ids: simNodesRef.current.ids,
          positions: msg.positions,
          idIndex: simNodesRef.current.idIndex,
        };
        if (prev.byteLength > 0) {
          returnBufferToWorker(prev.buffer);
        }
        // D-16 — primary quadtree rebuild trigger at settle.
        quadtreeRef.current = buildQuadtree(
          simNodesRef.current.ids,
          msg.positions,
        );
        // D-28 — commit final positions so minimap/persistence consumers see
        // them. Build the Map once from the Float32Array + ids.
        const map = materializePositionMap(
          simNodesRef.current.ids,
          msg.positions,
        );
        useRadarStore.getState().commitSettledPositions(map);
        isSimulatingRef.current = false;
        tickCounterRef.current = 0;
        markDirtyRef.current();
        break;
      }
      case 'error': {
        // D-04 — no fallback; log + proceed with stale positions.
        console.error('[graphSim]', msg.message, msg.stack);
        break;
      }
      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
      }
    }
  }

  // ─── Worker lifecycle (StrictMode-safe cleanup per Pattern 6) ────────────
  // Lives for the whole hook lifetime (D-01). Empty deps — worker lifetime
  // is NOT tied to graph lifetime.
  useEffect(() => {
    // D-02 — literal-inline Vite pattern; the URL must be a literal so
    // Rolldown's static detector emits the worker chunk.
    const worker = new Worker(new URL('../workers/graphSim.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (e) => {
      // D-04 — no fallback; surface the error for observability.
      console.error('[graphSim.worker]', e?.message ?? e);
    };

    return () => {
      worker.onmessage = null;
      worker.onerror = null;
      try {
        worker.postMessage({ type: 'dispose' } satisfies WorkerIn);
      } catch {
        /* worker may already be terminated */
      }
      worker.terminate();
      workerRef.current = null;
      isSimulatingRef.current = false;
      // Reset the topology identity so the next worker instance takes the
      // `isFirst` branch in the topology handler. Without this, React 18
      // StrictMode's mount→cleanup→mount sequence leaves lastIdsRef
      // populated from pass-1; pass-2's fresh worker then fails isFirst
      // AND rewarm (same ids), the handler early-returns, and the worker
      // never receives its init payload — loader stuck on BUILDING GRAPH
      // forever until the hook unmounts for real (pause/resume monitoring).
      lastIdsRef.current = new Set();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── init / topology on graphNodes|graphEdges change ─────────────────────
  // Extract `handler` so we can invoke it once synchronously at mount to
  // cover the mount-after-setState ordering (tests set store state then
  // mount; zustand's subscribe() only fires on subsequent writes).
  useEffect(() => {
    const handler = (s: ReturnType<typeof useRadarStore.getState>): void => {
      const w = workerRef.current;
      if (!w) return;
      const nodes = s.graphNodes;
      const edges = s.graphEdges;
      if (nodes.length === 0) return;

      const currentIds = new Set(nodes.map((n) => n.id));
      const isFirst = lastIdsRef.current.size === 0;
      const rewarm = !isFirst && shouldRewarm(lastIdsRef.current, currentIds);
      if (!isFirst && !rewarm) return;

      topologySeqRef.current++;
      const ids = nodes.map((n) => n.id);
      // Update ids/idIndex immediately so tick-message handling can map
      // positions back to nodes even before the first tick lands. Positions
      // stay as the prior Float32Array (possibly empty) until first tick.
      simNodesRef.current = {
        ids,
        positions: simNodesRef.current.positions,
        idIndex: new Map(ids.map((id, i) => [id, i])),
      };
      tickCounterRef.current = 0;
      lastIdsRef.current = currentIds;

      const payload = {
        sequence: topologySeqRef.current,
        nodes: nodes.map((n) => ({
          id: n.id,
          dirKey: n.dirKey,
          dirDepth: n.dirDepth,
          fx: n.fx ?? null,
          fy: n.fy ?? null,
          // Phase 12 (D-10, D-37): kind + language ride init/topology only.
          // Passing them through updateConfig would orphan the assignment
          // because buildSim is not re-invoked (Pitfall 2).
          kind: n.kind,
          language: n.language,
        })),
        edges: edges.map((e) => ({
          source:
            typeof e.source === 'string'
              ? e.source
              : (e.source as GraphNode).id,
          target:
            typeof e.target === 'string'
              ? e.target
              : (e.target as GraphNode).id,
          kind: e.kind,
        })),
        config: s.forceConfig,
      };

      if (isFirst) {
        w.postMessage({
          type: 'init',
          ...payload,
          alpha: 1,
          fastSettle: true,
        } satisfies WorkerIn);
      } else {
        w.postMessage({
          type: 'topology',
          ...payload,
        } satisfies WorkerIn);
      }
      isSimulatingRef.current = true;
    };
    const unsub = useRadarStore.subscribe(handler);
    // Drive once synchronously for the mount-after-setState case — if the
    // store already has graphNodes at mount, zustand's subscribe only fires
    // on the NEXT write, which would miss the initial init. Invoking
    // handler here closes that gap.
    handler(useRadarStore.getState());
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── updateConfig on forceConfig change ──────────────────────────────────
  useEffect(() => {
    const unsub = useRadarStore.subscribe((s) => {
      const w = workerRef.current;
      if (!w) return;
      const cfg = s.forceConfig;
      if (lastForceConfigRef.current && sameConfig(cfg, lastForceConfigRef.current)) {
        return;
      }
      lastForceConfigRef.current = cfg;
      // No sim yet — the first init will carry the config inline.
      if (lastIdsRef.current.size === 0) return;
      w.postMessage({ type: 'updateConfig', config: cfg } satisfies WorkerIn);
      isSimulatingRef.current = true;
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── pin/unpin on pinnedNodeIds Set diff ─────────────────────────────────
  useEffect(() => {
    let prevPins = new Set<string>();
    const unsub = useRadarStore.subscribe((s) => {
      const w = workerRef.current;
      if (!w) return;
      const next = s.pinnedNodeIds;
      const added: string[] = [];
      const removed: string[] = [];
      for (const id of next) if (!prevPins.has(id)) added.push(id);
      for (const id of prevPins) if (!next.has(id)) removed.push(id);
      for (const id of added) {
        const n = s.graphNodes.find((x) => x.id === id);
        if (n && n.fx != null && n.fy != null) {
          w.postMessage({
            type: 'pin',
            id,
            x: n.fx,
            y: n.fy,
          } satisfies WorkerIn);
        }
      }
      for (const id of removed) {
        w.postMessage({ type: 'unpin', id } satisfies WorkerIn);
      }
      prevPins = new Set(next);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { quadtreeRef, simNodesRef, isSimulatingRef, markDirtyRef };
}
