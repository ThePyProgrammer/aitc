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
import type {
  DependencyEdgeDto,
  EdgeKind,
  IpcBridgeDto,
  IpcCallSite,
} from '../bindings';
import { GRAPH_HALF_WIDTH } from '../workers/graphSimConfig';
import {
  cullExpiredTrails,
  MAX_TRAILS_PER_AGENT,
  TRAIL_TOTAL_LIFESPAN_MS,
} from '../views/Radar/CometTrail';
import {
  THEMES,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
} from '../views/Radar/themes';

// Phase 7 graph state (D-01..D-03, D-11); Phase 12 extends with bridge kind
// discriminator + language classification + bridge metadata (D-10, D-16).
export interface GraphNode {
  id: string;              // repo-relative path (or `bridge:<commandName>` for bridges)
  dirKey: string;          // repo-relative parent dir path (synthetic "bridge" for bridge nodes)
  dirDepth: number;        // depth from repo root, for forceCluster (D-11)
  x?: number;
  y?: number;
  fx?: number | null;      // user-pinned x (D-03) / deterministic alpha x-spread (D-14 for bridges)
  fy?: number | null;      // user-pinned y (D-03) / 0 for bridges (D-13)
  // Phase 12 (D-10): kind discriminator; undefined treated as 'file' for BC.
  kind?: 'file' | 'bridge';
  // Phase 12 (D-16): language classification for forceBoundary routing; only
  // populated on file nodes (undefined on bridges + language-agnostic files).
  language?: 'ts' | 'rust';
  // Phase 12 bridge-only fields (undefined on file nodes).
  commandName?: string;
  rustName?: string;
  handlerFile?: string;
  handlerLine?: number;
  signatureSummary?: string;
  hasChannelArg?: boolean;
  callerFiles?: IpcCallSite[];
  callerCount?: number;
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
  linkStrength: number;     // 0..1, default 0.3; 0 = structure-only mode (no edge pull)
  chargeStrength: number;   // -300..0, default -80; repulsion between all nodes
  boundaryStrength: number; // Phase 12 (D-29/D-30): 0..1, default 0.15; language-axis separation
}

export const DEFAULT_FORCE_CONFIG: ForceConfig = {
  centerStrength: 0.05,
  clusterStrength: 0.08,
  linkStrength: 0.3,
  chargeStrength: -80,
  boundaryStrength: 0.15,
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
  /** Phase 12 (D-21): currently selected bridge, keyed by commandName.
   *  null when no bridge is selected. */
  selectedBridgeId: string | null;
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
  /** Phase 12 (D-14): last hashed command-name set used to compute bridge
   *  fx x-spread. Unchanged sets reuse prior fx values instead of
   *  recomputing — prevents bridges from jumping around on every
   *  fetchGraph refresh when the command set hasn't changed. */
  lastBridgeSetHash: string | null;
  /** Pre-computed from graphNodes on fetchGraph — avoids 20k string ops
   *  per render via useMemo. Maps parent dir → set of child dirs. */
  parentChildMap: Map<string, Set<string>>;
  /** Dirs that directly contain at least one file node. */
  dirsWithOwnFiles: Set<string>;
  /** Currently selected graph color theme id. Persisted in localStorage
   *  under THEME_STORAGE_KEY. Always a valid key in THEMES (invalid values
   *  are coerced to DEFAULT_THEME_ID on write). */
  themeId: string;
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
  /** Phase 12 (D-21): select a bridge by commandName, or clear with null. */
  selectBridge: (id: string | null) => void;
  toggleManifest: () => void;
  toggleHeatMap: () => void;
  /** Switch the active graph theme. Unknown ids fall back to the default
   *  silently. Persists to localStorage so the selection survives restart. */
  setThemeId: (id: string) => void;
  updateContentionScores: (conflicts: ConflictAlert[], agentFileEvents: Map<string, string[]>) => void;
  reset: () => void;
}

/**
 * Read the persisted theme id from localStorage, validating it against the
 * THEMES catalog. Missing / unknown / unreadable values fall back to the
 * default silently — acceptance criterion (spec §9).
 */
function readPersistedThemeId(): string {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_THEME_ID;
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && Object.prototype.hasOwnProperty.call(THEMES, raw)) {
      return raw;
    }
  } catch {
    // localStorage may throw in private-browsing / file:// contexts.
  }
  return DEFAULT_THEME_ID;
}

