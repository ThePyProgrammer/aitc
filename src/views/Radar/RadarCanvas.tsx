// Phase 7 Plan 04 RadarCanvas — Canvas 2D force-directed graph renderer.
//
// D-04, D-12, D-13, D-19, D-23, VIZN-01, VIZN-04, VIZN-05:
// Replaces the Phase 4 squarified treemap with a graph view driven by
// useGraphLayout + GraphRenderer pure functions.
//
// Preserved (from Phase 4):
// - HiDPI scaling via devicePixelRatio
// - ResizeObserver-driven canvas resize
// - Single rAF loop reading refs for current viewport / store state
// - useCanvasZoomPan (wheel/drag) and its handler wiring
// - Heat-map toggle button + zoom indicator (HTML overlay)
//
// New in Plan 04:
// - useGraphLayout settle-then-freeze hook (owns d3-force simulation +
//   quadtree hit-test index)
// - GraphRenderer call sequence (hulls → edges → arrows → nodes → selected
//   halo) matching UI-SPEC z-order steps 2-7
// - Performance warning banners at 5k/10k node thresholds (D-23, UI-SPEC)
// - Viewport culling for 5k+ node render budget
// - Progressive detail for hulls, arrows at zoom < 0.6
//
// Plans 05 and 06 extend the render sequence with comet trails, agent dots,
// conflict pulses, and the RadarMinimap rewrite. Heat-map tint is now inline
// in drawNodes (Plan 04) — the separate HeatMapOverlay module was removed.

import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Flame, AlertTriangle, Info } from 'lucide-react';
import {
  useRadarStore,
  getAgentColor,
  type GraphNode,
} from '../../stores/radarStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useAgentStore } from '../../stores/agentStore';
import { useConflictStore } from '../../stores/conflictStore';
import { useCanvasZoomPan } from '../../hooks/useCanvasZoomPan';
import { useGraphLayout } from '../../hooks/useGraphLayout';
import {
  drawFolderHulls,
  drawEdges,
  drawArrowHeads,
  drawNodes,
  drawSelectedNode,
  drawFileLabels,
  NODE_HIT_RADIUS,
} from './GraphRenderer';
import { drawCometTrails, drawAgentDots } from './CometTrail';
import { ForceConfigPanel } from './ForceConfigPanel';
import { resolveTheme } from './themes';

// UI-SPEC §Performance states thresholds (D-23).
const DEGRADED_NODE_THRESHOLD = 5_000;
const OVERLOAD_NODE_THRESHOLD = 10_000;

// UI-SPEC §Motion + §Sizing conflict pulse (D-22).
// Single expanding ring that loops while the file is in active conflict.
const CONFLICT_PULSE_CYCLE_MS = 1600;
const CONFLICT_PULSE_INNER = 6;       // world-space px @ zoom 1
const CONFLICT_PULSE_OUTER = 15;
const CONFLICT_BADGE_SIZE = 4;
const CONFLICT_BADGE_OFFSET = 6;
const CONFLICT_COLOR = '#ff7351';     // error token

/**
 * Z-order step 12 — expanding ring from 1.0× → 2.5× node radius over 1.6s,
 * opacity 1.0 → 0 with a cubic-bezier(0,0,0.2,1) ease approximation
 * (`t * (2 - t)`). One stroke per contended node id, using the error token.
 */
