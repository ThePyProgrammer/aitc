---
phase: 9
plan: 04
subsystem: frontend-arsenal-foundations
tags: [zustand, tauri-channel, ui-primitives, master-detail, motion, tdd]
dependency-graph:
  requires:
    - "09-01 (bindings: Resource, ResourceEvent, ResourceEventBatch, Scope, Category)"
    - "Phase 2: usePipelineChannel / pipelineStore pattern"
  provides:
    - "useClaudeResourcesStore + selectors (selectByCategoryScope, selectCombined, selectByScope)"
    - "useClaudeResourcesChannel hook (start/stop lifecycle)"
    - "MasterDetailShell layout primitive + MASTER_DETAIL_RAIL/MASTER_DETAIL_PANEL constants"
    - "ScopeChip, UndoToast, ExternalChangeBanner UI primitives"
  affects:
    - "Plan 05 (ArsenalView) consumes store, hook, and all three UI primitives"
    - "Future views (Settings, MCP inspector) reuse MasterDetailShell"
tech-stack:
  added: []
  patterns:
    - "Zustand store keyed by stable id (not event-ring-buffer like pipelineStore)"
    - "Two-click destructive confirmation with 3s lapse (no modal)"
    - "Motion v12 AnimatePresence entrance animations (150ms)"
key-files:
  created:
    - src/stores/claudeResourcesStore.ts
    - src/hooks/useClaudeResourcesChannel.ts
    - src/components/layout/MasterDetailShell.tsx
    - src/components/ui/ScopeChip.tsx
    - src/components/ui/UndoToast.tsx
    - src/components/ui/ExternalChangeBanner.tsx
    - src/__tests__/arsenal/claudeResourcesStore.test.ts
    - src/__tests__/arsenal/useClaudeResourcesChannel.test.ts
    - src/__tests__/arsenal/MasterDetailShell.test.tsx
    - src/__tests__/arsenal/ScopeChip.test.tsx
    - src/__tests__/arsenal/UndoToast.test.tsx
    - src/__tests__/arsenal/ExternalChangeBanner.test.tsx
  modified: []
decisions:
  - "Used vi.mock factory with module-internal FakeChannel to avoid hoist-order errors when mocking @tauri-apps/api/core for the hook test."
  - "UndoToast guards double-fire via a ref.consumed flag rather than early-unmount, so the component can report onDismiss deterministically on auto-expiry."
  - "ExternalChangeBanner confirmation state is driven by a single pending union ('reload' | 'keepMine' | null) with a shared 3s lapse timer."
metrics:
  duration: 383s
  completed: 2026-04-15
---

# Phase 9 Plan 04: Frontend Foundations Summary

Frontend machinery for ARSENAL — Zustand store, Channel<T> hook mirroring `usePipelineChannel`, reusable master/detail layout primitive, and three UI primitives (ScopeChip, UndoToast, ExternalChangeBanner) — delivered TDD across three commits per task (RED → GREEN) with 32/32 Vitest specs green.

## What Shipped

- **`claudeResourcesStore`** — Zustand store keyed by `ResourceId` with `seed/applyBatch/reset` + three selectors. `selectCombined` enforces D-03 shadow suppression: when a Project resource shares `(category, name)` with a Global one, the Global entry is hidden in the combined view. `externalEdits: Record<path, mtimeMs>` supports D-15 editor banner decisioning.
- **`useClaudeResourcesChannel`** — mirrors `usePipelineChannel` exactly: constructs a `Channel<ResourceEventBatch>` once on mount, onmessage pumps into `store.applyBatch`; `start(cwd)` invokes `startClaudeResourcesWatch` (seeds store from return value); `stop()` invokes `stopClaudeResourcesWatch` and resets the store.
- **`MasterDetailShell`** — three-column shell (220 rail / flex list / 520 detail) locked via Tailwind classes + exported `MASTER_DETAIL_RAIL`/`MASTER_DETAIL_PANEL` constants. Responsive: `2xl:w-[520px] xl:w-[480px]`. Uses surface-tier contrast instead of borders (Command Horizon No-Line Rule).
- **`ScopeChip`** — PROJECT uses `text-primary` (phosphor green), GLOBAL uses `text-tertiary` (amber). Space Grotesk 11px bold tracking-widest uppercase on `bg-surface-container-high`.
- **`UndoToast`** — 10s countdown ticking per-second, `SAVED — {filename}` title + `Undo in {n}s` secondary label, UNDO action and × dismiss glyph. Motion 150ms opacity/y entrance. Consumed-ref guard prevents double-fire from spam clicks or auto-expire race.
- **`ExternalChangeBanner`** — RELOAD / KEEP MINE / VIEW DIFF actions. RELOAD is single-click when clean, two-click when `hasUnsavedEdits=true`. KEEP MINE is always two-click (`CONFIRM OVERWRITE`). 3s pending timer lapses and reverts label.

