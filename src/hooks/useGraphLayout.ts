// D-03, D-11, D-23, VIZN-01, VIZN-04, VIZN-05.
// Continuous d3-force simulation — inspired by ResearchOS NoteGraphView.
//
// Architecture (replaces batch-settle):
//   • Simulation runs via d3's internal rAF loop (not manual ticks).
//   • On each tick, node x/y positions update in-place on the SimNode array.
//   • RadarCanvas reads positions from `simNodesRef` each frame — no Zustand
//     round-trip for live animation (avoids React re-renders at 60fps).
//   • When alpha cools (simulation stops), we commit final positions to the
//     store and rebuild the quadtree.
//   • Force config changes: update forces in-place + `.alpha(0.35).restart()`
//     — nodes glide to new equilibrium.
//   • Custom forces (forceCluster) read strength from refs so slider
//     changes apply immediately on the next tick.

import { useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import { quadtree, type Quadtree } from 'd3-quadtree';
import { forceCluster, forceClusterCollide, type ClusterNode } from '../views/Radar/forceCluster';
import {
  useRadarStore,
  type GraphNode,
  type GraphEdge,
} from '../stores/radarStore';

// d3-force tuning constants. Exported for tests.
export const LINK_DISTANCE = 40;
export const LINK_STRENGTH = 0.3;
export const CHARGE_STRENGTH = -80;
export const CHARGE_THETA = 0.9;
export const CHARGE_DISTANCE_MAX = 300;
export const CENTER_STRENGTH = 0.05;
export const COLLIDE_RADIUS = 6;
export const ALPHA_DECAY = 0.04;
export const VELOCITY_DECAY = 0.5;
export const MAX_TICKS = 500;
export const REWARM_NODE_COUNT_THRESHOLD = 5;
export const REWARM_PERCENT_THRESHOLD = 0.01;
export const REWARM_ALPHA = 0.3;
export const REWARM_MAX_TICKS = 100;

// Alpha used when force config sliders change — enough to see movement,
// not so much that the graph explodes.
const FORCE_CONFIG_ALPHA = 0.35;

export interface SimNode extends ClusterNode {
  id: string;
}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  kind: string;
}

export interface UseGraphLayoutResult {
  quadtreeRef: MutableRefObject<Quadtree<SimNode> | null>;
  /** Ref to the live simulation nodes — RadarCanvas reads this each rAF frame. */
  simNodesRef: MutableRefObject<SimNode[]>;
  /** True while the simulation is actively ticking (alpha > alphaMin). */
  isSimulatingRef: MutableRefObject<boolean>;
  /** Callback to mark the canvas dirty — set by RadarCanvas. */
  markDirtyRef: MutableRefObject<() => void>;
}

