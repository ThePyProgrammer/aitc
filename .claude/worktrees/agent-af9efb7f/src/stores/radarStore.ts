// Phase 4 radar Zustand store.
//
// VIZN-01: Manages viewport state, tree index data, selected agent, and manifest toggle.
// Uses periodic tree index refresh via Tauri invoke('get_tree_index').

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

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
  fetchTreeIndex: () => Promise<void>;
  setViewport: (v: Partial<Viewport>) => void;
  selectAgent: (id: string | null) => void;
  toggleManifest: () => void;
  reset: () => void;
}

export const useRadarStore = create<RadarStore>((set) => ({
  treeData: [],
  viewport: { zoom: 1, panX: 0, panY: 0 },
  selectedAgentId: null,
  isManifestOpen: true,

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

  reset: () =>
    set({
      treeData: [],
      viewport: { zoom: 1, panX: 0, panY: 0 },
      selectedAgentId: null,
      isManifestOpen: true,
    }),
}));
