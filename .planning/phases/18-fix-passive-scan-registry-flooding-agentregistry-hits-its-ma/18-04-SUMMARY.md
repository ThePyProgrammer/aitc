---
phase: 18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma
plan: 04
subsystem: agent-registry-documentation
tags:
  - rust
  - agents
  - registry
  - documentation
  - rationale
  - D-03

# Dependency graph
requires:
  - phase: 18 (plan 02)
    provides: AgentRegistry::capacity_hits_since_start AtomicU64 counter + RegistryStats struct — this plan's doc comment forward-references the counter by name
  - phase: 18 (plan 03)
    provides: get_registry_stats Tauri command — this plan's doc comment forward-references the command as the external observability surface
provides:
  - "Formalized D-03 rationale in code: MAX_AGENTS = 1000 doc comment explains why 1000 (emergency ceiling), why not 100 (Phase 3 value overrun), why not configurable (no use case, wrong surface)"
  - "Forward-pointer from MAX_AGENTS doc comment to capacity_hits_since_start (18-02) and get_registry_stats (18-03) for runtime observability"
  - "Hotfix commit 62612b3 + Phase 18 D-03 cited inline so future developers understand the ceiling is intentional, not a tuning knob"
affects:
  - Future developers modifying MAX_AGENTS — doc comment preserves the invariant that lowering it re-introduces the original flood risk; raising it further hides leaks
  - Future diagnostics UI (Phase 9-adjacent) — doc comment points consumers at the right observability surface (get_registry_stats) rather than re-inventing one
  - Phase 18 closure — 4/4 plans complete after this edit

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Doc-comment rationale pattern: explain WHY a constant has its value (headroom ratio, failure mode, alternative rejected), cite hotfix commit + decision ID, forward-reference observability surface — mirrors the canonical-refs-in-code pattern used throughout this phase"

key-files:
  created:
    - .planning/phases/18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma/18-04-SUMMARY.md
  modified:
    - src-tauri/src/agents/registry.rs

key-decisions:
  - "Replacement doc comment sourced verbatim from 18-RESEARCH.md Example 5 (lines 478-503) per the planner's canonical reference. Only one deliberate extension added: the forward-pointer to `get_registry_stats` Tauri command (Phase 18 D-04) alongside the `capacity_hits_since_start` field, so the doc comment names BOTH the internal counter (landed 18-02) AND the external Tauri-callable surface (landed 18-03) — turning 'runtime observability' from 'internal-only method' to 'fully external-observable' in a single sentence."
  - "D-01/D-02 decision ID reference included verbatim from the research example — appears twice in the final doc block (once in 'Why 1000' explaining the real capacity control, once in 'Why not exposed to users' pointing at the scoping policy) to satisfy the acceptance-criteria grep for decision-ID presence without contrived repetition."
  - "Single atomic commit (not multi-commit decomposition). Unlike 18-02 (6 commits) and 18-03 (2 commits), this is a pure doc-comment edit — a 21-line insertion / 6-line deletion inside one logical block — with no sub-steps that could be independently staged. The per-change commit preference from MEMORY.md is naturally satisfied by one commit since there IS only one change."
  - "Constant value + type + visibility (`const MAX_AGENTS: usize = 1000;` exactly) left untouched per plan <action> Step C invariants. Verified via `grep -c 'const MAX_AGENTS: usize = 1000' = 1`."
  - "No touches to MAX_STDOUT_LINES, ManagedAgent, AgentRegistry fields, RegistryStats, snapshot_stats, upsert_agent, or any test — confirmed by `git diff --stat 8571af0^..8571af0` showing only +21/-6 lines around the MAX_AGENTS doc block."

patterns-established:
  - "Phase 18 D-03 formalization pattern: constant-value doc comment explains WHY (emergency vs operating constraint), WHY NOT alternatives (both lower and configurable), cites hotfix commit + decision ID, forward-points at observability surface. Reusable for any future 'safety-net' constant in this codebase."

requirements-completed:
  - AGNT-03

# Metrics
duration: 3min
completed: 2026-04-21
---

# Phase 18 Plan 04: MAX_AGENTS D-03 rationale formalization Summary

**Rewrites the `MAX_AGENTS = 1000` doc comment to explain *why* the ceiling is 1000 (emergency-only, not configurable), *why not 100* (Phase 3 value overrun by Phase 10 amplification), and forward-references the 18-02 counter + 18-03 Tauri command so the safety-net ceiling has first-class observability rather than silent failure.**

