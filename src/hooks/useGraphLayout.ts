// D-03, D-11, D-23, VIZN-01, VIZN-04, VIZN-05.
// Settle-then-freeze d3-force wrapper per 07-RESEARCH §Pattern 1.
//
//   • Pulls graphNodes/graphEdges from radarStore; builds a fresh
//     simulation with forceLink / forceManyBody / forceCenter /
//     forceCollide / forceCluster (D-11).
//   • Internal timer is `.stop()`ed; we manual-tick up to MAX_TICKS
//     (500, D-03) or until `alpha < alphaMin`.
//   • On settle, builds a d3-quadtree from final positions (D-23) and
//     commits `{x,y}` + settledAt back to the store.
//   • Re-warms (brief alpha boost + bounded tick loop) when node-id
//     churn crosses `REWARM_NODE_COUNT_THRESHOLD` OR
//     `REWARM_PERCENT_THRESHOLD` (RESEARCH §Pitfall 3).
//   • Cleans up on unmount (RESEARCH §Pitfall 2).
//   • Simulation + quadtree live in `useRef` — never in Zustand
//     (RESEARCH §Pitfall 5).

import { useEffect, useRef, type MutableRefObject } from 'react';
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
import { forceCluster, type ClusterNode } from '../views/Radar/forceCluster';
import {
  useRadarStore,
  type GraphNode,
  type GraphEdge,
} from '../stores/radarStore';

// d3-force tuning constants (RESEARCH §Pattern 1 lines 218-235). Exported
// so tests can assert contract values without re-deriving them.
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

// Internal simulation shape — ClusterNode already extends
// SimulationNodeDatum and carries dirKey/dirDepth.
interface SimNode extends ClusterNode {
  id: string;
}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  kind: string;
}

export interface UseGraphLayoutResult {
  quadtreeRef: MutableRefObject<Quadtree<SimNode> | null>;
  rewarm: (alpha?: number) => void;
}

export function useGraphLayout(): UseGraphLayoutResult {
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const quadtreeRef = useRef<Quadtree<SimNode> | null>(null);
  const lastNodeIdsRef = useRef<Set<string>>(new Set());

  const graphNodes = useRadarStore((s) => s.graphNodes);
  const graphEdges = useRadarStore((s) => s.graphEdges);
  const settledAt = useRadarStore((s) => s.settledAt);
  const forceConfig = useRadarStore((s) => s.forceConfig);

  /**
   * Build a fresh simulation, manual-tick until alpha cools or MAX_TICKS,
   * snapshot positions, rebuild quadtree. Returns the position map so
   * the caller can commit it into the store.
   */
  function buildAndSettle(
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): Map<string, { x: number; y: number }> {
    // Seed positions near origin so new nodes don't fly in from
    // undefined-land (Pitfall 3).
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

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(simEdges)
          .id((n) => n.id)
          .distance(LINK_DISTANCE)
          .strength(LINK_STRENGTH),
      )
      .force(
        'charge',
        forceManyBody<SimNode>()
          .strength(CHARGE_STRENGTH)
          .theta(CHARGE_THETA)
          .distanceMax(CHARGE_DISTANCE_MAX),
      )
      .force('center', forceCenter(0, 0).strength(forceConfig.centerStrength))
      .force('collide', forceCollide(COLLIDE_RADIUS))
      .force('cluster', forceCluster().strength(forceConfig.clusterStrength))
      .alphaDecay(ALPHA_DECAY)
      .velocityDecay(VELOCITY_DECAY)
      .stop();

    simRef.current = sim;

    for (let i = 0; i < MAX_TICKS && sim.alpha() > sim.alphaMin(); i++) {
      sim.tick();
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const n of simNodes) {
      positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    }
    quadtreeRef.current = quadtree<SimNode>()
      .x((n) => n.x ?? 0)
      .y((n) => n.y ?? 0)
      .addAll(simNodes);
    return positions;
  }

  /** Decide whether node-id churn crosses the rewarm thresholds (Pitfall 3). */
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

  // Initial settle when graph data lands without positions (settledAt === null).
  useEffect(() => {
    if (graphNodes.length === 0) return;
    if (settledAt !== null) return;
    const positions = buildAndSettle(graphNodes, graphEdges);
    useRadarStore.getState().commitSettledPositions(positions);
    lastNodeIdsRef.current = new Set(graphNodes.map((n) => n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphEdges, settledAt, forceConfig]);

  // Re-warm when graph data mutates past the threshold. Runs only after
  // an initial settle (settledAt !== null).
  useEffect(() => {
    if (settledAt === null) return;
    if (graphNodes.length === 0) return;
    const currentIds = new Set(graphNodes.map((n) => n.id));
    if (!shouldRewarm(currentIds)) return;
    const positions = buildAndSettle(graphNodes, graphEdges);
    useRadarStore.getState().commitSettledPositions(positions);
    lastNodeIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphEdges, forceConfig]);

  // Cleanup on unmount (Pitfall 2).
  useEffect(() => {
    return () => {
      if (simRef.current) simRef.current.stop();
    };
  }, []);

  /**
   * Manual re-warm entry point. Keeps the existing simulation (so
   * accumulated state like charge cache survives) and tick-bounds at
   * REWARM_MAX_TICKS. Used by drag/pin flows in Plan 04.
   */
  function rewarm(alpha: number = REWARM_ALPHA) {
    const sim = simRef.current;
    if (!sim) return;
    sim.alpha(alpha);
    for (let i = 0; i < REWARM_MAX_TICKS && sim.alpha() > sim.alphaMin(); i++) {
      sim.tick();
    }
    const positions = new Map<string, { x: number; y: number }>();
    for (const n of sim.nodes()) {
      positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    }
    useRadarStore.getState().commitSettledPositions(positions);
    quadtreeRef.current = quadtree<SimNode>()
      .x((n) => n.x ?? 0)
      .y((n) => n.y ?? 0)
      .addAll(sim.nodes());
  }

  return { quadtreeRef, rewarm };
}
