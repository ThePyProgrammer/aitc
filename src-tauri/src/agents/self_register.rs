//! Self-registration HTTP server for externally-launched agents.
//!
//! Agents that know about AITC can POST to `http://127.0.0.1:{port}/register`
//! to announce themselves. This supplements process-scan-based detection.
//!
//! Threat mitigations:
//! - T-03-04: Binds to 127.0.0.1 only (no 0.0.0.0).
//! - T-03-04: Validates PID actually exists before accepting registration.
//! - T-03-07: Rate limits to 10 registrations per second via in-memory counter.

use crate::agents::adapter::{AgentInfo, AgentState};
use crate::agents::registry::AgentRegistry;
use axum::{
    extract::Extension,
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;

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
struct RateLimiter {
    count: AtomicU64,
    window_start: AtomicU64,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            window_start: AtomicU64::new(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            ),
        }
    }

    /// Returns true if the request is allowed (under 10/sec).
    ///
    /// Uses compare_exchange on window_start so only one thread wins
    /// the window reset, preventing burst-injection beyond 10 RPS.
    fn check(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let window = self.window_start.load(Ordering::Acquire);

        if now != window {
            // Attempt to claim the new window; only one thread wins the reset
            if self
                .window_start
                .compare_exchange(window, now, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                self.count.store(1, Ordering::Release);
                return true;
            }
        }
        let prev = self.count.fetch_add(1, Ordering::AcqRel);
        prev < 10 // T-03-07: max 10 registrations per second
    }
}

/// Handle POST /register from an external agent.
async fn register_agent(
    Extension(registry): Extension<Arc<AgentRegistry>>,
    Extension(rate_limiter): Extension<Arc<RateLimiter>>,
    Extension(pool): Extension<sqlx::SqlitePool>,
    Json(payload): Json<RegisterPayload>,
) -> impl IntoResponse {
    // T-03-07: Rate limit
    if !rate_limiter.check() {
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

    // Generate agent ID from PID
    let agent_id = format!("KAGENT-{:04}", payload.pid % 10000);
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

/// Start the self-registration HTTP server on localhost.
///
/// Tries `preferred_port` first, falls back to OS-assigned port 0 if busy
/// (Pitfall 2 from RESEARCH.md).
///
/// Returns the actual bound port number.
pub async fn start_registration_server(
    registry: Arc<AgentRegistry>,
    pool: sqlx::SqlitePool,
    preferred_port: u16,
) -> Result<u16, String> {
    let rate_limiter = Arc::new(RateLimiter::new());

    let app = Router::new()
        .route("/register", post(register_agent))
        .layer(Extension(registry))
        .layer(Extension(rate_limiter))
        .layer(Extension(pool));

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
}