function drawConflictPulses(
  ctx: CanvasRenderingContext2D,
  conflictedPaths: Set<string>,
  positions: Map<string, { x: number; y: number }>,
  now: number,
  zoom: number,
): void {
  if (conflictedPaths.size === 0) return;
  const cyclePhase = (now % CONFLICT_PULSE_CYCLE_MS) / CONFLICT_PULSE_CYCLE_MS;
  // Cubic-bezier(0,0,0.2,1) approximation for the opacity ramp.
  const easedOpacity = 1 - cyclePhase * (2 - cyclePhase);
  const r =
    (CONFLICT_PULSE_INNER +
      (CONFLICT_PULSE_OUTER - CONFLICT_PULSE_INNER) * cyclePhase) /
    zoom;
  ctx.strokeStyle = CONFLICT_COLOR;
  ctx.lineWidth = 1 / zoom;
  for (const path of conflictedPaths) {
    const p = positions.get(path);
    if (!p) continue;
    ctx.globalAlpha = easedOpacity;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Z-order step 13 — always-on 4px/zoom badge dot, offset +6/-6 world-space
 * from node center. Rendered regardless of zoom to keep conflicts visible
 * even at low zoom where the ring is tiny.
 */
function drawConflictBadges(
  ctx: CanvasRenderingContext2D,
  conflictedPaths: Set<string>,
  positions: Map<string, { x: number; y: number }>,
  zoom: number,
): void {
  if (conflictedPaths.size === 0) return;
  ctx.fillStyle = CONFLICT_COLOR;
  const off = CONFLICT_BADGE_OFFSET / zoom;
  const size = CONFLICT_BADGE_SIZE / zoom;
  for (const path of conflictedPaths) {
    const p = positions.get(path);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x + off, p.y - off, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface RadarCanvasHandle {
  hoveredAgentId: string | null;
  mousePos: { x: number; y: number };
}

interface RadarCanvasProps {
  onHoveredAgentChange?: (
    agentId: string | null,
    mouseX: number,
    mouseY: number,
  ) => void;
}

export function RadarCanvas({ onHoveredAgentChange }: RadarCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(true);
  const animFrameRef = useRef<number>(0);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  // Screen-space mouse position relative to the container — used to place the
  // hover popover. Stored as a ref so it doesn't trigger extra re-renders;
  // the popover reads this when hoveredNodeId changes.
  const mousePosRef = useRef({ x: 0, y: 0 });
  const [degradedDismissed, setDegradedDismissed] = useState(false);
  const [overloadDismissed, setOverloadDismissed] = useState(false);

  // Store-driven state — single selector with shallow equality so only
  // fields that actually changed trigger a re-render (was 9 separate
  // selectors, each re-running on any store mutation).
  const {
    graphNodes,
    graphEdges,
    settledAt,
    pinnedNodeIds,
    selectedAgentId,
    heatMapEnabled,
    contentionScores,
    themeId,
    activeTrails,
    parentChildMap,
    dirsWithOwnFiles,
  } = useRadarStore(
    useShallow((s) => ({
      graphNodes: s.graphNodes,
      graphEdges: s.graphEdges,
      settledAt: s.settledAt,
      pinnedNodeIds: s.pinnedNodeIds,
      selectedAgentId: s.selectedAgentId,
      heatMapEnabled: s.heatMapEnabled,
      contentionScores: s.contentionScores,
      themeId: s.themeId,
      activeTrails: s.activeTrails,
      parentChildMap: s.parentChildMap,
      dirsWithOwnFiles: s.dirsWithOwnFiles,
    })),
  );
  const theme = useMemo(() => resolveTheme(themeId), [themeId]);

  const { viewport, setViewport, handlers, screenToWorld } = useCanvasZoomPan();
  const { quadtreeRef, simNodesRef, isSimulatingRef, markDirtyRef } = useGraphLayout();

  // D-25 / D-26 — Metadata lookup for the rAF hot path. graphNodes is
  // already in the store; here we just index it by id so the render loop
  // can resolve dirKey/dirDepth per node without array searches when
  // reading positions out of the Float32Array delivered by useGraphLayout's
  // Worker-populated simNodesRef.current.positions buffer.
  const nodeById = useMemo(
    () => new Map<string, GraphNode>(graphNodes.map((n) => [n.id, n])),
    [graphNodes],
  );

  // D-22 conflict subscription — reads all alerts, filters to active
  // (non-dismissed) entries, and memoizes a Set of contended file paths for
  // the render loop. Matches the existing conflictStore pattern (see
  // TowerControl.tsx, ConflictBanner.tsx).
  const conflictAlerts = useConflictStore((s) => s.alerts);
  const activeConflictPaths = useMemo(() => {
    const set = new Set<string>();
    for (const a of conflictAlerts) {
      if (!a.dismissed) set.add(a.filePath);
    }
    return set;
  }, [conflictAlerts]);

  // Snapshot the agents list so we can map PID → agentId when ingesting
  // pipeline events (Attribution.kind === 'pid'). Safe fallback: empty list.
  const agents = useAgentStore((s) => s.agents);
  const pidToAgentId = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of agents) {
      if (a.pid !== null) m.set(a.pid, a.id);
    }
    return m;
  }, [agents]);

  // Connect the simulation's tick event to the canvas dirty flag so
  // each simulation frame triggers a canvas repaint.
  useEffect(() => {
    markDirtyRef.current = () => { dirtyRef.current = true; };
    return () => { markDirtyRef.current = () => {}; };
  }, [markDirtyRef]);

  // Auto-fit viewport to center the graph when positions first settle.
  // d3-force centers nodes around world (0,0), but viewport default is
  // panX=0, panY=0 (world origin at screen top-left). This shifts the
  // viewport so world (0,0) maps to the center of the canvas.
  const hasFittedRef = useRef(false);
  useEffect(() => {
    if (settledAt === null) return;
    if (hasFittedRef.current) return;
    if (graphNodes.length === 0) return;
    hasFittedRef.current = true;

    // Compute graph bounding box from settled positions.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graphNodes) {
      if (n.x !== undefined && n.y !== undefined) {
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x > maxX) maxX = n.x;
        if (n.y > maxY) maxY = n.y;
      }
    }
    if (!isFinite(minX)) return;

    const graphW = maxX - minX || 1;
    const graphH = maxY - minY || 1;
    const graphCx = (minX + maxX) / 2;
    const graphCy = (minY + maxY) / 2;

    // Fit graph into 90% of canvas with a minimum zoom of 0.3.
    const fitZoom = Math.max(0.05, Math.min(
      (canvasSize.width * 0.9) / graphW,
      (canvasSize.height * 0.9) / graphH,
      2, // don't over-zoom small graphs
    ));

    setViewport({
      zoom: fitZoom,
      panX: canvasSize.width / 2 - graphCx * fitZoom,
      panY: canvasSize.height / 2 - graphCy * fitZoom,
    });
    dirtyRef.current = true;
  }, [settledAt, graphNodes, canvasSize, setViewport]);

  // Sync viewport back to store so minimap / debug tools can observe.
  // Phase 11.1 revision: the rAF-coalesced writeback added ~16ms of
  // latency between the main canvas redraw and the minimap catching up,
  // making minimap feel perpetually one frame behind during wheel-zoom.
  // Direct write here — React's commit phase is already batched to at
  // most one run per setViewport, so this is one zustand set per frame
  // in the steady state.
  const storeSetViewport = useRadarStore((s) => s.setViewport);
  useEffect(() => {
    storeSetViewport(viewport);
  }, [viewport, storeSetViewport]);

  // Bootstrap: fetch graph once. Also re-fetch when the pipeline watcher
  // starts (pipelineStore.isWatching flips true) — the initial mount may
  // fire before start_watch completes, yielding empty results.
  const isWatching = usePipelineStore((s) => s.isWatching);
  useEffect(() => {
    useRadarStore.getState().fetchGraph();
  }, [isWatching]);

  // Positions map (O(1) lookup for edges/arrows) memoized on node identity.
  // Positions: during live simulation, read from simNodesRef (updated
  // each tick by d3). When idle, fall back to store positions. The memoized
  // version is used for non-rAF consumers (minimap, hover, etc.). The rAF
  // loop builds a fresh map each frame from simNodesRef when simulating.
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of graphNodes) {
      if (n.x !== undefined && n.y !== undefined) {
        m.set(n.id, { x: n.x, y: n.y });
      }
    }
    return m;
  }, [graphNodes]);

  // parentChildMap + dirsWithOwnFiles now come from the store (computed
  // once in fetchGraph) instead of a per-render useMemo.

  // Per-agent current-file + dot-state refs. Updated by the pipeline
  // subscription effect below; read by the rAF loop via stateRef.
  //   - lastAgentFileRef: agentId → most-recent file path (used to detect
  //     path-changed events and to resolve `selectedNode`).
  //   - agentDotsRef: agentId → {x, y, lastEventTs} for drawAgentDots.
  const lastAgentFileRef = useRef<Map<string, string>>(new Map());
  const agentDotsRef = useRef<
    Map<string, { x: number; y: number; lastEventTs: number }>
  >(new Map());

  // Phase 11.1 — rolling-p95 frame-time diagnostic (D-12).
  // Enabled at mount if `localStorage.radarPerfDebug === '1'`. Zero runtime
  // overhead when the flag is off — one boolean ref read per frame.
  const perfRingRef = useRef<Float32Array>(new Float32Array(120)); // ~2s @ 60fps
  const perfIdxRef = useRef(0);
  const perfFilledRef = useRef(0);
  const perfDebugEnabledRef = useRef(false);
  useEffect(() => {
    try {
      perfDebugEnabledRef.current = localStorage.getItem('radarPerfDebug') === '1';
    } catch {
      // Private browsing / storage disabled — keep diagnostic off.
      perfDebugEnabledRef.current = false;
    }
  }, []);
  // Tick version forces `selectedNode` useMemo to re-evaluate after the
  // pipeline subscription mutates lastAgentFileRef (ref mutations don't
  // themselves trigger React re-renders).
  const [agentFileVersion, setAgentFileVersion] = useState(0);

  const pipelineEvents = usePipelineStore((s) => s.events);

  // D-14 trail spawn: for each new pipeline event attributed to a known
  // agent, update the dot position + spawn a trail when the path changes.
  // Tracks the highest event timestampMs we've already processed so we
  // don't double-spawn trails on React-StrictMode double-invoke.
  const lastProcessedTsRef = useRef<number>(0);
  useEffect(() => {
    if (pipelineEvents.length === 0) return;
    // Pipeline events are newest-first; iterate oldest → newest so trails
    // spawn in chronological order.
    let maxTs = lastProcessedTsRef.current;
    let mutated = false;
    for (let i = pipelineEvents.length - 1; i >= 0; i--) {
      const ev = pipelineEvents[i];
      if (ev.timestampMs <= lastProcessedTsRef.current) continue;
      if (ev.attribution.kind !== 'pid') continue;
      const agentId = pidToAgentId.get(ev.attribution.value);
      if (!agentId) continue;

      const path = ev.path;
      const prev = lastAgentFileRef.current.get(agentId);
      // D-17: snap the agent dot to the touched file if we have a position.
      const node = graphNodes.find((n) => n.id === path);
      if (node && node.x !== undefined && node.y !== undefined) {
        agentDotsRef.current.set(agentId, {
          x: node.x,
          y: node.y,
          lastEventTs: Date.now(),
        });
        mutated = true;
      }
      // D-14: spawn a trail when the touched path changes.
      if (prev && prev !== path) {
        useRadarStore.getState().pushTrail({
          id: `${agentId}|${prev}|${path}|${Date.now()}`,
          agentId,
          fromPath: prev,
          toPath: path,
          startTs: Date.now(),
        });
        mutated = true;
      }
      lastAgentFileRef.current.set(agentId, path);
      if (ev.timestampMs > maxTs) maxTs = ev.timestampMs;
    }
    if (maxTs > lastProcessedTsRef.current) {
      lastProcessedTsRef.current = maxTs;
    }
    if (mutated) setAgentFileVersion((v) => v + 1);
  }, [pipelineEvents, graphNodes, pidToAgentId]);

  // Selected-agent glow: resolve to the graph node matching the agent's
  // most-recently-touched file, if any. Closes the loop left open in Plan 04.
  const selectedNode = useMemo(() => {
    if (!selectedAgentId) return undefined;
    const path = lastAgentFileRef.current.get(selectedAgentId);
    if (!path) return undefined;
    return graphNodes.find((n) => n.id === path);
    // agentFileVersion participates so re-lookups happen on pipeline ingest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId, graphNodes, agentFileVersion]);

  // Dirty-flag invalidators.
  useEffect(() => {
    dirtyRef.current = true;
  }, [
    viewport,
    graphNodes,
    graphEdges,
    settledAt,
    selectedAgentId,
    hoveredNodeId,
    pinnedNodeIds,
    heatMapEnabled,
    contentionScores,
    activeTrails,
    agentFileVersion,
    activeConflictPaths,
    theme,
  ]);

  // Keep the render loop dirty while any conflict pulse is active so the
  // ring animates even during periods with no other visual state mutation.
  useEffect(() => {
    if (activeConflictPaths.size === 0) return;
    let raf = 0;
    const tick = () => {
      dirtyRef.current = true;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeConflictPaths]);

  // Keep the render loop dirty while trails or agent pulses are animating
  // (heads travel for 400ms, tails fade over 10s, pulses loop every 2s).
  // Without this the loop would idle after settledAt and skip frames even
  // though visual state is changing.
  useEffect(() => {
    if (activeTrails.length === 0 && agentDotsRef.current.size === 0) return;
    let raf = 0;
    const tick = () => {
      dirtyRef.current = true;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeTrails]);

  // Phase 11.1 fix — Tauri v2 WebKitGTK blanks the canvas backing store
  // when the window loses focus; on refocus rAF resumes but nothing in
  // our dirty-flag deps has changed, so the render loop early-returns
  // and nodes appear to have "disappeared". Force a dirty mark on any
  // visibility/focus event so the next rAF repaints.
  useEffect(() => {
    const markDirty = () => {
      dirtyRef.current = true;
    };
    window.addEventListener('focus', markDirty);
    document.addEventListener('visibilitychange', markDirty);
    return () => {
      window.removeEventListener('focus', markDirty);
      document.removeEventListener('visibilitychange', markDirty);
    };
  }, []);

  // ResizeObserver → canvasSize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setCanvasSize({ width: Math.floor(width), height: Math.floor(height) });
          dirtyRef.current = true;
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // HiDPI scaling — reset transform and re-scale on size change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasSize.width * dpr);
    canvas.height = Math.floor(canvasSize.height * dpr);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;
    dirtyRef.current = true;
  }, [canvasSize]);

  // Refs mirror latest render-loop inputs so the rAF function can read them
  // without re-subscribing the whole loop every render (WR-05 from Phase 4).
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  const stateRef = useRef({
    graphNodes,
    graphEdges,
    positions,
    parentChildMap,
    dirsWithOwnFiles,
    contentionScores,
    heatMapEnabled,
    hoveredNodeId,
    pinnedNodeIds,
    selectedNode,
    selectedAgentId,
    activeTrails,
    activeConflictPaths,
    theme,
    nodeById,
    settledAt, // Phase 11.1 T3 (D-08) — cache key for hullCache.getHullCache.
  });
  useEffect(() => {
    stateRef.current = {
      graphNodes,
      graphEdges,
      positions,
      parentChildMap,
      dirsWithOwnFiles,
      contentionScores,
      heatMapEnabled,
      hoveredNodeId,
      pinnedNodeIds,
      selectedNode,
      selectedAgentId,
      activeTrails,
      activeConflictPaths,
      theme,
      nodeById,
      settledAt, // Phase 11.1 T3 (D-08) — see stateRef init block.
    };
  }, [
    graphNodes,
    graphEdges,
    positions,
    parentChildMap,
    dirsWithOwnFiles,
    contentionScores,
    heatMapEnabled,
    hoveredNodeId,
    pinnedNodeIds,
    selectedNode,
    selectedAgentId,
    activeTrails,
    activeConflictPaths,
    theme,
    nodeById,
    settledAt, // Phase 11.1 T3 (D-08).
  ]);

  // Main rAF render loop — single subscription for the lifetime of the view.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reusable position map — cleared and re-populated each frame when the
    // simulation is active, avoiding a new Map allocation per frame. With
    // 5k nodes at 60fps that eliminates ~300k/sec short-lived entries from
    // hitting the GC.
    const simPositionMap = new Map<string, { x: number; y: number }>();
    // Scratch liveNodes array — mutated in place each frame so the sim
    // branch doesn't allocate a new array on every rAF tick. Length is
    // set to the current live.ids.length; when the sim is idle or the
    // Worker hasn't delivered its first tick yet, we fall back to
    // s.graphNodes (allocation-free).
    let simLiveNodes: GraphNode[] = [];

    function render() {
      if (!ctx) return;
      if (!dirtyRef.current) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }
      // Phase 11.1 — perf bracket open (D-12). Gated so prod pays only one
      // boolean ref read per frame; performance.now() is NOT called when the
      // diagnostic flag is unset.
      const t0 = perfDebugEnabledRef.current ? performance.now() : 0;

      const vp = viewportRef.current;
      const s = stateRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas!.width / dpr;
      const h = canvas!.height / dpr;

      // Step 1 — Canvas clear, painted with the active theme's background.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = s.theme.canvasBackground;
      ctx.fillRect(0, 0, canvas!.width, canvas!.height);
      ctx.restore();

      // Apply viewport (world→screen) with HiDPI scaling baked in so all
      // render functions can operate in raw world coordinates.
      ctx.setTransform(
        vp.zoom * dpr,
        0,
        0,
        vp.zoom * dpr,
        vp.panX * dpr,
        vp.panY * dpr,
      );

      // D-25 / D-26 — hot-path read from LivePositions.
      // During active simulation, read world positions from the
      // Worker-populated Float32Array (ids[i] <-> positions[i*2],
      // positions[i*2+1]). When the Worker has not yet emitted its first
      // tick (positions.byteLength === 0) OR the sim is idle, fall back to
      // the store's graphNodes/positions — identical to the pre-Phase-11
      // idle path. Metadata (dirKey/dirDepth) is resolved via the
      // memoized s.nodeById Map, avoiding O(n) array scans per frame.
      const simulating = isSimulatingRef.current;
      const live = simNodesRef.current;
      let liveNodes: typeof s.graphNodes = s.graphNodes;
      let livePositions = s.positions;
      if (
        simulating &&
        live.positions.byteLength > 0 &&
        live.ids.length > 0
      ) {
        // Repopulate simPositionMap from the Float32Array (reads via
        // live.positions[i * 2] / live.positions[i * 2 + 1] — the
        // Worker-populated Transferable buffer; ids[i] resolves the
        // matching node id for the consumer-facing Map<string,{x,y}>
        // contract preserved from Phase 7).
        simPositionMap.clear();
        for (let i = 0; i < live.ids.length; i++) {
          simPositionMap.set(live.ids[i], {
            x: live.positions[i * 2],
            y: live.positions[i * 2 + 1],
          });
        }
        livePositions = simPositionMap;
        // Build the scratch liveNodes array: merge Float32Array positions
        // with store-supplied metadata (dirKey/dirDepth) via the
        // nodeById memo. Length-set in place so repeated frames reuse the
        // same array backing store (no per-frame Array allocation).
        simLiveNodes.length = live.ids.length;
        let valid = true;
        for (let i = 0; i < live.ids.length; i++) {
          const id = live.ids[i];
          const meta = s.nodeById.get(id);
          if (!meta) {
            // Transient id-mismatch: a tick landed for a topology that the
            // store hasn't caught up to yet. Skip the sim branch for this
            // frame and fall back to store positions.
            valid = false;
            break;
          }
          simLiveNodes[i] = {
            ...meta,
            x: live.positions[i * 2],
            y: live.positions[i * 2 + 1],
          };
        }
        if (valid) {
          liveNodes = simLiveNodes;
        } else {
          // Fallback — reset the sim-only override so downstream reads see
          // coherent metadata+positions from the store.
          livePositions = s.positions;
        }
      }

      // Steps 2-3: Folder hulls (fill/stroke + label).
      drawFolderHulls(
        ctx,
        liveNodes,
        vp.zoom,
        s.settledAt, // Phase 11.1 T3 (D-08) — hullCache key.
        s.parentChildMap,
        s.dirsWithOwnFiles,
        s.theme,
      );
      // Step 4: Edges.
      drawEdges(ctx, s.graphEdges, livePositions, vp.zoom, vp, w, h, s.theme);
      // Step 5: Arrow heads.
      drawArrowHeads(ctx, s.graphEdges, livePositions, vp.zoom, vp, w, h, s.theme);
      // Step 6: Nodes (heat-tint fill on demand).
      drawNodes(
        ctx,
        liveNodes,
        s.contentionScores,
        s.heatMapEnabled,
        s.hoveredNodeId,
        vp.zoom,
        vp,
        w,
        h,
        s.theme,
      );
      // Step 6b: File-name labels at high zoom (UI-SPEC §Progressive Detail ≥ 4×).
      drawFileLabels(ctx, liveNodes, vp.zoom, vp, w, h, s.theme);

      // Step 7: Selected-agent ambient glow + 1px white outer stroke.
      if (s.selectedNode && s.selectedAgentId) {
        drawSelectedNode(
          ctx,
          s.selectedNode,
          getAgentColor(s.selectedAgentId),
          vp.zoom,
        );
      }

      // Plan 05 z-order steps 9-11: comet trails + agent dots.
      // Use Date.now() so the `now` passed to CometTrail functions is the
      // same epoch as `trail.startTs` (written with Date.now() above).
      const now = Date.now();
      // Prune expired trails from the store each frame (cheap) so memory
      // stays bounded even in long sessions. D-16 / D-18.
      useRadarStore.getState().pruneTrails(now);
      // Step 9-10: gradient tails + glowing heads.
      drawCometTrails(ctx, s.activeTrails, livePositions, now, vp.zoom);
      // Step 11: agent dots + pulse rings (D-17). Snapshot the ref's map
      // into an array for the pure draw function.
      const dots = Array.from(agentDotsRef.current.entries()).map(
        ([agentId, st]) => ({
          agentId,
          x: st.x,
          y: st.y,
          lastEventTs: st.lastEventTs,
        }),
      );
      drawAgentDots(ctx, dots, now, vp.zoom);

      // Plan 06 z-order steps 12-13: conflict pulse rings + badge dots (D-22).
      drawConflictPulses(ctx, s.activeConflictPaths, livePositions, now, vp.zoom);
      drawConflictBadges(ctx, s.activeConflictPaths, livePositions, vp.zoom);

      // Phase 11.1 — perf bracket close + emit (D-12, D-13). No observer API.
      // Runs only when radarPerfDebug === '1'. Emits once per 120-frame ring wrap
      // (~2s at 60fps) with p95/max/avg via the Float32Array(120) ring buffer.
      if (perfDebugEnabledRef.current) {
        const dt = performance.now() - t0;
        const ring = perfRingRef.current;
        ring[perfIdxRef.current] = dt;
        perfIdxRef.current = (perfIdxRef.current + 1) % ring.length;
        if (perfFilledRef.current < ring.length) perfFilledRef.current++;
        if (perfIdxRef.current === 0) {
          const n = perfFilledRef.current;
          const sorted = Array.from(ring.subarray(0, n)).sort((a, b) => a - b);
          const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
          const max = sorted[n - 1];
          const avg = sorted.reduce((s, v) => s + v, 0) / n;
          // eslint-disable-next-line no-console
          console.log(
            `[RadarPerf] p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms avg=${avg.toFixed(2)}ms n=${n}`,
          );
        }
      }

      dirtyRef.current = false;
      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []); // empty deps — one loop for the component lifetime

  // Quadtree-powered hit-test on mouse move (RESEARCH §Pattern 4).
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);
      const found = quadtreeRef.current?.find(
        world.x,
        world.y,
        NODE_HIT_RADIUS / Math.max(viewport.zoom, 0.1),
      );
      const nextId = found?.id ?? null;
      setHoveredNodeId(nextId);
      mousePosRef.current = { x: sx, y: sy };
      onHoveredAgentChange?.(null, sx, sy);
    },
    [screenToWorld, viewport.zoom, onHoveredAgentChange, quadtreeRef],
  );

  // Attach native wheel/mouse handlers for pan/zoom (wheel must be non-passive).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { onWheel, onMouseDown, onMouseMove, onMouseUp } = handlers;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [handlers]);


  // Reset dismissals when node count falls back into NORMAL.
  useEffect(() => {
    if (graphNodes.length < DEGRADED_NODE_THRESHOLD) {
      setDegradedDismissed(false);
      setOverloadDismissed(false);
    }
  }, [graphNodes.length]);

  const showOverload = graphNodes.length >= OVERLOAD_NODE_THRESHOLD && !overloadDismissed;
  const showDegraded =
    graphNodes.length >= DEGRADED_NODE_THRESHOLD &&
    graphNodes.length < OVERLOAD_NODE_THRESHOLD &&
    !degradedDismissed;

  // ── Hover popover data ──
  // Look up metadata for the hovered node so we can render a tooltip.
  const hoveredNode = useMemo(() => {
    if (!hoveredNodeId) return null;
    return graphNodes.find((n) => n.id === hoveredNodeId) ?? null;
  }, [hoveredNodeId, graphNodes]);

  const hoveredContention = hoveredNodeId
    ? contentionScores.get(hoveredNodeId) ?? 0
    : 0;
  const hoveredConflict = hoveredNodeId
    ? activeConflictPaths.has(hoveredNodeId)
    : false;

  // Compute incoming/outgoing edge counts for the hovered node.
  const hoveredEdgeCounts = useMemo(() => {
    if (!hoveredNodeId) return { incoming: 0, outgoing: 0 };
    let incoming = 0;
    let outgoing = 0;
    for (const e of graphEdges) {
      const sId = typeof e.source === 'string' ? e.source : (e.source as { id: string }).id;
      const tId = typeof e.target === 'string' ? e.target : (e.target as { id: string }).id;
      if (sId === hoveredNodeId) outgoing++;
      if (tId === hoveredNodeId) incoming++;
    }
    return { incoming, outgoing };
  }, [hoveredNodeId, graphEdges]);

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden bg-surface-container-lowest"
    >
      {/* Performance banners (UI-SPEC §Layout §Performance states, D-23). */}
      {showOverload && (
        <div
          role="alert"
          className="absolute top-0 left-0 right-0 h-12 px-4 flex items-center gap-3 border-b border-outline-variant/20 bg-error-container/15 z-20"
        >
          <AlertTriangle size={16} strokeWidth={1.5} className="text-error" />
          <span className="font-headline text-sm font-bold tracking-wider text-error">
            GRAPH_OVERLOAD
          </span>
          <span className="font-mono text-sm text-on-surface-variant">
            {graphNodes.length.toLocaleString()}_files — rendering in degraded mode. Progressive culling active.
          </span>
          <button
            type="button"
            onClick={() => setOverloadDismissed(true)}
            className="ml-auto font-headline text-[10px] uppercase tracking-widest text-error hover:bg-error/10 px-2 py-1"
          >
            DISMISS
          </button>
        </div>
      )}
      {showDegraded && (
        <div
          role="status"
          className="absolute top-0 left-0 right-0 h-12 px-4 flex items-center gap-3 border-b border-outline-variant/20 bg-tertiary/10 z-20"
        >
          <Info size={16} strokeWidth={1.5} className="text-tertiary" />
          <span className="font-headline text-sm font-bold tracking-wider text-tertiary">
            INFO_DEGRADED
          </span>
          <span className="font-mono text-sm text-on-surface-variant">
            {graphNodes.length.toLocaleString()}_files — viewport culling active. Pan/zoom for full view.
          </span>
          <button
            type="button"
            onClick={() => setDegradedDismissed(true)}
            className="ml-auto font-headline text-[10px] uppercase tracking-widest text-tertiary hover:bg-tertiary/10 px-2 py-1"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Force configuration panel */}
      <ForceConfigPanel />

      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        className="block"
        data-hovered-node={hoveredNodeId}
        role="img"
        aria-label={`Codebase dependency graph. ${graphNodes.length} files, ${graphEdges.length} edges.`}
      />

      {/* Empty / building state overlay (UI-SPEC §States). */}
      {graphNodes.length === 0 && settledAt === null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <h2 className="text-primary font-headline text-sm font-bold uppercase tracking-widest">
            BUILDING_GRAPH
          </h2>
          <p className="text-on-surface-variant font-mono text-xs">
            Parsing imports. This takes up to 2 seconds on large repos.
          </p>
        </div>
      )}
      {graphNodes.length === 0 && settledAt !== null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <h2 className="text-primary font-headline text-sm font-bold uppercase tracking-widest">
            AIRSPACE_CLEAR
          </h2>
          <p className="text-on-surface-variant font-mono text-xs">
            No source files detected in the watched tree. Check your gitignore and language filters.
          </p>
        </div>
      )}

      {/* Zoom indicator */}
      <div className="absolute bottom-3 left-3 font-mono text-[10px] text-on-surface-variant/50 select-none">
        {viewport.zoom.toFixed(1)}x
      </div>
      {/* Heat map toggle */}
      <button
        onClick={() => useRadarStore.getState().toggleHeatMap()}
        className={`absolute bottom-3 left-16 flex items-center gap-1 px-2 py-1 font-headline text-[10px] uppercase tracking-widest transition-colors duration-150 ${
          heatMapEnabled
            ? 'text-primary bg-primary/10'
            : 'text-on-surface-variant bg-transparent hover:bg-surface-container-high'
        }`}
        aria-label="Toggle heat map overlay"
        aria-pressed={heatMapEnabled}
      >
        <Flame size={16} strokeWidth={1.5} />
        HEAT_MAP
      </button>

      {/* Hover popover — shows filename + metadata when a node is hovered. */}
      {hoveredNode && (
        <div
          className="absolute z-30 pointer-events-none bg-surface-container border border-outline-variant/40 px-3 py-2 max-w-72 shadow-lg"
          style={{
            left: Math.min(mousePosRef.current.x + 12, canvasSize.width - 290),
            top: Math.max(8, mousePosRef.current.y - 8),
          }}
        >
          {/* Filename (basename) */}
          <div className="font-mono text-xs text-on-surface font-bold truncate">
            {hoveredNode.id.includes('/')
              ? hoveredNode.id.slice(hoveredNode.id.lastIndexOf('/') + 1)
              : hoveredNode.id}
          </div>
          {/* Full path */}
          <div className="font-mono text-[10px] text-on-surface-variant/70 truncate mt-0.5">
            {hoveredNode.id}
          </div>
          {/* Metadata row */}
          <div className="flex items-center gap-3 mt-1.5 font-mono text-[10px] text-on-surface-variant">
            <span>
              DIR <span className="text-on-surface">{hoveredNode.dirKey || '(root)'}</span>
            </span>
            <span>
              DEPTH <span className="text-on-surface">{hoveredNode.dirDepth}</span>
            </span>
          </div>
          {/* Edge counts */}
          <div className="flex items-center gap-3 mt-0.5 font-mono text-[10px] text-on-surface-variant">
            <span>
              IN <span className="text-on-surface">{hoveredEdgeCounts.incoming}</span>
            </span>
            <span>
              OUT <span className="text-on-surface">{hoveredEdgeCounts.outgoing}</span>
            </span>
          </div>
          {/* Contention + conflict badges */}
          {(hoveredContention > 0 || hoveredConflict) && (
            <div className="flex items-center gap-3 mt-1 font-headline text-[10px] uppercase tracking-widest">
              {hoveredContention > 0 && (
                <span className="text-error">
                  CONTENTION {Math.round(hoveredContention * 100)}%
                </span>
              )}
              {hoveredConflict && (
                <span className="text-error font-bold">CONFLICT</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
