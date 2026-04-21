# Phase 17: Conflict-triggered PreToolUse gating — Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 13 (3 new, 10 modified)
**Analogs found:** 13 / 13 (all files have a concrete in-repo analog or preservable current shape)

This file is a lookup table. For each file the planner touches in Phase 17, it gives:
1. **Current state** — the lines to preserve (modified files) or "N/A — new" (new files).
2. **Target pattern** — the shape the executor must mirror (signatures + excerpts; NOT full implementation).
3. **Closest analog** — existing file the executor reads before writing.
4. **Gotchas** — file-specific pitfalls from RESEARCH §Common Pitfalls + CONTEXT decisions.

Line numbers cite file state at phase start (2026-04-21). Ranges are pinned to the reads captured during pattern mapping; re-verify with `wc -l` + `grep -n` during execution if files have drifted.

## File Classification

| File | New/Modified | Role | Data Flow | Closest Analog | Match Quality |
|------|--------------|------|-----------|----------------|---------------|
| `src-tauri/src/agents/bash_paths.rs` | NEW | utility (pure-Rust single-purpose module with `mod tests`) | transform | `src-tauri/src/pipeline/ignore_filter.rs` (single-purpose pure module, hardcoded tables, unit tests) | exact |
| `src-tauri/src/db/migrations/007_conflict_gating.sql` | NEW | DB migration (ALTER TABLE additive) | schema-change | `src-tauri/src/db/migrations/005_pretool_use_hooks.sql` | exact |
| `src/components/ui/ConflictChip.tsx` (if planner picks extract path) | NEW (conditional) | React presentation component (Command Horizon chip) | request-response | `src/components/ui/UrgencyBadge.tsx` | exact |
| `src-tauri/src/agents/self_register.rs` :: `hook_handler` gating branch (lines 270–285) | MODIFIED | axum handler (rewrite gate predicate) | request-response | itself lines 266–285 (keep ordering, replace branch body) | self-match |
| `src-tauri/src/agents/self_register.rs` :: `hook_handler` signature (lines 208–216) | MODIFIED | axum handler signature (add Extension) | request-response | existing `Extension<…>` lines 210–214 | self-match |
| `src-tauri/src/agents/self_register.rs` :: `build_router` + `start_registration_server` (lines 519–606) | MODIFIED | axum router composer | request-response | existing layer stack lines 542–548 | self-match |
| `src-tauri/src/agents/self_register.rs` :: `tests::make_hook_pool` + `spawn_hook_server` (lines 728–824) | MODIFIED | test harness | integration-test | itself — add two columns to CREATE TABLE, return engine handle | self-match |
| `src-tauri/src/conflict/engine.rs` | MODIFIED | engine query surface (add read method) | CRUD / read | self `process_batch` at lines 51–141 | role-match |
| `src-tauri/src/conflict/engine.rs` :: `mod tests` (lines 157–432) | MODIFIED | unit-test module (add `phase17` submodule) | unit-test | existing `test_conflict_detected_different_pids_within_window` pattern (lines 193–211) | self-match |
| `src-tauri/src/conflict/types.rs` | MODIFIED (optional) | type surface (possibly add `GateReason` enum) | value-type | `AgentState` enum at `agents/adapter.rs:20–28` | role-match |
| `src-tauri/src/pipeline/commands.rs` (lines 176–202) | MODIFIED | async task (share engine via `Arc<Mutex<_>>`) | event-driven | `WaiterRegistry` registration/extension in `lib.rs:221–223` + `self_register.rs:542–548` | role-match |
| `src-tauri/src/lib.rs` | MODIFIED | Tauri setup (register new state + pass handle) | config | existing `.manage(conflict::ConflictState::new(5000))` line 162 + waiters block lines 221–223, 264, 270 | self-match |
| `src-tauri/src/comms/commands.rs` :: `create_approval_request_internal` (lines 106–148) | MODIFIED | service (signature extension) | CRUD | itself — add two optional params, thread to INSERT | self-match |
| `src/views/CommsHub/ApprovalRequestCard.tsx` | MODIFIED | React card (add conditional conflict line) | request-response | existing `{isPretool && <ToolBadge …/>}` line 84; `preview &&` block lines 106–113 | self-match |
| `src-tauri/Cargo.toml` | MODIFIED | manifest (promote `shlex` + add `path-clean`) | config | existing `[dependencies]` block lines 18–73 | self-match |
| `src-tauri/src/agents/mod.rs` | MODIFIED | module index (one `pub mod bash_paths;` line) | config | existing `pub mod hook_install;` line 13 | self-match |

---

## Pattern Assignments

### 1. `src-tauri/src/agents/bash_paths.rs` (NEW — utility / transform)

**Current state:** N/A — new file.

**Target pattern — public surface (signatures only; RESEARCH §"Code Examples" Example 3 has the full skeleton):**

```rust
//! Best-effort Bash `command` → target-path extractor + read-only safelist
//! for Phase 17 conflict-gate predicate. CONTEXT D-09..D-13.
//!
//! Allow-on-parse-failure (D-10): a command we can't locate a write target in
//! is, by definition, not a known conflict surface. Safelist short-circuits
//! before parsing so common read-only tools stay zero-overhead.

use std::path::{Path, PathBuf};

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
    // 1. Cheap pre-check: any redirect forbids safelist (D-11 last bullet).
    // 2. shlex::split → None on unbalanced quotes → ParseFailed (Pitfall 2).
    // 3. Safelist dispatch (single-word / git subcmd / find-without-destructive).
    // 4. Operator-split argv into segments on ["|", "&&", "||", ";"].
    // 5. Per-segment verb dispatch (cp/mv/rm/touch/mkdir/patch/sed/awk/dd/install/tee + stdout redirects).
    // 6. Empty target set → ParseFailed (D-10, not Targets(vec![])).
    todo!("implementation follows RESEARCH §Bash parser cwd handling")
}

#[cfg(test)]
mod tests {
    use super::*;
    // REQUIRED tests (VALIDATION 17-WX-YY D-11/D-12):
    //   safelist_ls_and_git_status  — Safelisted result for "ls", "git status".
    //   safelist_excludes_redirect  — "git diff > out.patch" is NOT safelisted.
    //   safelist_find_without_destructive  — "find . -name 'x'" is Safelisted; with -exec it falls through.
    //   verb_dispatch_cp               — "cp a.txt b.txt" → Targets([b.txt]).
    //   verb_dispatch_redirect         — "echo hi > log.txt" → Targets([log.txt]).
    //   verb_dispatch_tee              — "cmd | tee -a out" → Targets([out]).
    //   verb_dispatch_sed_inplace      — "sed -i 's/a/b/' f.rs" → Targets([f.rs]).
    //   parse_fail_unterminated_quote  — ParseFailed (shlex returns None).
    //   parse_fail_heredoc             — ParseFailed (verb dispatch falls off end).
    //   operator_split_preserves_both  — "echo a && rm b.txt" → Targets([b.txt]).
    //   tracing_emits_kind_bash_parse  — optional; assert via tracing_test if added.
}
```

**Closest analog:** `src-tauri/src/pipeline/ignore_filter.rs` lines 1–50.

Why that file: it's the canonical example in this repo of a single-purpose pure-Rust module that exposes `const X: &[&str] = &[...]` tables, one public function, and a `mod tests` at the bottom. Match the same tone — short doc comment citing the CONTEXT decisions, one `pub enum`, one `pub fn`, no shared state.

**Imports + const pattern from analog (`ignore_filter.rs` lines 1–22):**

```rust
//! Gitignore-respecting walker with hardcoded excludes per D-10 and Pitfall 6.
//!
//! Hardcoded excludes (layered on .gitignore): .git, node_modules, target, …

use ignore::{overrides::OverrideBuilder, WalkBuilder};
use std::path::Path;

/// Hardcoded directory names excluded regardless of .gitignore contents.
pub const HARDCODED_EXCLUDES: &[&str] = &[
    ".git", "node_modules", "target", "build", "dist", ".next", "out",
];
```