## Bindings Confirmation

`src/bindings.ts` (from Plan 01+03) already exposes `Resource`, `ResourceEvent`, `ResourceEventBatch`, `Scope`, `Category`, `ResourceId` — verified via `grep`. Plan 04 did NOT regenerate bindings; it only consumed typed imports. Tauri commands `startClaudeResourcesWatch` / `stopClaudeResourcesWatch` are currently invoked as string literals (they will surface as typed commands once Plan 03's `tauri-specta` regeneration lands — the string call site will remain compatible because bindings auto-generate camelCase functions that wrap the same `invoke`).

## Motion Import Path

Used `motion/react` (current Motion v12 package path per `CLAUDE.md` tech stack). No import-path pitfall encountered.

## Test Results

| Suite | Tests | Status |
|---|---|---|
| claudeResourcesStore | 10 | PASS |
| useClaudeResourcesChannel | 3 | PASS |
| MasterDetailShell | 5 | PASS |
| ScopeChip | 3 | PASS |
| UndoToast | 5 | PASS |
| ExternalChangeBanner | 6 | PASS |
| **Total** | **32** | **32/32 green** |

## Deviations from Plan

**[Rule 1 – Bug] UndoToast auto-dismiss test required async timer advance**
- Found during Task 3 GREEN verification.
- Issue: `vi.advanceTimersByTime(10_100)` in a single sync `act()` did not flush React 19's effect scheduler between each 1s countdown tick, so the final `remaining === 0` render never fired `onDismiss`.
- Fix: Advanced timers in eleven 1-second increments using `vi.advanceTimersByTimeAsync(1000)` inside an async `act`. Production code unchanged.
- File modified: `src/__tests__/arsenal/UndoToast.test.tsx`
- Commit: 6ec334e

**[Rule 3 – Blocking] Resolved vi.mock hoist-order error for channel test**
- Found during Task 1 GREEN verification.
- Issue: Referencing `FakeChannel` class from the test module scope inside `vi.mock(...)` factory triggered "Cannot access 'FakeChannel' before initialization" because `vi.mock` is hoisted above module imports.
- Fix: Declared `FakeChannel` + `channels[]` + `invoke` fn inside the factory, re-exported via sentinel keys (`__registeredChannels`, `__invokeMock`), then accessed them through the mocked module after import.
- File modified: `src/__tests__/arsenal/useClaudeResourcesChannel.test.ts`
- Commit: 5fb2e65

## UI-SPEC Interpretation Flags for Plan 05

1. **Detail panel width at sub-1440 viewports** — UI-SPEC specifies `w-[520px] 2xl:w-[520px] xl:w-[480px]`. MasterDetailShell currently defaults base width to `w-[480px]` so the 1280–1439 breakpoint behaves as specified. Plan 05 should confirm this satisfies the "responsive rules" table.
2. **Banner `View diff` button color** — UI-SPEC says "ghost default". Implementation uses `text-on-surface-variant` for the default ghost tone; confirm during Plan 05 that this matches existing ghost-variant treatment elsewhere.
3. **UndoToast positioning** — this plan ships the component; host container / stacking / toast-queue behavior is Plan 05's responsibility. The component itself is position-agnostic.
4. **Two-click RESET on cleaner state changes** — if the external file lands back in sync while a confirmation is pending, Plan 05 host should clear the banner entirely rather than reset `pending`.

## Deferred Issues

Pre-existing typecheck errors in `src/views/Radar/forceCluster.ts` (and its test file) discovered during verification. They are unrelated to Plan 04's surface area — logged in `deferred-items.md` for Phase 7 owners.

## Self-Check: PASSED

Files verified present:
- `src/stores/claudeResourcesStore.ts` FOUND
- `src/hooks/useClaudeResourcesChannel.ts` FOUND
- `src/components/layout/MasterDetailShell.tsx` FOUND
- `src/components/ui/ScopeChip.tsx` FOUND
- `src/components/ui/UndoToast.tsx` FOUND
- `src/components/ui/ExternalChangeBanner.tsx` FOUND
- All 6 test specs FOUND under `src/__tests__/arsenal/`

Commits verified in `git log`:
- 8bfa323 (RED task 1)
- 5fb2e65 (GREEN task 1)
- febe852 (RED task 2)
- ea1adb0 (GREEN task 2)
- 2556d4c (RED task 3)
- 6ec334e (GREEN task 3)