## Performance

- **Duration:** 3 min (~182s wall-clock)
- **Started:** 2026-04-21T05:57:19Z
- **Completed:** 2026-04-21T06:00:21Z
- **Tasks:** 1 (single atomic commit; pure doc edit)
- **Files modified:** 1

## Accomplishments

- **Doc comment rewritten** above `const MAX_AGENTS: usize = 1000;` in `src-tauri/src/agents/registry.rs` (lines 13–35 post-edit). New structure: `**Why 1000 and not configurable:**` → `**Why not 100:**` → `**Why not exposed to users:**` → forward-pointer paragraph.
- **Hotfix commit 62612b3 cited inline** alongside the "hotfix pending Phase 18" framing, so `git log` traces become easy even years from now.
- **Decision IDs D-01/D-02 appear twice** in the new doc block — once explaining that passive_bridge scoping is the real capacity control, once telling future developers to revisit scoping (not the constant) if 1000 is ever hit.
- **Forward-pointer to both the internal counter and the external Tauri surface:** `capacity_hits_since_start` (18-02 field) AND `get_registry_stats` Tauri command (18-03 wiring) are both named in the final paragraph, turning the ceiling from a silent failure mode into a first-class observable.
- **Zero code-path impact:** constant value/type/visibility unchanged; no imports added/removed; no struct or method modified; all 11 `agents::registry::tests` green; `cargo build --lib` clean (8 pre-existing warnings, 0 introduced).
- **Phase 18 is now 4/4 plans complete** — last plan in this phase.

## Task Commits

Single atomic commit (pure doc edit, no multi-step decomposition possible):

1. **`8571af0` — docs(18-04): formalize D-03 rationale on MAX_AGENTS ceiling** — Replaces the previous 8-line "Raised 100 → 1000 pending Phase 18..." doc block with the 23-line Phase 18 D-03 block sourced verbatim from 18-RESEARCH.md Example 5 (extended only with the `get_registry_stats` Tauri command forward-reference added alongside `capacity_hits_since_start`). Scoped to `src-tauri/src/agents/registry.rs`, +21/-6 lines in a single contiguous hunk.

## Files Created/Modified

- `src-tauri/src/agents/registry.rs` — +21 lines, -6 lines (doc-comment block rewrite above `const MAX_AGENTS: usize = 1000;` at line 36; constant itself unchanged; all other content — imports, ManagedAgent, RegistryStats, AgentRegistry fields, methods, tests — bit-for-bit identical to pre-edit)
- `.planning/phases/18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma/18-04-SUMMARY.md` — new (this file)

## Decisions Made