export const useRadarStore = create<RadarStore>((set, get) => ({
  viewport: { zoom: 1, panX: 0, panY: 0 },
  selectedAgentId: null,
  selectedBridgeId: null,
  isManifestOpen: true,
  heatMapEnabled: false,
  contentionScores: new Map(),
  graphNodes: [],
  graphEdges: [],
  settledAt: null,
  pinnedNodeIds: new Set<string>(),
  activeTrails: [],
  forceConfig: { ...DEFAULT_FORCE_CONFIG },
  lastBridgeSetHash: null,
  themeId: readPersistedThemeId(),
  parentChildMap: new Map<string, Set<string>>(),
  dirsWithOwnFiles: new Set<string>(),

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
      // Phase 12 (V-12-16, D-08): widened to three-leg Promise.all — bridges
      // are best-effort; a single backend failure leaves the other slots
      // intact thanks to the per-leg .catch() guards.
      const [treeIndex, edges, bridges] = await Promise.all([
        invoke<TreeIndexEntryRaw[]>('get_tree_index'),
        invoke<DependencyEdgeDto[]>('get_dependency_graph'),
        invoke<IpcBridgeDto[]>('get_ipc_bridges').catch((err) => {
          // Per-leg catch so a bridge-scan failure does not clobber the
          // tree/edges work that already completed.
          console.error('get_ipc_bridges failed:', err);
          return [] as IpcBridgeDto[];
        }),
      ]);
      const fileEntries = treeIndex.filter((e) => !e.isDir);
      const knownIds = new Set(fileEntries.map((e) => e.path));
      // Phase 11.1 fix: preserve x/y/fx/fy for nodes that survive the
      // refresh. Without this, a pipeline-triggered re-fetch (e.g. from a
      // stray file-watcher event) would wipe every node's coords and the
      // minimap + canvas would render blank until the worker re-settled
      // — user-visible as "the nodes just disappeared mid-zoom."
      const existingById = new Map(
        get().graphNodes.map((n) => [n.id, n]),
      );

      // Phase 12 (D-16): language classification for file nodes drives the
      // forceBoundary targetY selection. Derived on the fly rather than
      // persisted — cheap and avoids a schema migration.
      const classifyLanguage = (path: string): 'ts' | 'rust' | undefined => {
        if (path.startsWith('src-tauri/')) return 'rust';
        if (path.endsWith('.rs')) return 'rust';
        if (/\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(path)) return 'ts';
        return undefined;
      };

      const fileNodes: GraphNode[] = fileEntries.map((e) => {
        const lastSlash = e.path.lastIndexOf('/');
        const dirKey = lastSlash >= 0 ? e.path.slice(0, lastSlash) : '';
        const prev = existingById.get(e.path);
        return {
          id: e.path,
          dirKey,
          dirDepth: dirKey === '' ? 0 : dirKey.split('/').length,
          x: prev?.x,
          y: prev?.y,
          fx: prev?.fx,
          fy: prev?.fy,
          kind: 'file' as const,
          language: classifyLanguage(e.path),
        };
      });
      const validEdges: GraphEdge[] = edges
        .filter((e) => knownIds.has(e.from) && knownIds.has(e.to))
        .map((e) => ({ source: e.from, target: e.to, kind: e.kind }));

      // Phase 12 (D-10, D-13, D-14): build bridge nodes + (D-27) bridge edges.
      // Bridge id uses `bridge:<commandName>` prefix to avoid collision with
      // file paths (RESEARCH §Pitfall 6). fy=0 pins to the boundary line;
      // fx is assigned below via alphabetic x-spread.
      const bridgeNodes: GraphNode[] = bridges.map((b) => {
        const bridgeId = `bridge:${b.commandName}`;
        const prev = existingById.get(bridgeId);
        return {
          id: bridgeId,
          dirKey: 'bridge',
          dirDepth: 0,
          kind: 'bridge' as const,
          commandName: b.commandName,
          rustName: b.rustName,
          handlerFile: b.handlerFile,
          handlerLine: b.handlerLine,
          signatureSummary: b.signatureSummary,
          hasChannelArg: b.hasChannelArg,
          callerFiles: b.callerFiles,
          callerCount: b.callerFiles.length,
          fy: 0,
          // fx set below via alphabetic x-spread / cache.
          x: prev?.x,
          y: 0,
        };
      });

      // Phase 12 (D-14): alphabetic x-spread with hash-gated cache.
      // When the command set is unchanged, reuse prior fx values to prevent
      // bridges from jumping on every fetchGraph refresh. When changed,
      // recompute an evenly spread fx across [-GRAPH_HALF_WIDTH, +GRAPH_HALF_WIDTH]
      // in command-name alphabetic order.
      const sortedBridges = [...bridgeNodes].sort((a, b) =>
        (a.commandName ?? '').localeCompare(b.commandName ?? ''),
      );
      const bridgeSetHash = sortedBridges
        .map((n) => n.commandName)
        .join(',');
      const prevHash = get().lastBridgeSetHash;
      const prevBridgeFxById = new Map(
        get()
          .graphNodes.filter((n) => n.kind === 'bridge')
          .map((n) => [n.id, n.fx]),
      );
      let nextBridgeSetHash = prevHash;
      if (bridgeSetHash !== prevHash) {
        const N = sortedBridges.length;
        sortedBridges.forEach((n, i) => {
          if (N === 0) return;
          n.fx =
            N === 1
              ? 0
              : -GRAPH_HALF_WIDTH + (2 * GRAPH_HALF_WIDTH * i) / (N - 1);
          // Align x with fx on first-placement so the renderer doesn't see
          // a transient (0, 0) before the worker settles.
          n.x = n.fx ?? 0;
        });
        nextBridgeSetHash = bridgeSetHash;
      } else {
        // Same command set — preserve prior fx values verbatim.
        sortedBridges.forEach((n) => {
          const priorFx = prevBridgeFxById.get(n.id);
          n.fx = priorFx ?? 0;
          n.x = (priorFx ?? 0);
        });
      }

      // Phase 12 (D-27): bridge edges — fan `invokes` edges from each caller
      // file into the bridge, and a single `handles` edge from the bridge to
      // the Rust handler file. Dangling bridges (no handler, no callers)
      // contribute nothing.
      const bridgeEdges: GraphEdge[] = [];
      for (const b of bridges) {
        const bridgeId = `bridge:${b.commandName}`;
        for (const caller of b.callerFiles) {
          if (!knownIds.has(caller.file)) continue;
          bridgeEdges.push({
            source: caller.file,
            target: bridgeId,
            kind: 'invokes' as EdgeKind,
          });
        }
        if (b.handlerFile && knownIds.has(b.handlerFile)) {
          bridgeEdges.push({
            source: bridgeId,
            target: b.handlerFile,
            kind: 'handles' as EdgeKind,
          });
        }
      }

      // Merge: file nodes first, bridges appended. Canvas z-order (Plan 05)
      // draws bridges on top; array order here is informational only.
      const allNodes = [...fileNodes, ...sortedBridges];
      const allEdges = [...validEdges, ...bridgeEdges];

      // Pre-compute parentChildMap + dirsWithOwnFiles once here instead
      // of per-render via useMemo. Eliminates ~20k slice/join string ops
      // from the React render path for a 5k-node graph. Bridges are
      // intentionally excluded — they are not part of the folder tree.
      const pcm = new Map<string, Set<string>>();
      const dwof = new Set<string>();
      for (const n of fileNodes) {
        dwof.add(n.dirKey);
        const parts = n.dirKey === '' ? [] : n.dirKey.split('/');
        for (let i = 0; i < parts.length; i++) {
          const parent = i === 0 ? '' : parts.slice(0, i).join('/');
          const child = parts.slice(0, i + 1).join('/');
          const s = pcm.get(parent) ?? new Set<string>();
          s.add(child);
          pcm.set(parent, s);
        }
      }

      set({
        graphNodes: allNodes,
        graphEdges: allEdges,
        settledAt: null,
        parentChildMap: pcm,
        dirsWithOwnFiles: dwof,
        lastBridgeSetHash: nextBridgeSetHash,
      });
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
    set((s) => {
      // Phase 11.1 post-ship defense: drop any non-finite fields from the
      // partial. A single NaN / ±Infinity in viewport corrupts every frame
      // — canvas2d's ctx.setTransform silently no-ops on non-finite input,
      // so the user sees a blank canvas with no error. Fall back to the
      // current store value for any axis whose incoming value isn't finite.
      const merged = { ...s.viewport, ...v };
      const zoom = Number.isFinite(merged.zoom) ? merged.zoom : s.viewport.zoom;
      const panX = Number.isFinite(merged.panX) ? merged.panX : s.viewport.panX;
      const panY = Number.isFinite(merged.panY) ? merged.panY : s.viewport.panY;
      return { viewport: { zoom, panX, panY } };
    }),

  selectAgent: (id) => set({ selectedAgentId: id }),

  // Phase 12 (D-21): select a bridge by commandName. Null clears selection.
  selectBridge: (id) => set({ selectedBridgeId: id }),

  toggleManifest: () =>
    set((s) => ({ isManifestOpen: !s.isManifestOpen })),

  toggleHeatMap: () =>
    set((s) => ({ heatMapEnabled: !s.heatMapEnabled })),

  /**
   * Persist and apply a new theme id. Invalid ids coerce to the default
   * (we still persist — so a corrupted value self-heals on next write).
   * localStorage write is try/caught because private-browsing can throw.
   */
  setThemeId: (id) => {
    const nextId = Object.prototype.hasOwnProperty.call(THEMES, id)
      ? id
      : DEFAULT_THEME_ID;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(THEME_STORAGE_KEY, nextId);
      }
    } catch {
      // Persist best-effort; the live selection still applies.
    }
    set({ themeId: nextId });
  },

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
      selectedBridgeId: null,
      isManifestOpen: true,
      heatMapEnabled: false,
      contentionScores: new Map(),
      graphNodes: [],
      graphEdges: [],
      settledAt: null,
      pinnedNodeIds: new Set<string>(),
      activeTrails: [],
      lastBridgeSetHash: null,
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
