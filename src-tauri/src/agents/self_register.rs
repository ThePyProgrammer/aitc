//! Self-registration HTTP server for externally-launched agents.
//!
//! Two routes, both bound on 127.0.0.1 only:
//!   - POST /register — external agents announce themselves (Phase 3).
//!   - POST /hook     — Claude Code PreToolUse hook sidecar checkpoints
//!                      mutating tool calls (Phase 8, D-07 long-held HTTP).
//!
//! Threat mitigations:
//! - T-03-04 / T-08-01: Binds to 127.0.0.1 only (no 0.0.0.0).
//! - T-03-04 / T-08-03: Validates PID actually exists before accepting.
//! - T-03-07 / T-08-Rate: 10 req/sec shared rate limiter.
//! - T-08-02: WaiterRegistry state is behind tokio::sync::Mutex; the
//!   AbandonGuard drop path treats the UPDATE as an atomic gate
//!   (rows_affected == 0 => skip signal).
//! - T-08-04: 2 MB body cap via axum DefaultBodyLimit.
//! - T-08-05: tool_input must be an object; parameterised SQL via sqlx.

use crate::agents::adapter::{AgentInfo, AgentState};
use crate::agents::hook_waiters::{HookDecision, WaiterEntry, WaiterRegistry};
use crate::agents::registry::AgentRegistry;
use crate::comms::commands::create_approval_request_internal;
use axum::{
    extract::{DefaultBodyLimit, Extension},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

/// Payload sent by an external agent to register itself with AITC.
#[derive(Debug, Clone, Deserialize)]
pub struct RegisterPayload {
    pub agent_type: String,
    pub pid: u32,
    pub cwd: String,
    pub intent: Option<String>,
    pub protocol: Option<String>,
}

/// Response returned after successful registration.
#[derive(Debug, Serialize)]
struct RegisterResponse {
    id: String,
}

/// Simple rate limiter: tracks registration count per second.
///
/// WR-06: Uses a `tokio::sync::Mutex<(window, count)>` instead of two separate
/// atomics. The previous CAS-based reset had a race where threads crossing
/// the window boundary could double-count or slip past the cap. At 10 rps
/// the lock contention is negligible and the logic becomes obviously correct.
pub struct RateLimiter {
    inner: Mutex<(u64, u64)>, // (window_secs, count)
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new((
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                0,
            )),
        }
    }

    /// Returns true if the request is allowed (under 10/sec).
    pub async fn check(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut g = self.inner.lock().await;
        if g.0 != now {
            *g = (now, 0);
        }
        g.1 += 1;
        g.1 <= 10 // T-03-07 / T-08-Rate: max 10 requests per second (shared)
    }
}

// ---------------------------------------------------------------------------
// POST /hook types + handler (Phase 8, D-07 long-held HTTP)
// ---------------------------------------------------------------------------

/// Body the sidecar POSTs to /hook. Mirrors `aitc_hook::HookRequest` in the
/// Plan 01 sidecar crate (contract-locked).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HookRequest {
    pub pid: u32,
    pub session_id: Option<String>,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub cwd: Option<String>,
}

/// Response the sidecar receives on /hook. Wire-shape matches
/// `aitc_hook::AitcDecision`.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AitcDecisionResponse {
    Allow,
    AllowWithEdits { updated_input: serde_json::Value },
    Deny { reason: String },
}

/// Mirror of `Serialize for AitcDecisionResponse` that we use inside tests to
/// deserialize the response body with serde. The production Response path uses
/// Serialize only.
#[cfg(test)]
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AitcDecisionResponseDe {
    Allow,
    AllowWithEdits { updated_input: serde_json::Value },
    Deny { reason: String },
}

/// Max bytes accepted on the /hook body. T-08-04 mitigation — prevents an
/// unbounded tool_input_json from OOMing the backend. 2 MiB is generous for
/// every real tool envelope we've seen.
const HOOK_BODY_MAX_BYTES: usize = 2 * 1024 * 1024;

/// Query all protected_paths globs and return true if `file_path` matches
/// any. Used for D-21 OR-semantics gating (Read/LS can still trigger a row
/// when the file matches a user-configured protected glob).
async fn protected_path_matches(pool: &sqlx::SqlitePool, file_path: &str) -> bool {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT glob_pattern FROM protected_paths")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    for (pat,) in rows {
        if let Ok(g) = glob::Pattern::new(&pat) {
            if g.matches(file_path) {
                return true;
            }
        }
    }
    false
}

/// Resolve `agent_id` for a /hook request. Lookup order:
///   1. Session binding (Pitfall 7 opt 4 — primary correlation key).
///   2. PID lookup in the registry.
///   3. Auto-create `PASSIVE-{pid}` stub (D-12, reuses Phase 6 D-06 path).
///
/// When session_id is present and the binding either does not exist or
/// points to an unknown agent, rebind to whatever the PID-path resolves to
/// so a /hook with session_id re-asserts attribution each call.
///
/// Phase 17 D-15b amendment (17-RESEARCH §Pitfall 5): after the canonical
/// `agent_id` is resolved, acquire the engine lock briefly and record the
/// PID→agent_id mapping so future `process_batch` write records carry
/// `KAGENT-*` / `PASSIVE-*` IDs instead of falling through to the
/// `format!("PID-{pid}")` default. Without this wire-up the liveness gate
/// in `hook_handler` (which does `registry.get_agent(other_id)`) never
/// matches and conflicts are under-gated.
async fn resolve_or_create_agent(
    registry: &AgentRegistry,
    waiters: &WaiterRegistry,
    engine: &Arc<Mutex<crate::conflict::engine::ConflictEngine>>,
    pid: u32,
    session_id: Option<&str>,
    cwd: Option<&str>,
) -> String {
    let agent_id = resolve_or_create_agent_inner(registry, waiters, pid, session_id, cwd).await;

    // D-15b: propagate PID→agent_id into the shared engine so write records
    // carry canonical IDs (not `PID-{pid}`). Lock held only for the single
    // HashMap insert — drop before any further await.
    {
        let mut eng = engine.lock().await;
        eng.update_pid_mapping(pid, agent_id.clone());
    }

    agent_id
}

/// Inner resolver — unchanged 3-branch lookup from Phase 8. Split out of
/// `resolve_or_create_agent` so the D-15b engine wire-up can happen at a
/// single post-resolution site (Phase 17 Plan 05 Task 2).
async fn resolve_or_create_agent_inner(
    registry: &AgentRegistry,
    waiters: &WaiterRegistry,
    pid: u32,
    session_id: Option<&str>,
    cwd: Option<&str>,
) -> String {
    // 1. Session binding fast path.
    if let Some(sid) = session_id {
        if let Some(agent_id) = waiters.agent_for_session(sid).await {
            if registry.get_agent(&agent_id).await.is_some() {
                return agent_id;
            }
        }
    }
    // 2. PID lookup.
    if let Some(info) = registry.find_agent_by_pid(pid).await {
        if let Some(sid) = session_id {
            waiters
                .bind_session(sid.to_string(), info.id.clone())
                .await;
        }
        return info.id;
    }
    // 3. Auto-create PASSIVE-{pid}. Never truncates PID (Pitfall 5).
    let agent_id = format!("PASSIVE-{pid}");
    let info = AgentInfo {
        id: agent_id.clone(),
        agent_type: "unknown".into(),
        protocol: "hook".into(),
        state: AgentState::Running,
        pid: Some(pid),
        cwd: cwd.map(std::path::PathBuf::from),
        intent: None,
    };
    let adapter = crate::agents::generic::passive_sentinel_adapter();
    let _ = registry
        .upsert_agent(agent_id.clone(), info, adapter, false)
        .await;
    if let Some(sid) = session_id {
        waiters
            .bind_session(sid.to_string(), agent_id.clone())
            .await;
    }
    agent_id
}

