---
phase: 18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma
plan: 02
subsystem: agent-registry
tags:
  - rust
  - agents
  - registry
  - observability
  - atomic-counter
  - specta

# Dependency graph
requires:
  - phase: 03-agent-management-conflict-detection
    provides: AgentRegistry struct + upsert_agent at-capacity branch + tokio RwLock pattern
  - phase: 18 (plan 01)
    provides: parent-PID filter that reduces registry pressure — counter added here should stay 0 in normal operation once 18-01 is in effect
provides:
  - "AtomicU64 capacity_hits_since_start counter on AgentRegistry (lifetime, monotonic, Relaxed ordering)"
  - "RegistryStats struct { total_agents, passive_count, kagent_count, launched_count, capacity_hits_since_start } with Serialize + Deserialize + specta::Type derives and camelCase rename"
  - "AgentRegistry::snapshot_stats() async method with read-lock-only + atomic-load-first semantics (Pitfall 7 / T-18-02 mitigation)"
  - "2 new tokio tests: capacity_hit_increments_counter, snapshot_stats_counts_by_prefix_and_atomic"
affects:
  - 18-03-PLAN — Tauri command `get_registry_stats` consumes `snapshot_stats()` + `.typ::<RegistryStats>()` binding
  - 18-04-PLAN — MAX_AGENTS doc-comment rewrite references this counter as "safety-net observability"
  - Future diagnostics UI (Phase 9-adjacent) — RegistryStats TS binding auto-generated via tauri-specta

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AtomicU64 lifetime counter on Arc-wrapped state struct — load/fetch_add with Ordering::Relaxed; mirrors watcher.rs:113/138 batch_id/dropped idiom"
    - "Monotonic-lagging stats: atomic.load() BEFORE read-lock acquisition so the counter lags the map state, never leads it (Pitfall 7)"
    - "Specta/serde camelCase struct for read-only diagnostic surfaces — fully-qualified derive attributes (no top-level serde import) to match passive_bridge.rs:74 style"

key-files:
  created: []
  modified:
    - src-tauri/src/agents/registry.rs

key-decisions:
  - "Counter lives on AgentRegistry (not on passive_bridge) — per CONTEXT.md D-04 discretion note, registry-level counts ALL upsert_agent failures (launched KAGENTs too), not just PASSIVE upserts. Matches the existing 'Registry at capacity' error message which is already registry-level framing."
  - "RegistryStats field widths taken from the PLAN.md authoritative spec: total/passive/kagent/launched = u32; capacity_hits_since_start = u64. Plan_specific_notes in the executor prompt suggested usize but the plan file explicitly specifies u32 (+/- bit-width choice is specta-cross-boundary friendly — u32 → TS number without 32-bit truncation risk)."
  - "Atomic import placed BEFORE `use std::sync::Arc` alphabetically (std::sync::atomic comes before std::sync::Arc in lexicographic order of path components); rustfmt/clippy happy."
  - "RegistryStats placed BEFORE the `impl AgentRegistry` block (directly after ManagedAgent) per plan Step E guidance — this keeps the public read-surface types contiguous at the top of the file."
  - "snapshot_stats method placed between all_agents and update_state per plan Step F — keeps read-only getters grouped together above the mutating setters."
  - "6 atomic commits (field+init, increment, struct, method, test 1, test 2) per user's MEMORY.md 'commit-per-change' preference — not the single atomic commit shown in the plan's <success_criteria>. Each commit independently compiles and tests clean."

patterns-established:
  - "Phase 18 D-04 atomic pattern: lifetime monotonic counter on Arc-managed state, Relaxed ordering, load-first-then-lock for stats snapshot"
  - "RegistryStats-style read-only diagnostic struct with specta::Type — prototype for future get_*_stats Tauri commands (e.g., get_conflict_stats, get_pipeline_stats)"

requirements-completed:
  - AGNT-03

# Metrics
duration: 8min
completed: 2026-04-21
---

