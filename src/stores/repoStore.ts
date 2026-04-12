// Phase 6 repo session Zustand store (D-01, D-02, D-03, D-04).
// See .planning/phases/06-pipeline-activation-integration-wiring/06-RESEARCH.md Example 1.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

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
    // 1. Launch-time CWD -> detect git root
    const cwd = await invoke<string | null>('get_launch_cwd');
    if (cwd) {
      const root = await invoke<string | null>('detect_git_root', { path: cwd });
      if (root) {
        set({ activeRepo: root, error: null });
        await invoke('persist_last_repo', { path: root });
        return;
      }
    }
    // 2. Persisted last repo
    const persisted = await invoke<string | null>('get_last_repo');
    if (persisted) {
      // Sanity-check still a git repo before auto-opening.
      const stillValid = await invoke<string | null>('detect_git_root', { path: persisted });
      if (stillValid) {
        set({ activeRepo: stillValid, error: null });
        return;
      }
    }
    // 3. Native folder picker
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      const root = await invoke<string | null>('detect_git_root', { path: picked });
      if (!root) {
        set({ error: 'That folder is not a git repository. Pick a folder containing a .git directory.' });
        return;
      }
      set({ activeRepo: root, error: null });
      await invoke('persist_last_repo', { path: root });
    }
    // else: user cancelled; leave activeRepo null silently (UI-SPEC: "Silent (no toast; restore prior state)")
  },

  changeRepo: async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      const root = await invoke<string | null>('detect_git_root', { path: picked });
      if (!root) {
        set({ error: 'That folder is not a git repository. Pick a folder containing a .git directory.' });
        return;
      }
      set({ activeRepo: root, isPaused: false, error: null });
      await invoke('persist_last_repo', { path: root });
    }
  },

  togglePause: () => set((s) => ({ isPaused: !s.isPaused })),
  setError: (error) => set({ error }),
}));
