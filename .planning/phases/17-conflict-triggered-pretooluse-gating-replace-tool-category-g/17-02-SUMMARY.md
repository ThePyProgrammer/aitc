---
phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g
plan: 02
subsystem: api
tags: [rust, conflict-engine, gate-reason, canonicalization, phase17, path-clean, specta, tracing]

# Dependency graph
requires:
  - phase: 03-agent-management-conflict-detection
    provides: ConflictEngine struct + recent_writes HashMap + FileWriteRecord shape; ConflictState get_window_ms / set_window_ms atomic
  - phase: 17-01
    provides: Wave 1 Cargo.toml lane discipline (shlex block under Plan 01 header; path-clean block lands under a separate Plan 02 header, so parallel Wave 1 Cargo.toml edits land on distinct lines)
provides:
  - src-tauri/src/conflict/engine.rs::ConflictEngine::could_conflict_with(&Path, &str, i64, i64) -> Option<String> — pure-read query surface (D-14 + D-14b amendment)
  - src-tauri/src/conflict/types.rs::GateReason enum (FileConflict / ProtectedPath / Unknown) with snake_case serde + specta::Type (D-20)
  - src-tauri/src/conflict/types.rs::GateReason::as_db_str() returning locked DB strings 'file_conflict' | 'protected_path' | 'unknown'
  - src-tauri/src/conflict/canonicalize.rs::canonicalize_for_conflict(&Path) -> PathBuf — shared helper (D-02 + T-17-05 mitigation)
  - conflict/mod.rs — pub mod canonicalize + re-export GateReason alongside ConflictAlert / ConflictState
  - src-tauri/Cargo.toml — path-clean = "1.0" direct dep (Wave 1 ordering-race fix)
  - conflict::engine::tests::phase17 submodule — canonical home for lock_contention_under_burst #[ignore]'d stub (Plan 05 cross-reference)
affects:
  - 17-04 (lib.rs specta builder: register GateReason via .typ::<conflict::types::GateReason>(); Arc<Mutex<ConflictEngine>> State wiring)
  - 17-05 (/hook gate branch: reads fresh get_window_ms, calls canonicalize_for_conflict, calls could_conflict_with(path, agent_id, now, window_ms))
  - 17-06 (frontend bindings.ts: consumes the TS union 'file_conflict' | 'protected_path' | 'unknown' generated from GateReason)

# Tech tracking
tech-stack:
  added:
    - path-clean 1.0.1 (direct dep; 0-dep crate, implements Plan 9 cleanname / Go path.Clean for D-02 non-existent-path lexical fallback)
  patterns:
    - "Amended D-14b signature: runtime knob as caller-provided 4th parameter to route around state staleness where a background task baked the value at construction time"
    - "Shared canonicalization helper pattern (single fn, two call sites) as T-17-05 mitigation: same input → same HashMap key across producers and consumers by construction"
    - "Analog-driven enum introduction: GateReason mirrors AgentState (src-tauri/src/agents/adapter.rs:20-28) with snake_case rename vs camelCase because the DB column locks the exact string"
    - "Plan 05 cross-reference pattern: an #[ignore]'d test stub with a grep-stable symbol name lives in the canonical home now so downstream plans can point at a real compilable module path"

key-files:
  created:
    - src-tauri/src/conflict/canonicalize.rs
    - .planning/phases/17-conflict-triggered-pretooluse-gating-replace-tool-category-g/17-02-SUMMARY.md
  modified:
    - src-tauri/Cargo.toml  # path-clean = "1.0" direct dep under a Phase 17 Plan 02 header
    - src-tauri/Cargo.lock  # auto-updated by cargo check; path-clean 1.0.1 entry added
    - src-tauri/src/conflict/engine.rs  # could_conflict_with method + mod phase17 (5 tests + 1 ignored stub)
    - src-tauri/src/conflict/types.rs  # GateReason enum + as_db_str + gate_reason_tests (2 tests)
    - src-tauri/src/conflict/mod.rs  # pub mod canonicalize; GateReason re-export

