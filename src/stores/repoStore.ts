// Phase 6 repo session Zustand store.
// TODO(plan-02): implement resolveInitialRepo, changeRepo, togglePause per
// 06-RESEARCH.md Code Example 1.

import { create } from 'zustand';

export interface RepoStore {
  activeRepo: string | null;
  isPaused: boolean;
  error: string | null;
  resolveInitialRepo: () => Promise<void>;
  changeRepo: () => Promise<void>;
  togglePause: () => void;
  setError: (e: string | null) => void;
}

export const useRepoStore = create<RepoStore>((set) => ({
  activeRepo: null,
  isPaused: false,
  error: null,
  resolveInitialRepo: async () => {
    throw new Error('TODO(plan-02)');
  },
  changeRepo: async () => {
    throw new Error('TODO(plan-02)');
  },
  togglePause: () => set((s) => ({ isPaused: !s.isPaused })),
  setError: (error) => set({ error }),
}));
