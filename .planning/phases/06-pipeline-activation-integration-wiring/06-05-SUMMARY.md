---
phase: 06
plan: 05
subsystem: pipeline-activation-ui
wave: 4
tags: [radar-bridge, topbar, ui, e2e, integration]
status: complete
autonomous: false
auto_approved_checkpoint: true
requirements: [FMON-01, FMON-03, FMON-04]
dependency_graph:
  requires:
    - 06-02-SUMMARY (repoStore, RepoSessionProvider, repo_session commands)
    - 06-03-SUMMARY (session lifecycle, registry reconciliation)
    - 06-04-SUMMARY (passive_bridge, persist_attributed_batch forwarder)
  provides:
    - installRadarPipelineBridge (src/stores/radarStore.ts)
    - RepoStatusChip, PauseMonitoringToggle, ChangeRepoButton (src/components/repo/)
    - TopBar right-aligned repo-session cluster
    - end_to_end_pipeline_activation integration test
  affects:
    - src/providers/RepoSessionProvider.tsx (adds bridge install/cleanup)
    - src/components/layout/TopBar.tsx (adds repo controls)
    - src-tauri/src/lib.rs (elevates agents + pipeline modules to pub)
    - src-tauri/src/pipeline/commands.rs (elevates persist_attributed_batch to pub)
    - src-tauri/src/pipeline/process_snapshot.rs (drops cfg(test) gate on test helper)
tech_stack:
  added: []
  patterns:
    - "Zustand cross-store subscription (usePipelineStore.subscribe → radarStore.fetchTreeIndex)"
    - "setTimeout-based debounce inside the subscribe listener (500ms settle window)"
    - "useEffect return-unsubscribe lifecycle per T-06-05-01 mitigation"
    - "vi.hoisted() factory for vitest module mocks that reference shared spies"
    - "Integration-test visibility via pub module exports in lib.rs"
key_files:
  created:
    - src/components/repo/RepoStatusChip.tsx
    - src/components/repo/PauseMonitoringToggle.tsx
    - src/components/repo/ChangeRepoButton.tsx
  modified:
    - src/stores/radarStore.ts
    - src/stores/__tests__/radarStore.test.ts
    - src/providers/RepoSessionProvider.tsx
    - src/providers/__tests__/RepoSessionProvider.integration.test.tsx
    - src/components/layout/TopBar.tsx
    - src-tauri/src/lib.rs
    - src-tauri/src/pipeline/commands.rs
    - src-tauri/src/pipeline/process_snapshot.rs
    - src-tauri/tests/end_to_end_smoke.rs
    - src-tauri/tests/common/mod.rs
decisions:
  - "Task 4 human-verify checkpoint auto-approved per auto-chain mode (no interactive pause)."
  - "Pre-existing TypeScript errors and conflict::engine test failures at base commit 4d8adc3 logged to deferred-items.md — out of scope per SCOPE BOUNDARY."
  - "Elevated agents + pipeline modules to pub in lib.rs so integration tests under src-tauri/tests/ can import via aitc_lib::."
  - "from_candidates_for_test dropped its #[cfg(test)] gate (marked #[doc(hidden)]) so integration tests can seed ProcessSnapshot deterministically."
commits:
  - hash: f6080b6
    message: "feat(06-05): install radar<->pipeline bridge with debounced refetch (D-08)"
  - hash: b8d9b62
    message: "feat(06-05): add RepoStatusChip, PauseMonitoringToggle, ChangeRepoButton + TopBar integration"
  - hash: de28ed6
    message: "test(06-05): unignore e2e smoke driving bridge + reconciliation + forwarder chain"
metrics:
  tasks_completed: 4
  tasks_total: 4
  completed: 2026-04-11
---

# Phase 6 Plan 5: Radar Live Bridge + TopBar Repo Controls + E2E Smoke Summary

**One-liner:** D-08 cross-store bridge (`installRadarPipelineBridge`) wires `pipelineStore.events` → debounced `radarStore.fetchTreeIndex()`, three UI components land in the TopBar per the Phase 6 UI-SPEC, and the phase-gate e2e smoke test drives the PASSIVE-bridge → KAGENT-reconcile → forwarder-persist chain against a real tempdir git repo.

## What Shipped

1. **Radar live-update bridge (Task 1)** — `src/stores/radarStore.ts` gains `installRadarPipelineBridge()`: a Zustand `subscribe()` listener that calls `useRadarStore.getState().fetchTreeIndex()` on any change to `pipelineStore.events`, debounced to one fetch per 500ms settle window. `RepoSessionProvider` installs the bridge in a new `useEffect` and returns the unsubscribe as cleanup (mitigates T-06-05-01 debounce/leak on HMR). 4 tests pass (3 on the bridge itself, 1 for provider mount/unmount lifecycle).

