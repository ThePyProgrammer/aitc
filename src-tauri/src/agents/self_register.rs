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

    // Find matching adapter or use None (will be handled by caller)
    let adapter = registry
        .find_adapter_for_process(&payload.agent_type)
        .unwrap_or_else(|| {
            // Use first adapter as fallback -- better than rejecting
            // In practice, unknown agents can still be tracked
            tracing::warn!(
                agent_type = %payload.agent_type,
                "No adapter found for self-registering agent, using claude-code as fallback"
            );
            registry
                .find_adapter_for_process("claude")
                .expect("built-in adapters must be registered")
        });

    let info = AgentInfo {
        id: agent_id.clone(),
        agent_type: payload.agent_type,
        protocol,
        state: AgentState::Running,
        pid: Some(payload.pid),
        cwd: Some(std::path::PathBuf::from(&payload.cwd)),
        intent: payload.intent,
    };

    match registry
        .upsert_agent(agent_id.clone(), info, adapter, false)
        .await
    {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({"id": agent_id})),
        ),
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
    preferred_port: u16,
) -> Result<u16, String> {
    let rate_limiter = Arc::new(RateLimiter::new());

    let app = Router::new()
        .route("/register", post(register_agent))
        .layer(Extension(registry))
        .layer(Extension(rate_limiter));

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