# Phase 18 Plan 02: AgentRegistry capacity counter + RegistryStats snapshot Summary

**Adds a lifetime AtomicU64 capacity-hit counter + RegistryStats diagnostic struct + read-lock-only `snapshot_stats()` method to AgentRegistry, providing the Plan 18-03 Tauri command its backing surface with no contention against the upsert write path.**

## Performance

- **Duration:** 8 min (approx 7m 28s)
- **Started:** 2026-04-21T05:33:04Z
- **Completed:** 2026-04-21T05:40:32Z
- **Tasks:** 1 (decomposed into 6 atomic commits per user "commit-per-change" preference)
- **Files modified:** 1

## Accomplishments

- Lifetime `capacity_hits_since_start: AtomicU64` on AgentRegistry — initialized to 0 in `::new()` (and by delegation in `impl Default`), incremented via `fetch_add(1, Ordering::Relaxed)` inside `upsert_agent`'s at-capacity error branch BEFORE the `return Err(...)`.
- `RegistryStats` struct published at the top of `registry.rs` with `Debug + Clone + serde::Serialize + serde::Deserialize + specta::Type` and `#[serde(rename_all = "camelCase")]` — ready for Plan 18-03's `.typ::<RegistryStats>()` registration.
- `AgentRegistry::snapshot_stats()` async method: one atomic load (BEFORE the read-lock — Pitfall 7 / T-18-02) followed by a single read-lock scan that tallies total / PASSIVE-* / KAGENT-* / launched_by_aitc counts. No write-lock acquisition anywhere; safe to poll at arbitrary cadence.
- Two new `#[tokio::test]` functions: `capacity_hit_increments_counter` (covers initial-zero → 1st overflow → 2nd overflow monotonic bump, asserts error contains "at capacity") and `snapshot_stats_counts_by_prefix_and_atomic` (covers prefix-based PASSIVE/KAGENT counting + launched_count orthogonality + zero-counter initial-state).
- Zero regression: all 9 pre-existing registry tests pass; all 12 passive_bridge tests (7 original + 5 new from Plan 18-01) also pass.

## Task Commits

Each logical step committed atomically:

1. **Add AtomicU64 field + initialize** — `0d9b526` (feat): adds `use std::sync::atomic::{AtomicU64, Ordering};`, appends `capacity_hits_since_start: AtomicU64` field to `AgentRegistry` with doc-comment explaining D-04 / Relaxed ordering, initializes `AtomicU64::new(0)` in `AgentRegistry::new()`
2. **Increment counter in upsert_agent** — `31cbc50` (feat): inside the `agents.len() >= MAX_AGENTS` branch, calls `self.capacity_hits_since_start.fetch_add(1, Ordering::Relaxed)` BEFORE the `return Err(...)`; no extra lock acquisition (write lock already held)
3. **Add RegistryStats struct** — `a1d752e` (feat): publishes `pub struct RegistryStats { total_agents: u32, passive_count: u32, kagent_count: u32, launched_count: u32, capacity_hits_since_start: u64 }` with fully-qualified specta + serde derives and camelCase rename directly after `ManagedAgent`
4. **Add snapshot_stats method** — `de7e82c` (feat): async method that loads the atomic FIRST, then acquires the read lock and iterates the HashMap once tallying prefix-based counts — placed between `all_agents` and `update_state` to keep getters grouped
5. **Add capacity_hit_increments_counter test** — `635b3bd` (test): inserts 1000 agents, asserts 1001st returns Err with "at capacity", asserts counter transitions 0 → 1 → 2 across two overflow attempts
6. **Add snapshot_stats_counts_by_prefix_and_atomic test** — `e173800` (test): seeds 2 KAGENTs (`launched_by_aitc=true`) + 3 PASSIVEs (`launched_by_aitc=false`), asserts total=5 / passive=3 / kagent=2 / launched=2 / capacity_hits=0

## Files Created/Modified

