// Phase 3 conflict detection Zustand store.
// Extended in Phase 5 with merge resolution state machine.
//
// CNFL-02: Frontend subscribes to real-time conflict-detected Tauri events
// via listen() -- not just polling. The subscribeToEvents() method sets up
// the listener and returns an unlisten function for cleanup.
//
// All mutations (dismiss, updateWindow) go through Tauri invoke for
// backend validation.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { type MergeHunk, computeMerge, buildMergedContent } from '../lib/merge';

export interface ConflictAlert {
  id: string;
  filePath: string;
  agentAId: string;
  agentAPid: number;
  agentBId: string;
  agentBPid: number;
  detectedAtMs: number;
  conflictWindowMs: number;
  hunkHintsA: [number, number] | null;
  hunkHintsB: [number, number] | null;
  dismissed: boolean;
}

interface ConflictFileVersions {
  baseContent: string;
  agentAContent: string;
  agentBContent: string;
  filePath: string;
  agentAId: string;
  agentBId: string;
}

export interface ActiveMerge {
  conflictId: string;
  filePath: string;
  baseContent: string;
  agentAContent: string;
  agentBContent: string;
  agentAId: string;
  agentBId: string;
  hunks: MergeHunk[];
  resolutions: Map<number, 'a' | 'b' | 'custom'>;
  customEdits: Map<number, string>;
  status: 'loading' | 'diffing' | 'resolving' | 'committing' | 'done' | 'error';
  error: string | null;
}

interface ConflictStore {
  alerts: ConflictAlert[];
  windowMs: number;
  activeMerge: ActiveMerge | null;
  fetchConflicts: () => Promise<void>;
  dismissConflict: (id: string) => Promise<void>;
  fetchSettings: () => Promise<void>;
  updateWindow: (ms: number) => Promise<void>;
  /** Subscribe to real-time conflict-detected Tauri events. Returns unsubscribe function. */
  subscribeToEvents: () => Promise<UnlistenFn>;
  /** Count of active (non-dismissed) alerts. */
  activeCount: () => number;
  reset: () => void;

  // Merge resolution actions
  openMerge: (conflictId: string) => Promise<void>;
  resolveHunk: (hunkIndex: number, choice: 'a' | 'b' | 'custom', customContent?: string) => void;
  applyResolution: () => Promise<void>;
  discardAll: () => void;
  unresolvedCount: () => number;
  resolvedCount: () => number;

  _resolveTimeoutId: ReturnType<typeof setTimeout> | null;
}