export function useGraphLayout(): UseGraphLayoutResult {
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const quadtreeRef = useRef<Quadtree<SimNode> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const isSimulatingRef = useRef(false);
  const markDirtyRef = useRef<() => void>(() => {});
  const lastNodeIdsRef = useRef<Set<string>>(new Set());

  const graphNodes = useRadarStore((s) => s.graphNodes);
  const graphEdges = useRadarStore((s) => s.graphEdges);
  const settledAt = useRadarStore((s) => s.settledAt);
  const forceConfig = useRadarStore((s) => s.forceConfig);

  // Keep force config in refs so the tick handler reads current values
  // without needing to rebuild the simulation.
  const forceConfigRef = useRef(forceConfig);
  forceConfigRef.current = forceConfig;

  /**
   * Build a simulation from graph data. For the initial load, we do a
   * fast synchronous settle (MAX_TICKS) so the graph doesn't appear as
   * a chaotic blob. After that, the simulation stays alive for smooth
   * force-config transitions.
   */
  const buildSimulation = useCallback(
    (nodes: GraphNode[], edges: GraphEdge[], fastSettle: boolean) => {
      // Stop any existing sim.
      if (simRef.current) simRef.current.stop();

      const simNodes: SimNode[] = nodes.map((n) => ({
        id: n.id,
        dirKey: n.dirKey,
        dirDepth: n.dirDepth,
        x: n.x ?? (Math.random() - 0.5) * 200,
        y: n.y ?? (Math.random() - 0.5) * 200,
        fx: n.fx ?? null,
        fy: n.fy ?? null,
      }));
      const simEdges: SimEdge[] = edges.map((e) => ({
        source: typeof e.source === 'string' ? e.source : (e.source as SimNode).id,
        target: typeof e.target === 'string' ? e.target : (e.target as SimNode).id,
        kind: e.kind,
      }));

      const cfg = forceConfigRef.current;
      const sim = forceSimulation<SimNode>(simNodes)
        .force(
          'link',
          forceLink<SimNode, SimEdge>(simEdges)
            .id((n) => n.id)
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
        .alphaDecay(ALPHA_DECAY)
        .velocityDecay(VELOCITY_DECAY)
        .stop(); // we control when it runs

      simRef.current = sim;
      simNodesRef.current = simNodes;

      if (fastSettle) {
        // Synchronous initial settle so the graph appears stable on first paint.
        for (let i = 0; i < MAX_TICKS && sim.alpha() > sim.alphaMin(); i++) {
          sim.tick();
        }
      }

      // Commit positions to the store (for hover hit-testing, minimap, etc.)
      const positions = new Map<string, { x: number; y: number }>();
      for (const n of simNodes) {
        positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
      }
      quadtreeRef.current = quadtree<SimNode>()
        .x((n) => n.x ?? 0)
        .y((n) => n.y ?? 0)
        .addAll(simNodes);
      useRadarStore.getState().commitSettledPositions(positions);

      // Now let the simulation run continuously via d3's internal rAF.
      // On each tick: mark canvas dirty so it redraws with live positions.
      // On end: commit final positions + rebuild quadtree.
      sim.on('tick', () => {
        isSimulatingRef.current = true;
        markDirtyRef.current();
      });
      sim.on('end', () => {
        isSimulatingRef.current = false;
        // Commit final positions to store + rebuild quadtree.
        const finalPositions = new Map<string, { x: number; y: number }>();
        for (const n of sim.nodes()) {
          finalPositions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
        }
        quadtreeRef.current = quadtree<SimNode>()
          .x((n) => n.x ?? 0)
          .y((n) => n.y ?? 0)
          .addAll(sim.nodes());
        useRadarStore.getState().commitSettledPositions(finalPositions);
      });

      // Restart the simulation (d3's internal rAF loop takes over).
      sim.alpha(fastSettle ? 0.01 : 1).restart();

      return positions;
    },
    [],
  );

  /** Decide whether node-id churn crosses the rewarm thresholds. */
  function shouldRewarm(currentIds: Set<string>): boolean {
    const prev = lastNodeIdsRef.current;
    let added = 0;
    let removed = 0;
    for (const id of currentIds) if (!prev.has(id)) added++;
    for (const id of prev) if (!currentIds.has(id)) removed++;
    const mutations = added + removed;
    if (mutations === 0) return false;
    const totalForPercent = Math.max(currentIds.size, prev.size, 1);
    return (
      mutations >= REWARM_NODE_COUNT_THRESHOLD ||
      mutations / totalForPercent >= REWARM_PERCENT_THRESHOLD
    );
  }

  // Initial build when graph data lands without positions (settledAt === null).
  useEffect(() => {
    if (graphNodes.length === 0) return;
    if (settledAt !== null) return;
    buildSimulation(graphNodes, graphEdges, true);
    lastNodeIdsRef.current = new Set(graphNodes.map((n) => n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphEdges, settledAt]);

  // Re-warm when graph data mutates past the threshold.
  useEffect(() => {
    if (settledAt === null) return;
    if (graphNodes.length === 0) return;
    const currentIds = new Set(graphNodes.map((n) => n.id));
    if (!shouldRewarm(currentIds)) return;
    buildSimulation(graphNodes, graphEdges, true);
    lastNodeIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphEdges]);

  // When forceConfig changes: update existing sim forces in-place and
  // alpha-restart. Nodes glide smoothly to new equilibrium — no rebuild.
  const prevForceConfigRef = useRef(forceConfig);
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (settledAt === null) return;
    const prev = prevForceConfigRef.current;
    if (
      prev.centerStrength === forceConfig.centerStrength &&
      prev.clusterStrength === forceConfig.clusterStrength &&
      prev.linkStrength === forceConfig.linkStrength &&
      prev.chargeStrength === forceConfig.chargeStrength
    ) return;
    prevForceConfigRef.current = forceConfig;
    // Update all forces in-place on the existing simulation.
    const centerForce = sim.force('center') as ReturnType<typeof forceCenter> | undefined;
    if (centerForce) centerForce.strength(forceConfig.centerStrength);
    const clusterForce = sim.force('cluster') as ReturnType<typeof forceCluster> | undefined;
    if (clusterForce) clusterForce.strength(forceConfig.clusterStrength);
    const linkForce = sim.force('link') as ReturnType<typeof forceLink> | undefined;
    if (linkForce) linkForce.strength(forceConfig.linkStrength);
    const chargeForce = sim.force('charge') as ReturnType<typeof forceManyBody> | undefined;
    if (chargeForce) chargeForce.strength(forceConfig.chargeStrength);
    // Alpha-restart — d3's rAF loop picks up immediately, nodes glide.
    sim.alpha(FORCE_CONFIG_ALPHA).restart();
  }, [forceConfig, settledAt]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (simRef.current) simRef.current.stop();
    };
  }, []);

  return { quadtreeRef, simNodesRef, isSimulatingRef, markDirtyRef };
}
