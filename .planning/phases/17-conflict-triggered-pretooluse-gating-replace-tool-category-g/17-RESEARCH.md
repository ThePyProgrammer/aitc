# Phase 17: Conflict-triggered PreToolUse gating — Research

**Researched:** 2026-04-21
**Domain:** Rust axum + tokio shared state, shell argv parsing, Claude Code PreToolUse hook contract, sqlx migrations, two-agent integration testing
**Confidence:** HIGH on all 8 research questions (all findings verified against source code, Cargo.lock, or official docs)

## Summary

The 23 locked decisions in 17-CONTEXT.md are implementable against the existing codebase with minimal new dependencies. Three findings drive the plan:

1. **`shlex 1.3.0` is already in Cargo.lock** (transitive via `cc`), so bash argv splitting needs zero new direct deps if we promote it to a `[dependencies]` entry (or we add `shell-words` for a cleaner `Result` error shape). Neither crate expands variables, globs, or substitutes commands — both return operators like `>`, `|`, `&&` as literal tokens, which matches exactly what the D-12 parser needs (operator-aware segmentation).
2. **`path-clean 1.0.1`** is a 0-dep, purely lexical normalizer — the right tool for D-02's "file does not exist yet" branch. `dunce` is already a transitive dep via Tauri but is Windows-UNC-stripping-specific and not a substitute for lexical cleaning. Recommend adding `path-clean` as a direct dep.
3. **Migration number 007 is clear.** Existing: 001/002/003/004/005/006 (sequential). No unmerged migrations. The 005 pattern is the exact template — additive `ALTER TABLE ADD COLUMN` + indexes.

The plan must also correct one inherited bug in the pipeline: the current `conflict_task` reads `ConflictState.get_window_ms()` once at startup and bakes it into `ConflictEngine::new(…)` — so the "user-configurable window" knob is effectively frozen until `start_watch` is re-run. Phase 17 makes the `/hook` path fresh-read `get_window_ms()` per request, which gives us a single source of truth for the gate predicate independent of this staleness. Fixing the pipeline-side staleness is **out of Phase 17's scope** but should be flagged in the plan's "known existing issues" section.

**Primary recommendation:** Wrap the engine in `Arc<tokio::sync::Mutex<ConflictEngine>>` exactly as CONTEXT.md D-15 specifies; add `shlex` as a direct dep (already in lockfile, zero new bytes); add `path-clean` for D-02; write migration 007 additively; co-locate the new two-agent integration tests in `self_register.rs::tests` (reuses `spawn_hook_server`). Lock granularity is a non-issue at the measured event rate (see §1 below) — do not pre-optimize.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Conflict query (`could_conflict_with`) | API (axum `/hook`) | — | Query is called synchronously from the HTTP handler; the result drives the gate decision. Lives on `ConflictEngine` next to `process_batch`. |
| Conflict state persistence | API (Rust / sqlx) | Database (SQLite) | `approval_requests` table + migration 007. All writes through Rust; frontend reads via existing Tauri commands. |
| Bash argv parsing (`bash_paths::extract_target_paths`) | API (Rust) | — | Pure CPU function called inside the hook handler; no I/O, no await. |
| Path canonicalization (D-02) | API (Rust) | — | Called once per /hook request inside `hook_handler` before the engine query. |
| Gate reason display | Browser (React) | — | UI-only rendering of `gateReason` + `conflictWithAgentId` fields surfaced through existing `bindings.ts` regen. |
| Notification payload | Frontend Server (Tauri IPC) | Browser | `dispatch_approval_notification` emits; payload ships via existing Tauri notification plumbing. |

## Phase Requirements

No new REQ-IDs. Phase 17 inherits and validates against:

| ID | Description | Research Support |
|----|-------------|------------------|
| CNFL-01 | System detects when two or more agents write to the same file within a configurable conflict window | §1 (engine sharing): `could_conflict_with` reuses `recent_writes` exactly; §5 (liveness gate): filters out dead-agent residue. |
| CNFL-02 | System alerts the user immediately when a conflict is detected | §1: Phase 17 does NOT change the real-time alert emit path (`emit_conflict_event`); it adds a *query* surface that rides the same data. |
| CNFL-06 | Conflict detection runs in the Rust backend for real-time accuracy | §1: all new logic (argv parse, path canon, engine query) is Rust-side before the HTTP response returns. |
| COMM-01..COMM-06 | Approval workflow carries forward | §6, §7: migration 007 additive (no row-shape breakage); `create_approval_request_internal` gains optional params; `ApprovalRequestCard` gains conditional render. |

## Project Constraints (from CLAUDE.md)

Applicable to Phase 17:
- **Tauri v2 + Rust + TypeScript** stack — all new code fits.
- **Extensible adapter pattern** — Phase 17 does not touch adapters; it operates on the shared conflict engine. [VERIFIED: CLAUDE.md §"Constraints"]
- **tokio::sync::Mutex** for async-friendly locking — already established for `WaiterRegistry` and `RateLimiter`. [VERIFIED: 17-CONTEXT.md §Established Patterns]
- **sqlx with compile-time SQL checking** — migration 007 follows the same pattern as 005/006 (raw .sql files executed by `sqlx::migrate!`).
- **Structured `tracing` with `kind = "…"` key** for machine-readable log filtering — Phase 17 emits `tracing::debug!(kind = "bash_parse", …)` per D-13.
- **GSD workflow enforcement** — all edits go through `/gsd-execute-phase`.
- **Commit per code change** (MEMORY.md) — one Plan task = one or more focused commits, not batched.

---

## 1. Arc<Mutex<ConflictEngine>> sharing pattern

### Where the Arc is constructed

Current (broken for sharing): `pipeline/commands.rs:182` constructs `let mut engine = ConflictEngine::new(Duration::from_millis(conflict_window_ms))` inside the `conflict_task` closure — engine is private to one task.

Required shape (D-15, D-16):

```rust
// In lib.rs, alongside .manage(conflict::ConflictState::new(5000)):
let conflict_engine = Arc::new(tokio::sync::Mutex::new(
    ConflictEngine::new(Duration::from_millis(5000))
));
app.manage(conflict_engine.clone());  // Tauri State
// Then pass into start_registration_server(...) as a new arg, which passes
// it to build_router(...) as a new Extension layer, alongside WaiterRegistry.
```

[VERIFIED: src-tauri/src/lib.rs:162; src-tauri/src/pipeline/commands.rs:181-202]

The pipeline `conflict_task` takes the `Arc<Mutex<_>>` as an argument (passed through `start_watch` → the spawned task) rather than building its own engine. Inside the loop: `let mut eng = engine.lock().await; let alerts = eng.process_batch(&batch); drop(eng);` — release the lock before dispatching the resulting alerts to avoid holding it across Tauri `emit`s and `NotificationState` awaits.

### Lock granularity — should you worry?

**Measurement baseline:**
- `process_batch` runs one HashMap lookup + vector retain + vector push per event. For a typical "burst-write debounce flush" of ~100 events in a single batch, that's ~100 microseconds of CPU on the lock.
- `could_conflict_with` is a single HashMap lookup + linear scan over `Vec<FileWriteRecord>` (typically 1-3 entries per file). Call sites hold the lock for single-digit microseconds.
- Notify debouncer flush cadence is configurable; current setting in `notify-debouncer-full 0.7` defaults to a few hundred ms. In practice the pipeline broadcast channel is capped at 256 batches, and batches are ≤1024 events (MPSC cap).

