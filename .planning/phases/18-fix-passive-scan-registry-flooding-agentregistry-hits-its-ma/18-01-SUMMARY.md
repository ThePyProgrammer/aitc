---
phase: 18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma
plan: 01
subsystem: agent-registry
tags:
  - rust
  - pipeline
  - passive-bridge
  - registry-flood-fix
  - subprocess-filter
  - sysinfo
  - parent-pid

# Dependency graph
requires:
  - phase: 03-agent-management-conflict-detection
    provides: AgentRegistry, passive-bridge scaffolding (D-05/D-06 hybrid passive-scan)
  - phase: 06-pipeline-activation-integration-wiring
    provides: ActiveWatch::bridge_task lifecycle, cwd-scope filter seam (commit d3573dc)
  - phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s
    provides: long-lived claude stream-json sessions that amplified the flood (the problem)
provides:
  - Parent-PID in-candidate-set filter in passive_bridge::bridge_tick — drops subprocess children whose parent PID is itself in the post-cwd in_scope list
  - 5 new unit/regression tests covering parent-drops-children, orphan-retention, cwd-filter-order promotion, 1+50 flood regression, and AGNT-03 shell-parent preservation
  - cand_with_parent(pid, name, parent_pid) test helper sibling to existing cand
affects:
  - 18-02-PLAN (registry capacity doc + AtomicU64 counter — this plan's sibling)
  - 18-03-PLAN (get_registry_stats Tauri command wiring)
  - Future debugging of PASSIVE-{pid} flood events — filter is the authoritative scoping policy

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "HashSet<u32> per-tick filter set built from post-cwd in_scope (read pattern mirrors existing live_pids at lines 107-110)"
    - "Option-matched filter predicate with None-branch retention (for orphans / PID-1-reparented children)"

key-files:
  created: []
  modified:
    - src-tauri/src/pipeline/passive_bridge.rs

key-decisions:
  - "D-02 landed verbatim per CONTEXT.md: parent-PID filter lives inside bridge_tick, after cwd-scope, before reap/upsert"
  - "Filter reads c.parent_pid (ProcessInfo field), not c.parent (CandidateProc field) — in_scope holds ProcessInfo after snap.candidates() call"
  - "cand_with_parent helper takes parent_pid: u32 positionally and wraps in Some() — eliminates accidental parent:None in parenting tests; existing cand (parent=None default) remains for 6+ legacy tests per RESEARCH.md Pitfall 6"
  - "flood regression test uses len()==1 as authoritative invariant — 51 candidates still fits under MAX_AGENTS=1000, so 'no capacity hit' is not a meaningful witness"
  - "bridge_tick kept monolithic (no helper extraction) — Claude's Discretion open question resolved per RESEARCH recommendation; monolithic form remains readable with four-line filter addition"

patterns-established:
  - "Pattern: Phase 18 D-02 filter — HashSet<u32> built from in_scope.iter().map(|c| c.pid), filter predicate c.parent_pid ∈ candidate_pids, None-branch keeps candidate"
  - "Pattern: inline CandidateProc test fixtures for multi-cwd scenarios (Test 3) — neither cand nor cand_with_parent fits when per-fixture cwd differs"

requirements-completed:
  - AGNT-03

# Metrics
duration: 8min
completed: 2026-04-21
---

# Phase 18 Plan 01: Add parent-PID in-candidate-set filter Summary

**Drops subprocess children whose parent PID is itself an in-scope passive-scan candidate, collapsing the Phase 10 MCP-helper / node-shim / aitc-hook amplification shape to a single PASSIVE-{parent} entry per top-level agent.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-21T05:20:48Z
- **Completed:** 2026-04-21T05:28:28Z
- **Tasks:** 1 (decomposed into 7 atomic commits per user "commit-per-change" preference)
- **Files modified:** 1

## Accomplishments

- Parent-PID filter landed in `bridge_tick` between cwd-scope and reap/upsert — 4 lines of substantive logic + 8 lines of anchoring comment under the `Phase 18 D-02` annotation
- Flood regression proof: 1 parent + 50 allowlisted subprocess children now collapses to exactly 1 PASSIVE entry (Test 4 `flood_regression_parent_plus_many_children`)
- AGNT-03 preservation proof: externally-launched agent with shell/PID-1 parent still registers (Test 5 `externally_launched_with_shell_parent_still_registers`)
- Filter-order semantics locked: parent dropped by cwd-scope ⇒ child promoted to top-level (Test 3 `child_of_cwd_filtered_parent_is_promoted`)
- Orphan-retention semantics locked: `parent_pid = None` candidates always survive the filter (Test 2 `orphaned_child_with_no_parent_registers`)
- Zero regression: all 7 pre-existing passive_bridge tests pass; all 9 registry tests pass

## Task Commits

Each logical step committed atomically:

1. **Scaffold filter skeleton + cand_with_parent helper** — `7355a3f` (chore): added `candidate_pids: HashSet<u32>` build + identity placeholder filter + `cand_with_parent(pid, name, parent_pid)` test helper
2. **Wire filter predicate** — `82d8c54` (feat): replaced the identity placeholder with the `c.parent_pid ∈ candidate_pids → drop` predicate, None-branch retained
3. **Test: parent drops children** — `5e66f87` (test): Test 1 `parent_in_candidate_list_drops_subprocess_children` — claude(100) + claude-mcp(101, parent=100) + node-claude-helper(102, parent=100) ⇒ only PASSIVE-100 registers
4. **Test: orphaned child registers** — `5592be1` (test): Test 2 `orphaned_child_with_no_parent_registers` — `parent=None` branch retention
5. **Test: child-of-cwd-filtered-parent promoted** — `4d7de3b` (test): Test 3 `child_of_cwd_filtered_parent_is_promoted` — filter-order guard; inline CandidateProc fixtures because per-fixture cwd differs
6. **Test: flood regression (1 parent + 50 children)** — `706f110` (test): Test 4 `flood_regression_parent_plus_many_children` — `all_agents().await.len() == 1` is the primary invariant
7. **Test: AGNT-03 shell-parent preservation** — `525a3fe` (test): Test 5 `externally_launched_with_shell_parent_still_registers` — parent=PID 1 not in candidate_pids ⇒ top-level still registers

## Files Created/Modified

- `src-tauri/src/pipeline/passive_bridge.rs` — Parent-PID in-candidate-set filter added to `bridge_tick` (lines 107-124); 5 new `#[tokio::test]` functions + `cand_with_parent` helper added at end of `mod tests`

## Verification

### Test Suite (cargo test --lib)

- `pipeline::passive_bridge::tests` — **12/12 pass** (7 pre-existing + 5 new)
  - `passive_scan_bridge_upserts_passive_entries_for_live_pids` ✓
  - `passive_scan_bridge_classifies_by_registered_adapter` ✓
  - `passive_scan_bridge_does_not_overwrite_kagent_with_same_pid` ✓
  - `passive_scan_bridge_reaps_passives_whose_pids_disappear` ✓
  - `passive_bridge_writes_dedup_sentinel_on_first_claude_sighting` ✓
  - `passive_bridge_dedups_after_decision` ✓
  - `passive_bridge_skips_emit_for_non_claude_agent_type` ✓
  - `parent_in_candidate_list_drops_subprocess_children` ✓ **(new)**
  - `orphaned_child_with_no_parent_registers` ✓ **(new)**
  - `child_of_cwd_filtered_parent_is_promoted` ✓ **(new)**
  - `flood_regression_parent_plus_many_children` ✓ **(new)**
  - `externally_launched_with_shell_parent_still_registers` ✓ **(new)**
- `agents::registry::tests` — **9/9 pass** (no regression in the registry layer the filter ultimately feeds)

### Grep-verified acceptance criteria (all required by 18-01-PLAN <acceptance_criteria>)

| Check | Expected | Actual |
|-------|----------|--------|
| `candidate_pids.contains` inside bridge_tick | 1 hit | 1 hit at line 121 |
| `Phase 18 D-02` annotation present | ≥ 1 hit | 2 hits (filter block at 107, test section at 458) |
| `fn cand_with_parent` helper | 1 hit | 1 hit at line 267 |
| `c.parent_pid` (ProcessInfo field, not CandidateProc) | ≥ 1 hit | 1 hit at line 120 |
| `spawn_passive_bridge` signature unchanged | Same 6-arg list | Verified: `(registry, snapshot, repo_root, interval, pool, app)` at line 33-40 |

## Deviations from Plan

None. Plan executed exactly as written, with the task internally decomposed into 7 atomic commits per the user's commit-per-change preference (documented in MEMORY.md and the plan's `<plan_specific_notes>` guidance).

