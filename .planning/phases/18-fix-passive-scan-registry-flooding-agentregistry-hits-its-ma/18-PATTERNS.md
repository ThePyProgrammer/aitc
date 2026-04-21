# Phase 18: Fix Passive-Scan Registry Flooding — Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 4 modified + 1 auto-regenerated
**Analogs found:** 4 / 4 (all modifications have strong in-repo analogs)

Phase 18 is a **backend-only, modify-in-place** phase. No new Rust modules,
no new frontend files. Every edit has a concrete, line-numbered analog already
living in the same file (or a sibling file in the same module). The planner's
job is to copy the analog's shape and insert the Phase-18 addition, not to
invent new structure.

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src-tauri/src/pipeline/passive_bridge.rs` | pipeline task (bridge tick) | batch / tick-driven transform | **self** — existing cwd-scope filter lines 99–105; seeded-snapshot tests lines 238–263 | exact (in-file pattern extension) |
| `src-tauri/src/agents/registry.rs` | service / shared state | request-response (async getters) + atomic counters | **self** — existing `upsert_agent` at lines 61–92; `AtomicU64` pattern from `pipeline/watcher.rs:113, 138` and `conflict/types.rs:40, 50` | exact (in-file pattern extension + cross-file atomic idiom) |
| `src-tauri/src/agents/commands.rs` | Tauri command (controller) | request-response (IPC) | **self** — `list_agents` at lines 22–29 | exact (copy-paste shape) |
| `src-tauri/src/lib.rs` | wiring / app bootstrap | config registration | **self** — `collect_commands![...]` at lines 42–97, `.typ::<...>()` chain at lines 98–135 | exact (append to existing lists) |
| `src/bindings.ts` (auto) | generated TS bindings | n/a | emitted by `tauri-specta` on `cargo build` in debug mode (lib.rs:137–145) | n/a |

## Pattern Assignments

### `src-tauri/src/pipeline/passive_bridge.rs` (pipeline task, batch/tick-driven transform)

**Analog:** Same file — the existing cwd-scope filter immediately above the
insertion point.

#### Existing cwd-scope filter to layer on top of (lines 99–105):

```rust
let in_scope: Vec<_> = candidates
    .into_iter()
    .filter(|c| match (repo_root, c.cwd.as_ref()) {
        (Some(root), Some(cwd)) => cwd.starts_with(root),
        _ => true, // no root known -> keep the previous behaviour
    })
    .collect();
```

**Pattern to copy:** `let in_scope: Vec<_> = in_scope.into_iter().filter(...).collect();`
— same `Vec<_>` shadow + same `.filter(|c| ...)` predicate shape. The new
parent-PID filter is a second `.filter + .collect` layered after this one
(Example 1 from RESEARCH.md reproduces the exact four-liner).

#### Existing HashSet-per-tick pattern to mirror (lines 107–110):

```rust
let mut live_pids: HashSet<u32> = HashSet::with_capacity(in_scope.len());
for c in &in_scope {
    live_pids.insert(c.pid);
}
```

**Pattern to copy for `candidate_pids`:** build a `HashSet<u32>` once per
tick from the **post-cwd-scope** `in_scope` list, **before** the reap step.
The `candidate_pids` HashSet serves the filter; the existing `live_pids`
HashSet (still fed from the **final, post-parent-filter** `in_scope`) serves
the reap — two separate sets with different populations is intentional.

Critical ordering (per CONTEXT.md D-02 + RESEARCH.md Pitfall 4):
1. cwd-scope filter (existing, lines 99–105) →
2. build `candidate_pids: HashSet<u32>` from post-cwd `in_scope` →
3. parent-PID filter that drops `c.parent ∈ candidate_pids` →
4. build `live_pids: HashSet<u32>` from the **final** `in_scope` (move
   the existing lines 107–110 AFTER the new filter, or keep it where it
   is but re-initialize from the filtered list) →
5. existing `reap_passive_agents` + upsert loop (unchanged).

#### Existing coalesced capacity-hit pattern to preserve (lines 158–162, 223–228):

```rust
if let Err(e) = &upsert_result {
    if e.contains("at capacity") {
        capacity_hit += 1;
    } else {
        tracing::warn!(pid = c.pid, error = %e, "passive upsert failed");
    }
}
// ... after the loop ...
if capacity_hit > 0 {
    tracing::warn!(
        skipped = capacity_hit,
        "passive_bridge: registry at capacity, agents skipped this tick (tighten allowlist or raise MAX_AGENTS)"
    );
}
```

**Pattern to preserve:** leave this verbatim. The Phase 18 addition is
**inside** `AgentRegistry::upsert_agent` (which increments
`capacity_hits_since_start` on every capacity-hit, including launched-agent
failures) — not here. This bridge-side coalesced log is the "right now"
signal; the registry atomic is the "since start" signal. They serve
different questions (D-04).

#### Test fixture pattern (lines 238–263):

```rust
fn cand(pid: u32, name: &str) -> CandidateProc {
    CandidateProc {
        pid,
        name: name.into(),
        cwd: PathBuf::from("/tmp/test-cwd"),
        exe: None,
        parent: None,
    }
}

