---
phase: 06
plan: 02
subsystem: pipeline-activation
tags: [repo-resolution, dialog-plugin, pipeline-activation, wave-1, tdd-green]
requirements: [FMON-01, FMON-04]
dependency_graph:
  requires:
    - 06-01 Wave 0 scaffolding (tauri-plugin-dialog, module stubs)
  provides:
    - Real repo_session.rs (capture_launch_cwd, get_launch_cwd, detect_git_root, persist_last_repo, get_last_repo)
    - Real repoStore.ts with resolveInitialRepo chain (CWD -> persisted -> picker)
    - Real RepoSessionProvider owning usePipelineChannel lifecycle
    - AppShell wrapping <Outlet/> in <RepoSessionProvider>
    - Four new Tauri commands registered + exported via tauri-specta bindings
  affects:
    - src-tauri/src/lib.rs (capture_launch_cwd, 4 commands added to collect_commands!)
    - src/components/layout/AppShell.tsx (provider now wraps the route outlet)
tech_stack:
  added: []
  patterns:
    - "Provider-above-Outlet (06-RESEARCH.md Pattern 1) keeps Channel<T> alive across navigation"
    - "Zustand store side-effecting into Tauri commands via invoke() (mirrors pipelineStore pattern)"
    - "StrictMode-safe single-shot effect via useRef gate"
    - "Mock hoist pattern for vi.mock of Zustand stores with getState/setState/subscribe shims"
key_files:
  created: []
  modified:
    - src-tauri/src/repo_session.rs
    - src-tauri/src/lib.rs
    - src/stores/repoStore.ts
    - src/stores/__tests__/repoStore.test.ts
    - src/providers/RepoSessionProvider.tsx
    - src/providers/__tests__/RepoSessionProvider.test.tsx
    - src/components/layout/AppShell.tsx
decisions:
  - "T-06-02-01 path-traversal: detect_git_root rejects '..' segments before shelling out to git"
  - "T-06-02-02 path-validation: persist_last_repo requires exists + is_dir, matching pipeline::commands::start_watch validation"
  - "T-06-02-04 SQL injection: parameterized sqlx bind() only, no string interpolation"
  - "D-05 discretion resolved: pipeline provider mounts in AppShell ABOVE <Outlet/>, not inside a route view (Pitfall 1)"
  - "Picker cancellation is silent per UI-SPEC (no toast; activeRepo stays null)"
metrics:
  duration: ~18m
  completed: 2026-04-11
  commits: 3
---

# Phase 06 Plan 02: Wave 1 — Repo Resolution + Pipeline Provider Mount Summary

Shipped the full "first file watch starts automatically when the app boots in a git repo" path: Rust commands for repo detection + persistence, a Zustand store that walks the CWD → persisted → picker chain, and a React provider that mounts above the router so the pipeline Channel outlives navigation.

## What Shipped

### Task 1: Rust repo_session commands + lib.rs registration
- `capture_launch_cwd` (sync, called at top of `run()` before Tauri builder — preserves CWD before Tauri changes it)
- `get_launch_cwd`, `detect_git_root`, `persist_last_repo`, `get_last_repo` Tauri commands with `#[specta::specta]`
- `detect_git_root` rejects `..` paths before shelling out; shells `git rev-parse --show-toplevel` with `current_dir(path)` sandboxing
- `persist_last_repo` validates `exists + is_dir` before `INSERT ... ON CONFLICT DO UPDATE` into `app_settings`
- All 4 commands registered in `collect_commands!` block; placed after `pipeline::commands::get_tree_index`
- 5 Rust unit tests (`repo_resolution::*`) pass: self-repo detect, non-git tempdir, persist roundtrip, nonexistent-path validation, `..` traversal rejection
- Commit: `5645b73`

### Task 2: repoStore.ts resolveInitialRepo chain
- Replaced Wave 0 throw-stub with real Zustand store per 06-RESEARCH.md Example 1
- `resolveInitialRepo`: launch CWD → `detect_git_root` → persist; else `get_last_repo` → sanity-check → set; else `openDialog({ directory: true })` → `detect_git_root` → set + persist, error if picked folder not a git repo
- `changeRepo`: picker + `detect_git_root` + persist on success, also clears `isPaused`
- `togglePause` flips `isPaused`; `setError` exposed for provider error sink
- Picker cancellation is silent (`activeRepo` stays null, no error set)
- 8 Vitest cases pass covering all three branches + error path + toggle + cancel + change-on-success
- Commit: `a6c79cd`

