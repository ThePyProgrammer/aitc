// Phase 4 + Phase 7 radar Zustand store.
//
// Phase 4 (VIZN-01): viewport state, selected agent, manifest toggle.
// Phase 5 (FMON-05): heat map overlay + contention scores.
// Phase 7 (D-01..D-03, D-11, VIZN-01/05): dependency-graph state.
//   - `graphNodes` / `graphEdges`: settled force-directed layout input.
//   - `settledAt`: null while in flight; ms epoch after useGraphLayout
//     commits positions.
//   - `pinnedNodeIds` + `fx/fy`: user-dragged pins (D-03).
//   - `activeTrails`: per-agent comet trails (D-14..D-18); Plan 05 wires.
//
// Treemap-era state (`treeData` + `fetchTreeIndex`) is gone — Plan 03
// replaced it with `fetchGraph()` which resolves both the tree index and
// the dependency graph in parallel and resets `settledAt` to trigger a
// fresh settle in useGraphLayout. Plan 04 deleted `useTreemapLayout` and
// the `squarify` dependency entirely (D-04).

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { computeContentionScore } from '../lib/contention';
import type { ConflictAlert } from './conflictStore';
import { usePipelineStore } from './pipelineStore';
import type { DependencyEdgeDto, EdgeKind } from '../bindings';
import {
  cullExpiredTrails,
  MAX_TRAILS_PER_AGENT,
  TRAIL_TOTAL_LIFESPAN_MS,
} from '../views/Radar/CometTrail';

// Phase 7 graph state (D-01..D-03, D-11).
export interface GraphNode {
  id: string;              // repo-relative path (matches contentionScores keys)
  dirKey: string;          // repo-relative parent dir path
  dirDepth: number;        // depth from repo root, for forceCluster (D-11)
  x?: number;
  y?: number;
  fx?: number | null;      // user-pinned x (D-03)
  fy?: number | null;      // user-pinned y (D-03)
}

export interface GraphEdge {
  source: string;          // node id
  target: string;          // node id
  kind: EdgeKind;
}

export interface ActiveTrail {
  id: string;              // `${agentId}|${fromPath}|${toPath}|${startTs}`
  agentId: string;
  fromPath: string;
  toPath: string;
  startTs: number;         // ms epoch
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ForceConfig {
  centerStrength: number;   // 0..1, default 0.05
  clusterStrength: number;  // 0..1, default 0.08
}

export const DEFAULT_FORCE_CONFIG: ForceConfig = {
  centerStrength: 0.05,
  clusterStrength: 0.08,
};

// 8-color agent dot palette per UI-SPEC.
export const AGENT_DOT_PALETTE = [
  '#8eff71', '#00cffc', '#ffd16f', '#ff7351',
  '#c084fc', '#f472b6', '#67e8f9', '#a3e635',
];

// Hash agent ID to palette index for session-consistent colors.
export function getAgentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_DOT_PALETTE[Math.abs(hash) % AGENT_DOT_PALETTE.length];
}

// Minimal shape used by fetchGraph's invocation of `get_tree_index`.
// Kept internal — the graph store no longer exposes a flat entry list.
interface TreeIndexEntryRaw {
  path: string;
  size: number;
  isDir: boolean;
  depth: number;
}

interface RadarStore {
  viewport: Viewport;
  selectedAgentId: string | null;
  isManifestOpen: boolean;
  heatMapEnabled: boolean;
  contentionScores: Map<string, number>;
  // Phase 7 graph state.
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  settledAt: number | null;
  pinnedNodeIds: Set<string>;
  activeTrails: ActiveTrail[];
  forceConfig: ForceConfig;
  // Actions.
  fetchGraph: () => Promise<void>;
  commitSettledPositions: (positions: Map<string, { x: number; y: number }>) => void;
  pinNode: (id: string, x: number, y: number) => void;
  unpinNode: (id: string) => void;
  pushTrail: (t: ActiveTrail) => void;
  pruneTrails: (now?: number) => void;
  setForceConfig: (cfg: Partial<ForceConfig>) => void;
  setViewport: (v: Partial<Viewport>) => void;
  selectAgent: (id: string | null) => void;
  toggleManifest: () => void;
  toggleHeatMap: () => void;
  updateContentionScores: (conflicts: ConflictAlert[], agentFileEvents: Map<string, string[]>) => void;
  reset: () => void;
}