fn seeded_snapshot(candidates: Vec<CandidateProc>) -> Arc<RwLock<ProcessSnapshot>> {
    Arc::new(RwLock::new(ProcessSnapshot::from_candidates_for_test(candidates)))
}

#[tokio::test]
async fn passive_scan_bridge_upserts_passive_entries_for_live_pids() {
    let reg = Arc::new(AgentRegistry::new());
    let snap = seeded_snapshot(vec![cand(111, "claude-code"), cand(222, "codex")]);
    bridge_tick(&reg, &snap, None, None, None).await.unwrap();
    let p1 = reg.get_agent("PASSIVE-111").await.expect("PASSIVE-111 missing");
    assert_eq!(p1.agent_type, "unknown");
    ...
}
```

**Pattern for new tests:**
- Reuse the existing `cand(pid, name)` helper for parentless candidates.
- Add a sibling helper `cand_with_parent(pid, name, parent_pid)` (or
  `cand_child(...)`) that builds a `CandidateProc` with
  `parent: Some(parent_pid)` — do NOT modify the existing `cand` (6+ tests
  depend on the `parent: None` default per RESEARCH.md Pitfall 6).
- Continue calling `bridge_tick(&reg, &snap, None, None, None).await.unwrap()`
  — the signature is stable.
- For the "parent out-of-scope by cwd" test, use `cand_with_parent(child, ..., Some(parent_pid))`
  but seed the parent with a `cwd: PathBuf::from("/not/watched/repo")` and
  pass `Some(Path::new("/tmp/test-cwd"))` as the repo_root so the parent is
  dropped by cwd-scope before reaching the parent-PID filter — then assert
  `PASSIVE-{child}` IS registered (promotion semantic).

#### Tests to add (from RESEARCH.md §"Phase Requirements → Test Map"):

| Test name | Intent |
|-----------|--------|
| `parent_in_candidate_list_drops_subprocess_children` | Parent (pid=100) + two subprocess children (pids 101, 102 with `parent=Some(100)`) → only `PASSIVE-100` exists. |
| `orphaned_child_with_no_parent_registers` | Candidate with `parent=None` still registers (keep the `None` → true branch working). |
| `child_of_cwd_filtered_parent_is_promoted` | Parent filtered by cwd-scope + child in-scope → child gets PASSIVE entry (filter order test). |
| `flood_regression_parent_plus_many_children` | 1 parent + 50 children with shared allowlisted name → exactly 1 PASSIVE entry, zero capacity errors. |
| `externally_launched_with_shell_parent_still_registers` | AGNT-03 preservation: `parent=Some(1)` (PID 1 not in candidate list) → registers normally. |

---

### `src-tauri/src/agents/registry.rs` (service / shared state)

**Analog:** Same file (existing `upsert_agent` + `AgentRegistry` shape) + cross-file
atomic counter idiom from `pipeline/watcher.rs` and `conflict/types.rs`.

#### Existing `upsert_agent` at-capacity branch (lines 61–92):

```rust
pub async fn upsert_agent(
    &self,
    id: String,
    info: AgentInfo,
    adapter: Arc<dyn AgentAdapter>,
    launched_by_aitc: bool,
) -> Result<(), String> {
    let mut agents = self.agents.write().await;
    if let Some(existing) = agents.get_mut(&id) {
        // Merge: update info but keep stdout_buffer
        existing.info = info;
        existing.adapter = adapter;
        existing.launched_by_aitc = launched_by_aitc;
        Ok(())
    } else {
        if agents.len() >= MAX_AGENTS {
            return Err(format!(
                "Registry at capacity ({MAX_AGENTS}). Cannot add agent '{id}'"
            ));
        }
        agents.insert(id, ManagedAgent { ... });
        Ok(())
    }
}
```

**Pattern to extend:** insert `self.capacity_hits_since_start.fetch_add(1, Ordering::Relaxed);`
on the `agents.len() >= MAX_AGENTS` branch, **before** the `return Err(...)`.
The write-lock is already held; the atomic increment does not require it,
but placing it here centralizes the accounting at the exact point of failure
regardless of caller (passive bridge, launch_agent, self_register all share
this path).

#### AtomicU64 counter idiom — cross-file analog (`pipeline/watcher.rs:113, 138`):

```rust
// Declaration (line 113):
let batch_id_counter = Arc::new(AtomicU64::new(0));