**Gotchas:**
- **shlex `Option` pitfall (RESEARCH Pitfall 2):** use explicit `match shlex::split(cmd) { Some(v) if !v.is_empty() => v, _ => return BashParseResult::ParseFailed }` — do NOT `.unwrap_or_default()`.
- **shlex returns operators as literal tokens** (`|`, `&&`, `||`, `;`, `>`, `>>`, `2>`, `&>`). Segment by comparing token strings, not regex.
- **No tilde / env expansion** (RESEARCH §4 "Bash parser cwd handling"): treat `~/out.txt` literal — accept the conservative miss.
- **Resolve relative paths against `cwd`** (from top-level envelope, NOT `tool_input.cwd` — Claude does not put cwd inside tool_input for Bash).
- **Canonicalization happens in the hook handler, not here** (D-09): this module returns absolute-but-non-canonicalized paths.
- **Tracing contract (D-13, VALIDATION §"Tracing Keys"):** emit `tracing::debug!(kind = "bash_parse", command_len = cmd.len(), tokens = argv.len(), result = "Safelisted" / "Targets(N)" / "ParseFailed")`. **Do not log the `command` string at info-level** (avoid leaking user commands into production logs).
- **`find` special case (D-11):** safelist only when none of `-exec`, `-execdir`, `-delete`, `-ok` appear in argv.

---

### 2. `src-tauri/src/db/migrations/007_conflict_gating.sql` (NEW — DDL)

**Current state:** N/A — new file. Migration number 007 is confirmed clear (RESEARCH §6 "Migration numbering").

**Target pattern — full file (short; RESEARCH §6 has the verified canonical text):**

```sql
-- Phase 17: switch PreToolUse gating from tool-category to conflict-based.
-- Adds two nullable columns to approval_requests:
--   * conflict_with_agent_id — the OTHER agent whose write triggered the gate
--     (NULL for protected_path gates, legacy rows, future other reasons).
--   * gate_reason — enum-shaped string: 'file_conflict' | 'protected_path' | 'unknown'
--     (NULL on legacy rows created before this migration).
-- Also empties pretool_gated_tools so old category-based gating is off by default.
-- Storage key stays in app_settings for future power-user revival (17-CONTEXT.md D-19).

ALTER TABLE approval_requests ADD COLUMN conflict_with_agent_id TEXT;
ALTER TABLE approval_requests ADD COLUMN gate_reason TEXT;

UPDATE app_settings
   SET value = '[]'
 WHERE key = 'pretool_gated_tools';
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('pretool_gated_tools', '[]');
```

**Closest analog:** `src-tauri/src/db/migrations/005_pretool_use_hooks.sql` (full file, 19 lines):

```sql
-- Phase 8: Extend approval_requests to carry Claude Code PreToolUse context.
...
ALTER TABLE approval_requests ADD COLUMN tool_name TEXT;
ALTER TABLE approval_requests ADD COLUMN tool_input_json TEXT;
ALTER TABLE approval_requests ADD COLUMN hook_session_id TEXT;

-- No CHECK constraint on status exists (verified against migrations 001-004),
-- so 'abandoned' can be inserted without dropping/recreating a constraint.
CREATE INDEX IF NOT EXISTS idx_approval_requests_tool ON approval_requests(tool_name);
CREATE INDEX IF NOT EXISTS idx_approval_requests_hook_session ON approval_requests(hook_session_id);
```

**Gotchas:**
- **No CHECK constraint on `gate_reason`** (RESEARCH §6): follow migration 005's precedent — validation happens in Rust (serde for the optional `GateReason` enum, or string-guard in the handler).
- **No new indexes** (RESEARCH §6): no query path filters by these columns today. Indexes cost write throughput and `create_approval_request_internal` is on the hot path.
- **Do NOT drop `pretool_gated_tools` row** — D-19 preserves the storage for future strict-mode revival. Only blank the value.
- **`INSERT OR IGNORE` is load-bearing**: on a fresh install where the row has never been bootstrapped, the UPDATE is a no-op and the next call to `get_pretool_gated_tools` would re-insert the 5-item default (see `app_settings.rs:50–57` "Bootstrap default"), silently re-enabling category gating. The INSERT OR IGNORE forecloses that.
- **Executed by `sqlx::migrate!`** — same pattern as migrations 001–006. Do not put `.sql` in a subdirectory, do not rename 007.

---

### 3. `src/components/ui/ConflictChip.tsx` (NEW — conditional, Claude's Discretion per D-22)

**Current state:** N/A — new file. Planner may instead inline the conflict line directly in `ApprovalRequestCard.tsx`; either is acceptable (CONTEXT §"Claude's Discretion").

**Target pattern — if planner picks the extracted-component path:**

```tsx
import { motion } from 'motion/react';

interface ConflictChipProps {
  reason: 'file_conflict' | 'protected_path' | 'unknown';
  conflictWithAgentId?: string | null;
}

// D-22 exact strings:
//   file_conflict  → ⚠ CONFLICT with {agentId}   (amber / text-error)
//   protected_path → 🔒 PROTECTED path           (warning tint)
//   unknown        → render nothing (defensive)

const REASON_STYLE: Record<ConflictChipProps['reason'], string> = {
  file_conflict: 'bg-error/10 text-error border border-error/20',
  protected_path: 'bg-[#ffd16f]/10 text-[#ffd16f] border border-[#ffd16f]/20',
  unknown: '',
};

export function ConflictChip({ reason, conflictWithAgentId }: ConflictChipProps) {
  if (reason === 'unknown') return null;
  const label =
    reason === 'file_conflict'
      ? `⚠ CONFLICT with ${conflictWithAgentId ?? 'unknown'}`
      : '🔒 PROTECTED path';
  return (
    <motion.span
      className={`inline-flex items-center px-2 py-0.5 font-headline text-[10px] uppercase tracking-widest ${REASON_STYLE[reason]}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      aria-label={reason === 'file_conflict' ? 'file conflict' : 'protected path'}
    >
      {label}
    </motion.span>
  );
}
```

**Closest analog:** `src/components/ui/UrgencyBadge.tsx` (full file):

```tsx
import { motion } from 'motion/react';

interface UrgencyBadgeProps { urgency: 'low' | 'medium' | 'high'; }

const urgencyStyles: Record<UrgencyBadgeProps['urgency'], string> = {
  low: 'bg-[#494847]/10 text-[#adaaaa] border border-[#494847]/20',
  medium: 'bg-[#ffd16f]/10 text-[#ffd16f] border border-[#ffd16f]/20',
  high: 'bg-[#ff7351]/10 text-[#ff7351] border border-[#ff7351]/20',
};

