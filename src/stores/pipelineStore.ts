// Phase 2 pipeline Zustand store.
//
// D-02: Frontend subscribes to file events via this store.
// D-04 (Claude recommendation): In-memory ring buffer of 5000 events. Phase 5
// file heat map will add persistent storage; Phase 2 is RAM-only.
//
// Ring buffer strategy: newest events at index 0. ingest() prepends the batch
// and trims to MAX_EVENTS. droppedBatches is an OR'd counter from the backend's
// FileEventBatch.dropped_batches, so the frontend can show a "!" badge when the
// Rust watcher flagged a drop.

import { create } from 'zustand';
import type { FileEvent, FileEventBatch, ProcessInfo, Worktree } from '../bindings';

export const MAX_EVENTS = 5_000;

export interface PipelineStore {
  events: FileEvent[];
  eventCount: number;
  processes: ProcessInfo[];
  worktrees: Worktree[];
  isWatching: boolean;
  droppedBatches: number;
  ingest: (batch: FileEventBatch) => void;
  setWorktrees: (wts: Worktree[]) => void;
  setProcesses: (ps: ProcessInfo[]) => void;
  setWatching: (on: boolean) => void;
  reset: () => void;
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  events: [],
  eventCount: 0,
  processes: [],
  worktrees: [],
  isWatching: false,
  droppedBatches: 0,
  ingest: (batch) =>
    set((s) => {
      const merged = [...batch.events, ...s.events];
      const trimmed = merged.length > MAX_EVENTS ? merged.slice(0, MAX_EVENTS) : merged;
      return {
        events: trimmed,
        eventCount: s.eventCount + batch.events.length,
        droppedBatches: s.droppedBatches + (batch.droppedBatches ?? 0),
      };
    }),
  setWorktrees: (wts) => set({ worktrees: wts }),
  setProcesses: (ps) => set({ processes: ps }),
  setWatching: (on) => set({ isWatching: on }),
  reset: () =>
    set({
      events: [],
      eventCount: 0,
      droppedBatches: 0,
      // Do NOT clear worktrees or processes -- they describe topology, not events.
      // Do NOT clear isWatching -- caller decides.
    }),
}));