export const useRadarStore = create<RadarStore>((set) => ({
  viewport: { zoom: 1, panX: 0, panY: 0 },
  selectedAgentId: null,
  isManifestOpen: true,
  heatMapEnabled: false,
  contentionScores: new Map(),
  graphNodes: [],
  graphEdges: [],
  settledAt: null,
  pinnedNodeIds: new Set<string>(),
  activeTrails: [],
  forceConfig: { ...DEFAULT_FORCE_CONFIG },

  /**
   * D-03 + D-05: fetch tree index + dependency graph in parallel, derive
   * file-only `GraphNode[]` with dirKey/dirDepth, filter edges to known
   * node ids, reset settledAt so useGraphLayout runs a fresh settle.
   *
   * Best-effort: backend errors (e.g. command not registered, parser
   * failure) leave the store untouched — matches the old fetchTreeIndex
   * contract so the UI degrades gracefully on startup.
   */
  fetchGraph: async () => {
    try {
      const [treeIndex, edges] = await Promise.all([
        invoke<TreeIndexEntryRaw[]>('get_tree_index'),
        invoke<DependencyEdgeDto[]>('get_dependency_graph'),
      ]);
      const fileEntries = treeIndex.filter((e) => !e.isDir);
      const knownIds = new Set(fileEntries.map((e) => e.path));
      const nodes: GraphNode[] = fileEntries.map((e) => {
        const lastSlash = e.path.lastIndexOf('/');
        const dirKey = lastSlash >= 0 ? e.path.slice(0, lastSlash) : '';
        return {
          id: e.path,
          dirKey,
          dirDepth: dirKey === '' ? 0 : dirKey.split('/').length,
        };
      });
      const validEdges: GraphEdge[] = edges
        .filter((e) => knownIds.has(e.from) && knownIds.has(e.to))
        .map((e) => ({ source: e.from, target: e.to, kind: e.kind }));
      set({ graphNodes: nodes, graphEdges: validEdges, settledAt: null });
    } catch {
      // Best-effort: leave existing slots as-is on failure.
    }
  },

  /**
   * D-03: write settled x/y back into each matching node, mark
   * `settledAt = now` so subscribers know the layout is stable.
   */
  commitSettledPositions: (positions) => {
    set((s) => ({
      graphNodes: s.graphNodes.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, x: p.x, y: p.y } : n;
      }),
      settledAt: Date.now(),
    }));
  },

  /**
   * D-03: pin a node at (x, y). Sets fx/fy (d3-force honors these as
   * fixed positions) and records the id in pinnedNodeIds so the Canvas
   * overlay can render a distinct "pinned" marker.
   */
  pinNode: (id, x, y) => {
    set((s) => {
      const nextPinned = new Set(s.pinnedNodeIds);
      nextPinned.add(id);
      return {
        pinnedNodeIds: nextPinned,
        graphNodes: s.graphNodes.map((n) =>
          n.id === id ? { ...n, fx: x, fy: y, x, y } : n,
        ),
      };
    });
  },

  /**
   * D-03: release a pinned node — clears fx/fy so d3-force resumes
   * governing its position on the next rewarm.
   */
  unpinNode: (id) => {
    set((s) => {
      const nextPinned = new Set(s.pinnedNodeIds);
      nextPinned.delete(id);
      return {
        pinnedNodeIds: nextPinned,
        graphNodes: s.graphNodes.map((n) =>
          n.id === id ? { ...n, fx: null, fy: null } : n,
        ),
      };
    });
  },

  /**
   * D-18: append a trail, evicting this agent's oldest (by startTs) when it
   * is already at MAX_TRAILS_PER_AGENT. Other agents' trails are untouched —
   * the cap is strictly per-agent.
   */
  pushTrail: (t) => {
    set((s) => {
      const ofAgent = s.activeTrails.filter((x) => x.agentId === t.agentId);
      if (ofAgent.length >= MAX_TRAILS_PER_AGENT) {
        const oldest = ofAgent.reduce(
          (a, b) => (a.startTs <= b.startTs ? a : b),
          ofAgent[0],
        );
        return {
          activeTrails: s.activeTrails
            .filter((x) => x.id !== oldest.id)
            .concat(t),
        };
      }
      return { activeTrails: s.activeTrails.concat(t) };
    });
  },

  /**
   * D-16/D-18: drop trails older than 10s and enforce per-agent FIFO cap.
   * Called from the RadarCanvas rAF loop — cheap (scan + single filter).
   */
  pruneTrails: (now = Date.now()) => {
    set((s) => ({
      activeTrails: cullExpiredTrails(
        s.activeTrails,
        now,
        MAX_TRAILS_PER_AGENT,
        TRAIL_TOTAL_LIFESPAN_MS,
      ),
    }));
  },

  setForceConfig: (cfg) =>
    set((s) => ({
      forceConfig: { ...s.forceConfig, ...cfg },
    })),

  setViewport: (v) =>
    set((s) => ({ viewport: { ...s.viewport, ...v } })),

  selectAgent: (id) => set({ selectedAgentId: id }),

  toggleManifest: () =>
    set((s) => ({ isManifestOpen: !s.isManifestOpen })),

  toggleHeatMap: () =>
    set((s) => ({ heatMapEnabled: !s.heatMapEnabled })),

  updateContentionScores: (conflicts, agentFileEvents) => {
    const fileStats = new Map<string, { conflictCount: number; agentIds: Set<string> }>();

    // Accumulate conflict data.
    for (const conflict of conflicts) {
      const existing = fileStats.get(conflict.filePath) ?? { conflictCount: 0, agentIds: new Set() };
      existing.conflictCount += 1;
      existing.agentIds.add(conflict.agentAId);
      existing.agentIds.add(conflict.agentBId);
      fileStats.set(conflict.filePath, existing);
    }

    // Merge in agent file events.
    for (const [agentId, filePaths] of agentFileEvents) {
      for (const filePath of filePaths) {
        const existing = fileStats.get(filePath) ?? { conflictCount: 0, agentIds: new Set() };
        existing.agentIds.add(agentId);
        fileStats.set(filePath, existing);
      }
    }

    // Compute normalization ceilings.
    let maxConflicts = 0;
    let maxAgents = 0;
    for (const stats of fileStats.values()) {
      if (stats.conflictCount > maxConflicts) maxConflicts = stats.conflictCount;
      if (stats.agentIds.size > maxAgents) maxAgents = stats.agentIds.size;
    }

    // Compute scores.
    const scores = new Map<string, number>();
    for (const [filePath, stats] of fileStats) {
      const score = computeContentionScore(stats.conflictCount, stats.agentIds.size, maxConflicts, maxAgents);
      if (score > 0) {
        scores.set(filePath, score);
      }
    }

    set({ contentionScores: scores });
  },

  reset: () =>
    set({
      viewport: { zoom: 1, panX: 0, panY: 0 },
      selectedAgentId: null,
      isManifestOpen: true,
      heatMapEnabled: false,
      contentionScores: new Map(),
      graphNodes: [],
      graphEdges: [],
      settledAt: null,
      pinnedNodeIds: new Set<string>(),
      activeTrails: [],
    }),
}));

const BRIDGE_DEBOUNCE_MS = 500;

/**
 * D-08: Wire pipelineStore.events → radarStore.fetchGraph (debounced 500ms).
 * Returns an unsubscribe function. Caller MUST store it in a ref and call
 * on unmount to avoid leaks (06-RESEARCH.md Pitfall 6).
 *
 * Phase 7 swap: calls `fetchGraph()` instead of the old `fetchTreeIndex()`
 * so the dependency graph is refreshed in step with the tree index.
 */
export function installRadarPipelineBridge(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = usePipelineStore.subscribe((state, prev) => {
    if (state.events === prev.events) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      useRadarStore.getState().fetchGraph().catch(() => {
        /* graph refresh is best-effort; errors already swallowed by fetchGraph */
      });
    }, BRIDGE_DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}