// Increment (line 138):
dropped_clone.fetch_add(1, Ordering::Relaxed);
```

And (`conflict/types.rs:40, 50`):

```rust
// Struct field declaration (line 40):
pub struct ConflictDetectorConfig {
    ...
    window_ms: AtomicU64,
}

// Init in constructor (line 50):
impl ConflictDetectorConfig {
    pub fn new(window_ms: u64) -> Self {
        Self {
            ...
            window_ms: AtomicU64::new(window_ms),
        }
    }
}
```

**Pattern to copy verbatim:**
1. `use std::sync::atomic::{AtomicU64, Ordering};` at top of `registry.rs`.
2. Add `capacity_hits_since_start: AtomicU64,` as a new field on
   `pub struct AgentRegistry` (after `adapters: Vec<...>`).
3. Initialize in `AgentRegistry::new()`:
   `capacity_hits_since_start: AtomicU64::new(0),`.
4. Increment on the capacity-hit branch:
   `self.capacity_hits_since_start.fetch_add(1, Ordering::Relaxed);`.
5. Read in `snapshot_stats`:
   `self.capacity_hits_since_start.load(Ordering::Relaxed)`.

#### Specta-derived stats struct — cross-file analog (`pipeline/process_snapshot.rs:42–50`):

```rust
/// Frontend-facing process info (serializable via specta).
///
/// `parent_pid` is serialized as `parentPid` by the camelCase rename rule.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cwd: Option<PathBuf>,
    pub exe: Option<PathBuf>,
    pub parent_pid: Option<u32>,
}
```

And also `AgentInfo` at `agents/adapter.rs:97–108`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub agent_type: String,
    ...
}
```

**Pattern to copy for `RegistryStats`:**

```rust
/// Read-only diagnostic snapshot of the agent registry. Counts are by ID-prefix
/// convention (PASSIVE-*, KAGENT-*); `capacity_hits_since_start` is a monotonic
/// lifetime counter incremented on every `upsert_agent` at-capacity failure.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegistryStats {
    pub total_agents: u32,
    pub passive_count: u32,
    pub kagent_count: u32,
    pub launched_count: u32,
    pub capacity_hits_since_start: u64,
}
```

Use the local `use serde::{Deserialize, Serialize}; use specta::Type;` import
convention from `process_snapshot.rs:19–20` (the module-level `use` statements
keep derive attrs short), or the fully-qualified `#[derive(..., serde::Serialize, serde::Deserialize, specta::Type)]`
shape already used in `passive_bridge.rs:74` for `PassiveClaudeDetectedPayload`.
Either works; pick whichever is already present in the file's existing imports
(registry.rs currently has no `serde` imports, so fully-qualified derives
avoid adding a top-of-file `use`).