/// POST /hook handler — long-holds the HTTP response until the user resolves
/// the approval or the client disconnects.
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
    // T-08-Rate.
    if !rate_limiter.check().await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(AitcDecisionResponse::Deny {
                reason: "rate limited".into(),
            }),
        )
            .into_response();
    }

    // T-08-05: tool_input must be an object (or null for future-proofing).
    if !body.tool_input.is_object() && !body.tool_input.is_null() {
        return (
            StatusCode::BAD_REQUEST,
            Json(AitcDecisionResponse::Deny {
                reason: "tool_input must be object".into(),
            }),
        )
            .into_response();
    }

    // T-08-03: validate live PID.
    {
        let s = sysinfo::System::new_with_specifics(
            sysinfo::RefreshKind::nothing()
                .with_processes(sysinfo::ProcessRefreshKind::nothing()),
        );
        if s.process(sysinfo::Pid::from_u32(body.pid)).is_none() {
            return (
                StatusCode::BAD_REQUEST,
                Json(AitcDecisionResponse::Deny {
                    reason: format!("PID {} not found", body.pid),
                }),
            )
                .into_response();
        }
    }

    let agent_id = resolve_or_create_agent(
        &registry,
        &waiters,
        &engine,
        body.pid,
        body.session_id.as_deref(),
        body.cwd.as_deref(),
    )
    .await;

    // Always-allow fast path (D-08 — run first so cached sessions bypass
    // every downstream check). Unchanged from Phase 8.
    if waiters.is_always_allowed(&agent_id, &body.tool_name).await {
        return (StatusCode::OK, Json(AitcDecisionResponse::Allow)).into_response();
    }

    // -----------------------------------------------------------------
    // Phase 17 D-01..D-18 gate-decision rewrite: replace the Phase 8
    // tool-category allowlist (D-19/D-20, removed) with a conflict-query
    // against the shared ConflictEngine, preserving the protected_paths
    // OR-branch (D-07). See 17-CONTEXT.md for the locked semantics.
    //
    // Phase 17 D-04 amendment (17-RESEARCH §5): `AgentState` has NO
    // `Terminated` variant — terminated agents are *removed* from the
    // registry, not transitioned. The liveness gate therefore reduces to
    // `registry.get_agent(&id).await.is_some()`.
    // -----------------------------------------------------------------

    use crate::conflict::canonicalize::canonicalize_for_conflict;
    use std::path::{Path, PathBuf};

    // D-06: derive the conflict-check path from `tool_input` based on the
    // tool_name. Canonicalization flows through the shared helper so the
    // HashMap-key parity with the pipeline's write path is guaranteed
    // (T-17-05 mitigation). `gate_file_path_str` feeds both the
    // protected_paths glob check and the approval row's `file_path` column.
    let (canonical_path, gate_file_path_str): (Option<PathBuf>, Option<String>) = match body
        .tool_name
        .as_str()
    {
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => body
            .tool_input
            .get("file_path")
            .and_then(|v| v.as_str())
            .map(|p| {
                let canon = canonicalize_for_conflict(Path::new(p));
                let s = canon.to_string_lossy().into_owned();
                (Some(canon), Some(s))
            })
            .unwrap_or((None, None)),
        "Bash" => {
            // D-09..D-13: best-effort Bash path extraction; Safelisted +
            // ParseFailed + empty Targets all collapse to (None, None) →
            // no conflict query → allow (D-10 + D-11).
            let cmd = body
                .tool_input
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cwd_str = body.cwd.as_deref().unwrap_or(".");
            let cwd_path = Path::new(cwd_str);
            match crate::agents::bash_paths::extract_target_paths(cmd, cwd_path) {
                crate::agents::bash_paths::BashParseResult::Targets(v) if !v.is_empty() => {
                    // v1 policy: take the first target. Multi-target Bash
                    // commands (`cp a b && rm c`) are rare and the approval
                    // row is one-path-one-row; extra targets fall through
                    // to the filesystem-watcher path for post-write
                    // convergence per D-17's accepted race.
                    let canon = canonicalize_for_conflict(&v[0]);
                    let s = canon.to_string_lossy().into_owned();
                    (Some(canon), Some(s))
                }
                _ => (None, None),
            }
        }
        // D-06: Read/LS/Grep/Glob/WebFetch/WebSearch/Task/MCP pass through.
        // They still honor protected_paths (handled below) but never drive
        // a conflict query.
        _ => (None, None),
    };

    // D-07: protected_paths OR-branch — unchanged semantics from Phase 8.
    // Checked against the RAW `tool_input.file_path` so Read/LS/Grep also
    // gate on protected globs (D-06 explicitly preserves this: "Read-vs-
    // write gating is an explicit defer; users who want it can add globs
    // to `protected_paths`"). For write-class tools this matches the
    // canonical form via `gate_file_path_str`; for pass-through tools it
    // falls back to the raw JSON value so gating is still possible.
    let raw_file_path_for_glob: Option<String> = gate_file_path_str.clone().or_else(|| {
        body.tool_input
            .get("file_path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    });
    let path_gated: bool = match &raw_file_path_for_glob {
        Some(p) => protected_path_matches(&pool, p).await,
        None => false,
    };

    // D-14/D-14b/D-15: conflict query against the shared ConflictEngine.
    // Pitfall 1: scope the lock tightly; drop BEFORE any DB call or await.
    // D-05 self-exclusion via `except_agent_id = agent_id`. D-04 liveness
    // gate via `registry.get_agent(&id).await.is_some()` (amended per
    // RESEARCH §5 — there is NO Terminated variant).
    let conflict_other: Option<String> = match &canonical_path {
        Some(p) => {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            // Fresh-read window each request — routes around the engine's
            // `self.window` staleness (RESEARCH §1) by passing the live
            // `ConflictState::get_window_ms()` as an explicit argument.
            // `Manager` trait brings `app.state::<T>()` into scope.
            use tauri::Manager;
            let window_ms: i64 = app
                .state::<crate::conflict::types::ConflictState>()
                .get_window_ms() as i64;

            let t0 = std::time::Instant::now();
            let raw = {
                let eng = engine.lock().await;
                eng.could_conflict_with(p, &agent_id, now_ms, window_ms)
            };
            let elapsed = t0.elapsed();
            tracing::debug!(
                kind = "hook_lock_wait",
                elapsed_us = elapsed.as_micros() as u64,
                agent = %agent_id,
                "engine lock acquire + could_conflict_with"
            );

            match raw {
                Some(id) if registry.get_agent(&id).await.is_some() => Some(id),
                // D-04 liveness gate: ghost record from an agent no longer
                // in the registry (crashed / reaped). Under-gate fail-safe.
                _ => None,
            }
        }
        None => None,
    };

    // D-20/D-21: compose gate decision. Both-or-neither invariant for
    // (conflict_with_agent_id, gate_reason) enforced at this single site
    // (T-17-07 mitigation — no DB CHECK constraint needed).
    let (should_gate, gate_reason, conflict_with): (bool, &str, Option<&str>) =
        match (conflict_other.as_deref(), path_gated) {
            (Some(id), _) => (true, "file_conflict", Some(id)),
            (None, true) => (true, "protected_path", None),
            _ => (false, "", None),
        };

    if !should_gate {
        let allow_reason = if canonical_path.is_some() {
            "no_conflict"
        } else if body.tool_name == "Bash" {
            "safelisted_or_parse_fail"
        } else {
            "passthrough"
        };
        tracing::debug!(
            kind = "hook_allow",
            agent = %agent_id,
            tool = %body.tool_name,
            reason = allow_reason,
            "instant allow"
        );
        return (StatusCode::OK, Json(AitcDecisionResponse::Allow)).into_response();
    }

    tracing::info!(
        kind = "hook_gate",
        reason = gate_reason,
        agent = %agent_id,
        file = ?gate_file_path_str,
        conflict_with = ?conflict_with,
        "gating PreToolUse"
    );

    // Derive a minimal diff_content preview so Phase 4's ApprovalRequestCard
    // preview path keeps working until Plan 05's ToolPreview reads
    // tool_input_json directly.
    let diff_preview: Option<String> = match body.tool_name.as_str() {
        "Edit" | "MultiEdit" => body
            .tool_input
            .get("new_string")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        "Write" => body
            .tool_input
            .get("content")
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(200).collect()),
        _ => None,
    };

    let tool_input_str =
        serde_json::to_string(&body.tool_input).unwrap_or_else(|_| "{}".into());

    // Row `file_path`: prefer the canonical form (so it matches the engine's
    // HashMap key) when we have one; fall back to the raw tool_input path
    // so protected_path gates on Read/LS still show a useful file in the
    // approval card.
    let row_file_path: Option<&str> = gate_file_path_str
        .as_deref()
        .or(raw_file_path_for_glob.as_deref());

    let req = match create_approval_request_internal(
        &agent_id,
        "pretool_use",
        // D-02/D-21: canonical when available (file_conflict path), raw
        // otherwise (protected_path on a non-write tool).
        row_file_path,
        diff_preview.as_deref(),
        "high",
        Some(&body.tool_name),
        Some(&tool_input_str),
        body.session_id.as_deref(),
        conflict_with,
        Some(gate_reason),
        &pool,
        &app,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AitcDecisionResponse::Deny {
                    reason: format!("insert failed: {e}"),
                }),
            )
                .into_response();
        }
    };

    let row_id = req.id;
    let (tx, rx) = oneshot::channel();
    waiters
        .register(
            row_id,
            WaiterEntry {
                agent_id: agent_id.clone(),
                tool_name: body.tool_name.clone(),
                sender: tx,
            },
        )
        .await;

    // Drop-guard: if the handler future is dropped (client disconnect) before
    // the waiter fires, mark the row abandoned and remove the waiter entry.
    // T-08-02 mitigation: uses WHERE status='pending' so we never overwrite a
    // row that racing approve_request/deny_request already resolved.
    struct AbandonGuard {
        id: i64,
        waiters: Arc<WaiterRegistry>,
        pool: sqlx::SqlitePool,
        triggered: bool,
    }
    impl Drop for AbandonGuard {
        fn drop(&mut self) {
            if self.triggered {
                return;
            }
            let id = self.id;
            let waiters = self.waiters.clone();
            let pool = self.pool.clone();
            tokio::spawn(async move {
                waiters.remove_silently(id).await;
                let _ = sqlx::query(
                    "UPDATE approval_requests SET status='abandoned', \
                     resolved_at=datetime('now') \
                     WHERE id = ? AND status = 'pending'",
                )
                .bind(id)
                .execute(&pool)
                .await;
            });
        }
    }
    let mut guard = AbandonGuard {
        id: row_id,
        waiters: waiters.clone(),
        pool: pool.clone(),
        triggered: false,
    };

    let decision = match rx.await {
        Ok(d) => {
            guard.triggered = true;
            d
        }
        Err(_) => {
            // Sender dropped without sending — treat as deny (fail-safe D-11).
            guard.triggered = true;
            HookDecision::Deny("waiter channel closed".into())
        }
    };

    let resp = match decision {
        HookDecision::Allow => AitcDecisionResponse::Allow,
        HookDecision::AllowWithEdits(updated) => AitcDecisionResponse::AllowWithEdits {
            updated_input: updated,
        },
        HookDecision::Deny(reason) => AitcDecisionResponse::Deny { reason },
    };
    (StatusCode::OK, Json(resp)).into_response()
}