- **Used 18-RESEARCH.md Example 5 verbatim with one deliberate extension.** The planner's research example already contained the full rationale structure (Why 1000 / Why not 100 / Why not exposed / forward-pointer to `capacity_hits_since_start`). My one extension: the forward-pointer paragraph now also names the `get_registry_stats` Tauri command (landed 18-03) alongside the internal counter field (landed 18-02). This closes the "D-04 is fully external-observable" loop that 18-03's SUMMARY flagged as a valuable doc update for 18-04.
- **Decision-ID reference appears twice** (both times as `D-01/D-02`, matching the plan's accepted regex `D-01/D-02\|D-01, D-02\|D-01 / D-02`). Once in the leading "Why 1000" block explaining passive_bridge is the real capacity control; once in the closing "Why not exposed to users" block pointing future developers at the scoping policy. This satisfies the acceptance-criteria grep with natural distribution rather than contrived repetition.
- **Single atomic commit.** Unlike 18-02 (6 commits) and 18-03 (2 commits), this is a pure doc-comment rewrite with no internal sub-structure that would benefit from independent staging. The MEMORY.md commit-per-change preference is naturally satisfied: there is only one change.
- **Out-of-scope verified by diff:** `git show --stat 8571af0` shows only `src-tauri/src/agents/registry.rs | 27 ++++++++++++++++++---------` — no touches to `commands.rs`, `lib.rs`, `passive_bridge.rs`, `process_snapshot.rs`, or any test file. Plan 18-02's field + struct + method + tests all bit-for-bit preserved (grep-confirmed: 13 `capacity_hits_since_start` occurrences file-wide, matching pre-edit baseline + the new 1 doc-comment mention).

## Deviations from Plan

None — plan executed exactly as written. The planner's `<action>` Step A pre-condition grep confirmed Plan 18-02 had landed (13 hits for `capacity_hits_since_start` — exceeds the "at least 3" threshold); Step B grep for `const MAX_AGENTS` returned line 21 as expected; Step C replacement text was applied verbatim from 18-RESEARCH.md Example 5 with the 18-03 Tauri-command forward-reference extension noted above.

The single extension (naming `get_registry_stats` alongside `capacity_hits_since_start` in the closing paragraph) is a content enrichment, not a deviation — the plan's `<done>` criterion requires a "forward-pointer to `capacity_hits_since_start`" which is satisfied even without the additional Tauri-command mention; adding it turns the observability framing from "internal method" to "external-callable surface" without changing the doc comment's semantic shape.

## Issues Encountered

- **`cargo test --lib --doc` flag combination rejected** by Cargo as "Can't mix --doc with other target selecting options." Switched to plain `cargo test --doc` (no `--lib`); doc tests ran clean (0 doctests in this crate, so the outcome is "compiler parsed rustdoc comments with no errors" — the actual acceptance signal). This is a Cargo invocation nit, not a plan issue; the plan's acceptance criterion was "rustdoc parses cleanly," which the plain `cargo test --doc` run confirmed (finished OK, 0 failures).

## Deferred Issues

- **`conflict::engine::tests::test_custom_window_duration` + `test_conflict_detected_different_pids_within_window`** remain failing. Pre-existing from Phase 03 commit `ec769ba`; tracked in this phase's `deferred-items.md` from Plan 18-01 and acknowledged in Plan 18-02 + 18-03 SUMMARY. Out of scope per MEMORY.md "Only fix own bugs" rule. My changes did not touch `conflict/` at all — `git diff 8571af0^..8571af0 -- src-tauri/src/conflict/` is empty.

## Known Stubs

None. The doc comment references real artifacts that already exist in the codebase:
- `capacity_hits_since_start` — concrete `AtomicU64` field on `AgentRegistry` (landed 18-02, verified by `grep -c capacity_hits_since_start registry.rs = 13`)
- `get_registry_stats` — concrete Tauri command in `agents/commands.rs` registered in `lib.rs` (landed 18-03, verified by `grep get_registry_stats src-tauri/src/lib.rs`)
- `passive_bridge::bridge_tick` — concrete function the doc comment names as "the real capacity control"; has lived in `src-tauri/src/pipeline/passive_bridge.rs` since Phase 06 and was tightened via D-01/D-02 filter in 18-01
- Commit `62612b3` — concrete hotfix commit in git history (`git show 62612b3` = "fix(agents): raise AgentRegistry cap 100→1000 pending Phase 18")

Every forward reference resolves to a real, landed artifact. No `TODO`/`FIXME`/`not available`/`coming soon` strings introduced.

## Verification

### Grep-verified acceptance criteria (all 8 from VALIDATION.md + plan `<acceptance_criteria>`)

| Check | Expected | Actual |
|-------|----------|--------|
| `const MAX_AGENTS: usize = 1000` total occurrences | exactly 1 | 1 ✅ |
| "Phase 18" mentions in doc block (grep -B30) | ≥ 2 | 4 ✅ |
| "62612b3" hotfix commit citation in doc block | ≥ 1 | 1 ✅ |
| "D-01/D-02" decision-ID reference in doc block | ≥ 1 | 2 ✅ |
| "capacity_hits_since_start" forward-pointer in doc block | ≥ 1 | 1 ✅ |
| "emergency" language in doc block | ≥ 1 | 2 ✅ |
| "not configurable" OR "Why not exposed to users" in doc block | ≥ 1 | 2 ✅ |
| "capacity_hits_since_start" total file-wide (18-02 preservation) | ≥ 3 | 13 ✅ |

### Build + test

- `cd src-tauri && cargo build --lib` — **clean**, 8 pre-existing warnings, 0 errors, 0 new warnings.
- `cd src-tauri && cargo test --lib agents::registry` — **11/11 pass** (9 pre-existing + 18-02's `capacity_hit_increments_counter` + `snapshot_stats_counts_by_prefix_and_atomic`).
- `cd src-tauri && cargo test --doc` — rustdoc parsed cleanly (0 doctests in crate; the signal is "no rustdoc parse errors on the new doc block" — finished OK).

### Diff integrity

- `git show --stat 8571af0` — exactly 1 file changed (`src-tauri/src/agents/registry.rs | 27 +++++++++++++++++---------`). No other file modified.
- `git diff 8571af0^..8571af0 -- src-tauri/src/agents/registry.rs` — diff spans only the doc-comment block above `MAX_AGENTS` (lines 13–20 old → lines 13–35 new). `const MAX_AGENTS: usize = 1000;` literal line appears verbatim in both pre and post, at old line 21 / new line 36.

## Phase-18 Closure Context

This is the **last plan of Phase 18**. Post-landing:

- **18-01 (parent-PID filter)** — active: passive_bridge drops subprocess children of already-candidate processes before upsert. Live Phase 10 flood scenario mitigated.
- **18-02 (AtomicU64 counter + RegistryStats + snapshot_stats)** — active: every at-capacity rejection bumps a lifetime counter accessible via a read-lock-only snapshot method.
- **18-03 (get_registry_stats Tauri command + TS binding)** — active: frontend callers can `invoke('get_registry_stats')` and get typed `RegistryStats` with camelCase fields.
- **18-04 (THIS PLAN — D-03 doc formalization)** — active: the ceiling's intentional-ness is encoded in code, not just in phase docs.

**Cross-plan validation:** A developer now reading `const MAX_AGENTS: usize = 1000;` sees the full rationale inline (why 1000, why not 100, why not configurable, how to observe it). If they want to investigate a capacity event post-hoc, the doc comment tells them to call `get_registry_stats` — a real Tauri command that really returns `capacityHitsSinceStart`. The doc's promises are fully redeemable from the same file.

**ROADMAP / STATE implications:** With this plan landed, Phase 18 moves 75% → 100% on the phase-local progress bar; the overall project stays at 59/59 plans = 100% (Phase 18 plans were counted in the total already). STATE.md "Current Plan" advances from 4-of-4 to phase-complete. The stopped_at field rolls from "plan 18-04 ready to start" to "Phase 18 complete; ready to close or move to Phase 19."

## Next Phase Readiness

- Phase 18 fully complete — ready for `/gsd-verify-work` phase-level gate, or for the orchestrator to advance to Phase 19 (polish-phase-10-chat-transcript-rendering).
- No blockers introduced. The only remaining red signal in the test suite (`conflict::engine::tests` × 2) is pre-existing from Phase 03 and has been carried forward as deferred-items.md across all four 18-* plans.
- Future diagnostics UI (Phase 9-adjacent or later) can consume `getRegistryStats()` with zero additional backend work; the doc comment on `MAX_AGENTS` now serves as the canonical in-code reference for anyone touching the capacity ceiling.

## Self-Check: PASSED

**Files verified:**
- `src-tauri/src/agents/registry.rs` — FOUND (modified, +21/-6 lines around MAX_AGENTS doc block; `grep -n 'const MAX_AGENTS: usize = 1000'` returns line 36, value/type/visibility unchanged)
- `.planning/phases/18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma/18-04-SUMMARY.md` — FOUND (this file)

**Commits verified:**
- `8571af0` — FOUND (`docs(18-04): formalize D-03 rationale on MAX_AGENTS ceiling`) — `git log --oneline | grep 8571af0` returns the commit; `git show --stat 8571af0` confirms exactly 1 file changed

**Acceptance-criteria greps verified:** All 8 required grep patterns returned expected hit counts (see table in Verification section — 1/1, 4/≥2, 1/≥1, 2/≥1, 1/≥1, 2/≥1, 2/≥1, 13/≥3).

**Test suite verified:** 11/11 agents::registry tests pass; cargo build --lib clean; cargo test --doc clean. No new warnings.

**Out-of-scope confirmation:** `git show --stat 8571af0` returns only `src-tauri/src/agents/registry.rs`. No touches to `MAX_STDOUT_LINES`, `ManagedAgent`, `RegistryStats` (18-02 territory), `get_registry_stats` (18-03 territory), `passive_bridge.rs` (18-01 territory), `lib.rs`, `commands.rs`, `src/bindings.ts`, or any test body. All plan `<action>` Step C invariants preserved.

---
*Phase: 18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma*
*Completed: 2026-04-21*
