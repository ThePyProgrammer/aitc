# Phase 8 — Deferred Items (out-of-scope findings)

Items discovered while executing Phase 8 that are outside this phase's scope.

## Plan 08-01 (2026-04-15)

### 1. `aitc` lib test build broken by Phase 9 Plan 1 scaffolding

- **Symptom:** `cargo test --lib ...` fails with:
  ```
  error[E0583]: file not found for module `fixtures`
   --> src/claude_resources/mod.rs:25:1
     |
  25 | pub mod fixtures;
  ```
- **Root cause:** Commit `291acb4 feat(09-01): scaffold claude_resources module + add backend deps` declares `#[cfg(test)] pub mod fixtures;` but does not create `src/claude_resources/fixtures.rs` or `src/claude_resources/fixtures/mod.rs`.
- **Scope:** Pre-existing on the worktree base commit; not introduced by Plan 08-01.
- **Workaround used in Plan 08-01:** Verified Plan 08-01 stubs compile via `cargo check --workspace` (lib-only, not `--tests`). Could not run `cargo test --lib agents::hook_waiters ...` directly. The sidecar crate `aitc-hook` tests run cleanly (verified RED state).
- **Owner:** Phase 9 — to be addressed by Phase 9 Plan 2 (which introduces the fixtures module) or a targeted fix to un-gate the empty module declaration.

### 2. Pre-existing `tsc --noEmit` errors in `src/views/Radar/forceCluster.ts` + its tests

- **Symptom:** `npx tsc --noEmit` reports 59 errors rooted in `d3-force` typings and `ClusterNode` missing `x`/`y`/`vx`/`vy` simulation fields.
- **Scope:** Pre-existing (63 errors on base commit `fb5d5a9`, reduced to 59 after Plan 08-01 which adds zero errors).
- **Owner:** Phase 7 — Plan 07-05 introduced the `forceCluster` module; fixing the d3-force typings is out of scope for Phase 8.

### 3. Non-root `[profile.release]` in `aitc-hook/Cargo.toml` ignored

- **Symptom:** `cargo check --workspace` emits:
  ```
  warning: profiles for the non root package will be ignored, specify profiles at the workspace root
  ```
- **Scope:** Plan 08-01 explicitly specifies the profile block in `aitc-hook/Cargo.toml`. Moving it to the workspace root is a structural change that could affect other crates' release builds.
- **Disposition:** Leave as-is for Wave 0 (profile is effectively a no-op, not breaking). A later plan (08-04 or bundle prep) can migrate the release profile to the workspace root once multiple release profiles are needed.
