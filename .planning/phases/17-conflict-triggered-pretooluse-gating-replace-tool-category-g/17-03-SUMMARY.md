---
phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g
plan: 03
subsystem: database
tags: [sqlx, sqlite, migration, rust-module, approval_requests, app_settings]

# Dependency graph
requires:
  - phase: 08-pretool-use-hooks
    provides: approval_requests table + app_settings.pretool_gated_tools row
  - phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g/01
    provides: src-tauri/src/agents/bash_paths.rs source file (registered here)
provides:
  - pub mod bash_paths; registration in src-tauri/src/agents/mod.rs
  - Migration 007: conflict_with_agent_id + gate_reason TEXT columns on approval_requests
  - Migration 007: disarmed pretool_gated_tools row ('[]' on existing and fresh installs)
affects:
  - 17-04 (Plan 04 calls crate::agents::bash_paths::extract_target_paths)
  - 17-05 (Plan 05 INSERTs into conflict_with_agent_id + gate_reason)
  - Any future settings UI revival of pretool_gated_tools (D-19 plumbing preserved)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-only DDL migration — ALTER ADD COLUMN (no DROP, no CHECK, no index)"
    - "INSERT OR IGNORE companion to UPDATE for existing-row + fresh-install parity"
    - "sqlx implicit per-file BEGIN/COMMIT for partial-apply safety (T-17-06 mitigation)"

key-files:
  created:
    - src-tauri/src/db/migrations/007_conflict_gating.sql
  modified:
    - src-tauri/src/agents/mod.rs

key-decisions:
  - "D-18 implemented: disarm legacy tool-category gating via UPDATE to '[]'"
  - "D-19 honored: pretool_gated_tools row preserved (not dropped) — INSERT OR IGNORE keeps it alive on fresh installs for future power-user revival"
  - "D-20 implemented: two nullable TEXT columns added to approval_requests, NULL on legacy rows"
  - "W3 revision respected: Cargo.toml NOT touched in this plan — shlex owned by Plan 01, path-clean owned by Plan 02"

patterns-established:
  - "Migration 007 follows 005's template: header comment explains intent + references to CONTEXT decisions + no CHECK constraint rationale"
  - "Module registration block follows Phase 8 hook_install/hook_waiters shape: blank line + phase comment + pub mod lines"

requirements-completed: [CNFL-01, COMM-01, COMM-02, COMM-06]

# Metrics
duration: 8min
completed: 2026-04-21
---

# Phase 17 Plan 03: Wave 1 Scaffolding — Module Index + Migration 007 Summary

**Registered `pub mod bash_paths;` in agents/mod.rs and introduced additive migration 007 adding `conflict_with_agent_id` + `gate_reason` TEXT columns to `approval_requests` while disarming the legacy `pretool_gated_tools` allowlist to `'[]'`.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-21T11:54:00Z
- **Completed:** 2026-04-21T12:02:33Z
- **Tasks:** 1 (executed as 2 atomic commits per plan instruction + "commit after every change" memory rule)
- **Files modified:** 2

## Accomplishments
- `src-tauri/src/agents/mod.rs` now registers the Phase 17 `bash_paths` module (D-09), matching the Phase 8 block shape
- New additive migration file `src-tauri/src/db/migrations/007_conflict_gating.sql` (1,763 bytes) ships the two new nullable TEXT columns on `approval_requests` (D-20) and flips the legacy category gate off by default (D-18)
- `INSERT OR IGNORE` companion statement forecloses the `get_pretool_gated_tools` bootstrap path so fresh installs also start with category gating OFF — D-19 revival plumbing preserved (row still exists, just empty)
- `src-tauri/Cargo.toml` NOT touched — revision W3 correctly respected (shlex owned by Plan 01, path-clean owned by Plan 02)

## Task Commits

Each change was committed atomically per the plan's "2 commits — one per file" directive and the user's "commit after every change" memory rule:

1. **Task 1 Step A: Register bash_paths module** — `0e603fc` (feat)
2. **Task 1 Step B: Migration 007 conflict_gating.sql** — `be2b900` (feat)

_This plan had no separate "final metadata commit" step to execute — the orchestrator commits SUMMARY.md in worktree mode after all Wave 1 agents return._

## Files Created/Modified
- `src-tauri/src/agents/mod.rs` — +3 lines: blank + `// Phase 17:` comment + `pub mod bash_paths;` (slotted after the Phase 8 hook block, before the `pub use adapter::*` re-exports; no existing modules touched)
- `src-tauri/src/db/migrations/007_conflict_gating.sql` — NEW, 1,763 bytes — 2× `ALTER TABLE ADD COLUMN`, 1× `UPDATE app_settings SET value='[]'`, 1× `INSERT OR IGNORE INTO app_settings VALUES ('pretool_gated_tools','[]')`

## Decisions Made
None — plan executed exactly as written. All four SQL statements match RESEARCH §6's canonical body verbatim (comments updated per plan's §Action body wording, which is a functionally-equivalent superset of RESEARCH §6).