## Deferred Issues

Two tests in `src-tauri/src/conflict/engine.rs` fail on the full `cargo test --lib` run — pre-existing bugs from commit `ec769ba` (Phase 03 WR-01 wall-clock eviction fix), NOT caused by Phase 18 work.

See `deferred-items.md` in this phase directory for full analysis including proof-of-non-causation (`git diff --name-only 7355a3f^..HEAD` shows only `passive_bridge.rs` was modified in this plan's commits). Per MEMORY.md "Only fix own bugs" and the GSD executor SCOPE BOUNDARY rule, these are documented but NOT fixed here.

Failing tests (out of scope):
- `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
- `conflict::engine::tests::test_custom_window_duration`

## Known Stubs

None. The filter is fully wired; no placeholder data, no TODO markers, no empty renderers. The implementation is the final intended form per CONTEXT.md D-02.

## Phase-18 Context for Follow-on Plans

- **18-02** will add the `MAX_AGENTS=1000` doc-comment rewrite + `capacity_hits_since_start: AtomicU64` counter. Expected to touch `src-tauri/src/agents/registry.rs` only. This plan (18-01) does not modify `registry.rs` at all — verified.
- **18-03** will add the `get_registry_stats` Tauri command + `RegistryStats` struct + `lib.rs` registration. No coupling to 18-01's filter — the filter and the diagnostic endpoint are independent surfaces.
- **18-04** will be the capacity-ceiling safety-net formalization. Independent of 18-01.

The filter landed in 18-01 is load-bearing for all subsequent plans: with it in place, the `capacity_hits_since_start` counter that 18-02 introduces should stay at zero in normal operation — any non-zero reading indicates a NEW flood source beyond the three already accounted for (MCP helpers, node shims, aitc-hook fires).

## Self-Check: PASSED

**Files verified:**
- `src-tauri/src/pipeline/passive_bridge.rs` — FOUND (modified, 5 new tests, 1 new helper, 1 new filter block)
- `.planning/phases/18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma/deferred-items.md` — FOUND (created for out-of-scope conflict::engine failures)

**Commits verified:**
- `7355a3f` — FOUND (`chore(18-01): scaffold parent-PID filter skeleton + cand_with_parent helper`)
- `82d8c54` — FOUND (`feat(18-01): wire parent-PID filter predicate in bridge_tick`)
- `5e66f87` — FOUND (`test(18-01): add parent_in_candidate_list_drops_subprocess_children`)
- `5592be1` — FOUND (`test(18-01): add orphaned_child_with_no_parent_registers`)
- `4d7de3b` — FOUND (`test(18-01): add child_of_cwd_filtered_parent_is_promoted`)
- `706f110` — FOUND (`test(18-01): add flood_regression_parent_plus_many_children`)
- `525a3fe` — FOUND (`test(18-01): add externally_launched_with_shell_parent_still_registers`)

**Acceptance-criteria greps verified:** All 5 required grep patterns returned the expected hit counts in the post-commit file (see table above).

**Test suite verified:** 12/12 passive_bridge tests pass; 9/9 registry tests pass.

**Out-of-scope confirmation:** Only `src-tauri/src/pipeline/passive_bridge.rs` was modified across all 7 plan commits (`git diff --name-only 7355a3f^..HEAD`). No touches to `spawn_passive_bridge`, no touches to the capacity-hit coalesced warn, no touches to `process_snapshot.rs`.
