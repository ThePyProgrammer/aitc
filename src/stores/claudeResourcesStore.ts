// Phase 9 ARSENAL — Claude resources store (Plan 04 Wave 2).
//
// Mirrors the pipelineStore pattern (Phase 2) but for Claude resources discovered
// under `~/.claude/` (global) and `<cwd>/.claude/` (project). Unlike pipelineStore,
// this is keyed by stable ResourceId (not an event ring buffer) — the total
// population is bounded by the number of Claude resources on disk.
//
// D-03: selectCombined suppresses a Global resource if a Project resource of the
// same (category, name) exists.
// D-15: externalEdits map records watcher-reported mtime changes so the editor
// can decide between silent refresh and the "file changed on disk" banner.

import { create } from 'zustand';
import type { Category, Resource, ResourceEventBatch, Scope } from '../bindings';

export interface ClaudeResourcesState {
  resourcesById: Record<string, Resource>;
  loaded: boolean;
  droppedBatches: number;
  /** D-15 support: backend Changed/ExternalEdit events stamp mtime per path. */
  externalEdits: Record<string, number>;
  seed: (resources: Resource[]) => void;
  applyBatch: (batch: ResourceEventBatch) => void;
  reset: () => void;
}

export const useClaudeResourcesStore = create<ClaudeResourcesState>((set) => ({
  resourcesById: {},
  loaded: false,
  droppedBatches: 0,
  externalEdits: {},

  seed: (resources) =>
    set(() => {
      const byId: Record<string, Resource> = {};
      for (const r of resources) byId[r.id] = r;
      return { resourcesById: byId, loaded: true };
    }),

  applyBatch: (batch) =>
    set((s) => {
      const next = { ...s.resourcesById };
      const nextExternal = { ...s.externalEdits };
      for (const ev of batch.events) {
        switch (ev.kind) {
          case 'added':
          case 'changed':
            next[ev.resource.id] = ev.resource;
            break;
          case 'removed':
            delete next[ev.id];
            break;
          case 'externalEdit':
            nextExternal[ev.path] = ev.mtimeMs;
            break;
        }
      }
      return {
        resourcesById: next,
        externalEdits: nextExternal,
        droppedBatches: s.droppedBatches + (batch.droppedBatches ?? 0),
      };
    }),

  reset: () =>
    set({ resourcesById: {}, loaded: false, droppedBatches: 0, externalEdits: {} }),
}));

// --- Selectors -------------------------------------------------------------

export const selectByCategoryScope =
  (category: Category, scope: Scope) =>
  (s: ClaudeResourcesState): Resource[] =>
    Object.values(s.resourcesById).filter(
      (r) => r.category === category && r.scope === scope,
    );

/**
 * D-03: In the combined view, when a Project resource shares (category, name)
 * with a Global resource, hide the Global entry — the project version shadows it.
 */
export const selectCombined =
  (category: Category) =>
  (s: ClaudeResourcesState): Resource[] => {
    const all = Object.values(s.resourcesById).filter((r) => r.category === category);
    const projectNames = new Set(
      all.filter((r) => r.scope === 'project').map((r) => r.name),
    );
    return all.filter((r) => r.scope === 'project' || !projectNames.has(r.name));
  };

export const selectByScope =
  (scope: Scope) =>
  (s: ClaudeResourcesState): Resource[] =>
    Object.values(s.resourcesById).filter((r) => r.scope === scope);