## Deviations from Plan

None — plan executed exactly as written.

- No Cargo.toml edit attempted (revision W3 boundary held)
- No CHECK constraint added (RESEARCH §6 + plan's §Action "Do NOT")
- No indexes added (RESEARCH §6 + plan's §Action "Do NOT")
- No `pub use bash_paths::*` re-export (plan's §Action "Do NOT")
- No data migration on legacy rows (D-20: new columns NULL on pre-existing rows)

## Issues Encountered

**`cargo check --package aitc --lib` does not exit 0 in this worktree**, but for a reason orthogonal to this plan's changes:

- Expected cause per plan's `<done>` block: `bash_paths.rs` file doesn't exist yet in this worktree (Plan 01 owns its creation in a parallel worktree). This would manifest as `unresolved module declaration \`bash_paths\``.
- Actual cause observed: Tauri build script failure — `resource path \`binaries/aitc-hook-x86_64-unknown-linux-gnu\` doesn't exist`. This is a pre-existing environmental issue (missing sidecar binary) that aborts compilation before the Rust module resolution phase is reached, so the `unresolved module` error is masked but would otherwise appear.
- Per "only fix own bugs" memory rule, the build-script issue was not touched — it is pre-existing and not caused by this plan.
- Wave 1 exit gate: once Plans 01, 02, and 03 merge together, `bash_paths.rs` will exist and the module registration will resolve cleanly. The Tauri build-script issue is a separate infrastructure concern outside Wave 1's scope.

**Migration runtime validation was deferred**, since the build-script blocks binary compilation. This is acceptable because:
- The SQL file is syntactically isomorphic to migrations 005/006 (verified by inspection + grep of required strings)
- sqlx's `migrate!` macro parses files at runtime only, so `cargo check` cannot validate SQL regardless
- Downstream plans (04, 05) and the Wave 1 exit gate will exercise the migration when `make_hook_pool()` is extended (per RESEARCH §6 note about test schema)

## Threat Flags

No new security surface beyond what's in `<threat_model>` (T-17-06). No new network endpoints, auth paths, or trust-boundary schema changes introduced.

T-17-06 mitigation verified by inspection:
- sqlx's `migrate!` macro wraps each `.sql` file in an implicit transaction (RESEARCH §6 + Phase 17 threat model)
- All four statements are idempotent-or-version-gated: ALTER ADD COLUMN is protected by sqlx's migration version table; UPDATE is a no-op if re-run (idempotent); INSERT OR IGNORE is explicitly idempotent

## Next Phase Readiness

**Wave 1 downstream consumers can proceed:**
- Plan 04 will reference `crate::agents::bash_paths::extract_target_paths` — module index entry is now in place
- Plan 05 will `INSERT` values into `conflict_with_agent_id` + `gate_reason` — schema columns are now in place (after migrator runs at next app boot)
- Plan 05 must also extend `self_register.rs::make_hook_pool()` CREATE TABLE to mirror the new columns, per RESEARCH §6 — this is Plan 05's responsibility, noted here for downstream context

**Wave 1 exit gate dependencies:**
- `bash_paths.rs` source file must land via Plan 01 before `cargo check` resolves cleanly (expected Wave 1 ordering per plan's §objective)
- After Wave 1 merge: `cargo check --package aitc --lib` should exit 0 modulo the pre-existing Tauri build-script sidecar-binary issue, which is environmental and unrelated

**Requirements marked complete (to be written to REQUIREMENTS.md by orchestrator):**
- CNFL-01 (conflict-based gating plumbing — schema columns landed)
- COMM-01, COMM-02, COMM-06 (approval-request communication surface extensions)

## Self-Check: PASSED

Verified post-write:
- `pub mod bash_paths` exists in `src-tauri/src/agents/mod.rs` line 17 — FOUND
- `// Phase 17:` comment exists in `src-tauri/src/agents/mod.rs` line 16 — FOUND
- `src-tauri/src/db/migrations/007_conflict_gating.sql` exists (1,763 bytes) — FOUND
- `ADD COLUMN conflict_with_agent_id TEXT` in migration 007 — FOUND (line 19)
- `ADD COLUMN gate_reason TEXT` in migration 007 — FOUND (line 20)
- `UPDATE app_settings` in migration 007 — FOUND (line 23)
- `INSERT OR IGNORE INTO app_settings` in migration 007 — FOUND (line 32)
- `ls src-tauri/src/db/migrations/ | sort` shows `007_conflict_gating.sql` immediately after `006_agent_events.sql` — FOUND
- `git diff 4cc570b7268d24822a1d9dda163e616c78cf83e1 HEAD -- src-tauri/Cargo.toml` is EMPTY — CONFIRMED
- Commit `0e603fc` present in `git log` — FOUND
- Commit `be2b900` present in `git log` — FOUND

---
*Phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g*
*Plan: 03*
*Completed: 2026-04-21*