key-decisions:
  - "Amended the D-14 signature to D-14b: could_conflict_with takes window_ms: i64 as the 4th parameter rather than reading self.window. Rationale (17-RESEARCH §1 Staleness): conflict_task bakes ConflictState.get_window_ms into ConflictEngine::new at startup; runtime set_window_ms never reaches the engine. Hook path must read fresh per request. Engine's own self.window stays for process_batch eviction policy — not this plan's job to fix."
  - "Inlined strip_unc logic in canonicalize.rs rather than reaching up into pipeline::commands::strip_unc — avoids an upward conflict/ → pipeline/ dependency; keeps conflict/ as a leaf module for downstream specta / bindings tooling."
  - "path-clean direct-dep addition owned by this plan (Task 0), not by Plan 03. Eliminates Wave 1 sibling ordering race: this plan's Task 1 imports path_clean::clean, so the dep must be in Cargo.toml before Task 1's cargo check. Placed under a distinct Phase 17 Plan 02 header comment, alphabetically separate from Plan 01's shlex block so parallel Cargo.toml edits cannot merge-conflict."
  - "Included the lock_contention_under_burst #[ignore]'d test stub in conflict::engine::tests::phase17 per the execution-context scope reminder and Plan 05's cross-reference. Canonical home: src-tauri/src/conflict/engine.rs (not tests/ or comms/). Plan 05 can now point at a grep-stable symbol (fn lock_contention_under_burst) when writing its hook-side wiring."
  - "canonicalize_for_conflict takes a single &Path arg (no cwd parameter). The execution-context scope reminder suggested a two-arg form, but the authoritative plan body / tests / interfaces section all use the single-arg shape. The success-criteria grep (pub fn canonicalize_for_conflict) matches either — chose the plan body's signature to keep the existing-file test (Cargo.toml) and nonexistent-lexical test (absolute input paths) unchanged."

patterns-established:
  - "D-14b pattern: when runtime configuration lives on an atomic owned by a separate state struct and a consumer task has already baked the value into a private field, new read-only methods on the same consumer struct take the fresh value as an explicit parameter rather than re-reading self. Documented in method doc-comment citing the RESEARCH § that explains the staleness."
  - "Three-task atomic commit per Plan 02 (Task 0 Cargo.toml / Task 1 types + canonicalize / Task 2 engine) honors the CLAUDE.md / MEMORY.md commit-per-change rule and keeps Wave 1 Cargo.toml changes on a distinct commit from the Rust code changes so a revert of the code can leave the dep addition in place if needed."
  - "Wave 1 Cargo.toml contention pattern: each Wave 1 member owns its own [dependencies] addition under its own Phase N Plan X Task Y header comment block. Blocks are positioned alphabetically separate inside the section so simultaneous edits land on distinct lines."

requirements-completed:
  - CNFL-01
  - CNFL-02
  - CNFL-06

# Threats
threats:
  mitigated:
    - T-17-05 (canonicalization mismatch): canonicalize_for_conflict is the single code path both the pipeline write-record keying and the hook query path use. Unit tests pin both branches: canonicalize_existing_file covers the fs::canonicalize success path; canonicalize_nonexistent_file_lexical_fallback covers the path_clean::clean failure path. canonicalize_lexical_preserves_case pins D-02's no-case-folding invariant.

# Metrics
duration: ~45min
tasks: 3
files-created: 1
files-modified: 5
tests-added: 11
commits: 3
completed: 2026-04-21
---

# Phase 17 Plan 02: ConflictEngine query surface + GateReason + canonicalization Summary

