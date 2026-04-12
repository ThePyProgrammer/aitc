---
phase: 06
plan: 01
subsystem: pipeline-activation
tags: [scaffolding, wave-0, dialog-plugin, tdd-red]
requirements: [FMON-01, HIST-01]
dependency_graph:
  requires: []
  provides:
    - tauri-plugin-dialog installed and registered
    - repo_session.rs module stub
    - db/session.rs module stub
    - repoStore.ts Zustand stub
    - RepoSessionProvider.tsx pass-through
    - Wave 0 RED test scaffolds (Rust + Vitest)
  affects:
    - src-tauri/src/lib.rs (plugin chain, module declarations)
    - src-tauri/src/db/mod.rs (pub mod session)
tech_stack:
  added:
    - "tauri-plugin-dialog ^2 (Rust)"
    - "@tauri-apps/plugin-dialog ^2 (npm)"
  patterns:
    - "Wave 0 RED scaffolding: #[ignore] tests with TODO(plan-NN) pointers"
    - "Vitest it.todo markers for frontend future work"
key_files:
  created:
    - src-tauri/src/repo_session.rs
    - src-tauri/src/db/session.rs
    - src-tauri/tests/common/mod.rs
    - src-tauri/tests/end_to_end_smoke.rs
    - src/stores/repoStore.ts
    - src/stores/__tests__/repoStore.test.ts
    - src/providers/RepoSessionProvider.tsx
    - src/providers/__tests__/RepoSessionProvider.test.tsx
    - src/providers/__tests__/RepoSessionProvider.integration.test.tsx
  modified:
    - src-tauri/Cargo.toml
    - src-tauri/Cargo.lock
    - package.json
    - package-lock.json
    - src-tauri/src/lib.rs
    - src-tauri/src/db/mod.rs
decisions:
  - "Pinned tauri-plugin-dialog to major version 2 on both Rust and TS sides; lockfiles committed for reproducibility"
  - "Plugin registered after tauri_plugin_notification to preserve existing ordering"
  - "Rust placeholder tests use #[ignore] + panic! so they compile cleanly but do not pollute CI green runs"
metrics:
  duration: ~5m
  completed: 2026-04-11
---

# Phase 06 Plan 01: Pipeline Activation — Wave 0 Foundation Summary

Installed the native folder-picker plugin (tauri-plugin-dialog v2) on both Rust and JS sides and scaffolded every module + test file that downstream Phase 6 plans will turn from RED to GREEN.

## What Shipped

### Task 1: tauri-plugin-dialog installation and registration

- Added `tauri-plugin-dialog = "2"` to `src-tauri/Cargo.toml`, and `@tauri-apps/plugin-dialog: ^2` to `package.json`
- Registered `tauri_plugin_dialog::init()` in the Tauri builder chain in `src-tauri/src/lib.rs`, placed immediately after `tauri_plugin_notification::init()`
- `npm install` hydrated the JS side; `Cargo.lock` + `package-lock.json` committed for supply-chain pinning
- Commit: `f4a532f`

### Task 2: Wave 0 module + test scaffolds

- **Rust modules:** `repo_session.rs` (top-level) + `db/session.rs`, both wired into `lib.rs` and `db/mod.rs`
- **Rust integration tests:** `tests/common/mod.rs` shared helpers + `tests/end_to_end_smoke.rs` (`#[ignore]`d)
- **Frontend:** `src/stores/repoStore.ts` Zustand stub, `src/providers/RepoSessionProvider.tsx` pass-through, and three Vitest spec files with `it.todo` markers
- Every stub carries a `TODO(plan-NN)` comment pointing to the implementing plan so the Nyquist "MISSING — Wave 0" rule has a real target
- Commit: `68e14d6`

## Verification Results

- `cd src-tauri && cargo check --lib` → exits 0 (27 pre-existing warnings, none new)
- `cd src-tauri && cargo test --lib --no-run` → exits 0 (test compile clean)
- `npm run test -- --run src/stores/__tests__/repoStore.test.ts src/providers/__tests__/` → 3 tests passed + 7 todo, all files green
- `grep "tauri_plugin_dialog::init" src-tauri/src/lib.rs` → exactly 1 match
- `npm ls @tauri-apps/plugin-dialog` → 2.x present, no UNMET

## Deviations from Plan

None — plan executed exactly as written. Pre-existing TypeScript errors in `conflictStore.ts`, `theme.test.ts`, `InlineDiff.tsx`, `RadarComponents.test.tsx`, and `RadarCanvas.tsx` are unrelated to this plan's scope (Rule 1 SCOPE BOUNDARY — not caused by this plan's changes; left for the owning plans/teams).

## Authentication Gates

None.

## Known Stubs

All intentional and tracked via `TODO(plan-NN)` markers — this is the Wave 0 RED foundation:

| File | Stub | Resolved By |
|------|------|-------------|
| `src-tauri/src/repo_session.rs` | `capture_launch_cwd` body + 3 ignored tests panic | Plan 02 |
| `src-tauri/src/db/session.rs` | `ensure_open_session` / `close_session` return `Err("TODO")` | Plan 03 |
| `src-tauri/tests/common/mod.rs` | `tempdir_repo_fixture` is `unimplemented!()` | Plans 04-05 |
| `src-tauri/tests/end_to_end_smoke.rs` | `#[ignore]`d panic | Plan 05 |
| `src/stores/repoStore.ts` | `resolveInitialRepo` / `changeRepo` throw | Plan 02 |
| `src/providers/RepoSessionProvider.tsx` | pass-through with no logic | Plan 02 |

These stubs are the **intended output** of Wave 0 — they give downstream plans compiling RED targets.

## Threat Flags

None — plan introduces no new runtime code paths. Supply-chain mitigations (T-06-01-01, T-06-01-02) satisfied via committed lockfiles and official Tauri plugin source.

## Commits

- `f4a532f` — feat(06-01): install and register tauri-plugin-dialog
- `68e14d6` — test(06-01): scaffold Wave 0 module stubs and placeholder tests

## Self-Check: PASSED

- FOUND: src-tauri/src/repo_session.rs
- FOUND: src-tauri/src/db/session.rs
- FOUND: src-tauri/tests/common/mod.rs
- FOUND: src-tauri/tests/end_to_end_smoke.rs
- FOUND: src/stores/repoStore.ts
- FOUND: src/stores/__tests__/repoStore.test.ts
- FOUND: src/providers/RepoSessionProvider.tsx
- FOUND: src/providers/__tests__/RepoSessionProvider.test.tsx
- FOUND: src/providers/__tests__/RepoSessionProvider.integration.test.tsx
- FOUND: commit f4a532f
- FOUND: commit 68e14d6