#### `snapshot_stats` method — read-lock + atomic load shape (RESEARCH.md §"Example 2", Pitfall 7):

**Pattern to copy:** read the atomic **before** acquiring the read lock so any
concurrent upsert failure that races with the snapshot reflects in the *next*
call, not this one (monotonic-lagging, never "from the future" — see Pitfall 7).

```rust
impl AgentRegistry {
    /// Read-only diagnostic snapshot — single read-lock acquisition + one
    /// atomic load. Safe to call at any cadence; does not contend with the
    /// upsert path.
    pub async fn snapshot_stats(&self) -> RegistryStats {
        let capacity_hits_since_start =
            self.capacity_hits_since_start.load(Ordering::Relaxed);
        let agents = self.agents.read().await;
        let total_agents = agents.len() as u32;
        let mut passive_count = 0u32;
        let mut kagent_count = 0u32;
        let mut launched_count = 0u32;
        for (id, managed) in agents.iter() {
            if id.starts_with("PASSIVE-") { passive_count += 1; }
            else if id.starts_with("KAGENT-") { kagent_count += 1; }
            if managed.launched_by_aitc { launched_count += 1; }
        }
        RegistryStats {
            total_agents,
            passive_count,
            kagent_count,
            launched_count,
            capacity_hits_since_start,
        }
    }
}
```

This mirrors the existing `all_agents` method's single-read-lock acquisition
pattern (lines 142–149) but iterates to count by prefix instead of cloning
out the vec.

#### `MAX_AGENTS` doc-comment rewrite (lines 12–20):

**Current doc comment:**

```rust
/// Maximum number of agents the registry will accept (T-03-03 mitigation).
///
/// Raised 100 → 1000 pending Phase 18 (passive-scan flooding). The original
/// 100 was set when passive detection was young and the worst case was a
/// couple of PASSIVE-{pid} entries per repo. Phase 10's long-lived sessions
/// + any developer running multiple claude CLIs machine-wide overflow it
/// within seconds of boot. 1000 is a cheap safety net — HashMap handles it
/// trivially — and Phase 18 will properly scope passive registration.
const MAX_AGENTS: usize = 1000;
```

**Pattern to replace with** (from RESEARCH.md Example 5 — includes *why 1000*,
*why not 100*, *why not configurable*, and a forward-pointer to the new
`capacity_hits_since_start` counter for runtime observability). Do not change
the value — only the doc comment body.

#### Tests to add (from RESEARCH.md §"Phase Requirements → Test Map"):

| Test name | Intent |
|-----------|--------|
| `capacity_hit_increments_counter` | Insert 1000 unique agents (loop), 1001st returns capacity error AND `snapshot_stats().capacity_hits_since_start == 1` (or == N for N attempts past cap). |
| `snapshot_stats_counts_by_prefix_and_atomic` | Seed 2 KAGENT + 3 PASSIVE + 1 launched_by_aitc=true entry, trigger one capacity hit, assert every field of the returned struct matches the expectation. |

Reuse the existing `TestAdapter` + `info_with_pid` + `dummy_adapter` helpers
already in the `mod tests` block (lines 280–425). Follow the `#[tokio::test]`
+ `AgentRegistry::new()` + `upsert_agent(...)` idiom established across the
existing tests.

---

### `src-tauri/src/agents/commands.rs` (Tauri command, controller)

**Analog:** `list_agents` in the same file at lines 22–29.

#### `list_agents` pattern to copy verbatim (lines 22–29):

```rust
/// List all currently tracked agents.
#[tauri::command]
#[specta::specta]
pub async fn list_agents(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<AgentInfo>, String> {
    Ok(registry.all_agents().await)
}
```

**Pattern to copy for `get_registry_stats`:**

```rust
/// Read-only diagnostic: snapshot of the agent registry counts + lifetime
/// capacity-hit counter. Safe to call at any cadence; single read-lock
/// acquisition. Intended for post-hoc debugging of "why did KAGENT launch
/// fail with 'Registry at capacity'" questions.
#[tauri::command]
#[specta::specta]
pub async fn get_registry_stats(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<crate::agents::registry::RegistryStats, String> {
    Ok(registry.snapshot_stats().await)
}
```