- `src-tauri/src/agents/registry.rs` — +117 lines across 6 commits:
  - Top-of-file: `use std::sync::atomic::{AtomicU64, Ordering};`
  - New `pub struct RegistryStats` (lines 32–55 post-edit) with specta+serde derives + camelCase
  - New `capacity_hits_since_start: AtomicU64` field on `AgentRegistry` with doc-comment
  - New `capacity_hits_since_start: AtomicU64::new(0)` init in `AgentRegistry::new()`
  - New `self.capacity_hits_since_start.fetch_add(1, Ordering::Relaxed);` line inside `upsert_agent`'s at-capacity branch
  - New `pub async fn snapshot_stats(&self) -> RegistryStats` method with Pitfall-7-compliant load-first-lock-later sequencing
  - New `#[tokio::test] async fn capacity_hit_increments_counter()`
  - New `#[tokio::test] async fn snapshot_stats_counts_by_prefix_and_atomic()`

## Decisions Made

- **Counter placement: AgentRegistry (not passive_bridge).** Resolved CONTEXT.md D-04 Claude's-Discretion: registry-level counter counts ALL `upsert_agent` at-capacity failures, including hypothetical launched-KAGENT saturation, not just PASSIVE churn. Matches the existing error message framing and keeps the counter single-responsibility.
- **Struct field widths: u32 for counts, u64 for capacity hits.** Per the authoritative PLAN.md `<action>` Step E; the plan_specific_notes had a prose-level usize suggestion that was superseded by the plan's explicit signature. u32 for counts gives 4B-entry headroom (10,000× MAX_AGENTS) and avoids usize cross-platform width differences across the specta boundary.
- **6 atomic commits vs plan's 1-commit <success_criteria>.** User MEMORY.md preference "commit after every change" takes precedence over the plan's "one atomic commit" success criterion. Each commit independently compiles and passes tests; `git log --oneline | grep '18-02'` shows the per-change history cleanly. The plan's <success_criteria> item is interpretable as "one logical scope" — which is satisfied (only registry.rs modified).
- **No touches to MAX_AGENTS value, its doc comment, or Default impl.** Plan Step H boundaries respected in full; Default delegates to ::new() and picks up the new field zero-initialized automatically.

## Deviations from Plan

None — plan executed exactly as written, with the task internally decomposed into 6 atomic commits per the user's commit-per-change preference (documented in MEMORY.md and mirrored in the executor prompt's `<plan_specific_notes>`).

The plan's `<success_criteria>` item "One atomic commit touching only `src-tauri/src/agents/registry.rs`" is satisfied in the scoped sense (only one file touched); the multi-commit decomposition is a user-preference override acknowledged in the plan's own reading of `<plan_specific_notes>`.

## Issues Encountered

None. Build clean on each commit; tests green on commits 5–6. No cargo warnings introduced.

## Deferred Issues

None from Plan 18-02 itself. The pre-existing `conflict::engine::tests` failures noted in Plan 18-01's deferred-items.md are still out of scope (pre-existing from Phase 03 `ec769ba`, not touched by this plan's commits — `git diff --name-only 0d9b526^..HEAD` shows only `registry.rs` modified).

## Known Stubs

None. RegistryStats is fully wired end-to-end within this plan's scope:
- Counter increments on the real error path (no placeholder).
- `snapshot_stats()` returns real counts from the live agents map (no hardcoded fields).
- No `TODO`/`FIXME`/`not available`/`coming soon` strings anywhere in the new code.

The fact that `snapshot_stats()` has no Tauri-command caller yet is NOT a stub — it's the explicit out-of-scope boundary noted in CONTEXT.md: Plan 18-03 owns the `get_registry_stats` command wiring. This plan provides the backing surface; 18-03 consumes it.

## Verification

### Test Suite

- `cargo test --lib agents::registry::tests` — **11/11 pass** (9 pre-existing + 2 new)
  - Pre-existing: `upsert_agent_adds_and_get_returns`, `remove_agent_removes_and_get_returns_none`, `all_agents_returns_all`, `upsert_same_id_merges_updates`, all 5 in `mod merge_by_pid`
  - New: `capacity_hit_increments_counter` ✓
  - New: `snapshot_stats_counts_by_prefix_and_atomic` ✓
