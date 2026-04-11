// Phase 4 radar Zustand store.
//
// VIZN-01: Manages viewport state, tree index data, selected agent, and manifest toggle.
// Uses periodic tree index refresh via Tauri invoke('get_tree_index').
// FMON-05: Heat map overlay state with contention score computation.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { computeContentionScore } from '../lib/contention';
import type { ConflictAlert } from './conflictStore';

export interface TreeIndexEntry {
  path: string;
  size: number;
  isDir: boolean;
  depth: number;
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

// 8-color agent dot palette per UI-SPEC
export const AGENT_DOT_PALETTE = [
  '#8eff71', '#00cffc', '#ffd16f', '#ff7351',
  '#c084fc', '#f472b6', '#67e8f9', '#a3e635',
];

// Hash agent ID to palette index for session-consistent colors
export function getAgentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_DOT_PALETTE[Math.abs(hash) % AGENT_DOT_PALETTE.length];
}

interface RadarStore {
  treeData: TreeIndexEntry[];
  viewport: Viewport;
  selectedAgentId: string | null;
  isManifestOpen: boolean;
  heatMapEnabled: boolean;
  contentionScores: Map<string, number>;
  fetchTreeIndex: () => Promise<void>;
  setViewport: (v: Partial<Viewport>) => void;
  selectAgent: (id: string | null) => void;
  toggleManifest: () => void;
  toggleHeatMap: () => void;
  updateContentionScores: (conflicts: ConflictAlert[], agentFileEvents: Map<string, string[]>) => void;
  reset: () => void;
}

export const useRadarStore = create<RadarStore>((set) => ({
  treeData: [],
  viewport: { zoom: 1, panX: 0, panY: 0 },
  selectedAgentId: null,
  isManifestOpen: true,
  heatMapEnabled: false,
  contentionScores: new Map(),

  fetchTreeIndex: async () => {
    try {
      const data = await invoke<TreeIndexEntry[]>('get_tree_index');
      set({ treeData: data });
    } catch {
      // Backend may not have this command yet; silently ignore
    }
  },

  setViewport: (v) =>
    set((s) => ({ viewport: { ...s.viewport, ...v } })),

  selectAgent: (id) => set({ selectedAgentId: id }),

  toggleManifest: () =>
    set((s) => ({ isManifestOpen: !s.isManifestOpen })),

  toggleHeatMap: () =>
    set((s) => ({ heatMapEnabled: !s.heatMapEnabled })),

  updateContentionScores: (conflicts, agentFileEvents) => {
    const fileStats = new Map<string, { conflictCount: number; agentIds: Set<string> }>();

    // Accumulate conflict data
    for (const conflict of conflicts) {
      const existing = fileStats.get(conflict.filePath) ?? { conflictCount: 0, agentIds: new Set() };
      existing.conflictCount += 1;
      existing.agentIds.add(conflict.agentAId);
      existing.agentIds.add(conflict.agentBId);
      fileStats.set(conflict.filePath, existing);
    }

    // Merge in agent file events
    for (const [agentId, filePaths] of agentFileEvents) {
      for (const filePath of filePaths) {
        const existing = fileStats.get(filePath) ?? { conflictCount: 0, agentIds: new Set() };
        existing.agentIds.add(agentId);
        fileStats.set(filePath, existing);
      }
    }

    // Compute normalization ceilings
    let maxConflicts = 0;
    let maxAgents = 0;
    for (const stats of fileStats.values()) {
      if (stats.conflictCount > maxConflicts) maxConflicts = stats.conflictCount;
      if (stats.agentIds.size > maxAgents) maxAgents = stats.agentIds.size;
    }

    // Compute scores
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
      treeData: [],
      viewport: { zoom: 1, panX: 0, panY: 0 },
      selectedAgentId: null,
      isManifestOpen: true,
      heatMapEnabled: false,
      contentionScores: new Map(),
    }),
}));
