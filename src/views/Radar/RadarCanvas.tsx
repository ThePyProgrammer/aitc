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
import { Flame, AlertTriangle, Info } from 'lucide-react';
import {
  useRadarStore,
  getAgentColor,
  installRadarPipelineBridge,
} from '../../stores/radarStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useCanvasZoomPan } from '../../hooks/useCanvasZoomPan';
import { useGraphLayout } from '../../hooks/useGraphLayout';
import {
  drawFolderHulls,
  drawEdges,
  drawArrowHeads,
  drawNodes,
  drawSelectedNode,
  NODE_HIT_RADIUS,
} from './GraphRenderer';

// UI-SPEC §Performance states thresholds (D-23).
const DEGRADED_NODE_THRESHOLD = 5_000;
const OVERLOAD_NODE_THRESHOLD = 10_000;

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
  const [degradedDismissed, setDegradedDismissed] = useState(false);
  const [overloadDismissed, setOverloadDismissed] = useState(false);

  // Store-driven state (Plan 03 graph store + Phase 5 heat map).
  const graphNodes = useRadarStore((s) => s.graphNodes);
  const graphEdges = useRadarStore((s) => s.graphEdges);
  const settledAt = useRadarStore((s) => s.settledAt);
  const pinnedNodeIds = useRadarStore((s) => s.pinnedNodeIds);
  const selectedAgentId = useRadarStore((s) => s.selectedAgentId);
  const heatMapEnabled = useRadarStore((s) => s.heatMapEnabled);
  const contentionScores = useRadarStore((s) => s.contentionScores);

  const { viewport, handlers, screenToWorld } = useCanvasZoomPan();
  const { quadtreeRef } = useGraphLayout();

  // Sync viewport back to store so minimap / debug tools can observe.
  const storeSetViewport = useRadarStore((s) => s.setViewport);
  useEffect(() => {
    storeSetViewport(viewport);
  }, [viewport, storeSetViewport]);

  // Bootstrap: fetch graph once + install pipeline→fetch bridge.
  useEffect(() => {
    useRadarStore.getState().fetchGraph();
    const dispose = installRadarPipelineBridge();
    return () => dispose();
  }, []);

  // Positions map (O(1) lookup for edges/arrows) memoized on node identity.
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of graphNodes) {
      if (n.x !== undefined && n.y !== undefined) {
        m.set(n.id, { x: n.x, y: n.y });
      }
    }
    return m;
  }, [graphNodes]);

  // Parent→child map and dirs-with-own-files set for hull label collapsing.
  const { parentChildMap, dirsWithOwnFiles } = useMemo(() => {
    const pcm = new Map<string, Set<string>>();
    const dwof = new Set<string>();
    for (const n of graphNodes) {
      dwof.add(n.dirKey); // Each dirKey that hosts at least one file.
      const parts = n.dirKey === '' ? [] : n.dirKey.split('/');
      for (let i = 0; i < parts.length; i++) {
        const parent = i === 0 ? '' : parts.slice(0, i).join('/');
        const child = parts.slice(0, i + 1).join('/');
        const set = pcm.get(parent) ?? new Set<string>();
        set.add(child);
        pcm.set(parent, set);
      }
    }
    return { parentChildMap: pcm, dirsWithOwnFiles: dwof };
  }, [graphNodes]);

  // Resolve selected node (best-effort — Plan 05 wires agent current-position
  // tracking; for now we look up the most recent FileEvent for the selected
  // agent and find the matching graph node, else undefined = no glow).
  const pipelineEvents = usePipelineStore((s) => s.events);
  const selectedNode = useMemo(() => {
    if (!selectedAgentId) return undefined;
    // Heuristic: events are ordered newest-first in the pipeline store per
    // its contract; take the first one attributed to the selected agent.
    for (const ev of pipelineEvents) {
      if (ev.attribution.kind === 'pid') {
        // We don't know the PID here; Plan 05 wires this properly. Fall
        // through to the generic "find by path equality" loop below.
        break;
      }
    }
    return undefined;
  }, [selectedAgentId, pipelineEvents]);

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
  ]);

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
  ]);

  // Main rAF render loop — single subscription for the lifetime of the view.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function render() {
      if (!ctx) return;
      if (!dirtyRef.current) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }
      const vp = viewportRef.current;
      const s = stateRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas!.width / dpr;
      const h = canvas!.height / dpr;

      // Step 1 — Canvas clear (surface-container-lowest / #000000).
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000000';
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

      // Steps 2-3: Folder hulls (fill/stroke + label).
      drawFolderHulls(
        ctx,
        s.graphNodes,
        vp.zoom,
        s.parentChildMap,
        s.dirsWithOwnFiles,
      );
      // Step 4: Edges.
      drawEdges(ctx, s.graphEdges, s.positions, vp.zoom, vp, w, h);
      // Step 5: Arrow heads.
      drawArrowHeads(ctx, s.graphEdges, s.positions, vp.zoom, vp, w, h);
      // Step 6: Nodes (heat-tint fill on demand).
      drawNodes(
        ctx,
        s.graphNodes,
        s.contentionScores,
        s.heatMapEnabled,
        s.hoveredNodeId,
        s.pinnedNodeIds,
        vp.zoom,
        vp,
        w,
        h,
      );
      // Step 7: Selected-agent ambient glow + 1px white outer stroke.
      if (s.selectedNode && s.selectedAgentId) {
        drawSelectedNode(
          ctx,
          s.selectedNode,
          getAgentColor(s.selectedAgentId),
          vp.zoom,
        );
      }

      // Plans 05/06 will insert steps 8-13 here: comet tails, comet heads,
      // agent dots, conflict pulses, and conflict/pinned badges.

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
      setHoveredNodeId(found?.id ?? null);
      // Plan 05 will map the hit to an agent (via current-position tracking)
      // and forward to the tooltip. For now we surface the raw node id via a
      // data attribute and send a null agent to the parent.
      onHoveredAgentChange?.(null, sx, sy);
    },
    [screenToWorld, viewport.zoom, onHoveredAgentChange, quadtreeRef],
  );

  // Attach native wheel/mouse handlers (wheel must be non-passive).
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
    </div>
  );
}