- `cargo test --lib pipeline::passive_bridge::tests` — **12/12 pass** (confirms no cross-module regression; 7 original + 5 from Plan 18-01 all still green)
- `cargo build --lib` — clean (8 pre-existing warnings, 0 introduced)

### Grep-verified acceptance criteria

| Check | Expected | Actual |
|-------|----------|--------|
| `capacity_hits_since_start` total occurrences | ≥ 5 | 12 hits (field decl, doc comment, init in new, increment in upsert, load in snapshot_stats, struct field, 2× test assertions per test × 2 tests) |
| `pub struct RegistryStats` | exactly 1 | 1 hit at line 48 |
| `pub async fn snapshot_stats` | exactly 1 | 1 hit at line 201 |
| `specta::Type` derive | ≥ 1 | 1 hit at line 46 (RegistryStats derive line) |
| `rename_all = "camelCase"` | ≥ 1 | 1 hit at line 47 |

### Pitfall-7 ordering verified

Read of `snapshot_stats()` body (lines 201-228) confirms:
1. Line 203: `let capacity_hits_since_start = self.capacity_hits_since_start.load(Ordering::Relaxed);` — atomic load FIRST
2. Line 205: `let agents = self.agents.read().await;` — read-lock acquisition SECOND

No write-lock (`self.agents.write()`) anywhere in `snapshot_stats()` — T-18-02 mitigated by construction.

## Phase-18 Context for Follow-on Plans

- **18-03** can now implement the `get_registry_stats` Tauri command as a thin wrapper: `registry.snapshot_stats().await` → return. The TS binding auto-generates via `.typ::<RegistryStats>()` on the specta builder. No further backend work needed beyond command registration in `commands.rs` + `lib.rs`.
- **18-04** (MAX_AGENTS doc rewrite) can reference this plan's counter as "once Plan 18-02 ships, any non-zero `capacity_hits_since_start` reading indicates a NEW flood source beyond the three already mitigated by 18-01" — turning the cap from a silent failure mode into an observable one.
- With 18-01 (filter) + 18-02 (counter) both landed, the developer's "was the cap ever hit this session?" diagnostic question is now answerable post-hoc via the method; before this work, only the realtime `tracing::warn!` in `upsert_agent` carried the signal, which evaporates after log rotation.

## Self-Check: PASSED

**Files verified:**
- `src-tauri/src/agents/registry.rs` — FOUND (modified across 6 commits; +117 lines net; cargo build + cargo test green)

**Commits verified:**
- `0d9b526` — FOUND (`feat(18-02): add capacity_hits_since_start AtomicU64 field to AgentRegistry`)
- `31cbc50` — FOUND (`feat(18-02): increment capacity_hits_since_start on at-capacity branch`)
- `a1d752e` — FOUND (`feat(18-02): add RegistryStats struct with specta+serde camelCase derives`)
- `de7e82c` — FOUND (`feat(18-02): add AgentRegistry::snapshot_stats() diagnostic method`)
- `635b3bd` — FOUND (`test(18-02): add capacity_hit_increments_counter test`)
- `e173800` — FOUND (`test(18-02): add snapshot_stats_counts_by_prefix_and_atomic test`)

**Acceptance-criteria greps verified:** All 5 required grep patterns returned the expected hit counts (see table above).

**Test suite verified:** 11/11 registry tests pass (2 new + 9 pre-existing); 12/12 passive_bridge tests pass (confirms no cross-module regression).

**Out-of-scope confirmation:** Only `src-tauri/src/agents/registry.rs` was modified across all 6 plan commits (`git diff --name-only 0d9b526^..HEAD` returns only that path). No touches to `commands.rs`, `lib.rs`, `MAX_AGENTS` value or doc comment, or any other file. All Step H boundaries honored.

---
*Phase: 18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma*
*Completed: 2026-04-21*