2. **TopBar repo-session controls (Task 2)** — three new components:
   - `RepoStatusChip.tsx` — middle-truncated path + `WATCHING` (phosphor green, pulsing) or `PAUSED` (amber, static) state label, driven by `repoStore.activeRepo`, `repoStore.isPaused`, and `pipelineStore.isWatching`.
   - `PauseMonitoringToggle.tsx` — icon-label button calling `repoStore.togglePause`; disabled with tooltip when no repo is active.
   - `ChangeRepoButton.tsx` — inline confirmation menu (`Switch repository` / `Keep current repo`) chaining into `repoStore.changeRepo`.
   All copy comes verbatim from the UI-SPEC Copywriting Contract. Integrated into `TopBar.tsx` as a right-aligned cluster (`ml-auto`, `gap-2`) sitting before the existing window controls.

3. **End-to-end smoke test (Task 3)** — `src-tauri/tests/end_to_end_smoke.rs` is now unignored-by-opt-in (`cargo test --test end_to_end_smoke -- --ignored` runs it). It spins up a tempdir `git init` repo + in-memory SQLite with the Phase 6 schema, drives one `bridge_tick` to get a `PASSIVE-7777` entry, simulates a KAGENT self-register that supplants the PASSIVE entry (D-07), feeds a `FileEventBatch { Attribution::Pid(7777) }` through `persist_attributed_batch`, and asserts exactly one `session_files` row. `src-tauri/tests/common/mod.rs` provides the `tempdir_git_repo()` and `pool_with_phase6_schema()` helpers.

4. **Phase 6 human-verify checkpoint (Task 4)** — auto-approved per auto-chain mode. Log entry: "Auto-approved checkpoint (auto-chain mode)". The seven Manual-Only Verifications in 06-VALIDATION.md remain the user-facing acceptance surface; the code is staged so the user can run them against `npm run tauri dev` when they wish.

## Verification Results

- `npm run test -- --run src/stores/__tests__/radarStore.test.ts src/providers/__tests__/RepoSessionProvider.integration.test.tsx` — 15/15 pass (14 radar + 1 provider integration).
- `npx tsc --noEmit` on Plan 06-05 touched files — 0 errors.
- `cd src-tauri && cargo test --test end_to_end_smoke -- --ignored` — 1/1 pass (end_to_end_pipeline_activation).
- Acceptance-criteria grep checks:
  - `grep -c "export function installRadarPipelineBridge" src/stores/radarStore.ts` → 1.
  - `grep -c "installRadarPipelineBridge" src/providers/RepoSessionProvider.tsx` → 2 (import + call).
  - `grep -c "Pause monitoring\|Resume monitoring" src/components/repo/PauseMonitoringToggle.tsx` → 2.
  - `grep -c "Switching repositories will stop" src/components/repo/ChangeRepoButton.tsx` → 1.
  - `grep -c "WATCHING\|PAUSED" src/components/repo/RepoStatusChip.tsx` → 2.
  - `grep -c "RepoStatusChip\|PauseMonitoringToggle\|ChangeRepoButton" src/components/layout/TopBar.tsx` → 6.
  - No `--color-error` in the paused-state path.
  - `grep -c "persist_attributed_batch\|bridge_tick\|passive_sentinel_adapter" src-tauri/tests/end_to_end_smoke.rs` → 3.
  - `#[ignore = "filesystem + task-spawning smoke; run with --ignored"]` retained.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Private modules blocked integration-test access**
- Found during: Task 3.
- Issue: `src-tauri/src/lib.rs` declared `mod agents;` and `mod pipeline;` (private). Integration test `end_to_end_smoke.rs` could not resolve `aitc_lib::agents::*` / `aitc_lib::pipeline::*`.
- Fix: Elevated both to `pub mod` in `lib.rs`.
- Files modified: `src-tauri/src/lib.rs`.
- Commit: de28ed6.

**2. [Rule 3 - Blocking] `from_candidates_for_test` gated behind `#[cfg(test)]`**
- Found during: Task 3 compile of e2e smoke.
- Issue: The helper `ProcessSnapshot::from_candidates_for_test` was compiled only for `cfg(test)` inside the lib crate. Integration tests build as a separate crate that does NOT get `cfg(test)` for the library, so the helper was invisible.
- Fix: Dropped the `#[cfg(test)]` gate, marked the impl block helper with `#[doc(hidden)]` instead, preserving the intent (tests-only) without the cross-crate visibility problem.
- Files modified: `src-tauri/src/pipeline/process_snapshot.rs`.
- Commit: de28ed6.