/// Handle POST /register from an external agent.
async fn register_agent(
    Extension(registry): Extension<Arc<AgentRegistry>>,
    Extension(rate_limiter): Extension<Arc<RateLimiter>>,
    Extension(pool): Extension<sqlx::SqlitePool>,
    Json(payload): Json<RegisterPayload>,
) -> impl IntoResponse {
    // T-03-07: Rate limit
    if !rate_limiter.check().await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({"error": "rate limited"})),
        );
    }

    // T-03-04: Validate PID exists as a running process
    {
        let s = sysinfo::System::new_with_specifics(
            sysinfo::RefreshKind::nothing()
                .with_processes(sysinfo::ProcessRefreshKind::nothing()),
        );
        let pid = sysinfo::Pid::from_u32(payload.pid);
        if s.process(pid).is_none() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("PID {} not found", payload.pid)})),
            );
        }
    }

    // Generate agent ID from PID. Use the full PID -- PIDs exceed 10,000 on
    // modern OSes (Windows 32-bit PIDs, Linux pid_max commonly 4,194,304), and
    // `passive_bridge::bridge_tick` emits the full PID for `PASSIVE-{pid}`.
    // Truncating with `% 10000` caused collisions and broke PASSIVE→KAGENT
    // reconciliation (CR-01).
    let agent_id = format!("KAGENT-{}", payload.pid);
    let protocol = payload.protocol.as_deref().unwrap_or("unknown").to_string();

    // Find matching adapter -- reject unknown agent types with 400 instead of
    // falling back to a hard-coded adapter (which would panic if not registered).
    let adapter = match registry.find_adapter_for_process(&payload.agent_type) {
        Some(a) => a,
        None => {
            tracing::warn!(
                agent_type = %payload.agent_type,
                "Unknown agent type in self-registration"
            );
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("unknown agent_type: {}", payload.agent_type)})),
            );
        }
    };

    let info = AgentInfo {
        id: agent_id.clone(),
        agent_type: payload.agent_type,
        protocol,
        state: AgentState::Running,
        pid: Some(payload.pid),
        cwd: Some(std::path::PathBuf::from(&payload.cwd)),
        intent: payload.intent,
    };

    // D-07: Remove any prior PASSIVE entry for this PID so we don't double-list.
    let _ = registry
        .remove_agent(&format!("PASSIVE-{}", payload.pid))
        .await;

    let agent_type_for_session = info.agent_type.clone();
    match registry
        .upsert_agent(agent_id.clone(), info, adapter, false)
        .await
    {
        Ok(()) => {
            // HIST-01 Open Question 2: always insert a session row on successful
            // self-register so HistoryView sees the launch even if no file event fires.
            if let Err(e) = crate::db::session::ensure_open_session(
                &agent_id,
                &agent_type_for_session,
                &pool,
            )
            .await
            {
                tracing::warn!(
                    agent_id = %agent_id,
                    error = %e,
                    "ensure_open_session on self-register failed"
                );
                // Non-fatal: registration still succeeds.
            }
            (
                StatusCode::OK,
                Json(serde_json::json!({"id": agent_id})),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// Build the axum `Router` shared by production and test code. Having this
/// isolated from the bind step lets tests compose Routers with an arbitrary
/// TcpListener. Generic over Tauri runtime `R` so tests can use
/// `tauri::test::MockRuntime` while production uses `tauri::Wry`.
///
/// Phase 10 Plan 03: adds POST/GET/DELETE `/mcp` routes backed by
/// `crate::mcp::streamable_http` with two new Extension layers —
/// `Arc<LiveSessionRegistry>` (chat runtime session registry) and
/// `Arc<McpState>` (per-MCP-session state). The body cap applies to all
/// routes on this router.
#[allow(clippy::too_many_arguments)]
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
        .route("/register", post(register_agent))
        .route("/hook", post(hook_handler::<R>))
        .route("/mcp", post(crate::mcp::streamable_http::mcp_post_handler::<R>))
        .route("/mcp", get(crate::mcp::streamable_http::mcp_get_handler::<R>))
        .route(
            "/mcp",
            delete(crate::mcp::streamable_http::mcp_delete_handler::<R>),
        )
        // T-08-04 / T-10-15 body cap — layered before Extensions so the
        // limit applies to /register, /hook, AND /mcp. MCP bodies should
        // never approach this cap.
        .layer(DefaultBodyLimit::max(HOOK_BODY_MAX_BYTES))
        .layer(Extension(registry))
        .layer(Extension(rate_limiter))
        .layer(Extension(pool))
        .layer(Extension(waiters))
        // Phase 17 D-16: ConflictEngine shared with pipeline/commands.rs
        // conflict_task via Tauri managed state (see lib.rs). Plan 05
        // rewrites the hook gate branch to call
        // `engine.lock().await.could_conflict_with(...)`.
        .layer(Extension(engine))
        .layer(Extension(app))
        .layer(Extension(chat_sessions))
        .layer(Extension(mcp_state))
}

/// Start the self-registration HTTP server on localhost.
///
/// Tries `preferred_port` first, falls back to OS-assigned port 0 if busy
/// (Pitfall 2 from RESEARCH.md).
///
/// Returns the actual bound port number. Generic over runtime for test
/// compatibility.
#[allow(clippy::too_many_arguments)]
pub async fn start_registration_server<R: tauri::Runtime>(
    registry: Arc<AgentRegistry>,
    pool: sqlx::SqlitePool,
    waiters: Arc<WaiterRegistry>,
    app_handle: tauri::AppHandle<R>,
    preferred_port: u16,
    chat_sessions: Arc<crate::chat_runtime::session_registry::LiveSessionRegistry>,
    mcp_state: Arc<crate::mcp::McpState>,
    engine: Arc<tokio::sync::Mutex<crate::conflict::engine::ConflictEngine>>,
) -> Result<u16, String> {
    let rate_limiter = Arc::new(RateLimiter::new());

    let app = build_router(
        registry,
        pool,
        waiters,
        app_handle,
        rate_limiter,
        chat_sessions,
        mcp_state,
        engine,
    );

    // Try preferred port first, fallback to OS-assigned
    let listener = match TcpListener::bind(format!("127.0.0.1:{preferred_port}")).await {
        Ok(l) => l,
        Err(_) => {
            tracing::warn!(
                preferred_port,
                "Preferred port unavailable, binding to OS-assigned port"
            );
            TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to bind to any port: {e}"))?
        }
    };

    let actual_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {e}"))?
        .port();

    // Spawn the server as a background task (non-blocking)
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(error = %e, "Registration server exited with error");
        }
    });

    Ok(actual_port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::adapter::{AgentInfo, AgentState};
    use crate::agents::registry::AgentRegistry;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::Arc;
    // Phase 17 Plan 04: `app_handle.manage(...)` in spawn_hook_server needs
    // the `tauri::Manager` trait in scope.
    use tauri::Manager;

    async fn make_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                started_at TEXT NOT NULL,
                ended_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                file_count INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn removes_prior_passive_on_kagent_register() {
        // Seed a PASSIVE entry, then simulate the handler's PASSIVE removal step.
        let mut reg = AgentRegistry::new();
        reg.register_adapter(Arc::new(crate::agents::claude_code::ClaudeCodeAdapter));
        let reg = Arc::new(reg);

        let adapter = reg
            .find_adapter_for_process("claude-code")
            .expect("claude-code adapter registered");
        reg.upsert_agent(
            "PASSIVE-1234".into(),
            AgentInfo {
                id: "PASSIVE-1234".into(),
                agent_type: "unknown".into(),
                protocol: "passive-scan".into(),
                state: AgentState::Running,
                pid: Some(1234),
                cwd: None,
                intent: None,
            },
            adapter,
            false,
        )
        .await
        .unwrap();

        // Simulate the reconciliation the handler now performs.
        let removed = reg.remove_agent(&format!("PASSIVE-{}", 1234u32)).await;
        assert!(removed.is_some());
        assert!(reg.get_agent("PASSIVE-1234").await.is_none());
    }

    #[tokio::test]
    async fn kagent_register_inserts_agent_session_row() {
        let pool = make_pool().await;
        // Simulate the ensure_open_session call the handler now performs.
        let id = crate::db::session::ensure_open_session(
            "KAGENT-1234",
            "claude-code",
            &pool,
        )
        .await
        .unwrap();
        assert!(id > 0);
        let (cnt,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM agent_sessions WHERE agent_id = ?",
        )
        .bind("KAGENT-1234")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(cnt, 1);
    }

    #[test]
    fn register_payload_deserializes() {
        let json = r#"{"agent_type":"claude-code","pid":1234,"cwd":"/tmp"}"#;
        let payload: RegisterPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.agent_type, "claude-code");
        assert_eq!(payload.pid, 1234);
        assert_eq!(payload.cwd, "/tmp");
        assert!(payload.intent.is_none());
        assert!(payload.protocol.is_none());
    }

    #[test]
    fn register_payload_deserializes_with_optionals() {
        let json = r#"{"agent_type":"codex","pid":5678,"cwd":"/home","intent":"fix bug","protocol":"cli"}"#;
        let payload: RegisterPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.intent.as_deref(), Some("fix bug"));
        assert_eq!(payload.protocol.as_deref(), Some("cli"));
    }

    // -----------------------------------------------------------------
    // Phase 8 — /hook integration tests.
    //
    // We run a real axum server on 127.0.0.1:0 against a mock Tauri app
    // handle (tauri::test::mock_app) and POST via reqwest. The mock
    // AppHandle supports `emit` + `notification` calls without opening
    // any real window so we can drive create_approval_request_internal
    // end-to-end without the Tauri runtime.
    // -----------------------------------------------------------------

    use crate::agents::hook_waiters::{HookDecision, WaiterRegistry};

    /// Spin up an in-memory SQLite pool with the approval_requests +
    /// protected_paths schema mimicking migrations 001-005.
    pub(crate) async fn make_hook_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE approval_requests ( \
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                agent_id TEXT, \
                request_type TEXT NOT NULL, \
                file_path TEXT, \
                diff_content TEXT, \
                status TEXT NOT NULL DEFAULT 'pending', \
                urgency TEXT DEFAULT 'medium', \
                response_note TEXT, \
                edited_content TEXT, \
                created_at TEXT NOT NULL DEFAULT (datetime('now')), \
                resolved_at TEXT, \
                tool_name TEXT, \
                tool_input_json TEXT, \
                hook_session_id TEXT, \
                conflict_with_agent_id TEXT, \
                gate_reason TEXT \
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE protected_paths ( \
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                glob_pattern TEXT NOT NULL UNIQUE, \
                created_at TEXT NOT NULL DEFAULT (datetime('now')) \
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        // Phase 10 Plan 03: /mcp `tools/call request_user_input` writes a
        // `system_note` row into `agent_events`. Seed the 006 schema so the
        // insert succeeds in tests that exercise the full /mcp end-to-end.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS agent_events ( \
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                agent_id TEXT NOT NULL, \
                session_id TEXT, \
                event_type TEXT NOT NULL, \
                payload_json TEXT NOT NULL, \
                approval_request_id INTEGER REFERENCES approval_requests(id), \
                sequence_number INTEGER, \
                delivery_status TEXT, \
                created_at TEXT NOT NULL DEFAULT (datetime('now')) \
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    /// Build a fresh registry, waiters, and mock AppHandle, then bind an
    /// axum server on 127.0.0.1:0. Returns (base_url, registry, waiters,
    /// pool, engine).
    ///
    /// Phase 17 Plan 04: tuple grew from 4 to 5 elements to expose the
    /// shared `Arc<tokio::sync::Mutex<ConflictEngine>>`. Plan 05's
    /// integration tests will use the handle to seed synthetic write
    /// records and assert the /hook gate branch consults it.
    pub(crate) async fn spawn_hook_server() -> (
        String,
        Arc<AgentRegistry>,
        Arc<WaiterRegistry>,
        sqlx::SqlitePool,
        Arc<tokio::sync::Mutex<crate::conflict::engine::ConflictEngine>>,
    ) {
        let mut registry_inner = AgentRegistry::new();
        registry_inner.register_adapter(Arc::new(crate::agents::claude_code::ClaudeCodeAdapter));
        let registry = Arc::new(registry_inner);
        let pool = make_hook_pool().await;
        let waiters = WaiterRegistry::new_arc();
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let rate_limiter = Arc::new(RateLimiter::new());
        // Phase 10 Plan 03: /mcp extension layers — each test spawns its own
        // fresh registry / mcp_state so sessions never leak across tests.
        let chat_sessions =
            crate::chat_runtime::session_registry::LiveSessionRegistry::new_arc();
        let mcp_state = crate::mcp::McpState::new_arc();
        // Phase 17 Plan 04: construct the shared engine + seed ConflictState on
        // the mock app so Plan 05's hook gate branch can read
        // `get_window_ms()` and `engine.lock().await` from managed state.
        let engine = Arc::new(tokio::sync::Mutex::new(
            crate::conflict::engine::ConflictEngine::new(std::time::Duration::from_millis(5000)),
        ));
        app_handle.manage(crate::conflict::ConflictState::new(5000));
        app_handle.manage(engine.clone());
        let router = build_router(
            registry.clone(),
            pool.clone(),
            waiters.clone(),
            app_handle,
            rate_limiter,
            chat_sessions,
            mcp_state,
            engine.clone(),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        (
            format!("http://127.0.0.1:{port}"),
            registry,
            waiters,
            pool,
            engine,
        )
    }

    #[tokio::test]
    async fn hook_allows_passthrough_tools_without_row() {
        let (base, _reg, _waiters, pool, _engine) = spawn_hook_server().await;
        let my_pid = std::process::id();

        // D-06: Read is always pass-through regardless of conflict state.
        let body = serde_json::json!({
            "pid": my_pid,
            "tool_name": "Read",
            "tool_input": {"file_path": "/etc/hosts"},
        });
        let client = reqwest::Client::new();
        let resp = tokio::time::timeout(
            std::time::Duration::from_millis(2000),
            client.post(format!("{base}/hook")).json(&body).send(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(resp.status(), 200);
        let decoded: AitcDecisionResponseDe = resp.json().await.unwrap();
        assert!(matches!(decoded, AitcDecisionResponseDe::Allow));

        let (cnt,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cnt, 0, "pass-through tool must not insert a row");

        // Phase 17 extension: Edit on a file with no other-agent conflict
        // records must ALSO pass through without a row. This verifies the
        // old tool-category allowlist (D-19/D-20) is gone — the gate is now
        // purely conflict-driven.
        let body_edit = serde_json::json!({
            "pid": my_pid,
            "tool_name": "Edit",
            "tool_input": {
                "file_path": "/tmp/fresh_phase17.rs",
                "old_string": "a",
                "new_string": "b",
            },
        });
        let resp_edit = tokio::time::timeout(
            std::time::Duration::from_millis(2000),
            client.post(format!("{base}/hook")).json(&body_edit).send(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(resp_edit.status(), 200);
        let decoded_edit: AitcDecisionResponseDe = resp_edit.json().await.unwrap();
        assert!(
            matches!(decoded_edit, AitcDecisionResponseDe::Allow),
            "D-18: Edit with no conflicting agent must instant-allow"
        );

        let (cnt2,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            cnt2, 0,
            "no-conflict Edit must not insert a row (tool-category gating removed)"
        );
    }

    #[tokio::test]
    async fn hook_gates_edit_and_blocks_until_approved() {
        let (base, reg, waiters, pool, engine) = spawn_hook_server().await;
        let my_pid = std::process::id();

        // Phase 17 pivot: under the new conflict-triggered gating an Edit
        // only gates when another LIVE agent recently wrote the same file.
        // Seed KAGENT-A with a write to /x.ts 500ms ago and register the
        // agent in the registry so the D-04 liveness check passes.
        let other_pid: u32 = 99_001;
        let adapter = crate::agents::generic::passive_sentinel_adapter();
        reg.upsert_agent(
            "KAGENT-A".into(),
            AgentInfo {
                id: "KAGENT-A".into(),
                agent_type: "claude-code".into(),
                protocol: "cli".into(),
                state: AgentState::Running,
                pid: Some(other_pid),
                cwd: None,
                intent: None,
            },
            adapter,
            false,
        )
        .await
        .unwrap();
        {
            let mut eng = engine.lock().await;
            eng.update_pid_mapping(other_pid, "KAGENT-A".into());
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            // Use the canonical-for-conflict form so the HashMap key matches
            // what `could_conflict_with` sees from the hook side.
            let canon =
                crate::conflict::canonicalize::canonicalize_for_conflict(std::path::Path::new(
                    "/x.ts",
                ));
            let batch = crate::pipeline::events::FileEventBatch {
                events: vec![crate::pipeline::events::FileEvent {
                    path: canon,
                    kind: crate::pipeline::events::FileEventKind::Modify,
                    timestamp_ms: now_ms - 500,
                    attribution: crate::pipeline::events::Attribution::Pid(other_pid),
                }],
                batch_id: 1,
                dropped_batches: 0,
            };
            eng.process_batch(&batch);
        }

        let body = serde_json::json!({
            "pid": my_pid,
            "session_id": "s1",
            "tool_name": "Edit",
            "tool_input": {
                "file_path": "/x.ts",
                "old_string": "a",
                "new_string": "b",
            },
        });

        let waiters_clone = waiters.clone();
        let pool_clone = pool.clone();
        // Task 1: issue the /hook POST. This will block until we signal.
        let post_task = tokio::spawn(async move {
            let client = reqwest::Client::new();
            let resp = client
                .post(format!("{base}/hook"))
                .json(&body)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), 200);
            resp.json::<AitcDecisionResponseDe>().await.unwrap()
        });

        // Task 2: poll for the pending row, then signal Allow on its id.
        let row_id: i64 = loop {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            let found: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM approval_requests WHERE status='pending' AND tool_name='Edit' LIMIT 1",
            )
            .fetch_optional(&pool_clone)
            .await
            .unwrap();
            if let Some((id,)) = found {
                break id;
            }
        };
        // Confirm the row carries the Phase 8 fields.
        let (tool_name, tool_input_json, session_id): (String, String, String) = sqlx::query_as(
            "SELECT tool_name, tool_input_json, hook_session_id FROM approval_requests WHERE id = ?",
        )
        .bind(row_id)
        .fetch_one(&pool_clone)
        .await
        .unwrap();
        assert_eq!(tool_name, "Edit");
        assert!(tool_input_json.contains("\"file_path\":\"/x.ts\""));
        assert_eq!(session_id, "s1");

        waiters_clone.signal(row_id, HookDecision::Allow).await;

        let decoded = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            post_task,
        )
        .await
        .unwrap()
        .unwrap();
        assert!(matches!(decoded, AitcDecisionResponseDe::Allow));
    }

    #[tokio::test]
    async fn hook_gates_protected_path_even_on_read() {
        let (base, _reg, waiters, pool, _engine) = spawn_hook_server().await;
        let my_pid = std::process::id();
        sqlx::query("INSERT INTO protected_paths (glob_pattern) VALUES ('**/.env')")
            .execute(&pool)
            .await
            .unwrap();

        let body = serde_json::json!({
            "pid": my_pid,
            "tool_name": "Read",
            "tool_input": {"file_path": "/proj/.env"},
        });

        let pool_clone = pool.clone();
        let waiters_clone = waiters.clone();
        let post_task = tokio::spawn(async move {
            reqwest::Client::new()
                .post(format!("{base}/hook"))
                .json(&body)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
                .unwrap()
                .json::<AitcDecisionResponseDe>()
                .await
                .unwrap()
        });

        let row_id: i64 = loop {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            let found: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM approval_requests WHERE status='pending' LIMIT 1",
            )
            .fetch_optional(&pool_clone)
            .await
            .unwrap();
            if let Some((id,)) = found {
                break id;
            }
        };

        // Phase 17 extension: verify the row carries `gate_reason =
        // 'protected_path'` with `conflict_with_agent_id` IS NULL. Both
        // columns were added by migration 007 and are populated by the
        // hook_handler composition match in Plan 05 Task 2.
        let (gate_reason, conflict_with): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT gate_reason, conflict_with_agent_id \
             FROM approval_requests WHERE id = ?",
        )
        .bind(row_id)
        .fetch_one(&pool_clone)
        .await
        .unwrap();
        assert_eq!(
            gate_reason.as_deref(),
            Some("protected_path"),
            "D-20: protected-path gates must carry gate_reason='protected_path'"
        );
        assert!(
            conflict_with.is_none(),
            "D-21: protected-path gates must leave conflict_with_agent_id NULL"
        );

        waiters_clone
            .signal(row_id, HookDecision::Deny("denied".into()))
            .await;

        let decoded = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            post_task,
        )
        .await
        .unwrap()
        .unwrap();
        assert!(matches!(decoded, AitcDecisionResponseDe::Deny { .. }));
    }

    #[tokio::test]
    async fn hook_creates_passive_stub_when_no_agent_matches() {
        let (base, reg, _waiters, _pool, _engine) = spawn_hook_server().await;
        let my_pid = std::process::id();

        // Phase 17 pivot: Bash `echo hi` is now safelisted (D-11) and
        // produces an instant Allow with no row. The PASSIVE stub creation
        // still happens inside `resolve_or_create_agent` regardless of gate
        // outcome — that's what this test's name asserts, so drop the
        // row-polling loop and just verify the stub was created after a
        // 200 OK. Under the old tool-category allowlist Bash was gated so
        // a pending row was the convenient wait-point; post-Phase 17 we
        // verify the resolver directly.
        let body = serde_json::json!({
            "pid": my_pid,
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
        });

        let resp = tokio::time::timeout(
            std::time::Duration::from_millis(2000),
            reqwest::Client::new()
                .post(format!("{base}/hook"))
                .json(&body)
                .send(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(resp.status(), 200);
        let decoded: AitcDecisionResponseDe = resp.json().await.unwrap();
        assert!(
            matches!(decoded, AitcDecisionResponseDe::Allow),
            "D-11: safelisted Bash must instant-allow"
        );

        let passive_id = format!("PASSIVE-{my_pid}");
        assert!(
            reg.get_agent(&passive_id).await.is_some(),
            "PASSIVE-{my_pid} stub must exist after /hook autocreate"
        );
    }

    #[tokio::test]
    async fn hook_honors_always_allow_fast_path() {
        let (base, reg, waiters, pool, _engine) = spawn_hook_server().await;
        let my_pid = std::process::id();

        // Pre-register a KAGENT for this pid so resolve_or_create_agent resolves it.
        let adapter = crate::agents::generic::passive_sentinel_adapter();
        let agent_id = format!("KAGENT-{my_pid}");
        reg.upsert_agent(
            agent_id.clone(),
            AgentInfo {
                id: agent_id.clone(),
                agent_type: "claude-code".into(),
                protocol: "cli".into(),
                state: AgentState::Running,
                pid: Some(my_pid),
                cwd: None,
                intent: None,
            },
            adapter,
            true,
        )
        .await
        .unwrap();
        waiters.add_always_allow(agent_id.clone(), "Bash".into()).await;

        let body = serde_json::json!({
            "pid": my_pid,
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
        });
        let resp = tokio::time::timeout(
            std::time::Duration::from_millis(1500),
            reqwest::Client::new()
                .post(format!("{base}/hook"))
                .json(&body)
                .send(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(resp.status(), 200);
        let decoded: AitcDecisionResponseDe = resp.json().await.unwrap();
        assert!(matches!(decoded, AitcDecisionResponseDe::Allow));

        let (cnt,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cnt, 0, "always-allow must not create a row");
    }

    #[tokio::test]
    async fn hook_session_binding_is_idempotent() {
        let (base, reg, waiters, pool, _engine) = spawn_hook_server().await;
        let my_pid = std::process::id();

        // First /hook call binds session_id → agent_id.
        let body1 = serde_json::json!({
            "pid": my_pid,
            "session_id": "sess-1",
            "tool_name": "Read",
            "tool_input": {"file_path": "/tmp/x"},
        });
        let resp = reqwest::Client::new()
            .post(format!("{base}/hook"))
            .json(&body1)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);

        let agents_before = reg.all_agents().await.len();
        let binding = waiters.agent_for_session("sess-1").await;
        assert!(binding.is_some(), "session binding must be established");

        // Second /hook call with the same session_id — no new agent created.
        let body2 = serde_json::json!({
            "pid": my_pid,
            "session_id": "sess-1",
            "tool_name": "Read",
            "tool_input": {"file_path": "/tmp/y"},
        });
        let resp = reqwest::Client::new()
            .post(format!("{base}/hook"))
            .json(&body2)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);

        let agents_after = reg.all_agents().await.len();
        assert_eq!(
            agents_before, agents_after,
            "session binding reuse must not create a second agent"
        );

        // And no DB rows (Read is a passthrough).
        let (cnt,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cnt, 0);
    }

    #[tokio::test]
    async fn rate_limiter_applies_to_hook() {
        // Exercise the limiter directly — this is stable in CI unlike timing
        // an http burst across the window boundary. The same limiter instance
        // is Extension-layered into /hook in build_router, so the handler
        // transitively applies it; see hook_allows_passthrough_tools_without_row
        // for the end-to-end pass-through path that uses RateLimiter::check.
        let rl = RateLimiter::new();
        let mut allowed = 0;
        let mut denied = 0;
        for _ in 0..15 {
            if rl.check().await {
                allowed += 1;
            } else {
                denied += 1;
            }
        }
        assert_eq!(allowed, 10, "first 10 in the window must be allowed");
        assert_eq!(denied, 5, "the remaining 5 must be denied");
    }

    #[tokio::test]
    async fn hook_rejects_non_object_tool_input() {
        let (base, _reg, _waiters, _pool, _engine) = spawn_hook_server().await;
        let my_pid = std::process::id();
        let body = serde_json::json!({
            "pid": my_pid,
            "tool_name": "Edit",
            "tool_input": "not-an-object",
        });
        let resp = reqwest::Client::new()
            .post(format!("{base}/hook"))
            .json(&body)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 400);
    }

    #[tokio::test]
    async fn hook_rejects_dead_pid() {
        let (base, _reg, _waiters, _pool, _engine) = spawn_hook_server().await;
        // A PID extremely unlikely to be live. sysinfo will return None for it.
        let dead_pid: u32 = 0; // PID 0 is never a process on Linux/Mac.
        let body = serde_json::json!({
            "pid": dead_pid,
            "tool_name": "Read",
            "tool_input": {},
        });
        let resp = reqwest::Client::new()
            .post(format!("{base}/hook"))
            .json(&body)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 400);
    }

    // -----------------------------------------------------------------
    // Phase 10 Plan 03 — /mcp integration tests against the full
    // build_router (same axum stack used in production). Verifies the new
    // routes compose cleanly with the existing Extension layers and the
    // body cap.
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn mcp_initialize_returns_session_header_on_real_router() {
        let (base, _reg, _waiters, _pool, _engine) = spawn_hook_server().await;
        let resp = reqwest::Client::new()
            .post(format!("{base}/mcp"))
            .header("X-AITC-Session", "claude-cc-1")
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "claude", "version": "test"}
                }
            }))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let sid = resp
            .headers()
            .get("mcp-session-id")
            .expect("Mcp-Session-Id header on initialize")
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(sid.len(), 36, "UUIDv4 hyphenated shape");
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(body["result"]["serverInfo"]["name"], "aitc-chat");
    }

    #[tokio::test]
    async fn mcp_tools_list_without_session_returns_404() {
        let (base, _reg, _waiters, _pool, _engine) = spawn_hook_server().await;
        let resp = reqwest::Client::new()
            .post(format!("{base}/mcp"))
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list"
            }))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404);
    }

    #[tokio::test]
    async fn mcp_tools_call_request_user_input_after_initialize_succeeds() {
        let (base, _reg, _waiters, pool, _engine) = spawn_hook_server().await;
        let client = reqwest::Client::new();

        // 1. initialize → grab session id.
        let init = client
            .post(format!("{base}/mcp"))
            .header("X-AITC-Session", "claude-cc-1")
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {"protocolVersion": "2025-03-26", "capabilities": {}}
            }))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap();
        let sid = init
            .headers()
            .get("mcp-session-id")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();

        // 2. tools/call request_user_input.
        let call = client
            .post(format!("{base}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "request_user_input",
                    "arguments": {"prompt": "Confirm deployment?"}
                }
            }))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap();
        assert_eq!(call.status(), 200);
        let body: serde_json::Value = call.json().await.unwrap();
        assert!(
            body["result"]["content"].is_array(),
            "expected result.content array; body was {body}"
        );
        assert_eq!(body["result"]["isError"], false);

        // 3. Verify the transcript row exists.
        let events = crate::db::events::list_events_for_agent(
            &pool,
            "claude-cc-1",
            None,
            10,
        )
        .await
        .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "system_note");
        assert_eq!(events[0].payload_json["prompt"], "Confirm deployment?");
    }

    // =====================================================================
    // Phase 17 — conflict-triggered PreToolUse gating integration tests.
    //
    // Names locked by VALIDATION.md per-task contract. Do not rename. Each
    // test exercises one decision rule from CONTEXT.md:
    //   - D-04 liveness gate      → hook_allows_when_conflicting_agent_was_removed
    //   - D-05 self-exclusion     → hook_allows_when_only_same_agent_wrote_path
    //   - D-03 window boundary    → hook_allows_when_other_agent_write_outside_window
    //   - D-10 parse-failure      → bash_parse_failure_allows
    //   - D-14/D-15 two-agent     → hook_gates_edit_when_other_agent_recently_wrote_same_path
    //   - D-21 row metadata       → gate_row_carries_conflict_with_agent_id
    // T-17-04 latency perf test lives in `conflict::engine::tests::phase17::
    // lock_contention_under_burst` (Plan 02's canonical home; `#[ignore]`).
    // =====================================================================
    mod phase17 {
        use super::*;
        use crate::conflict::engine::ConflictEngine;
        use crate::pipeline::events::{Attribution, FileEvent, FileEventBatch, FileEventKind};
        use std::path::{Path, PathBuf};
        use std::sync::Arc;

        fn now_ms() -> i64 {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64
        }

        /// Seed the engine with a single synthetic write by `(pid_a,
        /// agent_id_a)` to `path` at `(now_ms - age_ms)`. `update_pid_mapping`
        /// is called first so the engine's record carries the canonical
        /// agent_id (D-15b). Path is canonicalized via the shared helper so
        /// the hook side's `could_conflict_with` finds it in the HashMap.
        async fn seed_other_agent_write(
            engine: &Arc<tokio::sync::Mutex<ConflictEngine>>,
            path: &Path,
            pid_a: u32,
            agent_id_a: &str,
            age_ms: i64,
        ) {
            let canon = crate::conflict::canonicalize::canonicalize_for_conflict(path);
            let mut eng = engine.lock().await;
            eng.update_pid_mapping(pid_a, agent_id_a.to_string());
            let batch = FileEventBatch {
                events: vec![FileEvent {
                    path: canon,
                    kind: FileEventKind::Modify,
                    timestamp_ms: now_ms() - age_ms,
                    attribution: Attribution::Pid(pid_a),
                }],
                batch_id: 1,
                dropped_batches: 0,
            };
            eng.process_batch(&batch);
        }

        /// Register an agent in the registry with the given pid + state.
        /// Uses the passive_sentinel_adapter to avoid real-adapter coupling.
        async fn register_agent(reg: &AgentRegistry, id: &str, pid: u32) {
            let adapter = crate::agents::generic::passive_sentinel_adapter();
            reg.upsert_agent(
                id.to_string(),
                AgentInfo {
                    id: id.to_string(),
                    agent_type: "claude-code".into(),
                    protocol: "cli".into(),
                    state: AgentState::Running,
                    pid: Some(pid),
                    cwd: None,
                    intent: None,
                },
                adapter,
                false,
            )
            .await
            .unwrap();
        }

        /// D-14/D-15 two-agent end-to-end: KAGENT-A wrote /tmp/phase17_a.rs
        /// 500ms ago; KAGENT-B's Edit on the same path hits /hook and gates
        /// with gate_reason='file_conflict', conflict_with_agent_id='KAGENT-A'.
        #[tokio::test]
        async fn hook_gates_edit_when_other_agent_recently_wrote_same_path() {
            let (base, reg, waiters, pool, engine) = spawn_hook_server().await;

            let path_str = "/tmp/phase17_gates_edit_when_other.rs";
            let other_pid: u32 = 77_101;
            register_agent(&reg, "KAGENT-A", other_pid).await;
            seed_other_agent_write(&engine, Path::new(path_str), other_pid, "KAGENT-A", 500).await;

            let my_pid = std::process::id();
            // The hook's resolve_or_create_agent auto-creates PASSIVE-{my_pid};
            // we use that identity (rather than a synthetic KAGENT-B) so the
            // live-PID check inside hook_handler always passes.

            let body = serde_json::json!({
                "pid": my_pid,
                "session_id": "phase17-sess-1",
                "tool_name": "Edit",
                "tool_input": {
                    "file_path": path_str,
                    "old_string": "a",
                    "new_string": "b",
                },
            });

            let pool_clone = pool.clone();
            let waiters_clone = waiters.clone();
            let post_task = tokio::spawn(async move {
                reqwest::Client::new()
                    .post(format!("{base}/hook"))
                    .json(&body)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await
                    .unwrap()
                    .json::<AitcDecisionResponseDe>()
                    .await
                    .unwrap()
            });

            // Wait for the gated row, then signal Allow.
            let row_id: i64 = loop {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                let found: Option<(i64,)> = sqlx::query_as(
                    "SELECT id FROM approval_requests \
                     WHERE status='pending' AND tool_name='Edit' LIMIT 1",
                )
                .fetch_optional(&pool_clone)
                .await
                .unwrap();
                if let Some((id,)) = found {
                    break id;
                }
            };

            let (gate_reason, conflict_with): (Option<String>, Option<String>) = sqlx::query_as(
                "SELECT gate_reason, conflict_with_agent_id \
                 FROM approval_requests WHERE id = ?",
            )
            .bind(row_id)
            .fetch_one(&pool_clone)
            .await
            .unwrap();
            assert_eq!(gate_reason.as_deref(), Some("file_conflict"));
            assert_eq!(conflict_with.as_deref(), Some("KAGENT-A"));

            waiters_clone.signal(row_id, HookDecision::Allow).await;
            let decoded =
                tokio::time::timeout(std::time::Duration::from_secs(2), post_task)
                    .await
                    .unwrap()
                    .unwrap();
            assert!(matches!(decoded, AitcDecisionResponseDe::Allow));
        }

        /// D-05 self-exclusion: an agent's own prior writes must never gate
        /// its next tool call. Seed a write under `PASSIVE-{my_pid}`, then
        /// POST /hook as the same PID — must return Allow with no row.
        #[tokio::test]
        async fn hook_allows_when_only_same_agent_wrote_path() {
            let (base, _reg, _waiters, pool, engine) = spawn_hook_server().await;

            let path_str = "/tmp/phase17_self_write.rs";
            let my_pid = std::process::id();
            let self_agent_id = format!("PASSIVE-{my_pid}");
            seed_other_agent_write(
                &engine,
                Path::new(path_str),
                my_pid,
                &self_agent_id,
                500,
            )
            .await;

            let body = serde_json::json!({
                "pid": my_pid,
                "tool_name": "Edit",
                "tool_input": {
                    "file_path": path_str,
                    "old_string": "a",
                    "new_string": "b",
                },
            });
            let resp = tokio::time::timeout(
                std::time::Duration::from_millis(2000),
                reqwest::Client::new()
                    .post(format!("{base}/hook"))
                    .json(&body)
                    .send(),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(resp.status(), 200);
            let decoded: AitcDecisionResponseDe = resp.json().await.unwrap();
            assert!(matches!(decoded, AitcDecisionResponseDe::Allow));

            let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(cnt, 0, "D-05: self-write must not gate");
        }

        /// D-03 window boundary: a write by another agent older than the
        /// configured window must NOT gate. Use the default 5000ms window
        /// and seed a record 6000ms old.
        #[tokio::test]
        async fn hook_allows_when_other_agent_write_outside_window() {
            let (base, reg, _waiters, pool, engine) = spawn_hook_server().await;

            let path_str = "/tmp/phase17_out_of_window.rs";
            let other_pid: u32 = 77_102;
            register_agent(&reg, "KAGENT-OLD", other_pid).await;
            // 6000ms old > 5000ms default window => must not gate.
            seed_other_agent_write(&engine, Path::new(path_str), other_pid, "KAGENT-OLD", 6000)
                .await;

            let my_pid = std::process::id();
            let body = serde_json::json!({
                "pid": my_pid,
                "tool_name": "Edit",
                "tool_input": {
                    "file_path": path_str,
                    "old_string": "a",
                    "new_string": "b",
                },
            });
            let resp = tokio::time::timeout(
                std::time::Duration::from_millis(2000),
                reqwest::Client::new()
                    .post(format!("{base}/hook"))
                    .json(&body)
                    .send(),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(resp.status(), 200);
            let decoded: AitcDecisionResponseDe = resp.json().await.unwrap();
            assert!(matches!(decoded, AitcDecisionResponseDe::Allow));

            let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(cnt, 0, "D-03: outside-window write must not gate");
        }

        /// D-04 liveness gate: if the engine's record points to an agent
        /// that's no longer in the registry (crashed / reaped), the hook
        /// must Allow — under-gate fail-safe, not false-gate.
        #[tokio::test]
        async fn hook_allows_when_conflicting_agent_was_removed() {
            let (base, reg, _waiters, pool, engine) = spawn_hook_server().await;

            let path_str = "/tmp/phase17_ghost_agent.rs";
            let ghost_pid: u32 = 77_103;
            register_agent(&reg, "KAGENT-GHOST", ghost_pid).await;
            seed_other_agent_write(
                &engine,
                Path::new(path_str),
                ghost_pid,
                "KAGENT-GHOST",
                500,
            )
            .await;
            // Simulate the ghost agent crashing / being reaped: registry
            // entry goes away, engine record survives (stale window).
            reg.remove_agent("KAGENT-GHOST").await;

            let my_pid = std::process::id();
            let body = serde_json::json!({
                "pid": my_pid,
                "tool_name": "Edit",
                "tool_input": {
                    "file_path": path_str,
                    "old_string": "a",
                    "new_string": "b",
                },
            });
            let resp = tokio::time::timeout(
                std::time::Duration::from_millis(2000),
                reqwest::Client::new()
                    .post(format!("{base}/hook"))
                    .json(&body)
                    .send(),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(resp.status(), 200);
            let decoded: AitcDecisionResponseDe = resp.json().await.unwrap();
            assert!(
                matches!(decoded, AitcDecisionResponseDe::Allow),
                "D-04: ghost conflict must under-gate, not false-gate"
            );

            let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(cnt, 0);
        }

        /// D-10 parse-failure fallback: a Bash command that shlex cannot
        /// tokenize (unterminated quote) maps to ParseFailed → Allow.
        #[tokio::test]
        async fn bash_parse_failure_allows() {
            let (base, _reg, _waiters, pool, _engine) = spawn_hook_server().await;

            let my_pid = std::process::id();
            let body = serde_json::json!({
                "pid": my_pid,
                "tool_name": "Bash",
                "tool_input": {
                    "command": "echo \"unterminated",
                    "cwd": "/tmp",
                },
            });
            let resp = tokio::time::timeout(
                std::time::Duration::from_millis(2000),
                reqwest::Client::new()
                    .post(format!("{base}/hook"))
                    .json(&body)
                    .send(),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(resp.status(), 200);
            let decoded: AitcDecisionResponseDe = resp.json().await.unwrap();
            assert!(
                matches!(decoded, AitcDecisionResponseDe::Allow),
                "D-10: bash parse failure must allow"
            );

            let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(cnt, 0);
        }

        /// D-21 approval-row shape: a file_conflict gate populates BOTH
        /// `gate_reason='file_conflict'` AND `conflict_with_agent_id=<peer>`
        /// (T-17-07 both-or-neither invariant).
        #[tokio::test]
        async fn gate_row_carries_conflict_with_agent_id() {
            let (base, reg, waiters, pool, engine) = spawn_hook_server().await;

            let path_str = "/tmp/phase17_row_metadata.rs";
            let other_pid: u32 = 77_104;
            register_agent(&reg, "KAGENT-PEER", other_pid).await;
            seed_other_agent_write(
                &engine,
                Path::new(path_str),
                other_pid,
                "KAGENT-PEER",
                300,
            )
            .await;

            let my_pid = std::process::id();
            let body = serde_json::json!({
                "pid": my_pid,
                "session_id": "phase17-row-sess",
                "tool_name": "Write",
                "tool_input": {
                    "file_path": path_str,
                    "content": "new file",
                },
            });

            let pool_clone = pool.clone();
            let waiters_clone = waiters.clone();
            let post_task = tokio::spawn(async move {
                reqwest::Client::new()
                    .post(format!("{base}/hook"))
                    .json(&body)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await
                    .unwrap()
                    .json::<AitcDecisionResponseDe>()
                    .await
                    .unwrap()
            });

            let row_id: i64 = loop {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                let found: Option<(i64,)> = sqlx::query_as(
                    "SELECT id FROM approval_requests WHERE status='pending' LIMIT 1",
                )
                .fetch_optional(&pool_clone)
                .await
                .unwrap();
                if let Some((id,)) = found {
                    break id;
                }
            };

            // Introspect the DB columns directly — mirrors what the
            // frontend ApprovalRequestCard will read via bindings.
            let (tool_name, file_path, gate_reason, conflict_with): (
                String,
                Option<String>,
                Option<String>,
                Option<String>,
            ) = sqlx::query_as(
                "SELECT tool_name, file_path, gate_reason, conflict_with_agent_id \
                 FROM approval_requests WHERE id = ?",
            )
            .bind(row_id)
            .fetch_one(&pool_clone)
            .await
            .unwrap();
            assert_eq!(tool_name, "Write");
            assert_eq!(gate_reason.as_deref(), Some("file_conflict"));
            assert_eq!(conflict_with.as_deref(), Some("KAGENT-PEER"));
            // file_path column carries the canonical form for HashMap parity.
            assert!(
                file_path.as_deref().map_or(false, |p| p.ends_with(
                    "phase17_row_metadata.rs"
                )),
                "canonical file_path must end with the original filename, got {file_path:?}"
            );

            waiters_clone.signal(row_id, HookDecision::Allow).await;
            let _ = tokio::time::timeout(std::time::Duration::from_secs(2), post_task)
                .await
                .unwrap();
        }

        /// D-15b regression: `resolve_or_create_agent` must wire
        /// `update_pid_mapping` into the engine so process_batch records
        /// carry the canonical KAGENT-*/PASSIVE-* id (never `PID-{pid}`).
        #[tokio::test]
        async fn update_pid_mapping_wired_via_resolve_or_create_agent() {
            let (base, _reg, _waiters, _pool, engine) = spawn_hook_server().await;

            let my_pid = std::process::id();
            // A harmless passthrough POST — drives resolve_or_create_agent
            // through the auto-create PASSIVE-{pid} branch.
            let body = serde_json::json!({
                "pid": my_pid,
                "tool_name": "Read",
                "tool_input": {"file_path": "/etc/hostname"},
            });
            let resp = tokio::time::timeout(
                std::time::Duration::from_millis(2000),
                reqwest::Client::new()
                    .post(format!("{base}/hook"))
                    .json(&body)
                    .send(),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(resp.status(), 200);

            // Now process a write batch through the engine under `my_pid`.
            // If update_pid_mapping was NOT called, the record would use
            // format!("PID-{my_pid}"); with D-15b wired it must use
            // `PASSIVE-{my_pid}`.
            let expected_id = format!("PASSIVE-{my_pid}");
            let canonical = crate::conflict::canonicalize::canonicalize_for_conflict(
                Path::new("/tmp/phase17_pid_mapping.rs"),
            );
            {
                let mut eng = engine.lock().await;
                let batch = FileEventBatch {
                    events: vec![FileEvent {
                        path: canonical.clone(),
                        kind: FileEventKind::Modify,
                        timestamp_ms: now_ms(),
                        attribution: Attribution::Pid(my_pid),
                    }],
                    batch_id: 2,
                    dropped_batches: 0,
                };
                eng.process_batch(&batch);
            }

            // The engine's could_conflict_with returns the record's
            // canonical agent_id when queried with a DIFFERENT except_id.
            let found = {
                let eng = engine.lock().await;
                eng.could_conflict_with(&canonical, "PID-999999", now_ms() + 10, 5000)
            };
            assert_eq!(
                found.as_deref(),
                Some(expected_id.as_str()),
                "D-15b: update_pid_mapping must route PID→canonical id at resolve time; got {found:?}, expected {expected_id}"
            );
        }

        /// Placeholder pointing at the T-17-04 opt-in perf test's canonical
        /// home in `conflict::engine::tests::phase17::lock_contention_under_
        /// burst`. Kept as a grep-discoverable breadcrumb per VALIDATION
        /// §"latency" row; the real test is `#[ignore]` in engine.rs.
        #[ignore]
        #[allow(dead_code)]
        #[tokio::test]
        async fn lock_contention_under_burst_placeholder_see_conflict_engine_tests() {
            // Intentionally empty — see the real test at:
            //   cargo test --package aitc --lib \
            //     conflict::engine::tests::phase17::lock_contention_under_burst \
            //     -- --ignored --nocapture
        }
    }
}
