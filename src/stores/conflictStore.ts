// Phase 3 conflict detection Zustand store.
//
// CNFL-02: Frontend subscribes to real-time conflict-detected Tauri events
// via listen() -- not just polling. The subscribeToEvents() method sets up
// the listener and returns an unlisten function for cleanup.
//
// All mutations (dismiss, updateWindow) go through Tauri invoke for
// backend validation.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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

interface ConflictStore {
  alerts: ConflictAlert[];
  windowMs: number;
  fetchConflicts: () => Promise<void>;
  dismissConflict: (id: string) => Promise<void>;
  fetchSettings: () => Promise<void>;
  updateWindow: (ms: number) => Promise<void>;
  /** Subscribe to real-time conflict-detected Tauri events. Returns unsubscribe function. */
  subscribeToEvents: () => Promise<UnlistenFn>;
  /** Count of active (non-dismissed) alerts. */
  activeCount: () => number;
  reset: () => void;
}

export const useConflictStore = create<ConflictStore>((set, get) => ({
  alerts: [],
  windowMs: 5000,

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

  reset: () => set({ alerts: [], windowMs: 5000 }),
}));