**3. [Rule 3 - Blocking] `CandidateProc` fields incomplete in plan-supplied snippet**
- Found during: Task 3 compile.
- Issue: Plan snippet constructed `CandidateProc { pid, name, cwd: Some(...) }`, but real struct has `pid, name, cwd: PathBuf, exe: Option<PathBuf>, parent: Option<u32>`.
- Fix: Passed `cwd: repo_root.clone()` (no Option wrap), `exe: None, parent: None`.
- Files modified: `src-tauri/tests/end_to_end_smoke.rs`.
- Commit: de28ed6.

**4. [Rule 3 - Blocking] `persist_attributed_batch` was `pub(crate)`**
- Found during: Task 3 compile.
- Issue: Plan's acceptance criteria required the integration test to call `aitc_lib::pipeline::commands::persist_attributed_batch`, but the function was `pub(crate)`.
- Fix: Elevated to `pub` per the plan's Step C instruction.
- Files modified: `src-tauri/src/pipeline/commands.rs`.
- Commit: de28ed6.

**5. [Rule 3 - Blocking] `vi.mock` factory referenced bare identifier before hoist**
- Found during: Task 1 test run.
- Issue: `installSpy` was declared as a plain `const` at the top of the integration test, but `vi.mock` factories are hoisted above all imports; the reference resolved to `undefined` at mock-install time.
- Fix: Wrapped the shared spies in `vi.hoisted(() => ({ installSpy, registerMock, unregisterMock }))` so the declarations land in the hoisted prologue.
- Files modified: `src/providers/__tests__/RepoSessionProvider.integration.test.tsx`.
- Commit: f6080b6.

## Auto-Approved Checkpoint Log

- **Task 4 (checkpoint:human-verify)** — Auto-approved per `workflow.auto_advance = true` / auto-chain mode.
  - Log entry: `Auto-approved checkpoint (auto-chain mode)` — the seven manual scenarios in 06-VALIDATION.md remain available for the user to exercise interactively against `npm run tauri dev`; the code is staged for their verification.

## Deferred Issues (Out-of-Scope, Pre-Existing)

Logged in full detail in `deferred-items.md`. Summary:
- 15 TypeScript errors in unrelated files (`conflictStore.ts`, `InlineDiff.tsx`, `RadarCanvas.tsx`, `RadarComponents.test.tsx`) predate Plan 06-05 and break `npm run build`. `npx tsc --noEmit` on Plan 06-05 touched files only → clean.
- 2 failing Rust unit tests (`conflict::engine::tests::test_conflict_detected_different_pids_within_window`, `test_custom_window_duration`) predate Plan 06-05 at base commit 4d8adc3.
- Both should be picked up by a Phase 5 gap-closure plan or a generic pre-flight cleanup task.

## Threat Model Coverage

| Threat ID | Status | Notes |
|-----------|--------|-------|
| T-06-05-01 (DoS/leak on HMR) | mitigated | Unsubscribe clears both Zustand sub and pending setTimeout; provider cleanup runs on unmount; test `unsubscribe_stops_further_fetches` enforces. |
| T-06-05-02 (race on stop_watch) | accepted | Pre-existing Option 1 tradeoff per 06-RESEARCH.md Pitfall 5; no change this plan. |
| T-06-05-03 (UI injection via repo path) | mitigated | React text-content rendering + attribute binding on `title`; no `dangerouslySetInnerHTML`. |
| T-06-05-04 (clickjacking on confirm) | accepted | Desktop Tauri WebView, no third-party frames. |
| T-06-05-05 (e2e tempdir leak) | mitigated | `TempDir` held in test scope, auto-cleaned on drop; `#[ignore]` by default. |

No new threat flags introduced — the three new components only read from existing Zustand stores; no new network endpoints, auth paths, or schema mutations.

## Known Stubs

None. All three UI components are wired to live `repoStore` / `pipelineStore` state; the radar bridge calls the real `fetchTreeIndex` IPC path; the e2e smoke exercises real `persist_attributed_batch`.

## Self-Check: PASSED

- `src/stores/radarStore.ts` — FOUND (contains `export function installRadarPipelineBridge`).
- `src/providers/RepoSessionProvider.tsx` — FOUND (imports + calls `installRadarPipelineBridge`).
- `src/components/repo/RepoStatusChip.tsx` — FOUND.
- `src/components/repo/PauseMonitoringToggle.tsx` — FOUND.
- `src/components/repo/ChangeRepoButton.tsx` — FOUND.
- `src/components/layout/TopBar.tsx` — FOUND (imports + renders 3 new components).
- `src-tauri/tests/end_to_end_smoke.rs` — FOUND (unignored-by-opt-in, 1 test pass).
- `src-tauri/tests/common/mod.rs` — FOUND (helpers fleshed out).
- Commit `f6080b6` — FOUND in git log.
- Commit `b8d9b62` — FOUND in git log.
- Commit `de28ed6` — FOUND in git log.