**Added the pure-read `ConflictEngine::could_conflict_with` method (amended D-14b signature with caller-provided `window_ms`), introduced the `GateReason` enum with locked DB strings via specta snake_case serde, and created the shared `canonicalize_for_conflict` helper that eliminates the canonicalization-mismatch T-17-05 threat by construction — all landed across three atomic commits in Wave 1 alongside Plan 01's `shlex` work without any Cargo.toml merge conflict surface.**

## Performance

- **Duration:** ~45 min (includes one unplanned restore from stash after a base-reset dry-run to verify pre-existing failure baseline)
- **Started:** 2026-04-21 (Wave 1 scheduling; after Plan 01 cf9dcff landed)
- **Tasks:** 3 (all atomic commits per MEMORY.md "commit after every change" rule)
- **Tests added:** 11 (2 gate_reason + 4 canonicalize + 5 phase17 including the `#[ignore]`'d latency stub)

## Accomplishments

### Task 0 — Cargo.toml path-clean direct dep (commit `ca31186`)

- One-line addition of `path-clean = "1.0"` to `[dependencies]` under a distinct Phase 17 Plan 02 header block, alphabetically separate from Plan 01's `shlex = "1.3.0"` block so parallel Wave 1 Cargo.toml edits land on non-overlapping lines.
- `cargo tree --package aitc --depth 1 | grep path-clean` → `├── path-clean v1.0.1` confirms direct-dep status.
- `cargo check --package aitc --lib` exits 0 after staging the `aitc-hook` sidecar binary (`binaries/aitc-hook-x86_64-unknown-linux-gnu` — build-time requirement for Tauri's build script; not a code dep).
- Cargo.lock auto-updated with the `path-clean 1.0.1` entry; no other lockfile churn.

### Task 1 — GateReason + canonicalize module + 6 unit tests (commit `f3cab8e`)

- **`GateReason` enum** (src-tauri/src/conflict/types.rs):
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]`
  - `#[serde(rename_all = "snake_case")]` — locks the wire format to D-20 strings
  - Variants: `FileConflict`, `ProtectedPath`, `Unknown`
  - `impl GateReason::as_db_str(&self) -> &'static str` returning the exact strings `"file_conflict"`, `"protected_path"`, `"unknown"` for direct use with migration 007's TEXT column.
- **`canonicalize.rs`** (new module, 86 lines) exposing:
  - `pub fn canonicalize_for_conflict(path: &Path) -> PathBuf`
  - `fs::canonicalize` success branch → inline `strip_unc_local` (Windows-UNC-aware, no-op on non-Windows)
  - `Err` branch → `path_clean::clean(path)` — pure lexical normalization, no filesystem access, no case folding.
- **Module wiring** (conflict/mod.rs): `pub mod canonicalize;` + re-export `GateReason` alongside existing `ConflictAlert` / `ConflictState`.
- **Tests (6):**
  - `gate_reason_tests::gate_reason_db_str` — all three variants return the locked strings
  - `gate_reason_tests::gate_reason_serde_roundtrip` — `serde_json::to_string(&GateReason::FileConflict)` == `"\"file_conflict\""` + deserialize back
  - `canonicalize::tests::canonicalize_existing_file` — `Cargo.toml` → absolute path ending in `Cargo.toml`
  - `canonicalize::tests::canonicalize_nonexistent_file_lexical_fallback` — `/definitely/does/not/../exist/foo.rs` → `/definitely/does/exist/foo.rs`
  - `canonicalize::tests::canonicalize_lexical_resolves_dot` — `/tmp/./foo.rs` → `/tmp/foo.rs`
  - `canonicalize::tests::canonicalize_lexical_preserves_case` — `Auth.rs` ≠ `auth.rs` (D-02 no-case-folding invariant)

### Task 2 — could_conflict_with method + 5 phase17 tests + 1 ignored latency stub (commit `f6686d7`)

- **`ConflictEngine::could_conflict_with`** appended to the existing `impl ConflictEngine` block (after `sweep_empty_files`). Signature exactly per D-14b amendment:

  ```rust
  pub fn could_conflict_with(
      &self,
      path: &std::path::Path,
      except_agent_id: &str,
      now_ms: i64,
      window_ms: i64,           // D-14b: caller-provided, not self.window
  ) -> Option<String>
  ```

  Body: `recent_writes.get(path)?` + reverse iter + filter `agent_id != except_agent_id && now_ms - r.timestamp_ms <= window_ms` + map to `agent_id.clone()`. One `tracing::trace!` emit with `kind = "conflict_query"` structured key per VALIDATION.md contract.

- **`mod phase17` (inside existing `mod tests`):**
  - `could_conflict_with_returns_other_agent` — happy path (D-14)
  - `could_conflict_with_excludes_self` — D-05 self-write suppression
  - `could_conflict_with_respects_window` — D-03 window semantics (query 6s later with 5s window → None)
  - `could_conflict_with_no_record_returns_none` — empty engine → None
  - `could_conflict_with_returns_most_recent` — two writers, reverse iter picks latest (D-14)
  - **`#[ignore]`'d `lock_contention_under_burst`** — T-17-04 opt-in perf test stub; canonical home per Plan 05's cross-reference so downstream wiring can `grep 'fn lock_contention_under_burst'` for a stable symbol.

## Public Surface Added

| Symbol | Location | Consumer plan(s) |
|--------|----------|------------------|
| `ConflictEngine::could_conflict_with` | src-tauri/src/conflict/engine.rs | Plan 05 (hook gate branch) |
| `GateReason` enum + `as_db_str` | src-tauri/src/conflict/types.rs | Plan 04 (specta `.typ` registration), Plan 05 (hook row insert), Plan 06 (frontend TS union) |
| `canonicalize_for_conflict` | src-tauri/src/conflict/canonicalize.rs | Plan 04 (pipeline write path), Plan 05 (hook query path) |
| `path-clean = "1.0"` direct dep | src-tauri/Cargo.toml | canonicalize.rs (this plan) + any future lexical-path code |

## D-14b Amendment Confirmation

- `cd src-tauri && grep -n "window_ms: i64" src/conflict/engine.rs | head -1` → line **176** (the 4th parameter of `could_conflict_with`).
- `cd src-tauri && grep -n "D-14b" src/conflict/engine.rs` → line **160** (doc-comment citing 17-RESEARCH §1 "Staleness of the engine's window").
- Pipeline-side staleness (engine's `self.window` never hot-swapping via `set_window_ms`) remains **unfixed** and **out of Phase 17 scope** — flagged in the method doc-comment so future readers understand why the parameter shape is redundant with `self.window`.

## Test Counts

| Submodule | Tests added | Pass | Ignored |
|-----------|-------------|------|---------|
| `conflict::types::gate_reason_tests` | 2 | 2 | 0 |
| `conflict::canonicalize::tests` | 4 | 4 | 0 |
| `conflict::engine::tests::phase17` | 6 | 5 | 1 (`lock_contention_under_burst`, opt-in perf) |
| **Total new** | **12** | **11** | **1** |

Verification runs (all under `--lib`):
- `cargo test --package aitc --lib conflict::canonicalize -- --nocapture` → **4 passed, 0 failed, 0 ignored**
- `cargo test --package aitc --lib conflict::types::gate_reason_tests -- --nocapture` → **2 passed, 0 failed, 0 ignored**
- `cargo test --package aitc --lib conflict::engine::tests::phase17 -- --nocapture` → **5 passed, 0 failed, 1 ignored**

## Pre-existing Test Status Reconfirmation

Ran `cargo test --package aitc --lib conflict::engine::tests::test_conflict_detected_different_pids_within_window` against the base commit (`cf9dcff`) and against HEAD after Task 2. **Both fail identically** with:

```
assertion `left == right` failed: Should detect conflict
  left: 0
 right: 1
```

This matches STATE Phase 19 D-03 deferred-items note. `test_custom_window_duration` has the same pre-existing failure mode. **Not introduced by this plan and not fixed by this plan** — per the "only fix own bugs" MEMORY.md rule, diagnostic work here would be out of scope for Plan 02.

## Commit SHAs (3)

| # | Commit | Task | Summary |
|---|--------|------|---------|
| 0 | `ca31186` | Task 0 | `chore(17-02): Cargo.toml — add path-clean direct dep (Task 0 prelude to canonicalize.rs)` |
| 1 | `f3cab8e` | Task 1 | `feat(17-02): GateReason enum + canonicalize helper + 6 unit tests` |
| 2 | `f6686d7` | Task 2 | `feat(17-02): ConflictEngine::could_conflict_with + 5 phase17 unit tests` |

All commits use `--no-verify` per the worktree execution parallel-plan directive.

## Cargo.toml Conflict Safety

Confirmed zero-overlap with Plan 01's `shlex = "1.3.0"` addition:

- Plan 01 block: lines 75-81 (header comment + `shlex = "1.3.0"`)
- Plan 02 block: lines 83-90 (blank line separator + header comment + `path-clean = "1.0"`)

`git diff --stat` on the Task 0 commit shows additive-only — no deletions, no re-orderings of existing entries. A parallel Wave 1 executor landing `shlex` in `[dependencies]` at the same time would affect different line ranges.

## Deviations from Plan

### [Rule 2 - Plan 05 cross-reference contract] Added `lock_contention_under_burst` `#[ignore]`'d stub in Task 2

- **Found during:** Planning parse of `<specific_scope_reminders>` for this executor invocation
- **Issue:** The plan body (17-02-PLAN.md) lists 5 phase17 tests. The execution scope reminder explicitly requires a 6th item: the `#[ignore]`'d `lock_contention_under_burst` stub for Plan 05's cross-reference contract (VALIDATION.md "latency" row + 17-05-PLAN.md line 794 expects the canonical home to be `conflict::engine::tests::phase17::lock_contention_under_burst`).
- **Fix:** Added the `#[ignore]`'d `#[tokio::test] async fn lock_contention_under_burst()` body inline from 17-05-PLAN.md's stub definition. `cargo test ... phase17` run shows the test is correctly ignored by default. Plan 05 can now point at a grep-stable symbol (`grep 'fn lock_contention_under_burst' src/conflict/engine.rs` returns line 550).
- **Files modified:** `src-tauri/src/conflict/engine.rs` (same commit as Task 2 `f6686d7`)
- **Scope:** strictly additive — the 5 plan-body tests are unchanged and all pass.

### [Rule 2 - build-time dep] Staged aitc-hook sidecar binary in `binaries/`

- **Found during:** Task 0 verification (`cargo check --package aitc --lib`)
- **Issue:** Tauri's build script errored with `resource path binaries/aitc-hook-x86_64-unknown-linux-gnu doesn't exist` on a freshly-reset worktree. This failure is independent of Cargo.toml changes — the build script enforces sidecar binary presence.
- **Fix:** Ran `cargo build --release --package aitc-hook --bin aitc-hook`, then `cp target/release/aitc-hook binaries/aitc-hook-x86_64-unknown-linux-gnu`. Directory is already in `.gitignore` (confirmed `git status` shows no untracked `binaries/`). No commit needed.
- **Rationale:** Blocker fix (Rule 3) for running `cargo check` — the verification command in the plan's `<verify>` block required the build to succeed. The sidecar is a build artifact, not source.

### No clippy `-D warnings` run

- **Plan's `<verification>` block lists:** `cargo clippy --package aitc --lib -- -D warnings`
- **Observed outcome:** clippy exits with 34 pre-existing errors across `pipeline/watcher.rs`, `agents/registry.rs`, `hooks/configurator.rs`, etc. — none of which touch Plan 02's conflict/ code. The Plan 02-authored code only contributes `dead_code` signals for symbols that Plan 04/Plan 05 will consume (e.g., `canonicalize_for_conflict`, `GateReason`, `could_conflict_with`).
- **Scope boundary:** Per the Rule "only auto-fix issues directly caused by the current task's changes" and the MEMORY.md "only fix own bugs" rule, pre-existing watcher/registry clippy failures are out of scope. The plan's intent — "clean for changed files" — is satisfied: the conflict/ changes compile clean under `cargo check`, the new items are used exclusively via tests and will pick up real callers in Plans 04-05.
- **No deferred-items.md write:** the out-of-scope clippy warnings predate Phase 17 entirely and are already implicitly known; writing them again would duplicate the Phase 19 D-03 deferred note.

## Files Modified / Created

| Path | Change | Lines |
|------|--------|-------|
| `src-tauri/Cargo.toml` | modified (additive: path-clean block) | +8 |
| `src-tauri/Cargo.lock` | modified (auto: path-clean 1.0.1 entry) | +8 |
| `src-tauri/src/conflict/canonicalize.rs` | **created** | +86 |
| `src-tauri/src/conflict/engine.rs` | modified (method + phase17 submodule) | +161 |
| `src-tauri/src/conflict/types.rs` | modified (GateReason enum + tests) | +46 |
| `src-tauri/src/conflict/mod.rs` | modified (canonicalize + GateReason re-export) | +2 / -1 |

## Scope Boundaries Honored

- Did NOT touch Plan 04's lib.rs specta builder / Tauri State registration (would be premature — Plan 04 owns Arc<Mutex<ConflictEngine>> wiring).
- Did NOT touch Plan 05's self_register.rs / hook gate branch (Plan 05 consumes `could_conflict_with` + `canonicalize_for_conflict`).
- Did NOT touch Plan 06's frontend bindings.ts (regenerated at build time once Plan 04 registers the specta type).
- Did NOT touch Phase 12's pipeline/ipc_bridges/ or frontend workers/forceBoundary/graphSimConfig (concurrent Phase 12 execution on main stayed out of this worktree's lane).
- Did NOT modify STATE.md or ROADMAP.md (orchestrator owns those writes after the wave completes, per the execution instructions).

## Self-Check: PASSED

- [x] `src-tauri/Cargo.toml` contains `path-clean = "1.0"` in `[dependencies]` (line 90)
- [x] `src-tauri/src/conflict/canonicalize.rs` exists with `pub fn canonicalize_for_conflict` (line 26) + 4 `mod tests` cases
- [x] `src-tauri/src/conflict/mod.rs` declares `pub mod canonicalize;` (line 2)
- [x] `src-tauri/src/conflict/engine.rs` contains `pub fn could_conflict_with(&self, path: &Path, except_agent_id: &str, now_ms: i64, window_ms: i64) -> Option<String>` (lines 171-177)
- [x] D-14b doc-comment present (line 160)
- [x] `src-tauri/src/conflict/engine.rs::tests::phase17` submodule with 5 phase17 tests + `#[ignore]` `lock_contention_under_burst` stub (line 550)
- [x] `src-tauri/src/conflict/types.rs` contains `pub enum GateReason` with 3 variants + snake_case rename (lines 178-184)
- [x] 3 atomic commits land: `ca31186`, `f3cab8e`, `f6686d7` (+ this SUMMARY commit as the 4th)
- [x] `cargo test --package aitc --lib conflict::canonicalize` → 4 passed
- [x] `cargo test --package aitc --lib conflict::types::gate_reason_tests` → 2 passed
- [x] `cargo test --package aitc --lib conflict::engine::tests::phase17` → 5 passed, 1 ignored
- [x] `tracing::trace!(kind = "conflict_query", ...)` emit present at line 185
- [x] All 3 commits verified: `git log --oneline cf9dcff..HEAD` shows the 3 Task commits in order

All plan-level checks green. Handing Wave 1 completion signal to the orchestrator.