The only differences from `list_agents`: return type (`RegistryStats` instead
of `Vec<AgentInfo>`), inner call (`snapshot_stats()` instead of `all_agents()`).
Same `#[tauri::command] #[specta::specta]` attribute pair, same
`tauri::State<'_, Arc<AgentRegistry>>` parameter, same `Result<_, String>`
return shape. Place the new command near `list_agents` (top of file) for
discoverability.

A unit test (`#[tokio::test]`) for the command body is trivially derivable
from the `list_agents_returns_empty_for_new_registry` pattern at line 509 —
but per CONTEXT.md D-05 (Claude's Discretion) this is optional; the
`snapshot_stats_counts_by_prefix_and_atomic` test in `registry.rs` already
exercises the underlying method. Planner can skip or include.

---

### `src-tauri/src/lib.rs` (wiring, 2 new lines)

**Analog:** Same file — existing `collect_commands![...]` at lines 42–97 and
existing `.typ::<...>()` chain at lines 98–135.

#### Command registration pattern (lines 52–57 — agents/commands.rs handlers):

```rust
agents::commands::list_agents,
agents::commands::list_available_agent_types,
agents::commands::launch_agent,
agents::commands::terminate_agent,
agents::commands::update_agent_intent,
agents::commands::get_agent_logs,
```

**Pattern to extend:** add one line to the `collect_commands![...]` macro,
next to the other `agents::commands::*` entries (grouped for readability):

```rust
agents::commands::get_registry_stats,
```

#### Type registration pattern (lines 106–109):

```rust
.typ::<agents::AgentInfo>()
.typ::<agents::AgentState>()
.typ::<agents::adapter::LaunchOptions>()
.typ::<agents::notifications::NotificationPrefs>()
```

**Pattern to extend:** add one line to the `.typ::<...>()` chain (it doesn't
matter where in the chain — specta only needs each type registered once).
Recommend adjacent to the existing `agents::*` types:

```rust
.typ::<agents::registry::RegistryStats>()
```

No other changes to `lib.rs`. No changes to `.manage(...)` (the registry is
already managed state — lines 39 + 158), no changes to `.plugin(...)`, no
changes to the startup/splash/self-register block.

---

### `src/bindings.ts` (auto-regenerated, zero manual edits)

**Analog:** emitted by `tauri-specta` on `cargo build` in debug mode via the
existing wiring at `lib.rs:137–145`:

```rust
#[cfg(debug_assertions)]
specta_builder
    .export(
        specta_typescript::Typescript::default()
            .header("// @ts-nocheck\n...")
            .bigint(specta_typescript::BigIntExportBehavior::Number),
        "../src/bindings.ts",
    )
    .expect("failed to export specta bindings");
```

After the command + type are added to `lib.rs`, run `cargo build` inside
`src-tauri/` (or `cargo test --lib` — also triggers the export) to refresh
the TS binding. Do not hand-edit this file. Phase 18 has no frontend consumer;
the regenerated binding is dead code until a future UI phase (Phase 9 / a
successor) imports `commands.getRegistryStats()`.

---

## Shared Patterns

### Specta + serde derive with camelCase rename

**Source:** `src-tauri/src/agents/adapter.rs:98–108` (`AgentInfo`) and
`src-tauri/src/pipeline/process_snapshot.rs:42–50` (`ProcessInfo`).

**Apply to:** `RegistryStats` in `registry.rs`.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
```

The `camelCase` rename is mandatory — every serialized struct in the Rust →
TS IPC boundary uses it, and the existing TS consumers all assume it.

### AtomicU64 counter on shared async struct

**Source:** `src-tauri/src/conflict/types.rs:4, 40, 50` (struct field form)
and `src-tauri/src/pipeline/watcher.rs:113, 138` (`.fetch_add(1, Ordering::Relaxed)`).

**Apply to:** `capacity_hits_since_start` on `AgentRegistry`.

```rust
use std::sync::atomic::{AtomicU64, Ordering};
// field:
capacity_hits_since_start: AtomicU64,
// init:
capacity_hits_since_start: AtomicU64::new(0),
// increment (on error path):
self.capacity_hits_since_start.fetch_add(1, Ordering::Relaxed);
// read:
self.capacity_hits_since_start.load(Ordering::Relaxed);
```

`Ordering::Relaxed` is the project idiom for monotonic counters where no
happens-before relationship with other memory is required. Do NOT use
`SeqCst` or `AcqRel` — overkill and inconsistent with existing usage.

### Tauri command shape (read-only)

**Source:** `src-tauri/src/agents/commands.rs:22–29` (`list_agents`).

**Apply to:** `get_registry_stats` in `commands.rs`.

```rust
#[tauri::command]
#[specta::specta]
pub async fn <name>(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<<ReturnType>, String> {
    Ok(registry.<method>().await)
}
```

Thin wrapper over a registry method. No validation logic. No direct DB
access. No app handle unless the command emits events (this one doesn't).

### Tauri command registration + specta type export

**Source:** `src-tauri/src/lib.rs:42–97` (`collect_commands![...]`) and
`src-tauri/src/lib.rs:98–135` (`.typ::<...>()` chain).

**Apply to:** appending one command line + one type line for Phase 18.

```rust
// In collect_commands![] macro body:
agents::commands::get_registry_stats,

// In the .typ::<...>() chain:
.typ::<agents::registry::RegistryStats>()
```

### Unit tests via seeded ProcessSnapshot

**Source:** `src-tauri/src/pipeline/passive_bridge.rs:238–263` (`cand` +
`seeded_snapshot` helpers + `#[tokio::test]` drive of `bridge_tick`).

**Apply to:** all four new `passive_bridge` tests (plus one AGNT-03
preservation test).

- Keep `cand(pid, name)` for parent-less fixtures (do not modify).
- Add a sibling `cand_with_parent(pid, name, parent_pid)` helper — minimal,
  next to `cand`.
- Drive via `bridge_tick(&reg, &snap, None, None, None).await.unwrap()`;
  pass `Some(&repo_root)` when testing cwd-scope interaction.
- Assert state by calling `reg.get_agent("PASSIVE-{pid}").await` and
  checking `Some`/`None`.

### Registry tests via TestAdapter

**Source:** `src-tauri/src/agents/registry.rs:280–323` (`TestAdapter`),
`src-tauri/src/agents/registry.rs:324–333` (`make_info`).

**Apply to:** the two new `registry.rs` tests (`capacity_hit_increments_counter`,
`snapshot_stats_counts_by_prefix_and_atomic`).

- Reuse `TestAdapter::new("test", vec!["test"])` for the adapter Arc.
- Reuse `make_info` (or the sibling `info_with_pid` at line 411) for
  `AgentInfo` construction.
- Loop with `for i in 0..1000 { reg.upsert_agent(format!("a{i}"), ...).await.unwrap(); }`
  for the capacity test.
- Assert via `reg.snapshot_stats().await.capacity_hits_since_start == 1`
  after the 1001st insert fails.

## No Analog Found

None. Every Phase 18 change extends an existing pattern in the same file
or a sibling file in the same crate.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | — |

## Metadata

**Analog search scope:**
- `src-tauri/src/pipeline/passive_bridge.rs` (SUT for D-01/D-02)
- `src-tauri/src/pipeline/process_snapshot.rs` (data source + test seam)
- `src-tauri/src/agents/registry.rs` (SUT for D-03/D-04 counter + stats)
- `src-tauri/src/agents/commands.rs` (Tauri command template)
- `src-tauri/src/agents/adapter.rs` (AgentInfo specta+serde derive template)
- `src-tauri/src/lib.rs` (command + type registration template)
- `src-tauri/src/pipeline/watcher.rs` (AtomicU64 usage analog)
- `src-tauri/src/conflict/types.rs` (AtomicU64 on-struct-field analog)

**Files scanned:** 8 Rust source files directly; 2 targeted Grep sweeps
(`AtomicU64`, `#[derive(.*specta::Type`) across `src-tauri/src/`.

**Pattern extraction date:** 2026-04-21

## PATTERN MAPPING COMPLETE