export function UrgencyBadge({ urgency }: UrgencyBadgeProps) {
  return (
    <motion.span
      className={`inline-flex items-center px-2 py-0.5 font-headline text-[10px] uppercase tracking-widest ${urgencyStyles[urgency]}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      aria-label={`${urgency} urgency`}
    >
      {urgencyLabels[urgency]}
    </motion.span>
  );
}
```

**Also reference** `src/components/ui/ToolBadge.tsx` lines 111–129 for the `motion.span` + Lucide icon + tailwind-class-merge pattern. `StatusBadge.tsx` lines 26–41 for the `Record<Variant, string>` style-map idiom.

**Gotchas:**
- **Use semantic tailwind tokens** (`text-error`, `bg-error/10`) per Command Horizon design tokens when the color is semantic; raw `#ffd16f`-style values are only used when the token doesn't exist (matches `UrgencyBadge` / `StatusBadge` conventions — amber is consistently literal because Command Horizon did not name the token).
- **Keep it presentational** (`role="img"` or `aria-label`). No click handlers. The ApprovalRequestCard owns interaction.
- **Do NOT re-export types via barrel** — `src/components/ui/` currently has no `index.ts`; imports go `from '../../components/ui/ConflictChip'` (match existing `UrgencyBadge` / `ToolBadge` import style in `ApprovalRequestCard.tsx:9-10`).
- **Exact display strings are locked by D-22** (`⚠ CONFLICT with {agentId}`, `🔒 PROTECTED path`). Do not paraphrase — the frontend test asserts these strings.

---

### 4. `src-tauri/src/agents/self_register.rs` :: `hook_handler` gating branch (MODIFIED — rewrite lines 270–285)

**Current state (lines 265–285, preserve everything above line 270 and below line 285):**

```rust
    // Always-allow fast path (D-22).
    if waiters.is_always_allowed(&agent_id, &body.tool_name).await {
        return (StatusCode::OK, Json(AitcDecisionResponse::Allow)).into_response();
    }

    // Tool allowlist (D-19/D-20) OR protected-path match (D-21).
    let gated_tools = get_pretool_gated_tools(&pool).await.unwrap_or_default();
    let file_path = body
        .tool_input
        .get("file_path")
        .and_then(|v| v.as_str());
    let tool_gated = gated_tools.iter().any(|t| t == &body.tool_name);
    let path_gated = if let Some(fp) = file_path {
        protected_path_matches(&pool, fp).await
    } else {
        false
    };
    if !tool_gated && !path_gated {
        // Pass-through tool — no row, no waiter. D-01 fast path.
        return (StatusCode::OK, Json(AitcDecisionResponse::Allow)).into_response();
    }
```

**Target pattern — replace lines 270–285 with the structure from RESEARCH §"Example 2" (abridged; executor fleshes in):**

```rust
    // Phase 17 D-06: derive conflict-check path from tool_input.
    let (canonical_path, gate_file_path_str): (Option<PathBuf>, Option<String>) =
        match body.tool_name.as_str() {
            "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => {
                body.tool_input.get("file_path").and_then(|v| v.as_str())
                    .map(|p| {
                        let canon = canonicalize_for_conflict(Path::new(p));
                        (Some(canon.clone()), Some(canon.to_string_lossy().into_owned()))
                    })
                    .unwrap_or((None, None))
            }
            "Bash" => {
                // D-09..D-13: extract_target_paths → Safelisted | Targets(..) | ParseFailed.
                // Safelisted + ParseFailed both → (None, None) → allow.
                // Targets(vs): take first path (v1 one-target policy per the rewritten gate predicate).
                let cmd = body.tool_input.get("command").and_then(|v| v.as_str()).unwrap_or("");
                let cwd = body.cwd.as_deref().map(Path::new).unwrap_or(Path::new("."));
                match crate::agents::bash_paths::extract_target_paths(cmd, cwd) {
                    crate::agents::bash_paths::BashParseResult::Targets(v) if !v.is_empty() => {
                        let canon = canonicalize_for_conflict(&v[0]);
                        (Some(canon.clone()), Some(canon.to_string_lossy().into_owned()))
                    }
                    _ => (None, None),
                }
            }
            _ => (None, None),  // D-06: Read/LS/Grep/Glob/WebFetch/WebSearch/Task/MCP pass through.
        };

    // D-07: protected_paths OR-branch — unchanged semantics, runs in parallel.
    let path_gated = match &gate_file_path_str {
        Some(p) => protected_path_matches(&pool, p).await,
        None => false,
    };

    // D-14/D-15: conflict query against shared ConflictEngine.
    let conflict_other: Option<String> = match &canonical_path {
        Some(p) => {
            let now_ms = /* SystemTime::now → millis as i64 */;
            let window_ms = app.state::<crate::conflict::types::ConflictState>()
                .get_window_ms() as i64;
            // Pitfall 1: scope lock tightly, drop BEFORE await.
            let other = {
                let eng = engine.lock().await;
                eng.could_conflict_with(p, &agent_id, now_ms, window_ms)
            };
            // D-04 liveness gate (§5): agent present in registry.
            match other {
                Some(id) if registry.get_agent(&id).await.is_some() => Some(id),
                _ => None,
            }
        }
        None => None,
    };

    // D-20: compose decision + gate_reason string.
    let (should_gate, gate_reason, conflict_with): (bool, &str, Option<&str>) =
        match (conflict_other.as_deref(), path_gated) {
            (Some(id), _)  => (true,  "file_conflict",  Some(id)),
            (None, true)   => (true,  "protected_path", None),
            _              => (false, "",               None),
        };
    if !should_gate {
        return (StatusCode::OK, Json(AitcDecisionResponse::Allow)).into_response();
    }
    tracing::info!(kind = "hook_gate", reason = gate_reason, agent = %agent_id,
                   file = ?gate_file_path_str, conflict_with = ?conflict_with,
                   "gating PreToolUse");
```

Then thread `conflict_with` + `Some(gate_reason)` into `create_approval_request_internal` at line 307 (see file 13 below).

**Closest analog:** the file's own current lines 270–285 (same shape, same variable names, same `if !should_gate { return allow }` flow).

**Gotchas:**
- **Pitfall 1 (hold mutex across await):** always scope the `engine.lock().await` guard inside a `{ }` block; drop before any DB call. `tokio::sync::Mutex` is *correct* across await but NOT *efficient*. Clippy does not flag it — enforce manually.
- **Pitfall 3 (canonicalization mismatch):** the pipeline's write records use `event.path` from notify (already canonical OS-side); hook-side canonicalize via `canonicalize_for_conflict(&Path::new(user_input))` from D-02 (`fs::canonicalize` → `strip_unc` on success; `path_clean::clean` on error). Use a shared helper so both sites take the same code path. `strip_unc` already exists at `pipeline/commands.rs:50–59`.
- **Window knob (RESEARCH §1 "Staleness"):** read `ConflictState::get_window_ms()` fresh at query time. The `D-14` signature must be `could_conflict_with(path, except_agent_id, now_ms, window_ms)` — planner amends CONTEXT's stated signature to include `window_ms` per RESEARCH §1.
- **Pitfall 5 (`update_pid_mapping`):** production writes all carry `agent_id = "PID-{pid}"`. Planner must wire `engine.lock().await.update_pid_mapping(pid, agent_id.clone())` inside `resolve_or_create_agent` (currently at lines 159–204) so future write records use canonical `KAGENT-*`/`PASSIVE-*` IDs and the liveness gate `registry.get_agent(&id)` resolves. Add 1 regression test.
- **D-10 allow on ParseFailed:** `BashParseResult::ParseFailed` falls into the `_ => (None, None)` arm above → no conflict check → allow. Safelisted commands are handled the same way (no canonical_path, no conflict check). Both still log `kind = "hook_allow", reason = "safelisted" | "no_conflict"` at debug.
- **`gated_tools` + `get_pretool_gated_tools` call goes away from this path** (D-18). Do NOT delete the import at line 21 immediately — it's still used via `set_pretool_gated_tools` in `app_settings.rs` and marked `#[allow(dead_code)]`. If the `use` line here becomes unused, the planner deletes it and applies `#[allow(dead_code)]` to the helpers in `app_settings.rs` if clippy fires on them (D-19).

---

### 5. `src-tauri/src/agents/self_register.rs` :: `hook_handler` signature (MODIFIED — add one Extension param)

**Current state (lines 208–216):**

```rust
#[allow(clippy::too_many_arguments)]
async fn hook_handler<R: tauri::Runtime>(
    Extension(registry): Extension<Arc<AgentRegistry>>,
    Extension(rate_limiter): Extension<Arc<RateLimiter>>,
    Extension(pool): Extension<sqlx::SqlitePool>,
    Extension(waiters): Extension<Arc<WaiterRegistry>>,
    Extension(app): Extension<tauri::AppHandle<R>>,
    Json(body): Json<HookRequest>,
) -> axum::response::Response {
```

**Target pattern — add one Extension parameter above the `Json` body (D-16):**

```rust
#[allow(clippy::too_many_arguments)]
async fn hook_handler<R: tauri::Runtime>(
    Extension(registry): Extension<Arc<AgentRegistry>>,
    Extension(rate_limiter): Extension<Arc<RateLimiter>>,
    Extension(pool): Extension<sqlx::SqlitePool>,
    Extension(waiters): Extension<Arc<WaiterRegistry>>,
    Extension(engine): Extension<Arc<tokio::sync::Mutex<crate::conflict::engine::ConflictEngine>>>,
    Extension(app): Extension<tauri::AppHandle<R>>,
    Json(body): Json<HookRequest>,
) -> axum::response::Response {
```

**Closest analog:** the same function's own existing Extension chain (self-pattern).

**Gotchas:**
- **Must use `tokio::sync::Mutex`, not `std::sync::Mutex`** (D-15, RESEARCH §1). The handler is async and the lock is held across (short) compute windows; `std::sync::Mutex` would block the tokio worker thread and Clippy flags nothing with tokio's type.
- **Order in the function signature doesn't matter to axum** (Extensions are resolved by type, not position), but keep `engine` adjacent to `waiters` for readability — both are new async-shared state.
- **Layer order in `build_router` (file 6 below) DOES matter only insofar as each `.layer(Extension(…))` registers a distinct type**; duplicates silently overwrite. `Arc<Mutex<ConflictEngine>>` is unique so there's no collision risk.

---

### 6. `src-tauri/src/agents/self_register.rs` :: `build_router` + `start_registration_server` (MODIFIED — add param + layer)

**Current state (lines 519–548):**

```rust
#[allow(clippy::too_many_arguments)]
pub fn build_router<R: tauri::Runtime>(
    registry: Arc<AgentRegistry>,
    pool: sqlx::SqlitePool,
    waiters: Arc<WaiterRegistry>,
    app: tauri::AppHandle<R>,
    rate_limiter: Arc<RateLimiter>,
    chat_sessions: Arc<crate::chat_runtime::session_registry::LiveSessionRegistry>,
    mcp_state: Arc<crate::mcp::McpState>,
) -> Router {
    Router::new()
        .route("/register", post(register_agent))
        .route("/hook", post(hook_handler::<R>))
        .route("/mcp", post(crate::mcp::streamable_http::mcp_post_handler::<R>))
        .route("/mcp", get(crate::mcp::streamable_http::mcp_get_handler::<R>))
        .route("/mcp", delete(crate::mcp::streamable_http::mcp_delete_handler::<R>))
        .layer(DefaultBodyLimit::max(HOOK_BODY_MAX_BYTES))
        .layer(Extension(registry))
        .layer(Extension(rate_limiter))
        .layer(Extension(pool))
        .layer(Extension(waiters))
        .layer(Extension(app))
        .layer(Extension(chat_sessions))
        .layer(Extension(mcp_state))
}
```

Also `start_registration_server` at lines 558–606 takes seven named args, calls `build_router(...)`, and spawns the listener.

**Target pattern — add one parameter + one `.layer(Extension(...))`:**

```rust
pub fn build_router<R: tauri::Runtime>(
    registry: Arc<AgentRegistry>,
    pool: sqlx::SqlitePool,
    waiters: Arc<WaiterRegistry>,
    app: tauri::AppHandle<R>,
    rate_limiter: Arc<RateLimiter>,
    chat_sessions: Arc<crate::chat_runtime::session_registry::LiveSessionRegistry>,
    mcp_state: Arc<crate::mcp::McpState>,
    engine: Arc<tokio::sync::Mutex<crate::conflict::engine::ConflictEngine>>,
) -> Router {
    Router::new()
        .route(/* unchanged routes */)
        .layer(DefaultBodyLimit::max(HOOK_BODY_MAX_BYTES))
        .layer(Extension(registry))
        .layer(Extension(rate_limiter))
        .layer(Extension(pool))
        .layer(Extension(waiters))
        .layer(Extension(engine))    // <-- new
        .layer(Extension(app))
        .layer(Extension(chat_sessions))
        .layer(Extension(mcp_state))
}

pub async fn start_registration_server<R: tauri::Runtime>(
    registry: Arc<AgentRegistry>,
    pool: sqlx::SqlitePool,
    waiters: Arc<WaiterRegistry>,
    app_handle: tauri::AppHandle<R>,
    preferred_port: u16,
    chat_sessions: Arc<…>,
    mcp_state: Arc<…>,
    engine: Arc<tokio::sync::Mutex<crate::conflict::engine::ConflictEngine>>,  // <-- new
) -> Result<u16, String> {
    // ...existing body, forward `engine` into build_router(...).
}
```

**Closest analog:** itself — existing layer stack + existing parameter list.

**Gotchas:**
- **One callsite for `start_registration_server`** — `src-tauri/src/lib.rs:267–276`. It already threads seven args. Add the engine handle as an 8th named arg (no defaults, Rust requires explicit).
- **`#[allow(clippy::too_many_arguments)]` is already on `build_router`** (line 519). Keep it.
- **Do not remove `chat_sessions` or `mcp_state`** — unrelated Phase 10 state, Phase 17 just adds alongside.
- **Test-side parallel change** — `spawn_hook_server` in `tests` calls `build_router` directly (line 809); its return tuple grows by one element (see file 7 below). Every `(base, reg, waiters, pool) = spawn_hook_server().await;` call site in existing tests pattern-matches — planner must sweep all tests that destructure the tuple.

---

### 7. `src-tauri/src/agents/self_register.rs` :: `tests::make_hook_pool` + `spawn_hook_server` (MODIFIED)

**Current state — `make_hook_pool` (lines 728–785):**

```rust
pub(crate) async fn make_hook_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new().max_connections(1)
        .connect("sqlite::memory:").await.unwrap();
    sqlx::query(
        "CREATE TABLE approval_requests ( \
            id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, \
            request_type TEXT NOT NULL, file_path TEXT, diff_content TEXT, \
            status TEXT NOT NULL DEFAULT 'pending', urgency TEXT DEFAULT 'medium', \
            response_note TEXT, edited_content TEXT, \
            created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, \
            tool_name TEXT, tool_input_json TEXT, hook_session_id TEXT \
         )",
    ).execute(&pool).await.unwrap();
    // ... protected_paths + agent_events CREATEs ...
    pool
}
```

**Target pattern — extend the `approval_requests` CREATE TABLE with the two new columns (RESEARCH §6 "Test schema"):**

```rust
    sqlx::query(
        "CREATE TABLE approval_requests ( \
            id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, \
            request_type TEXT NOT NULL, file_path TEXT, diff_content TEXT, \
            status TEXT NOT NULL DEFAULT 'pending', urgency TEXT DEFAULT 'medium', \
            response_note TEXT, edited_content TEXT, \
            created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT, \
            tool_name TEXT, tool_input_json TEXT, hook_session_id TEXT, \
            conflict_with_agent_id TEXT, \
            gate_reason TEXT \
         )",
    )
```

**Current state — `spawn_hook_server` (lines 790–824, return tuple):**

```rust
pub(crate) async fn spawn_hook_server() -> (
    String,
    Arc<AgentRegistry>,
    Arc<WaiterRegistry>,
    sqlx::SqlitePool,
) { /* build registry, pool, waiters, mock_app, rate_limiter, router, bind :0 */ }
```

**Target pattern — extend to construct + return the engine handle (RESEARCH §7):**

```rust
pub(crate) async fn spawn_hook_server() -> (
    String,
    Arc<AgentRegistry>,
    Arc<WaiterRegistry>,
    sqlx::SqlitePool,
    Arc<tokio::sync::Mutex<crate::conflict::engine::ConflictEngine>>,
) {
    // ...existing setup...
    let engine = Arc::new(tokio::sync::Mutex::new(
        crate::conflict::engine::ConflictEngine::new(std::time::Duration::from_millis(5000)),
    ));
    let router = build_router(
        registry.clone(), pool.clone(), waiters.clone(),
        app_handle, rate_limiter, chat_sessions, mcp_state,
        engine.clone(),
    );
    // ...existing bind...
    (format!("http://127.0.0.1:{port}"), registry, waiters, pool, engine)
}
```

**Closest analog:** itself — the function is the two-agent fixture; extend in place.

**Gotchas:**
- **Sweep existing call sites.** Every test that does `let (base, _reg, _waiters, pool) = spawn_hook_server().await;` now needs a fifth element (at minimum `_engine`). Known sites: lines 828, 858, and every subsequent `#[tokio::test]` in the `tests` module. Miss one and it's a compile error, not a runtime bug — caught by `cargo check`.
- **Seed a `ConflictState` on the mock app if the hook handler reads the window.** `tauri::test::mock_app` returns a plain AppHandle — planner must call `app.manage(crate::conflict::types::ConflictState::new(5000))` inside `spawn_hook_server` so `app.state::<ConflictState>().get_window_ms()` works in the rewritten gate branch. Mirror `lib.rs:162` `.manage(conflict::ConflictState::new(5000))`.
- **Test isolation:** each test's engine is fresh. Tests that want to pre-seed a write record do `let mut eng = engine.lock().await; eng.update_pid_mapping(pid_a, "KAGENT-A".into()); eng.process_batch(&make_batch(...));` (RESEARCH §7 code sample).

---

### 8. `src-tauri/src/conflict/engine.rs` :: add `could_conflict_with` (MODIFIED)

**Current state — `ConflictEngine` impl block ends at line 155 with `sweep_empty_files`.** No read-only query methods exist today.

**Target pattern — new method on `impl ConflictEngine`, placed after `sweep_empty_files` (lines 152–154):**

```rust
    /// Phase 17: check whether any OTHER live agent wrote to `path` within
    /// the window. Pure read; no state mutation. D-05 self-exclusion, D-14
    /// contract, D-14-amended signature per 17-RESEARCH.md §1 (window_ms is
    /// passed in fresh each call to route around engine.window staleness).
    pub fn could_conflict_with(
        &self,
        path: &std::path::Path,
        except_agent_id: &str,
        now_ms: i64,
        window_ms: i64,
    ) -> Option<String> {
        let records = self.recent_writes.get(path)?;
        records.iter().rev()
            .find(|r| r.agent_id != except_agent_id
                      && now_ms - r.timestamp_ms <= window_ms)
            .map(|r| r.agent_id.clone())
    }
```

**Closest analog (same struct, same data shape):** the existing `process_batch` method at lines 51–141, specifically the inner loop at lines 86–91 that retains records within the window and compares `existing.agent_id != agent_id`. The new method is the "read-only" twin of that check.

**Gotchas:**
- **Signature diverges from CONTEXT D-14** — CONTEXT says `(path, except_agent_id, now_ms) -> Option<String>` but RESEARCH §1 locks the 4th parameter `window_ms: i64`. Planner must amend D-14 in the phase plan footnote or a revised-decisions appendix. Behavior changes from "engine decides window" to "caller decides window" — load-bearing for the D-03 user-configurable knob.
- **`recent_writes` is private** (`struct` field on line 14 has no `pub`). The new method lives on `impl ConflictEngine` so access is free; do NOT expose a getter for `recent_writes`.
- **`rev()` picks the most recent** — mirrors the existing "most recent first" intent (consumer only cares about the latest conflicting peer).
- **Self-exclusion (D-05):** `r.agent_id != except_agent_id`. Matches the `existing.agent_id != agent_id` check at line 91.
- **No mutation, no sweep, no `batch_count`** — do NOT call `evict_expired` from here. The pipeline's `process_batch` is still the sole eviction path; this query just filters at read time.

---

### 9. `src-tauri/src/conflict/engine.rs` :: `mod tests` (MODIFIED — add `phase17` submodule)

**Current state — `mod tests` spans lines 157–432 with 10 tests: `make_batch` helper (lines 163–189), then `test_conflict_detected_*` / `test_no_conflict_*` / `test_evict_expired` / `test_sweep_empty_files` / `test_conflict_alert_serialization` / `test_custom_window_duration`.**

**Target pattern — add a nested `mod phase17` with 5 new tests (VALIDATION §"Per-Task Verification Map"):**

```rust
#[cfg(test)]
mod tests {
    // ...existing 10 tests unchanged...

    mod phase17 {
        use super::*;
        use crate::pipeline::events::Attribution;

        // 1. Basic happy path: different agent, within window.
        #[test]
        fn could_conflict_with_returns_other_agent() {
            let mut engine = ConflictEngine::new(Duration::from_secs(5));
            let file = PathBuf::from("/repo/foo.rs");
            let batch = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
            engine.process_batch(&batch);
            let found = engine.could_conflict_with(&file, "PID-200", 3000, 5000);
            assert_eq!(found.as_deref(), Some("PID-100"));
        }

        // 2. Self-exclusion (D-05).
        #[test]
        fn could_conflict_with_excludes_self() { /* seed PID-100 write, query as PID-100 → None */ }

        // 3. Outside window (D-03).
        #[test]
        fn could_conflict_with_respects_window() { /* write at 1000, query at 7000 with window 5000 → None */ }

        // 4. No record on file → None.
        #[test]
        fn could_conflict_with_no_record_returns_none() { /* fresh engine, query foo.rs → None */ }

        // 5. Multiple records — returns most recent.
        #[test]
        fn could_conflict_with_returns_most_recent() { /* seed PID-100 @ 1000, PID-200 @ 2000; query as PID-300 @ 3000 → Some("PID-200") */ }
    }
}
```

**Closest analog:** lines 192–211 — `test_conflict_detected_different_pids_within_window`. The `make_batch` helper at lines 165–172 is shared; `phase17` submodule re-imports via `use super::*;`.

**Gotchas:**
- **Helper reuse:** `use super::*;` inside `mod phase17` pulls `make_batch`, `ConflictEngine`, `Duration`. Do not re-import `PathBuf` if superimports already include it.
- **Test names in VALIDATION.md are load-bearing** — `could_conflict_with_returns_other_agent`, `could_conflict_with_excludes_self`, `could_conflict_with_respects_window`. VALIDATION's per-task table pins these exact names for `cargo test` commands; rename only if VALIDATION is updated in lockstep.
- **An optional `lock_contention_under_burst` perf test** (VALIDATION row 15) is `#[ignore]` by default and lives in `phase17` too. Skip unless planner explicitly schedules it.

---

### 10. `src-tauri/src/conflict/types.rs` (MODIFIED — optional, Claude's Discretion)

**Current state — file defines `FileWriteRecord`, `ConflictAlert`, `ConflictState`. No `GateReason` enum.**

**Target pattern (if planner chooses typed enum path — RESEARCH §Open Question 1 recommends YES):**

```rust
/// Phase 17 D-20: reason a PreToolUse row was gated. Persisted as a string
/// at the DB boundary (serde-renamed to snake_case) so migration 007's
/// nullable TEXT column round-trips cleanly. specta::Type exports as a TS
/// union to `src/bindings.ts` — ApprovalRequestCard keys its conditional
/// rendering off the TS union directly (no ad-hoc string compare).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum GateReason {
    FileConflict,
    ProtectedPath,
    Unknown,
}

impl GateReason {
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Self::FileConflict => "file_conflict",
            Self::ProtectedPath => "protected_path",
            Self::Unknown => "unknown",
        }
    }
}
```

**Closest analog:** `src-tauri/src/agents/adapter.rs:20–28` — `AgentState` enum shape is exactly what `GateReason` mirrors (serde rename, specta::Type derive, tiny-set variant list):

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentState {
    Running, Idle, Waiting, Conflict, Error,
}
```

**Gotchas:**
- **`rename_all = "snake_case"` not `"camelCase"`** — the DB column stores `'file_conflict'` / `'protected_path'` / `'unknown'` (D-20 locks these exact strings). `AgentState` uses camelCase because its JSON wire format does; `GateReason` uses snake_case because its *DB storage* format does. The TS union therefore is `'file_conflict' | 'protected_path' | 'unknown'` (matches the D-21 ApprovalRequest extension).
- **Bindings regen required after adding `specta::Type`** — run `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc` (VALIDATION canonical command). Register the type in `lib.rs` specta builder: `.typ::<conflict::types::GateReason>()`.
- **Planner may skip the enum entirely** (CONTEXT §"Claude's Discretion" + deferred §"GateReason typed enum"): use string at DB and IPC boundary. If skipped, `ApprovalRequest.gate_reason: Option<String>` and the TS surface is `gateReason?: string`. The ConflictChip TS union (`'file_conflict' | 'protected_path' | 'unknown'`) lives only in component props. This is acceptable for v1.
- **`Copy` impl is cheap** (enum with no data) and prevents accidental moves. Keep it.

---

### 11. `src-tauri/src/pipeline/commands.rs` :: `conflict_task` (MODIFIED — lines 176–202)

**Current state (lines 176–202):**

```rust
    // Spawn conflict engine task: ...
    let conflict_window_ms = conflict_state.get_window_ms();
    let app_handle_clone = app_handle.clone();
    let conflict_task = tokio::spawn(async move {
        let mut engine = ConflictEngine::new(Duration::from_millis(conflict_window_ms));
        while let Ok(batch) = conflict_rx.recv().await {
            let alerts = engine.process_batch(&batch);
            for alert in alerts {
                emit_conflict_event(&app_handle_clone, &alert);
                let notification_state_ref = app_handle_clone.state::<NotificationState>();
                let prefs = notification_state_ref.get_prefs().await;
                dispatch_state_notification(
                    &app_handle_clone, &alert.agent_a_id,
                    &AgentState::Conflict, &prefs,
                );
                let conflict_state_ref = app_handle_clone.state::<ConflictState>();
                conflict_state_ref.add_alert(alert).await;
            }
        }
    });
```

**Target pattern — accept the shared `Arc<Mutex<ConflictEngine>>` instead of constructing local (RESEARCH §1):**

```rust
    // Phase 17: engine is shared with /hook — pull from managed state instead
    // of constructing local. Read window at startup still; the runtime setter
    // (`set_window_ms` on ConflictState) plumbs to this task via a future
    // refactor (OUT OF PHASE 17 SCOPE — noted in RESEARCH §1 "Staleness").
    let engine: Arc<tokio::sync::Mutex<ConflictEngine>> = app_handle
        .state::<Arc<tokio::sync::Mutex<ConflictEngine>>>()
        .inner()
        .clone();
    let app_handle_clone = app_handle.clone();
    let conflict_task = tokio::spawn(async move {
        while let Ok(batch) = conflict_rx.recv().await {
            // Pitfall 1: scope lock tightly; release BEFORE emit/notification awaits.
            let alerts = {
                let mut eng = engine.lock().await;
                eng.process_batch(&batch)
            };
            for alert in alerts {
                emit_conflict_event(&app_handle_clone, &alert);
                let notification_state_ref = app_handle_clone.state::<NotificationState>();
                let prefs = notification_state_ref.get_prefs().await;
                dispatch_state_notification(
                    &app_handle_clone, &alert.agent_a_id,
                    &AgentState::Conflict, &prefs,
                );
                let conflict_state_ref = app_handle_clone.state::<ConflictState>();
                conflict_state_ref.add_alert(alert).await;
            }
        }
    });
```

**Closest analog:** `src-tauri/src/lib.rs:221–276` — the `WaiterRegistry` is constructed once at setup (`WaiterRegistry::new_arc()`), stashed on managed state with `.manage(waiters.clone())`, and handed into `start_registration_server` by clone. Phase 17 follows the same recipe for `ConflictEngine`.

**Gotchas:**
- **Pitfall 1 (lock across await):** the existing code calls `dispatch_state_notification` and `conflict_state_ref.add_alert(alert).await` inside the same loop iteration. Do NOT hold the engine lock across these — confine the lock to `process_batch`, then iterate `alerts` outside. RESEARCH §1 is explicit: "release the lock before dispatching the resulting alerts to avoid holding it across Tauri `emit`s and `NotificationState` awaits."
- **`conflict_window_ms` binding goes away** — the shared engine is constructed once in `lib.rs` with 5000ms default. The "engine window staleness" bug (RESEARCH §1) remains out-of-scope; just document in the plan's "known existing issues" section.
- **`app.manage(Arc::new(Mutex::new(...)))` must run BEFORE `start_watch` can fire** — since `start_watch` is a Tauri command callable any time after setup completes, place the `.manage` in `lib.rs` `.setup` closure alongside the existing `WaiterRegistry` registration (line 223). Setup is synchronous up to the `tauri::async_runtime::spawn(async move { ... start_registration_server ... })` call (line 266).
- **Do NOT remove `let conflict_window_ms = conflict_state.get_window_ms();`** from earlier in `start_watch` if it's still used to size anything else — `rg "conflict_window_ms"` in this file to verify.

---

### 12. `src-tauri/src/lib.rs` :: register engine state + thread through start_registration_server (MODIFIED)

**Current state — relevant excerpts:**

Line 162 (ConflictState registration):
```rust
        .manage(conflict::ConflictState::new(5000))
```

Lines 221–223 (WaiterRegistry pattern — the model to mirror):
```rust
            let waiters: Arc<agents::hook_waiters::WaiterRegistry> =
                agents::hook_waiters::WaiterRegistry::new_arc();
            app.manage(waiters.clone());
```

Lines 264–276 (threading waiters into start_registration_server):
```rust
            let waiters_for_server = waiters.clone();
            let app_for_server = app.handle().clone();
            /* ... */
            tauri::async_runtime::spawn(async move {
                match agents::self_register::start_registration_server(
                    registry_clone, pool_for_server, waiters_for_server,
                    app_for_server, 9417,
                    chat_sessions_for_server, mcp_state_for_server,
                ).await { /* ... */ }
            });
```

**Target pattern — add one engine registration block + one additional arg (D-15, D-16):**

```rust
            // Phase 17 D-15: ConflictEngine shared between /hook (query) and
            // pipeline/commands.rs conflict_task (write). tokio::sync::Mutex
            // for async-friendly locking across .await — matches WaiterRegistry.
            let conflict_engine: Arc<tokio::sync::Mutex<conflict::engine::ConflictEngine>> =
                Arc::new(tokio::sync::Mutex::new(
                    conflict::engine::ConflictEngine::new(std::time::Duration::from_millis(5000))
                ));
            app.manage(conflict_engine.clone());

            /* ... existing blocks ... */

            let engine_for_server = conflict_engine.clone();
            tauri::async_runtime::spawn(async move {
                match agents::self_register::start_registration_server(
                    registry_clone, pool_for_server, waiters_for_server,
                    app_for_server, 9417,
                    chat_sessions_for_server, mcp_state_for_server,
                    engine_for_server,  // <-- new 8th arg
                ).await { /* ... */ }
            });
```

**Closest analog:** the 3-line `WaiterRegistry::new_arc() + .manage + _for_server = .clone() + pass into start_registration_server` pattern at lines 221–276 is the exact template. Four minor inline rewrites.

**Gotchas:**
- **Import `conflict::engine::ConflictEngine`** — the `mod conflict;` at line 4 is already private; the path `conflict::engine::ConflictEngine` works because `engine` is `pub mod` inside. Verify with `rg "pub mod engine" src-tauri/src/conflict/mod.rs` (current state expected: public).
- **5000ms default is the phase-start window** — matches `ConflictState::new(5000)` on line 162. Both magic numbers should live next to each other or behind a shared const. Planner may introduce `const DEFAULT_CONFLICT_WINDOW_MS: u64 = 5000;` in `conflict/types.rs` and have both sites read it.
- **`.manage()` requires `Send + Sync + 'static`** — `Arc<tokio::sync::Mutex<ConflictEngine>>` satisfies this (tokio's Mutex is Send+Sync; ConflictEngine contains only Send types — HashMap<PathBuf, Vec<…>>). Verified via compile.
- **Ordering inside `.setup`** — the `conflict_engine` binding must be introduced BEFORE the `tauri::async_runtime::spawn(async move { start_registration_server(...) })` that consumes it (line 266). Place it near the existing waiters block (line 221).

---

### 13. `src-tauri/src/comms/commands.rs` :: `create_approval_request_internal` (MODIFIED — lines 106–148)

**Current state (lines 106–148):**

```rust
#[allow(clippy::too_many_arguments)]
pub async fn create_approval_request_internal<R: tauri::Runtime>(
    agent_id: &str,
    request_type: &str,
    file_path: Option<&str>,
    diff_content: Option<&str>,
    urgency: &str,
    tool_name: Option<&str>,
    tool_input_json: Option<&str>,
    session_id: Option<&str>,
    pool: &Pool<Sqlite>,
    app_handle: &tauri::AppHandle<R>,
) -> Result<ApprovalRequest, String> {
    let row = sqlx::query(
        "INSERT INTO approval_requests \
         (agent_id, request_type, file_path, diff_content, urgency, tool_name, tool_input_json, hook_session_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         RETURNING id, agent_id, request_type, file_path, diff_content, status, urgency, \
                   response_note, edited_content, created_at, resolved_at, \
                   tool_name, tool_input_json, hook_session_id",
    )
    .bind(agent_id).bind(request_type).bind(file_path)
    .bind(diff_content).bind(urgency).bind(tool_name)
    .bind(tool_input_json).bind(session_id)
    .fetch_one(pool).await.map_err(|e| format!("insert approval_request failed: {e}"))?;

    let req = map_approval_row(&row);
    let _ = app_handle.emit("approval-request-created", &req);
    dispatch_approval_notification(app_handle, agent_id, file_path, Some(req.id));
    Ok(req)
}
```

**Target pattern — add two optional params; thread into INSERT + dispatch (D-21, D-23):**

```rust
#[allow(clippy::too_many_arguments)]
pub async fn create_approval_request_internal<R: tauri::Runtime>(
    agent_id: &str,
    request_type: &str,
    file_path: Option<&str>,
    diff_content: Option<&str>,
    urgency: &str,
    tool_name: Option<&str>,
    tool_input_json: Option<&str>,
    session_id: Option<&str>,
    conflict_with_agent_id: Option<&str>,  // <-- new D-21
    gate_reason: Option<&str>,              // <-- new D-21
    pool: &Pool<Sqlite>,
    app_handle: &tauri::AppHandle<R>,
) -> Result<ApprovalRequest, String> {
    let row = sqlx::query(
        "INSERT INTO approval_requests \
         (agent_id, request_type, file_path, diff_content, urgency, tool_name, tool_input_json, hook_session_id, conflict_with_agent_id, gate_reason) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         RETURNING id, agent_id, request_type, file_path, diff_content, status, urgency, \
                   response_note, edited_content, created_at, resolved_at, \
                   tool_name, tool_input_json, hook_session_id, conflict_with_agent_id, gate_reason",
    )
    .bind(agent_id).bind(request_type).bind(file_path)
    .bind(diff_content).bind(urgency).bind(tool_name)
    .bind(tool_input_json).bind(session_id)
    .bind(conflict_with_agent_id).bind(gate_reason)
    .fetch_one(pool).await.map_err(|e| format!("insert approval_request failed: {e}"))?;

    let req = map_approval_row(&row);
    let _ = app_handle.emit("approval-request-created", &req);
    // D-23: notification payload grows a conflictAgentId field; body
    // prefixes "⚠ CONFLICT: " when present.
    dispatch_approval_notification(app_handle, agent_id, file_path, Some(req.id) /* + conflict_with_agent_id per D-23 */);
    Ok(req)
}
```

Also update `map_approval_row` (lines 66–85) to read the new columns:

```rust
fn map_approval_row(row: &sqlx::sqlite::SqliteRow) -> ApprovalRequest {
    ApprovalRequest {
        /* ...existing fields... */
        // Phase 17 additions — optional, NULL on legacy rows per D-20.
        conflict_with_agent_id: row.try_get("conflict_with_agent_id").ok().flatten(),
        gate_reason: row.try_get("gate_reason").ok().flatten(),
    }
}
```

And update `ApprovalRequest` in `src-tauri/src/comms/types.rs` (lines 10–25) to add the two fields:

```rust
pub struct ApprovalRequest {
    /* ...existing... */
    pub conflict_with_agent_id: Option<String>,
    pub gate_reason: Option<String>,  // or Option<GateReason> if planner picks the enum path (file 10)
}
```

**Closest analog:** the function itself. The signature is already `#[allow(clippy::too_many_arguments)]` (line 106) so adding two more is fine. The `map_approval_row` pattern of `row.try_get("col").ok().flatten()` is the established idiom for optional columns that may not exist on legacy rows (see lines 81–83 for `tool_name`/`tool_input_json`/`hook_session_id`).

**Gotchas:**
- **Single callsite for `create_approval_request_internal`** — hook_handler at `src-tauri/src/agents/self_register.rs:307`. One other backend-internal caller may exist via the protected-path trigger; verify via `rg "create_approval_request_internal" src-tauri/`. Each caller passes `None, None` for the new params unless they're the rewritten gate branch (which passes `conflict_with.as_deref(), Some(gate_reason)`).
- **camelCase at JSON boundary** — `#[serde(rename_all = "camelCase")]` on `ApprovalRequest` (line 9 of types.rs) auto-maps `conflict_with_agent_id` → `conflictWithAgentId` and `gate_reason` → `gateReason`. The frontend TS interface (`src/stores/commsStore.ts:17-33`) picks these up via specta regen — no manual TS edit needed if types.rs uses serde+specta correctly.
- **Frontend binding regen** (VALIDATION §"Test Infrastructure"): `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc`. Watch `src/bindings.ts` for the `ApprovalRequest` type to gain the two optional fields.
- **Notification body** (D-23): the `dispatch_approval_notification` helper at lines 28–60 of this file needs a new optional `conflict_agent_id: Option<&str>` parameter so the body string can prefix `⚠ CONFLICT: `. Mirror the existing `request_id` handling (it threads through as optional, formatted into body only when `Some`).
- **INSERT + RETURNING column list must match `map_approval_row` reads** — if you add the columns to one you must add to the other. SQLite's `RETURNING *` would eliminate this coupling but the existing code spells out columns; stay consistent.

---

### 14. `src/views/CommsHub/ApprovalRequestCard.tsx` (MODIFIED — add conflict line)

**Current state — the conditional-rendering pattern at lines 77–113:**

```tsx
      {/* Agent ID + Urgency + ToolBadge */}
      <div className={`flex items-center justify-between gap-2 ${contentOpacity}`}>
        <span className="font-mono text-xs font-bold text-on-surface truncate">
          {request.agentId}
        </span>
        <div className="flex items-center gap-2">
          <UrgencyBadge urgency={request.urgency} />
          {isPretool && <ToolBadge toolName={request.toolName} />}
        </div>
      </div>

      {/* Request type */}
      <div className={`mt-1 ${contentOpacity}`}>
        <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
          {request.requestType.replace(/_/g, ' ')}
        </span>
      </div>

      {/* File path */}
      <div className={`mt-1 ${contentOpacity}`}>
        <span
          className="font-mono text-xs text-on-surface-variant truncate block"
          title={request.filePath ?? undefined}
        >
          {truncatedPath}
        </span>
      </div>

      {/* Preview line (pretool_use only) */}
      {preview && (
        <div className={`mt-2 ${contentOpacity}`}>
          <span className="font-mono text-[10px] leading-[1.4] tracking-[-0.025em] text-on-surface-variant truncate block overflow-hidden whitespace-nowrap">
            <span className={GLYPH_CLASS[preview.glyphColor]}>{preview.glyph}</span>
            {preview.content ? <> {preview.content}</> : null}
          </span>
        </div>
      )}
```

**Target pattern — inject a conflict/protected line beneath the file-path block, before the preview (D-22):**

```tsx
      {/* File path */}
      <div className={`mt-1 ${contentOpacity}`}>
        <span className="font-mono text-xs text-on-surface-variant truncate block" title={request.filePath ?? undefined}>
          {truncatedPath}
        </span>
      </div>

      {/* Phase 17 D-22: Conflict / Protected-path line. Renders nothing on
          legacy rows (both fields null) or when gateReason === 'unknown'. */}
      {request.gateReason === 'file_conflict' && (
        <div className={`mt-1 ${contentOpacity}`}>
          <span className="font-headline text-[10px] uppercase tracking-widest text-error">
            ⚠ CONFLICT with {request.conflictWithAgentId ?? 'unknown'}
          </span>
        </div>
      )}
      {request.gateReason === 'protected_path' && (
        <div className={`mt-1 ${contentOpacity}`}>
          <span className="font-headline text-[10px] uppercase tracking-widest text-[#ffd16f]">
            🔒 PROTECTED path
          </span>
        </div>
      )}

      {/* Preview line (pretool_use only) — UNCHANGED */}
      {preview && ( /* ... */ )}
```

If planner extracts to `ConflictChip` (file 3), the render collapses to:

```tsx
      {request.gateReason && request.gateReason !== 'unknown' && (
        <div className={`mt-1 ${contentOpacity}`}>
          <ConflictChip
            reason={request.gateReason as 'file_conflict' | 'protected_path'}
            conflictWithAgentId={request.conflictWithAgentId}
          />
        </div>
      )}
```

**Closest analog:** the file's own `{isPretool && <ToolBadge toolName={request.toolName} />}` (line 84) and `{preview && (...)}` (lines 106–113) — same idiom: short-circuit on optional field, render a styled span inside a margin wrapper.

**Gotchas:**
- **New fields `gateReason` / `conflictWithAgentId` come from regen'd bindings** — do NOT hand-edit `src/bindings.ts`. Run the canonical regen command after the Rust changes land (VALIDATION).
- **`commsStore.ts` ApprovalRequest interface (lines 17–33)** is the TS-side source of truth for the hand-written store type — update it in lockstep with the auto-regenerated `bindings.ts` so the destructure in this component stays typed. Add `gateReason?: 'file_conflict' | 'protected_path' | 'unknown' | null; conflictWithAgentId?: string | null;` near the `toolName` / `toolInputJson` / `sessionId` trio (lines 30–32).
- **Exact strings locked by D-22:** `⚠ CONFLICT with {agentId}` and `🔒 PROTECTED path`. Frontend test `cd src && npm run test -- ApprovalRequestCard` asserts these strings; typos break CI.
- **Abandoned rows must still render the chip** (or hide — D-22 says "no-conflict rows render nothing extra" but says nothing about abandoned-with-conflict). Simplest posture: wrap inside the existing `contentOpacity` scope so abandoned chips dim with the rest of the card. Already handled above by the `${contentOpacity}` class on the wrapper div.
- **`text-error` is the semantic token** for conflict amber; `#ffd16f` literal matches `UrgencyBadge`/`StatusBadge` warning tint for protected path. Do NOT invent new colors; consistency with existing badges is a design-system requirement.

---

### 15. `src-tauri/Cargo.toml` (MODIFIED — promote shlex + add path-clean)

**Current state — `[dependencies]` at lines 18–70 (the Phase 8 block runs lines 72–73):**

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-opener = "2"
...
glob = "0.3"
...
uuid = { version = "1", features = ["v4"] }

# Phase 8: PreToolUse hook integration dependencies
tauri-plugin-shell = "2"
```

**Target pattern — add a Phase 17 block just after the Phase 8 block (line 73):**

```toml
# Phase 8: PreToolUse hook integration dependencies
tauri-plugin-shell = "2"

# Phase 17: conflict-triggered PreToolUse gating
# shlex 1.3.0 is already in Cargo.lock (transitive via `cc`). Promoting to
# direct dep surfaces `shlex::split` without adding bytes at build time.
# RUSTSEC-2024-0006 was patched in 1.2.1 — 1.3.0 is current. (17-RESEARCH §2)
shlex = "1.3"
# Lexical path normalization for D-02 "file does not exist yet" branch.
# 0-dep, implements Plan 9 cleanname / Go path.Clean. (17-RESEARCH §3)
path-clean = "1.0"
```

**Closest analog:** the Phase 8 single-line block at lines 72–73 and the Phase 9 block at lines 60–64 (both add just 1–4 lines with a header comment). Follow the "phase header comment + one dep per line" convention.

**Gotchas:**
- **shlex is already in `Cargo.lock`** (RESEARCH §2 verified against line 4521–4525) — promoting costs zero bytes. Verify post-add: `cargo tree | grep shlex` should show the direct edge plus the transitive edge from `cc`.
- **`path-clean` adds 1 crate, 0 transitive deps** (RESEARCH §3). Compiled size ≈1 KB. Planner may hand-roll the ~30-LOC equivalent to avoid the dep — CONTEXT §"Claude's Discretion" permits either. If hand-rolled, put it in `src-tauri/src/agents/bash_paths.rs` or a new `src-tauri/src/path_util.rs`; do NOT inline in `self_register.rs`.
- **No feature flags needed** — both crates are plain `features = []`.
- **Do NOT add `shell-words`** — RESEARCH §2 explicitly recommends shlex over shell-words because shlex is already in lock. Adding shell-words duplicates functionality.
- **Run `cargo check` immediately after editing Cargo.toml** — an invalid manifest blocks every downstream Rust task.

---

### 16. `src-tauri/src/agents/mod.rs` (MODIFIED — one line addition)

**Current state (lines 1–15):**

```rust
pub mod adapter;
pub mod registry;
pub mod claude_code;
pub mod codex;
pub mod opencode;
pub mod generic;
pub mod launcher;
pub mod self_register;
pub mod notifications;
pub mod commands;

// Phase 8: Real Claude Code hook integration (PreToolUse approvals).
pub mod hook_install;
pub mod hook_waiters;
```

**Target pattern — add one line with a phase-scoped comment:**

```rust
// Phase 8: Real Claude Code hook integration (PreToolUse approvals).
pub mod hook_install;
pub mod hook_waiters;

// Phase 17: Bash command → target-path extractor for conflict-gate predicate.
pub mod bash_paths;
```

**Closest analog:** lines 12–14 — the Phase 8 2-line block with its `// Phase 8:` header comment. Phase 17 adds one more block of the same shape.

**Gotchas:**
- **`pub mod`, not `mod`** — the new module is called from `self_register.rs::hook_handler` via `crate::agents::bash_paths::extract_target_paths(...)`. Private would break that.
- **No re-exports required** — unlike `adapter::{AgentAdapter, AgentInfo, AgentState}` re-exported at line 16 (canonical trait + core types), `bash_paths`'s `extract_target_paths` is a call-site-only function; keep it behind the full path.

---

## Shared Patterns

### Shared Pattern A: `Arc<tokio::sync::Mutex<…>>` for axum-Extension-shared async state

**Source:** `src-tauri/src/lib.rs:221–223` + `src-tauri/src/agents/self_register.rs:542–548`.

**Apply to:** `ConflictEngine` state sharing (files 5, 6, 11, 12).

**Idiom — construct once at `.setup`, manage clone, pass clone to `start_registration_server`, layer clone as `Extension`:**

```rust
// Setup (lib.rs):
let thing: Arc<tokio::sync::Mutex<Thing>> = Arc::new(tokio::sync::Mutex::new(Thing::new()));
app.manage(thing.clone());
// ...
let thing_for_server = thing.clone();
tauri::async_runtime::spawn(async move {
    start_registration_server(..., thing_for_server).await;
});

// build_router (self_register.rs):
pub fn build_router(..., thing: Arc<tokio::sync::Mutex<Thing>>) -> Router {
    Router::new()
        .route(...)
        .layer(Extension(thing))
}

// hook_handler (self_register.rs):
async fn hook_handler(Extension(thing): Extension<Arc<tokio::sync::Mutex<Thing>>>, ...) {
    // Pitfall 1: scope tight.
    let result = { let g = thing.lock().await; g.query(...) };
    // now .await other things — guard already dropped.
}
```

### Shared Pattern B: Structured `tracing` with `kind = "…"` key

**Source:** `src-tauri/src/pipeline/passive_bridge.rs:55–56, 181–182` (no explicit `kind` key today, but `self_register.rs` uses the convention via Phase 8 code). Phase 17 VALIDATION §"Tracing Keys" locks five new keys.

**Apply to:** `bash_paths.rs` (`kind = "bash_parse"`), `self_register.rs` hook_handler (`kind = "hook_gate"`, `"hook_allow"`, `"hook_lock_wait"`), `engine.rs::could_conflict_with` (`kind = "conflict_query"`).

**Idiom:**

```rust
tracing::info!(
    kind = "hook_gate",
    reason = gate_reason,
    agent = %agent_id,
    file = ?gate_file_path_str,
    conflict_with = ?conflict_with,
    "gating PreToolUse"
);
```

- `kind = "…"` first (machine-readable filter key).
- `%value` for Display, `?value` for Debug (`std::fmt` formatting specs).
- Free-form message string last.
- Default log level is `info` — so `hook_gate` hits logs always; `bash_parse`, `conflict_query`, `hook_lock_wait` only on `RUST_LOG=debug` or `trace`.

### Shared Pattern C: Additive sqlx migration file in `src-tauri/src/db/migrations/`

**Source:** `src-tauri/src/db/migrations/005_pretool_use_hooks.sql` (full file).

**Apply to:** `007_conflict_gating.sql` (file 2).

**Idiom:**
1. Top-of-file comment: phase number + what it adds + why it's additive + refs to CONTEXT decision IDs.
2. `ALTER TABLE x ADD COLUMN` only — no `DROP`, no renames, no data transforms that can fail mid-migration.
3. No `CHECK` constraints (migrations 001–004 omit them; validate in Rust via serde instead).
4. Index only if a query path exists today — don't preemptively index.
5. File name: `NNN_slug.sql` where `NNN` is the next zero-padded integer and `slug` is `snake_case_feature_name`.

### Shared Pattern D: `specta::Type` derive + bindings regen

**Source:** `src-tauri/src/agents/adapter.rs:20–28` (AgentState) + `src-tauri/src/comms/types.rs:8–25` (ApprovalRequest).

**Apply to:** `GateReason` enum in `conflict/types.rs` (file 10, if planner takes the enum path); `ApprovalRequest` extension for two new fields.

**Idiom:**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]  // or camelCase depending on wire format
pub enum MyEnum { Variant1, Variant2 }
```

- Register in `lib.rs` specta builder: `.typ::<conflict::types::GateReason>()` near line 112.
- **Regen command (Phase 18 D-03 canonical, VALIDATION-cited):**
  ```
  cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc
  ```
- `src/bindings.ts` is `@ts-nocheck`'d at top (lib.rs:143) so trailing-comma / unused-import warnings are fine. Never hand-edit.

---

## No Analog Found

Every Phase 17 file has at least a role-match analog. Zero gap-fills required.

---

## Metadata

**Analog search scope:**
- `src-tauri/src/agents/` (all 10 modules read or scanned)
- `src-tauri/src/conflict/` (engine.rs + types.rs + commands.rs scanned)
- `src-tauri/src/comms/` (commands.rs + types.rs + app_settings.rs read)
- `src-tauri/src/pipeline/` (commands.rs relevant sections + ignore_filter.rs + passive_bridge.rs tracing references)
- `src-tauri/src/db/migrations/` (005 + 006 fully read, template for 007)
- `src-tauri/src/lib.rs` (full)
- `src-tauri/Cargo.toml` (full)
- `src/views/CommsHub/ApprovalRequestCard.tsx` (full)
- `src/components/ui/{UrgencyBadge,StatusBadge,ToolBadge}.tsx` (full)
- `src/stores/commsStore.ts` (ApprovalRequest interface lines 17–33)

**Files scanned:** 15 Rust source files + 3 TS source files + 2 SQL migrations + 2 manifests = 22 files.

**Pattern extraction date:** 2026-04-21.

**Cross-references:** `17-CONTEXT.md` (23 D-* decisions), `17-RESEARCH.md` (§§1–7 + Common Pitfalls + §"Tracing Keys"), `17-VALIDATION.md` (Per-Task Verification Map + Wave 0 Requirements).

## PATTERN MAPPING COMPLETE