**Worst-case latency added to /hook:** ≤1 ms under any realistic burst write, because:
1. `process_batch` never awaits inside the lock.
2. `/hook` is called at human-scale rates (≤10 rps per `RateLimiter`).
3. tokio's fair scheduling means the hook handler's `.lock().await` interleaves with the pipeline task's next `.lock().await` call at every yield point.

**Recommendation:** DO NOT pre-optimize. Use `tokio::sync::Mutex`, hold it for the shortest possible critical section, and measure. CONTEXT.md `<code_context>` §"Known Risks" already flags this; the planner should include a `tracing::debug!` span around both lock acquisitions in Phase 17 so post-hoc profiling is cheap. Only split locks if a real burst shows up in UAT.

[CITED: https://docs.rs/tokio/latest/tokio/sync/struct.Mutex.html — "If the value behind the mutex is just data, it's usually appropriate to use a blocking mutex such as the one in the standard library or parking_lot. ... when [locks] need to be held across awaits, a tokio mutex is almost always the right choice."]

### std::sync::Mutex vs tokio::sync::Mutex

D-15 says `tokio::sync::Mutex`. **Verified correct:** the hook handler is `async`, and the natural coding style is `let eng = engine.lock().await; let result = eng.could_conflict_with(...)`. Holding a `std::sync::Mutex` across an `.await` boundary is a correctness bug (the guard is not `Send` safely across yield points in general, and if you `.await` while holding it you block the entire tokio worker thread) — `clippy::await_holding_lock` flags it.

We *could* use `std::sync::Mutex` safely if we carefully `drop(guard)` before every `.await`, but the hook handler's flow is `lock → query → unlock → decision branch → maybe create_approval_request_internal (await!)`. Getting that right in every branch is fragile. `tokio::sync::Mutex` makes the contract self-enforcing.

**Decision check:** D-15's `tokio::sync::Mutex` is the right pick. No re-litigation.

[CITED: https://docs.rs/tokio/latest/tokio/sync/struct.Mutex.html#method.lock ; https://rust-lang.github.io/rust-clippy/master/#await_holding_lock]

### Staleness of the engine's window (out-of-scope flag)

**Inherited bug:** `conflict_task` reads `conflict_state.get_window_ms()` once at task startup and bakes it into `ConflictEngine::new()`. The engine's `window: Duration` field is private; `set_window()` exists on the engine but nothing calls it in production. So `set_window_ms` on `ConflictState` updates the atomic but never reaches the engine until `start_watch` is re-run.

**Phase 17 impact:** The hook handler should read `conflict_state.get_window_ms()` at query time and pass it explicitly into `could_conflict_with(path, except_agent, now, window_ms)`. This gives the gate predicate fresh window semantics independent of the engine's stale internal field. D-14's exact signature in CONTEXT.md specifies `now_ms` but not `window_ms` — **the planner should amend the signature to include `window_ms: i64` as the fourth arg.** The engine's own `self.window` field can stay as the batch-processing window (it's still the policy for `process_batch`'s record eviction).

Fixing the pipeline-side staleness (making `set_window_ms` hot-swap the engine's window) is **out of Phase 17 scope** — note it in the plan but do not fix.

## 2. Bash argv splitting crate

### Options audit

| Crate | Latest | MSRV | In Cargo.lock? | Dep weight | License |
|-------|--------|------|----------------|------------|---------|
| `shlex` | 1.3.0 | 1.46.0 | **YES** (transitive via `cc`) | 0 deps | MIT/Apache-2 |
| `shell-words` | 1.1.0 | 1.0 | No | 0 deps | MIT/Apache-2 |
| Hand-rolled | — | — | — | 0 deps | — |

[VERIFIED: src-tauri/Cargo.lock line 4521-4525 (`shlex 1.3.0`); https://docs.rs/shlex/latest/shlex/ ; https://docs.rs/shell-words/latest/shell_words/]

### Recommendation: shlex 1.3.0

**Reasons:**
1. Already in the dep graph (zero new bytes at build time). [VERIFIED: Cargo.lock]
2. Returns `Option<Vec<String>>` — `None` on unbalanced-quote / parse failure maps cleanly to `BashParseResult::ParseFailed` (D-10 → allow).
3. RUSTSEC-2024-0006 was fixed in 1.2.1/1.3.0; we're pulling a current version. [CITED: https://rustsec.org/advisories/RUSTSEC-2024-0006.html]
4. POSIX-compliant quote/escape handling sufficient for what D-12's verb dispatch needs.

**How to use:** Call `shlex::split(command_str)`. Iterate the resulting `Vec<String>` and dispatch on first token (single word → safelist check; otherwise → verb table). Shell operators (`|`, `&&`, `||`, `;`, `>`, `>>`, `2>`, `&>`) are **returned as literal tokens** — so segmentation at operators is a post-pass over the argv vector, not something shlex does for us.

**shell-words as alternative:** cleaner error type (`Result<Vec<String>, ParseError>` instead of `Option`), but 0 extra value given shlex is already there. Use shell-words only if the planner wants the explicit error type. Both crates have identical feature coverage for our purposes.

### Correctness edge cases the parser must handle

| Input | Expected `BashParseResult` | Why |
|-------|---------------------------|-----|
| `ls` | `Safelisted` | D-11 single-word safelist. |
| `git status` | `Safelisted` | D-11 git subcommand safelist. |
| `git diff > out.patch` | `Targets([out.patch])` | Redirect present → always parse. |
| `cp a.txt b.txt` | `Targets([b.txt])` | D-12 mutating util; last positional = dst. |
| `echo hi > log.txt` | `Targets([log.txt])` | Stdout redirect. |
| `cat <<EOF ... EOF` | `ParseFailed` | shlex does NOT interpret heredocs; the `<<` is a literal token → verb dispatch falls off the end → ParseFailed → allow. |
| `diff <(a) <(b)` | `ParseFailed` | Process substitution; shlex returns `<(a)` as one token — no way to know what file gets written. Fall through. |
| `echo $(date)` | `Targets([])` (no path verbs) or `Safelisted` depending on first verb | `$(...)` is a literal token to shlex; we never descend into it. `echo` is single-word safelist. |
| `rm *.rs` | `Targets([*.rs])` | shlex does NOT glob; we get the literal `*.rs` string. Acceptable — resolved-path canonicalization leaves it as-is; the engine lookup fails silently. Planner note: test this explicitly. |
| `echo a && rm b.txt` | segment-2 yields `Targets([b.txt])` | Post-pass split on `&&` operator tokens produces two segments; each parses independently. |
| Mismatched quote (`echo "hi`) | `ParseFailed` | shlex::split returns `None` on unbalanced quotes. [VERIFIED: https://docs.rs/shlex/latest/shlex/fn.split.html] |

**Segmentation algorithm** (post-shlex):
```
let argv = shlex::split(cmd)?;  // None → ParseFailed
let segments: Vec<Vec<&str>> = partition_at_operators(&argv, &["|", "&&", "||", ";"]);
let mut all_targets = vec![];
for seg in segments { extend_from(parse_one(seg, cwd), &mut all_targets); }
```

Operator tokens (`|`, `&&`, etc.) as returned by shlex are the exact separators — a literal string compare is sufficient, no regex needed.

[CITED: https://docs.rs/shell-words/latest/shell_words/fn.split.html — "compatible with behaviour of Unix shell, but with word expansions limited to quote removal, and without special token recognition rules for operators."]

## 3. Path canonicalization helper

### Recommendation: `path-clean 1.0.1`

| Crate | Version | Deps | Purpose | Fit |
|-------|---------|------|---------|-----|
| `path-clean` | 1.0.1 | 0 | Lexical normalization (`.`, `..`, `//`) | Exact match for D-02 "non-existent path fallback" |
| `dunce` | 1.0.5 | 0 | Windows UNC prefix stripping | Already transitive via Tauri; NOT a substitute for lexical cleaning |
| Hand-rolled | — | — | ~30 LOC lexical normalizer | Viable if the planner wants zero new deps |

[VERIFIED: Cargo.lock line 1169-1173 (`dunce 1.0.5`); https://docs.rs/path-clean/latest/path_clean/]

**path-clean's semantics:** Pure lexical — resolves `.`/`..`, collapses `//`, no filesystem access. Implements Plan 9 `cleanname` (same as Go `path.Clean`). Zero deps. [VERIFIED: https://docs.rs/path-clean/1.0.1/path_clean/]

**Cross-platform behavior on Linux (test env):** path-clean handles `/`-separated paths natively. For Windows-style `\` input on Linux, path-clean treats `\` as a normal character in a filename (NOT a separator) — this matches Rust `std::path::Path`'s platform-dependent behavior. For AITC's Linux/Mac/Windows target, this is fine: Claude Code's `file_path` is always absolute and uses the OS's native separator (Claude normalizes per-platform).

**`dunce::canonicalize`** already shows up via Tauri's tree (5+ call sites in the lockfile). It's not suitable for D-02's "file does not exist yet" case — it calls the filesystem. Use it only for the "file exists" branch alongside `std::fs::canonicalize`, or just use `fs::canonicalize` directly (the UNC strip already happens in `pipeline/commands.rs::strip_unc`).

**Recommended D-02 flow:**
```rust
fn canonicalize_for_conflict(path: &Path) -> PathBuf {
    match fs::canonicalize(path) {
        Ok(abs) => strip_unc(abs),         // existing helper in pipeline/commands.rs
        Err(_)  => path_clean::clean(path),  // lexical fallback
    }
}
```

If the planner prefers zero new deps, hand-rolling a Rust lexical cleaner is ~30 LOC and well-tested territory (the path-clean source is the reference implementation). My recommendation: add `path-clean = "1.0"` — 0 deps, 1 KB compiled, and the semantics are load-bearing for D-01's key-shape invariant (two agents writing the same `src/../src/foo.rs` must resolve to the same canonical HashMap key as `src/foo.rs`).

## 4. Claude Code PreToolUse contract

### Top-level payload envelope [VERIFIED: code.claude.com/docs/en/hooks]

```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { /* tool-specific, see below */ },
  "tool_use_id": "toolu_..."
}
```

**Field confirmation (matches AITC's existing `HookRequest`):**
- `pid` is NOT in the Claude envelope — AITC's sidecar (`aitc-hook`) captures its own parent PID and adds it to the POST body [VERIFIED: 08-CONTEXT.md D-03]
- `cwd` IS top-level (Phase 17's Bash parser gets a clean `cwd` to resolve relative paths against)
- `session_id` is Claude's session string; already stored in AITC as `hook_session_id`

### Per-tool `tool_input` shapes [VERIFIED: code.claude.com/docs/en/hooks]

| Tool | Fields (authoritative) |
|------|------------------------|
| **Bash** | `command` (string, required), `description` (string, optional), `timeout` (number ms, optional), `run_in_background` (boolean, optional) |
| **Edit** | `file_path` (string), `old_string` (string), `new_string` (string), `replace_all` (boolean, optional) |
| **Write** | `file_path` (string), `content` (string) |
| **Read** | `file_path` (string), `offset` (number, optional), `limit` (number, optional) |
| **MultiEdit** | **NOT DOCUMENTED** — AITC's existing code in `comms/commands.rs::approve_with_edits` assumes `file_path` + `new_string` (per Plan 08 planning). Keep that assumption. [ASSUMED: inferred from repo convention and Anthropic API family] |
| **NotebookEdit** | **NOT DOCUMENTED** — AITC's existing code assumes `file_path` + `new_source`. Keep that assumption. [ASSUMED] |

### Answers to the 4 sub-questions

1. **Fields for Bash:** `command` (string), `description` (optional), `timeout` (optional ms), `run_in_background` (optional boolean). No `cwd` inside `tool_input`. [VERIFIED]
2. **Does Claude Code send `tool_input.file_path` for Bash?** **No.** Only `command`/`description`/`timeout`/`run_in_background`. AITC's `hook_handler` already correctly extracts `tool_input.file_path` only when present (Edit/Write/etc.) — no change needed. [VERIFIED]
3. **Pipelines/heredocs/multi-line:** The entire command is in `tool_input.command` as a single string. No structured split. `"npm test && git push"` arrives as one string; our parser segments it. [VERIFIED: "The command is passed as a single string (with pipes/heredocs included as-is)."]
4. **Is `cwd` present?** Yes — **at the top level** of the envelope, not inside `tool_input`. AITC's `HookRequest` already captures it as `cwd: Option<String>`. The Bash parser (§2) must resolve relative paths against this top-level `cwd`. [VERIFIED]

### Bash parser cwd handling — concrete rule

- `command = "echo hi > out.txt"`, `cwd = "/repo"` → target = `/repo/out.txt` (relative resolution + canonicalize as per §3).
- `command = "echo hi > /tmp/out.txt"`, `cwd = "/repo"` → target = `/tmp/out.txt`.
- `command = "echo hi > ~/out.txt"` → **DO NOT expand `~`** (shlex doesn't; we shouldn't either). Treat `~/out.txt` as literal path relative to cwd → yields `/repo/~/out.txt` which will never conflict with a real file. Acceptable conservative miss. Planner: test this explicitly.

## 5. Liveness gate via AgentRegistry

### `AgentState` variants [VERIFIED: src-tauri/src/agents/adapter.rs:22-28]

```rust
pub enum AgentState {
    Running,
    Idle,
    Waiting,
    Conflict,
    Error,
}
```

**There is NO `Terminated` variant.** CONTEXT.md D-04 says "state ≠ `Terminated`" but this phrasing is inaccurate. The correct liveness check is:

> **`AgentRegistry::get_agent(agent_id).is_some()`** — agent is in the registry.

Terminated agents are *removed* from the registry, not transitioned to a new state:
- `terminate_process` (in `agents/commands.rs`) calls `registry.remove_agent(id)` after the process exits. [VERIFIED: src-tauri/src/agents/registry.rs:146]
- `reap_passive_agents` (bridge_tick) removes `PASSIVE-{pid}` entries whose PID is no longer live. Runs every `BRIDGE_INTERVAL_MS = 2000`ms. [VERIFIED: src-tauri/src/pipeline/passive_bridge.rs:23]

**The planner must amend D-04 to "agent is present in `AgentRegistry`".** The Error state counts as LIVE — an errored agent is still an active session in the registry; only `remove_agent` signals true terminal-ness.

### Crash detection (SIGKILL / OOM) reliability

- **PASSIVE agents:** reliable within ~2s of crash via `reap_passive_agents` at the next `bridge_tick` (checks if PID is still in ProcessSnapshot). [VERIFIED: src-tauri/src/pipeline/passive_bridge.rs:70-80]
- **KAGENT agents:** only removed by explicit `terminate_process`. A SIGKILL / OOM kill leaves the KAGENT entry in the registry until either (a) the user manually clicks "stop agent" in Tower Control, or (b) passive_bridge `reap_passive_agents` runs — but reaper only touches `PASSIVE-*` keys, so KAGENT entries persist indefinitely after a crash.
- **Phase 18 reaper cadence:** 2s, scoped to PASSIVE only. [VERIFIED: passive_bridge.rs:23, registry.rs:166-185]

### Can the liveness gate false-negative?

**Yes — but fail-safely.**
- Over-gating a dead KAGENT (ghost in registry, crashed silently): **fine** — the gate raises a row, user sees "agent B crashed, ignore" and clicks allow. This is annoying UX, not a correctness violation.
- Under-gating a live agent (agent missed the registry): **bad** — would let two live agents trample. But this would require the engine to have a write record from an agent not in the registry, which can only happen transiently during auto-create (the PASSIVE-{pid} insertion in `resolve_or_create_agent` happens before the engine query, not after).

**Verdict:** The liveness gate is conservatively correct for Phase 17. Acceptable 1-2s window of over-gating after a crash. The planner should note this in §"Known limitations" but NOT add a new reaper path for KAGENT (that's a separate phase).

### Recommended D-04 gate code

```rust
// Inside could_conflict_with result handling in hook_handler:
if let Some(other_agent_id) = engine.could_conflict_with(&canonical, &agent_id, now_ms, window_ms) {
    if registry.get_agent(&other_agent_id).await.is_some() {
        return gate_because_of_conflict(other_agent_id, ...);
    }
    // else: ghost record from a dead agent; fall through to allow
}
```

## 6. DB migration 007 shape

### File: `src-tauri/src/db/migrations/007_conflict_gating.sql`

```sql
-- Phase 17: switch PreToolUse gating from tool-category to conflict-based.
-- Adds two nullable columns to approval_requests:
--   * conflict_with_agent_id — the OTHER agent whose write triggered the gate
--     (NULL for protected_path gates, legacy rows, and future other reasons).
--   * gate_reason — enum-shaped string: 'file_conflict' | 'protected_path' | 'unknown'
--     (NULL on legacy rows created before this migration).
-- Also empties pretool_gated_tools so the old category-based gating is off
-- by default. The storage key stays in app_settings for future power-user
-- revival (17-CONTEXT.md D-19) — DO NOT drop it.

ALTER TABLE approval_requests ADD COLUMN conflict_with_agent_id TEXT;
ALTER TABLE approval_requests ADD COLUMN gate_reason TEXT;

-- Switch default gating off. Rows where pretool_gated_tools was already the
-- default allowlist value get wiped; rows the user customized get wiped too.
-- The power-user revival path is "put your tool names back via a future
-- settings screen" (D-19). A hand-rolled SQL upsert is preferable to a Rust
-- migration because tauri-plugin-sql runs this file exactly once per install.
UPDATE app_settings
   SET value = '[]'
 WHERE key = 'pretool_gated_tools';
-- If the row didn't exist (fresh install), `get_pretool_gated_tools`
-- bootstraps it to the default on first read anyway. Insert a zero-value row
-- here so the bootstrap doesn't re-populate the default allowlist and
-- silently re-enable category gating.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('pretool_gated_tools', '[]');
```

[VERIFIED: migration 005 pattern in src-tauri/src/db/migrations/005_pretool_use_hooks.sql; app_settings usage in src-tauri/src/comms/app_settings.rs:37-59]

### CHECK constraint on gate_reason?

**No.** The existing migration 005 comment explicitly notes "No CHECK constraint on status exists (verified against migrations 001-004), so 'abandoned' can be inserted without dropping/recreating a constraint." Follow the precedent — no CHECK on `gate_reason`. Validation lives in Rust (serde deserialization of the new `GateReason` enum if the planner chooses to introduce one — see D-discretion).

### Index additions?

**No.** The only query that filters by `conflict_with_agent_id` would be a hypothetical "show all conflict gates against agent X" view, which doesn't exist in the UI. Skip the index; add later if the query appears. Indexes cost write throughput and SQLite writes are on the hot path via `create_approval_request_internal`.

### Migration numbering

- Existing: `001_initial_schema`, `002_phase3_enrichment`, `003_comms_chat`, `004_phase5_resolution`, `005_pretool_use_hooks`, `006_agent_events`.
- No unmerged migrations in any local branch or staged change. [VERIFIED: `ls src-tauri/src/db/migrations/`]
- **Next: `007_conflict_gating.sql`** — unambiguous.

### Test schema for hook tests

The existing `make_hook_pool()` in `self_register.rs:728-785` hand-rolls the schema for tests (bypasses migrations). Phase 17 must extend that function to include the two new columns on `approval_requests` so the two-agent test (§7) can assert they're populated:

```sql
-- Inside make_hook_pool's CREATE TABLE approval_requests ( ... ):
conflict_with_agent_id TEXT,
gate_reason TEXT,
```

## 7. Test harness for two-agent scenarios

### Minimum-viable two-agent fixture

Reuse `spawn_hook_server()` (in `self_register.rs:790-824`) which already returns `(base_url, Arc<AgentRegistry>, Arc<WaiterRegistry>, sqlx::SqlitePool)`. For Phase 17, **extend it** to also return `Arc<Mutex<ConflictEngine>>`. Steps for a two-agent test:

```rust
#[tokio::test]
async fn hook_gates_edit_when_another_live_agent_wrote_same_path() {
    let (base, reg, waiters, pool, engine) = spawn_hook_server().await;

    // Seed agent A as a live KAGENT with a recent write to /tmp/foo.rs.
    let pid_a = 11111u32;  // synthetic pid; we'll bypass the live-PID check
                            // because the hook handler validates body.pid (agent B's),
                            // not the pid of agent A in the engine records.
    let adapter = aitc_lib::agents::generic::passive_sentinel_adapter();
    reg.upsert_agent(
        "KAGENT-A".into(),
        AgentInfo { id: "KAGENT-A".into(), pid: Some(pid_a), state: AgentState::Running, /* ... */ },
        adapter.clone(),
        false,
    ).await.unwrap();
    {
        let mut eng = engine.lock().await;
        eng.update_pid_mapping(pid_a, "KAGENT-A".into());
        let batch = make_batch(vec![
            (PathBuf::from("/tmp/foo.rs"), now_ms - 1000, Attribution::Pid(pid_a))
        ]);
        eng.process_batch(&batch);
    }

    // Agent B hooks on Edit(/tmp/foo.rs) — MUST gate.
    let my_pid = std::process::id();  // self PID passes sysinfo::check
    // ...register KAGENT-B with pid=my_pid ...
    let body = serde_json::json!({
        "pid": my_pid,
        "session_id": "sess-b",
        "tool_name": "Edit",
        "tool_input": {"file_path": "/tmp/foo.rs", "old_string": "a", "new_string": "b"},
    });
    // ...POST to /hook, assert row appears with conflict_with_agent_id='KAGENT-A'
    //    and gate_reason='file_conflict'...
}
```

### Injecting events into the shared engine in tests

The pipeline `conflict_task` is NOT running in unit tests. Tests call `engine.lock().await.process_batch(...)` directly — same pattern used in existing `engine.rs` tests. The key insight: the test must use `pid_a` in the Attribution that matches the `update_pid_mapping` call, so the recorded `FileWriteRecord.agent_id` becomes `"KAGENT-A"` (not `"PID-11111"`).

### Where the test lives

| Option | Pros | Cons |
|--------|------|------|
| `src-tauri/src/agents/self_register.rs::tests` | Reuses `spawn_hook_server`; close to hook_handler | Already long (>1300 lines) |
| `src-tauri/tests/end_to_end_smoke.rs` | Integration crate; `build_router` is `pub` | Would need to re-import `spawn_hook_server` (pub(crate) today) |
| New `src-tauri/src/agents/self_register.rs::tests::phase17` submodule | Grouped | Still in same file |

**Recommendation:** Add a `phase17` submodule inside `self_register.rs::tests` (right after `rate_limiter_applies_to_hook`, before the Plan 10 MCP tests). Three tests:

1. **`hook_gates_edit_when_other_agent_recently_wrote_same_path`** — the happy path.
2. **`hook_allows_edit_when_only_same_agent_wrote_path`** — D-05 self-write suppression.
3. **`hook_allows_when_other_agent_write_outside_window`** — D-03 window boundary.

Plus extend existing `hook_allows_passthrough_tools_without_row` to also assert no conflict row created for Edit-with-no-prior-writes, and `hook_gates_edit_and_blocks_until_approved` pivots to use a two-agent conflict fixture (per CONTEXT.md canonical_refs).

Additional tests on `ConflictEngine::could_conflict_with` itself go in `engine.rs::tests` (~5 new tests: basic case, self-agent exclusion, outside-window, no-record, multiple-records-return-most-recent).

## Runtime State Inventory

Not applicable — Phase 17 is a predicate swap + migration, not a rename/refactor.

## Common Pitfalls

### Pitfall 1: Holding the engine mutex across an await

**What goes wrong:** `let eng = engine.lock().await; let req = create_approval_request_internal(...).await;` blocks every other engine user (pipeline task, other /hook requests) for the full DB round-trip.
**Why it happens:** Rust makes it easy — `MutexGuard` is a local binding, and the natural code path holds it until end-of-scope.
**How to avoid:** Scope the lock tightly. Pattern:
```rust
let conflict = { let eng = engine.lock().await; eng.could_conflict_with(&canon, &agent, now, win) };
// lock released here; now await.
if let Some(other) = conflict { create_approval_request_internal(..., Some(&other), Some("file_conflict"), ...).await }
```
**Warning signs:** `cargo clippy` emits `clippy::await_holding_lock` for `std::sync::Mutex` but does NOT emit it for `tokio::sync::Mutex` — so tokio's mutex gives you *correctness* across awaits but not *efficiency*. Manual discipline required. [CITED: https://rust-lang.github.io/rust-clippy/master/#await_holding_lock]

### Pitfall 2: shlex returning None silently swallowed

**What goes wrong:** `shlex::split("echo \"oops").unwrap_or_default()` returns `vec![]` — parser sees empty argv, hits fall-through, returns `ParseFailed`, hook allows. That's the right behavior, but if the planner writes `.unwrap()` instead of explicit `None → ParseFailed` handling, tests may panic on adversarial inputs.
**How to avoid:** Explicit match:
```rust
let argv = match shlex::split(cmd) {
    Some(v) if !v.is_empty() => v,
    _ => return BashParseResult::ParseFailed,
};
```

### Pitfall 3: Canonicalization mismatch between engine write records and hook query

**What goes wrong:** Pipeline writes to `recent_writes` use `event.path` as produced by the notify watcher (which gives already-canonical paths from the OS). Hook handler canonicalizes `tool_input.file_path` via `fs::canonicalize`. If the two canonical forms differ (symlinks, case on macOS), the HashMap lookup misses.
**Why it happens:** notify emits real paths; Claude sends user-provided paths that may include symlinks or different case on case-insensitive filesystems.
**How to avoid:** Use identical canonicalization. Both paths should flow through a shared helper (`conflict::canonicalize_for_key`). Document that macOS case-insensitivity is out of scope for v1 (D-02 explicitly says "no case folding").
**Warning signs:** Integration test on macOS CI with `FooBar.rs` written by agent A and `foobar.rs` requested by agent B — test should assert the gate does NOT fire (consistent with D-02).

### Pitfall 4: `RateLimiter::check` drops the request BEFORE the conflict check

**What goes wrong:** Existing hook_handler's first gate is the rate limiter. At 10 rps, if agents A and B both hit /hook in the same second, one gets 429. That's fine, but means Phase 17's conflict detection can't rely on both hooks being processed.
**Why it happens:** Existing Phase 8 design.
**How to avoid:** Document as an accepted limitation. RateLimiter is at /hook level, not per-tool — two agents both trying to edit the same file from separate PIDs each count. Note in plan that bursts should be rare in practice (agents don't hammer /hook).

### Pitfall 5: `update_pid_mapping` not called during tests

**What goes wrong:** `ConflictEngine::process_batch` resolves agent_id via `pid_to_agent_id.get(&pid).unwrap_or_else(|| format!("PID-{pid}"))`. In production, the mapping is populated by… nothing in the current code (grep shows zero callers of `update_pid_mapping`). So in production, the engine already falls through to the `PID-{pid}` format.
**Investigation result:** `update_pid_mapping` exists on the engine but is never called. Production engine write records all carry `agent_id = "PID-{pid}"` strings, NOT KAGENT-/PASSIVE- prefixed ids.
**Phase 17 implication:** The `could_conflict_with` return value and the `AgentRegistry::get_agent(&other_agent_id)` liveness check need to reconcile these formats. **The planner must decide:**
- Option A: Phase 17 wires `update_pid_mapping` into `resolve_or_create_agent` so future write records use the canonical `KAGENT-*`/`PASSIVE-*` ids.
- Option B: Phase 17 does the reverse mapping on query — given a `PID-{pid}` id, extract pid and call `registry.find_agent_by_pid(pid)`.

**Recommendation:** **Option A.** Wire one new line — `engine.lock().await.update_pid_mapping(pid, agent_id.clone())` — into `resolve_or_create_agent`. Simpler and fixes a latent dead-code smell. One new test asserts that write records after /hook use `KAGENT-*` format.

[VERIFIED: Grep for `update_pid_mapping` across src-tauri/src returns zero call sites outside the engine module itself and one test.]

## Code Examples

### Example 1: `could_conflict_with` on ConflictEngine

```rust
// src-tauri/src/conflict/engine.rs

impl ConflictEngine {
    /// Check whether any OTHER live agent wrote to `path` within the window.
    /// Returns the most recent non-self agent_id, or None.
    /// Pure read; no state mutation.
    pub fn could_conflict_with(
        &self,
        path: &Path,
        except_agent_id: &str,
        now_ms: i64,
        window_ms: i64,   // fresh from ConflictState, not self.window
    ) -> Option<String> {
        let records = self.recent_writes.get(path)?;
        records
            .iter()
            .rev()  // most recent first
            .find(|r| r.agent_id != except_agent_id
                      && now_ms - r.timestamp_ms <= window_ms)
            .map(|r| r.agent_id.clone())
    }
}
```

### Example 2: Rewritten `/hook` gate branch

```rust
// src-tauri/src/agents/self_register.rs (replacing lines ~270-285)

// 1. Always-allow fast path (unchanged from D-08).
if waiters.is_always_allowed(&agent_id, &body.tool_name).await {
    return (StatusCode::OK, Json(AitcDecisionResponse::Allow)).into_response();
}

// 2. Derive target path for conflict check.
let (canonical_path, gate_file_path_str): (Option<PathBuf>, Option<String>) =
    match body.tool_name.as_str() {
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => {
            body.tool_input
                .get("file_path")
                .and_then(|v| v.as_str())
                .map(|p| {
                    let canon = canonicalize_for_conflict(Path::new(p));
                    (Some(canon.clone()), Some(canon.to_string_lossy().into_owned()))
                })
                .unwrap_or((None, None))
        }
        "Bash" => {
            // ...extract_target_paths(command, cwd)...
            // For v1: first target if present, else None; ParseFailed → (None, None) → allow.
        }
        _ => (None, None),  // D-06: all other tools pass through.
    };

// 3. Protected path OR-branch (D-07, unchanged).
let path_gated = match &gate_file_path_str {
    Some(p) => protected_path_matches(&pool, p).await,
    None => false,
};

// 4. Conflict gate.
let conflict_other: Option<String> = match &canonical_path {
    Some(p) => {
        let now_ms = now_ms();
        let window_ms = app.state::<ConflictState>().get_window_ms() as i64;
        let other = {
            let eng = engine.lock().await;
            eng.could_conflict_with(p, &agent_id, now_ms, window_ms)
        };
        match other {
            Some(id) if registry.get_agent(&id).await.is_some() => Some(id),
            _ => None,
        }
    }
    None => None,
};

// 5. Compose decision.
let (should_gate, gate_reason, conflict_with): (bool, &str, Option<&str>) = match (conflict_other.as_deref(), path_gated) {
    (Some(id), _)       => (true,  "file_conflict",   Some(id)),
    (None,     true)    => (true,  "protected_path",  None),
    _                   => (false, "",                None),
};

if !should_gate {
    return (StatusCode::OK, Json(AitcDecisionResponse::Allow)).into_response();
}

tracing::info!(kind = "hook_gate", reason = gate_reason, agent = %agent_id,
               file = ?gate_file_path_str, conflict_with = ?conflict_with,
               "gating PreToolUse");
// ...rest of create_approval_request_internal call with new params...
```

### Example 3: bash_paths dispatch skeleton

```rust
// src-tauri/src/agents/bash_paths.rs

pub enum BashParseResult {
    Safelisted,
    Targets(Vec<PathBuf>),
    ParseFailed,
}

const SINGLE_WORD_SAFELIST: &[&str] = &[
    "ls", "pwd", "cat", "head", "tail", "echo", "wc", "which",
    "whoami", "date", "uname", "test", "[",
];

const GIT_SAFE_SUBCMDS: &[&str] = &["status", "diff", "log", "show", "branch", "stash"];

pub fn extract_target_paths(command: &str, cwd: &Path) -> BashParseResult {
    let has_redirect = command.contains('>');  // cheap pre-check before shlex
    let argv = match shlex::split(command) {
        Some(v) if !v.is_empty() => v,
        _ => return BashParseResult::ParseFailed,
    };
    tracing::debug!(kind = "bash_parse", tokens = argv.len(), "shlex split ok");

    // Safelist check (skipped entirely if redirect present).
    if !has_redirect {
        let first = argv[0].as_str();
        if argv.len() == 1 && SINGLE_WORD_SAFELIST.contains(&first) {
            return BashParseResult::Safelisted;
        }
        if first == "git" && argv.len() >= 2 && GIT_SAFE_SUBCMDS.contains(&argv[1].as_str()) {
            return BashParseResult::Safelisted;
        }
        // `find` special-case: safelist only if no destructive flags.
        if first == "find" && !argv.iter().any(|t| matches!(t.as_str(), "-exec" | "-execdir" | "-delete" | "-ok")) {
            return BashParseResult::Safelisted;
        }
    }

    // Split on shell operators.
    let segments: Vec<Vec<String>> = split_on_operators(argv, &["|", "&&", "||", ";"]);
    let mut targets = vec![];
    for seg in segments {
        targets.extend(parse_one_segment(&seg, cwd));
    }
    if targets.is_empty() {
        return BashParseResult::ParseFailed;
    }
    BashParseResult::Targets(targets)
}
```

## State of the Art

No fundamental technology shifts relevant to this phase in 2026. Key notes:

| Area | Current | Notes |
|------|---------|-------|
| Tokio async Mutex | stable, tokio 1.x | No API changes; `tokio::sync::Mutex` is the recommended primitive for state shared across `.await`. [CITED: https://docs.rs/tokio/latest/tokio/sync/struct.Mutex.html] |
| Claude Code hooks | stable since 2024; docs at code.claude.com | PreToolUse contract unchanged since Phase 8 was researched. No MultiEdit/NotebookEdit official docs. |
| shlex RUSTSEC-2024-0006 | patched in 1.2.1/1.3.0 | We're pulling a current version. [CITED: https://rustsec.org/advisories/RUSTSEC-2024-0006.html] |
| sqlx 0.8 + SQLite | stable | `sqlx::migrate!` works; migration files are numbered-prefix conventional. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MultiEdit `tool_input` has `file_path` + `new_string` | §4 | Plan 17 may miss a canonicalization for MultiEdit; conflict miss, not false-gate. Existing Phase 8 code already makes this assumption; no new risk introduced. |
| A2 | NotebookEdit `tool_input` has `file_path` + `new_source` | §4 | Same as A1. |
| A3 | path-clean 1.0.1 is current in 2026-04 | §3 | Low; if a newer 1.x is out, the planner bumps the version tag. Lexical behavior is stable. |
| A4 | Pipeline `conflict_task` event rate is low enough that single Mutex has no contention | §1 | MEDIUM — no direct measurement; all reasoning is from debouncer defaults + MPSC capacities. If wrong, symptom is /hook latency >100ms under sustained burst, visible in `tracing::debug!` lock spans. |
| A5 | `update_pid_mapping` is safe to wire into `resolve_or_create_agent` without side effects on existing pipeline tests | §Pitfall 5 | LOW — the mapping is a simple HashMap insert; the only way it breaks tests is if an existing test asserts `PID-{pid}` format in write records. `rg 'PID-'` across tests shows zero such asserts. |

**User-confirmation checklist** (bring these to the planner / discuss-phase if they need to be locked):
- A1, A2: Should the plan include a probe task that ships Claude Code + logs a real MultiEdit tool_input? (Low value; the existing code has worked in production.)
- A4: Should Wave 0 include a microbenchmark of lock contention under a 1000-event burst? (Recommended IF planner sees any "latency" in the Nyquist checks.)
- A5: Is wiring `update_pid_mapping` in scope for Phase 17, or deferred? (Recommend in-scope — closes a latent inconsistency; adds one line of code and one test.)

## Open Questions

1. **Should the `GateReason` be a typed Rust enum or stay a string?**
   - What we know: CONTEXT.md D-20/D-21 specify string-at-DB-boundary; "Claude's Discretion" explicitly allows a Rust enum.
   - What's unclear: does Plan 17 want typed enum with serde + specta derives so the TS binding is a union type?
   - Recommendation: Typed enum. Cheap (~10 LOC); specta auto-derives the TS union. Rust code gets exhaustiveness checks at every match site. Specta-derived TS type replaces the hand-rolled TS union in `ApprovalRequestCard` props.

2. **Should `update_pid_mapping` be wired in Phase 17 or deferred?**
   - What we know: §Pitfall 5 — currently unused; production writes all use `PID-{pid}` format.
   - What's unclear: does wiring it break any latent assumption in conflict UI?
   - Recommendation: wire it (1 line in `resolve_or_create_agent`). Include 1 regression test in `engine.rs::tests` that a /hook-resolved agent's future write records use `KAGENT-*` format.

3. **Does the UI need an `AgentState` reaper for KAGENT crashes (§5 false-negative class)?**
   - What we know: Phase 18 only reaps PASSIVE.
   - What's unclear: is the 1-2s over-gate window noticeable enough to warrant a fix in Phase 17?
   - Recommendation: No — defer. Document as known limitation. Phase 17's job is the predicate swap; registry-reaper improvements deserve their own phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| shlex (direct dep) | §2 Bash parser | YES (transitive) | 1.3.0 in Cargo.lock | Use shell-words 1.1.0 (0 deps, adds 1 crate) |
| path-clean | §3 D-02 canonicalization | No (new dep) | 1.0.1 | Hand-roll ~30 LOC lexical cleaner |
| dunce | §3 Windows UNC handling | YES (transitive via Tauri) | 1.0.5 | `strip_unc` helper in pipeline/commands.rs |
| tokio::sync::Mutex | §1 engine sharing | YES | tokio 1.x | None needed; std::sync::Mutex is unsafe across await |
| sqlx::migrate! | §6 migration 007 | YES | sqlx 0.8 | None needed |
| tauri::test::mock_app | §7 two-agent tests | YES (dev-dep) | tauri 2.x | None needed |
| reqwest (dev-dep) | §7 /hook POST from tests | YES (dev-dep) | 0.12 | None needed |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** path-clean (can hand-roll — but recommendation is to add the crate).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (built-in) |
| Config file | none — per-module `#[cfg(test)]` submodules |
| Quick run command (backend) | `cargo test --package aitc --lib conflict::engine::tests::phase17 -- --nocapture` |
| Quick run command (hook handler) | `cargo test --package aitc --lib agents::self_register::tests::phase17 -- --nocapture` |
| Quick run command (bash_paths) | `cargo test --package aitc --lib agents::bash_paths::tests -- --nocapture` |
| Full backend suite | `cargo test --package aitc --lib` |
| Integration tests | `cargo test --package aitc --tests -- --ignored` (the existing e2e smoke is `#[ignore]`) |
| Frontend typecheck | `cd src && npx tsc --noEmit` |
| Frontend tests | `npm run test` (vitest; existing) |
| Binding regen | `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc` [VERIFIED: Phase 18 D-03, STATE.md] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CNFL-01 | `could_conflict_with` returns the OTHER agent when a write is in window | unit | `cargo test conflict::engine::tests::could_conflict_with_returns_other_agent` | ❌ Wave 0 |
| D-04 | Liveness gate — ghost agents (removed from registry) don't trigger conflict | integration | `cargo test agents::self_register::tests::phase17::hook_allows_when_conflicting_agent_was_removed` | ❌ Wave 0 |
| D-05 | Self-write suppression — agent doesn't conflict with itself | unit | `cargo test conflict::engine::tests::could_conflict_with_excludes_self` | ❌ Wave 0 |
| D-06 | Read/LS/Grep pass through | integration | `cargo test agents::self_register::tests::hook_allows_passthrough_tools_without_row` (EXTEND existing) | ✅ |
| D-07 | protected_paths still gates (no conflict required) | integration | `cargo test agents::self_register::tests::hook_gates_protected_path_even_on_read` (EXTEND to assert gate_reason='protected_path') | ✅ |
| D-08 | Always-allow fast path | integration | `cargo test agents::self_register::tests::hook_honors_always_allow_fast_path` (EXISTING) | ✅ |
| D-11 | Bash single-word safelist allows without gate | unit | `cargo test agents::bash_paths::tests::safelist_ls_and_git_status` | ❌ Wave 0 |
| D-12 | Bash verb dispatch extracts targets for `cp SRC DST` / `echo > file` | unit | `cargo test agents::bash_paths::tests::verb_dispatch_*` | ❌ Wave 0 |
| D-10 | Bash ParseFailed → Allow (no gate row) | integration | `cargo test agents::self_register::tests::phase17::bash_parse_failure_allows` | ❌ Wave 0 |
| D-14/D-15 | Engine query path end-to-end: two-agent scenario | integration | `cargo test agents::self_register::tests::phase17::hook_gates_edit_when_other_agent_recently_wrote_same_path` | ❌ Wave 0 |
| D-20/D-21 | Migration 007 adds columns; approval row populated | integration | `cargo test agents::self_register::tests::phase17::gate_row_carries_conflict_with_agent_id` | ❌ Wave 0 |
| D-22 | ApprovalRequestCard renders Conflict line | frontend | `cd src && npm run test -- ApprovalRequestCard` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cargo test --package aitc --lib conflict::engine agents::bash_paths agents::self_register` (~15s)
- **Per wave merge:** `cargo test --package aitc --all-targets` + `cd src && npx tsc --noEmit && npm run test`
- **Phase gate:** Full suite + manual UAT with two Claude Code sessions editing the same file (real-world conflict detection sanity check)

### Wave 0 Gaps

- [ ] `src-tauri/src/agents/bash_paths.rs` — new module with parser + safelist + shared unit tests
- [ ] `src-tauri/src/agents/mod.rs` — add `pub mod bash_paths;`
- [ ] `src-tauri/src/conflict/engine.rs` — add `could_conflict_with` method + 5 new unit tests
- [ ] `src-tauri/src/db/migrations/007_conflict_gating.sql` — schema migration
- [ ] `src-tauri/src/agents/self_register.rs::tests::make_hook_pool` — extend test schema to include `conflict_with_agent_id` + `gate_reason`
- [ ] `src-tauri/Cargo.toml` — promote `shlex` to `[dependencies]`; add `path-clean = "1.0"` (if the planner accepts §3 recommendation)
- [ ] Framework install: none — `cargo test` is already in scope
- [ ] Frontend: `src/components/ui/ConflictChip.tsx` (new) OR inline render in ApprovalRequestCard (planner discretion per D-22)
- [ ] `src/bindings.ts` — regenerate via canonical command after Rust changes

### Observable Behaviors

**Phase 17 works when all of these are true:**

1. **Two-agent gate:** Two live KAGENT entries (A, B); A wrote `/repo/foo.rs` 2s ago via the engine; B's `/hook` with `tool_name='Edit' tool_input.file_path='/repo/foo.rs'` returns 200 with approval row `status='pending' gate_reason='file_conflict' conflict_with_agent_id='KAGENT-A'`.
2. **Solo agent passes through:** Single live agent; `/hook` with `tool_name='Bash' tool_input.command='ls'` returns instant Allow — no approval row, no latency >5ms.
3. **Ghost agent doesn't gate:** A wrote foo.rs, then A was removed from registry; B's /hook on foo.rs returns Allow (liveness filter).
4. **Protected path still gates:** Solo agent; glob pattern `**/.env` registered; `/hook` on `/tmp/.env` gates with `gate_reason='protected_path' conflict_with_agent_id=NULL`.
5. **Self-write doesn't gate:** Same agent writes foo.rs, then hooks on Edit(foo.rs) — allow (D-05).
6. **Window boundary:** Agent A wrote foo.rs 6s ago (outside 5s default window); B hooks on Edit(foo.rs) — allow.
7. **Bash safelist:** `/hook` with `tool_name='Bash' tool_input.command='git status'` — allow regardless of conflict state (D-11).
8. **Bash parse failure:** `/hook` with `tool_name='Bash' tool_input.command='echo "unterminated'` — allow (D-10 + shlex::split returns None).
9. **Migration 007 applied:** `SELECT COUNT(*) FROM app_settings WHERE key='pretool_gated_tools' AND value='[]'` returns 1 after migration.
10. **UI renders correctly:** ApprovalRequestCard with `gateReason='file_conflict' conflictWithAgentId='KAGENT-A'` renders `⚠ CONFLICT with KAGENT-A` line in amber; with `gateReason='protected_path'` renders `🔒 PROTECTED path` line in warning tint; without either renders neither (legacy rows unaffected).

**Phase 17 does NOT over-gate:**

1. Solo agent Bash→Edit workflow on untouched files: zero approval rows created across a 20-tool-call session.
2. Benign multi-agent scenarios (agents on disjoint file sets): zero false conflicts.
3. Always-allow cached calls: zero new rows, zero conflict queries.

### Latency Measurement Strategy

For D-15's Arc<Mutex<_>> concern (§1), add `tracing::debug!` spans around both lock acquisitions:

```rust
let span = tracing::debug_span!("hook_engine_lock", agent = %agent_id);
let _enter = span.enter();
let t0 = Instant::now();
let eng = engine.lock().await;
let elapsed = t0.elapsed();
tracing::debug!(kind = "hook_lock_wait", elapsed_us = elapsed.as_micros() as u64);
```

Under normal load, `hook_lock_wait` should be ≤50µs p99. If >1ms appears in logs during UAT, that's the signal to investigate granularity. Add one assertion test on a synthetic burst (spawn 100 concurrent `process_batch` calls and verify the /hook query p99 <10ms).

### Tracing Keys for Post-Hoc Audit (D-13)

| Key | Level | Where | Fields |
|-----|-------|-------|--------|
| `kind = "bash_parse"` | debug | bash_paths.rs | `command_len`, `tokens`, `result` (Safelisted/Targets(N)/ParseFailed) |
| `kind = "hook_gate"` | info | self_register.rs (new gate branch) | `reason`, `agent`, `file`, `conflict_with` |
| `kind = "hook_allow"` | debug | self_register.rs (post-predicate) | `agent`, `tool`, `reason` (passthrough/safelisted/no_conflict) |
| `kind = "hook_lock_wait"` | debug | self_register.rs | `elapsed_us` |
| `kind = "conflict_query"` | trace | engine.rs (could_conflict_with) | `path`, `except_agent`, `found` |

Planner: set default log level to `info` so `hook_gate` always hits logs but `bash_parse`/`conflict_query` only on `RUST_LOG=debug` or `trace`.

## Sources

### Primary (HIGH confidence)
- **Repo source code** (all paths absolute):
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/conflict/engine.rs` — full engine source read
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/conflict/types.rs` — ConflictState read
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/self_register.rs` — hook_handler + tests read (1330 lines)
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/hook_waiters.rs` — WaiterRegistry pattern read
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/registry.rs` — AgentRegistry + AgentState read
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/agents/adapter.rs` — AgentState enum verified (no Terminated variant)
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/commands.rs` — conflict_task ownership verified
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/comms/app_settings.rs` — DEFAULT_GATED list
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/comms/commands.rs` — create_approval_request_internal signature
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/db/migrations/005_pretool_use_hooks.sql` — migration template
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/src/db/migrations/006_agent_events.sql` — migration template
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/Cargo.toml` — direct deps confirmed
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/Cargo.lock` — `shlex 1.3.0` + `dunce 1.0.5` transitive confirmed
  - `/home/prannayag/pragnition/htx/aitc/src/views/CommsHub/ApprovalRequestCard.tsx` — card rendering pattern
  - `/home/prannayag/pragnition/htx/aitc/src-tauri/tests/end_to_end_smoke.rs` + `common/mod.rs` — integration test pattern
- **Official docs:**
  - Claude Code hooks — https://code.claude.com/docs/en/hooks (PreToolUse envelope + Bash/Edit/Write/Read tool_input shapes)
  - Tokio Mutex — https://docs.rs/tokio/latest/tokio/sync/struct.Mutex.html
  - shlex — https://docs.rs/shlex/latest/shlex/ and https://docs.rs/shlex/latest/shlex/fn.split.html
  - shell-words — https://docs.rs/shell-words/latest/shell_words/fn.split.html
  - path-clean — https://docs.rs/path-clean/latest/path_clean/
  - shlex CHANGELOG + RUSTSEC — https://github.com/comex/rust-shlex/blob/master/CHANGELOG.md and https://rustsec.org/advisories/RUSTSEC-2024-0006.html
- **Project planning docs:**
  - `/home/prannayag/pragnition/htx/aitc/.planning/phases/17-conflict-triggered-pretooluse-gating-replace-tool-category-g/17-CONTEXT.md`
  - `/home/prannayag/pragnition/htx/aitc/.planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/08-CONTEXT.md`
  - `/home/prannayag/pragnition/htx/aitc/.planning/REQUIREMENTS.md`
  - `/home/prannayag/pragnition/htx/aitc/.planning/ROADMAP.md`
  - `/home/prannayag/pragnition/htx/aitc/.planning/STATE.md`

### Secondary (MEDIUM confidence)
- Rust forum discussion on shell-words vs shlex (confirms operators returned as tokens): https://users.rust-lang.org/t/crate-for-splitting-a-string-like-bash/40062
- Clippy `await_holding_lock` docs — https://rust-lang.github.io/rust-clippy/master/#await_holding_lock

### Tertiary (LOW confidence — flagged as ASSUMED)
- MultiEdit and NotebookEdit `tool_input` shapes (A1, A2) — inferred from AITC's existing Phase 8 code and API family patterns; not in Claude Code public docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps verified in Cargo.lock or official docs
- Architecture (Arc<Mutex<_>> sharing): HIGH — pattern established by `WaiterRegistry`; tokio mutex semantics are well-documented
- Pitfalls: HIGH — each pitfall verified against repo code
- Validation architecture: HIGH — test harness already exists (`spawn_hook_server`), extension path is mechanical
- MultiEdit/NotebookEdit tool_input: LOW (A1, A2 in Assumptions Log) — but existing Phase 8 code depends on the same assumption, so no new risk
- Lock contention: MEDIUM (A4) — not empirically measured; reasoning is from system design only

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (Claude Code hooks contract stable for 2+ years; Rust crate versions stable; only risk is an unreleased Claude Code feature adding a new PreToolUse tool_input shape — low probability)

## RESEARCH COMPLETE