export const useConflictStore = create<ConflictStore>((set, get) => ({
  alerts: [],
  windowMs: 5000,
  activeMerge: null,
  _resolveTimeoutId: null as ReturnType<typeof setTimeout> | null,

  fetchConflicts: async () => {
    const alerts = await invoke<ConflictAlert[]>('list_conflicts');
    set({ alerts });
  },

  dismissConflict: async (id) => {
    await invoke('dismiss_conflict', { conflictId: id });
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
    }));
  },

  fetchSettings: async () => {
    const windowMs = await invoke<number>('get_conflict_settings');
    set({ windowMs });
  },

  updateWindow: async (ms) => {
    await invoke('update_conflict_window', { windowMs: ms });
    set({ windowMs: ms });
  },

  subscribeToEvents: async () => {
    // Listen for real-time conflict-detected events from Rust backend
    const unlisten = await listen<ConflictAlert>('conflict-detected', (event) => {
      set((s) => ({
        alerts: [...s.alerts, event.payload],
      }));
    });
    return unlisten;
  },

  activeCount: () => get().alerts.filter((a) => !a.dismissed).length,

  reset: () => set({ alerts: [], windowMs: 5000, activeMerge: null }),

  // --- Merge resolution actions ---

  openMerge: async (conflictId: string) => {
    // Cancel any pending resolve timeout from a previous merge
    const { _resolveTimeoutId } = get();
    if (_resolveTimeoutId) {
      clearTimeout(_resolveTimeoutId);
      set({ _resolveTimeoutId: null });
    }

    set({
      activeMerge: {
        conflictId,
        filePath: '',
        baseContent: '',
        agentAContent: '',
        agentBContent: '',
        agentAId: '',
        agentBId: '',
        hunks: [],
        resolutions: new Map(),
        customEdits: new Map(),
        status: 'loading',
        error: null,
      },
    });

    try {
      const versions = await invoke<ConflictFileVersions>('read_conflict_files', { conflictId });
      const hunks = computeMerge(versions.baseContent, versions.agentAContent, versions.agentBContent);

      set({
        activeMerge: {
          conflictId,
          filePath: versions.filePath,
          baseContent: versions.baseContent,
          agentAContent: versions.agentAContent,
          agentBContent: versions.agentBContent,
          agentAId: versions.agentAId,
          agentBId: versions.agentBId,
          hunks,
          resolutions: new Map(),
          customEdits: new Map(),
          status: 'resolving',
          error: null,
        },
      });
    } catch (e) {
      set((s) => ({
        activeMerge: s.activeMerge
          ? { ...s.activeMerge, status: 'error' as const, error: String(e) }
          : null,
      }));
    }
  },

  resolveHunk: (hunkIndex: number, choice: 'a' | 'b' | 'custom', customContent?: string) => {
    set((s) => {
      if (!s.activeMerge) return s;

      const newResolutions = new Map(s.activeMerge.resolutions);
      newResolutions.set(hunkIndex, choice);

      const newCustomEdits = new Map(s.activeMerge.customEdits);
      if (choice === 'custom' && customContent != null) {
        newCustomEdits.set(hunkIndex, customContent);
      }

      return {
        activeMerge: {
          ...s.activeMerge,
          resolutions: newResolutions,
          customEdits: newCustomEdits,
        },
      };
    });
  },

  applyResolution: async () => {
    const { activeMerge } = get();
    if (!activeMerge) return;

    set((s) => ({
      activeMerge: s.activeMerge ? { ...s.activeMerge, status: 'committing' as const } : null,
    }));

    try {
      const mergedContent = buildMergedContent(
        activeMerge.hunks,
        activeMerge.resolutions,
        activeMerge.customEdits,
      );

      // Determine resolution type
      const choices = [...activeMerge.resolutions.values()];
      const allA = choices.every((c) => c === 'a');
      const allB = choices.every((c) => c === 'b');
      const allCustom = choices.every((c) => c === 'custom');
      let resolutionType: string;
      if (allA) resolutionType = 'accept_a';
      else if (allB) resolutionType = 'accept_b';
      else if (allCustom) resolutionType = 'manual';
      else resolutionType = 'mixed';

      // Serialize hunk resolutions for backend
      const hunkResolutions = [...activeMerge.resolutions.entries()].map(([idx, choice]) => ({
        hunkIndex: idx,
        choice,
      }));

      await invoke('apply_resolution', {
        conflictId: activeMerge.conflictId,
        mergedContent,
        hunkResolutions,
        resolutionType,
      });

      set((s) => ({
        activeMerge: s.activeMerge ? { ...s.activeMerge, status: 'done' as const } : null,
      }));

      // Emit conflict-resolved event
      await emit('conflict-resolved', { conflictId: activeMerge.conflictId });

      // Clear merge after 2s delay (store timeout ID for cancellation)
      const { _resolveTimeoutId: prevTimeout } = get();
      if (prevTimeout) clearTimeout(prevTimeout);
      const timeoutId = setTimeout(() => {
        set({ activeMerge: null, _resolveTimeoutId: null });
      }, 2000);
      set({ _resolveTimeoutId: timeoutId });
    } catch (e) {
      set((s) => ({
        activeMerge: s.activeMerge
          ? { ...s.activeMerge, status: 'error' as const, error: String(e) }
          : null,
      }));
    }
  },

  discardAll: () => {
    const { _resolveTimeoutId } = get();
    if (_resolveTimeoutId) clearTimeout(_resolveTimeoutId);
    set({ activeMerge: null, _resolveTimeoutId: null });
  },

  unresolvedCount: () => {
    const { activeMerge } = get();
    if (!activeMerge) return 0;
    const conflictHunks = activeMerge.hunks.filter((h) => h.type === 'conflict');
    return conflictHunks.filter((h) => !activeMerge.resolutions.has(h.index)).length;
  },

  resolvedCount: () => {
    const { activeMerge } = get();
    if (!activeMerge) return 0;
    const conflictHunks = activeMerge.hunks.filter((h) => h.type === 'conflict');
    return conflictHunks.filter((h) => activeMerge.resolutions.has(h.index)).length;
  },
}));