### Task 3: RepoSessionProvider + AppShell mount
- Provider uses `useRef` gate to invoke `resolveInitialRepo` exactly once across StrictMode double-invoke
- Second effect watches `[activeRepo, isPaused, register, unregister]` — when a repo is resolved and not paused, calls `register(activeRepo)`; returns cleanup that calls `unregister()`
- Cleanup uses a `cancelled` flag to avoid setting error state after unmount
- `AppShell` imports `RepoSessionProvider` and wraps the whole layout (TopBar, Sidebar, CommandPalette, main/Outlet) — Channel now outlives route navigation (Pitfall 1)
- 4 Vitest cases pass: mount-calls-resolve-once, register-on-repo, pause-skips-register, unmount-unregisters
- Commit: `4c1620d`

## Verification Results

| Check | Result |
|-------|--------|
| `cd src-tauri && cargo test --lib repo_resolution` | 5 passed, 0 failed, 0 ignored |
| `npm run test -- --run src/stores/__tests__/repoStore.test.ts` | 8 passed, 0 failed |
| `npm run test -- --run src/providers/__tests__/RepoSessionProvider.test.tsx` | 4 passed, 0 failed |
| `grep -c "pub async fn detect_git_root" src-tauri/src/repo_session.rs` | 1 |
| `grep -c "pub async fn persist_last_repo" src-tauri/src/repo_session.rs` | 1 |
| `grep -c "repo_session::capture_launch_cwd" src-tauri/src/lib.rs` | 1 |
| `grep -c "repo_session::(get_launch_cwd|detect_git_root|persist_last_repo|get_last_repo)"` | 4 |
| `grep -c "RepoSessionProvider" src/components/layout/AppShell.tsx` | 2 (import + JSX) |
| `grep -c "usePipelineChannel" src/providers/RepoSessionProvider.tsx` | 1 |
| `grep -c "resolveInitialRepo" src/providers/RepoSessionProvider.tsx` | 1 |
| `grep -c "it.todo" src/stores/__tests__/repoStore.test.ts` | 0 |

## Deviations from Plan

None — plan executed exactly as written. The Wave 0 scaffold on this worktree already contained the real `repo_session.rs` + `lib.rs` content from a prior run, which matched the Plan 02 Step A/B output byte-for-byte; I verified compatibility by running the 5 unit tests before committing. No re-authoring was required for Task 1's Rust side.

**Scope-boundary note:** `npx tsc --noEmit` still surfaces pre-existing errors in `conflictStore.ts`, `theme.test.ts`, `InlineDiff.tsx`, `RadarCanvas.tsx`, and `RadarComponents.test.tsx`. These were called out in the 06-01 SUMMARY as out-of-scope. None are in files modified by this plan, so SCOPE BOUNDARY applies; deferred to their owning plans.

## Authentication Gates

None — no external auth required for repo resolution or dialog APIs.

## Known Stubs

None introduced by this plan. Downstream Wave 0 stubs still exist in `src-tauri/src/db/session.rs`, `tests/common/mod.rs`, `tests/end_to_end_smoke.rs` — resolved by Plans 03-05 per 06-01 SUMMARY.

## Threat Flags

None new. This plan's threats (T-06-02-01 through T-06-02-06) were all covered in the PLAN's `<threat_model>` and verified mitigated:

- T-06-02-01 (path traversal) — `..` rejection in `detect_git_root`; unit test `repo_resolution_rejects_dotdot_traversal` guards it
- T-06-02-02 (malicious persist path) — `exists + is_dir` check before INSERT
- T-06-02-03 (CWD info disclosure) — accepted (desktop app, user's own data)
- T-06-02-04 (SQL injection) — parameterized `bind()` only
- T-06-02-05 (picker spoofing) — plugin-dialog is Tauri-maintained; frontend re-validates via `detect_git_root`
- T-06-02-06 (resolve loop DoS) — `resolvedOnce` useRef gate

## Commits

- `5645b73` — feat(06-02): implement repo_session.rs Tauri commands + register in lib.rs
- `a6c79cd` — feat(06-02): implement repoStore resolveInitialRepo chain (CWD -> persisted -> picker)
- `4c1620d` — feat(06-02): implement RepoSessionProvider and mount in AppShell (D-05)

## Self-Check: PASSED

- FOUND: src-tauri/src/repo_session.rs
- FOUND: src-tauri/src/lib.rs (capture_launch_cwd call + 4 commands registered)
- FOUND: src/stores/repoStore.ts
- FOUND: src/stores/__tests__/repoStore.test.ts
- FOUND: src/providers/RepoSessionProvider.tsx
- FOUND: src/providers/__tests__/RepoSessionProvider.test.tsx
- FOUND: src/components/layout/AppShell.tsx (RepoSessionProvider wrapping)
- FOUND: commit 5645b73
- FOUND: commit a6c79cd
- FOUND: commit 4c1620d
