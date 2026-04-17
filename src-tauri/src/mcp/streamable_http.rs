//! Phase 10: MCP Streamable HTTP transport handlers.
//!
//! Hosted on the existing `self_register` axum router (D-11 — same port as
//! `/register` and `/hook`). Three routes:
//!   POST /mcp   — JSON-RPC requests (initialize, tools/list, tools/call,
//!                 notifications/initialized)
//!   GET  /mcp   — SSE upgrade for server-initiated notifications (v1 returns
//!                 405; Claude falls back to POST-polling)
//!   DELETE /mcp — graceful session teardown
//!
//! Plan 03 provides the real bodies + tool-call dispatcher. MCP spec
//! 2025-03-26 compliance:
//!   - `initialize` issues a fresh `Mcp-Session-Id` response header (UUIDv4).
//!   - All other methods REQUIRE the `Mcp-Session-Id` header; unknown id ⇒
//!     HTTP 404 per spec mandate (forces Claude to re-initialize).
//!   - `notifications/initialized` returns HTTP 202 with empty body.

#![allow(dead_code, unused_variables)]

use axum::{
    extract::Extension,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use std::sync::Arc;

use super::types::{
    JsonRpcRequest, JsonRpcResponse, JSONRPC_INTERNAL_ERROR, JSONRPC_METHOD_NOT_FOUND,
    JSONRPC_TOO_MANY_SESSIONS, JSONRPC_UNKNOWN_AGENT,
};
use super::{
    McpSession, McpState, AITC_SESSION_HEADER, MAX_MCP_SESSIONS, MCP_PROTOCOL_VERSION,
    MCP_SESSION_HEADER,
};
use crate::chat_runtime::session_registry::LiveSessionRegistry;

/// Generate a fresh UUIDv4 for use as an MCP session id. Uses the `uuid`
/// crate (already a transitive dep via tauri-utils; `v4` feature enabled in
/// Cargo.toml for direct-import access). Output is the canonical hyphenated
/// 8-4-4-4-12 form — 36 characters — matching what Claude expects.
fn new_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Pull the `Mcp-Session-Id` header value as a `String` if present and valid
/// UTF-8. HeaderMap does case-insensitive lookup on the canonical lowercase
/// name (`MCP_SESSION_HEADER`).
fn session_id_from(headers: &HeaderMap) -> Option<String> {
    headers
        .get(MCP_SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(String::from)
}

/// Pull the `X-AITC-Session` header value as a `String` (the agent_id Claude
/// forwards per the per-session MCP config written by
/// `session_config::write_session_mcp_config`).
fn aitc_session_from(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AITC_SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(String::from)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// POST /mcp — main JSON-RPC dispatcher. Dispatches by `method`:
///   - `initialize` → create session, return capabilities + `Mcp-Session-Id`.
///   - `notifications/initialized` → HTTP 202, empty body.
///   - `tools/list` → two-tool surface (requires valid session).
///   - `tools/call {name: get_pending_user_messages | request_user_input}` →
///     forwards to `super::tools::*` (requires valid session + bound agent_id).
///   - Unknown method / unknown session id → see below.
pub async fn mcp_post_handler<R: tauri::Runtime>(
    Extension(state): Extension<Arc<McpState>>,
    Extension(sessions): Extension<Arc<LiveSessionRegistry>>,
    Extension(pool): Extension<sqlx::SqlitePool>,
    Extension(app): Extension<tauri::AppHandle<R>>,
    headers: HeaderMap,
    Json(body): Json<JsonRpcRequest>,
) -> Response {
    let id = body.id.clone().unwrap_or(serde_json::Value::Null);
    let req_session = session_id_from(&headers);

    match body.method.as_str() {
        "initialize" => {
            // T-10-20: cap sessions map. Reject before allocating the UUID.
            {
                let g = state.sessions.lock().await;
                if g.len() >= MAX_MCP_SESSIONS && req_session.as_ref().map_or(true, |s| !g.contains_key(s)) {
                    return Json(JsonRpcResponse::error(
                        id,
                        JSONRPC_TOO_MANY_SESSIONS,
                        "too many sessions".into(),
                    ))
                    .into_response();
                }
            }
            // Idempotent re-init: if the client sent a Mcp-Session-Id AND the
            // session exists, reuse it. Otherwise mint a fresh one.
            let sid = req_session.clone().unwrap_or_else(new_session_id);
            let agent_id = aitc_session_from(&headers);
            {
                let mut g = state.sessions.lock().await;
                // If the session already exists, preserve its agent_id binding
                // unless a new X-AITC-Session was provided.
                let existing_agent_id = g
                    .get(&sid)
                    .and_then(|s| s.agent_id.clone());
                let effective_agent_id = agent_id.clone().or(existing_agent_id);
                g.insert(
                    sid.clone(),
                    McpSession {
                        agent_id: effective_agent_id,
                        initialized: true,
                        created_at_ms: now_ms(),
                    },
                );
            }
            let result = serde_json::json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "aitc-chat", "version": "0.1"}
            });
            let mut resp = Json(JsonRpcResponse::success(id, result)).into_response();
            if let Ok(h) = HeaderValue::from_str(&sid) {
                resp.headers_mut().insert(MCP_SESSION_HEADER, h);
            }
            resp
        }

        "notifications/initialized" => {
            // JSON-RPC notifications carry no id and expect no response body.
            // MCP 2025-03-26 mandates HTTP 202 Accepted.
            (StatusCode::ACCEPTED, "").into_response()
        }

        other => {
            // Every non-initialize method requires a known Mcp-Session-Id.
            // Per MCP spec 2025-03-26, unknown / missing session id ⇒ HTTP 404
            // (forces Claude to re-initialize).
            let sid = match req_session {
                Some(s) => s,
                None => return (StatusCode::NOT_FOUND, "").into_response(),
            };
            let agent_id_opt = {
                let g = state.sessions.lock().await;
                match g.get(&sid) {
                    Some(s) => s.agent_id.clone(),
                    None => return (StatusCode::NOT_FOUND, "").into_response(),
                }
            };

            match other {
                "tools/list" => {
                    let result = serde_json::json!({
                        "tools": super::tools::tool_list_v1(),
                    });
                    Json(JsonRpcResponse::success(id, result)).into_response()
                }

                "tools/call" => {
                    let params = &body.params;
                    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let args = params
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({}));

                    // Every tool needs a bound agent_id. If no X-AITC-Session
                    // was forwarded on initialize, fail with a typed error
                    // rather than panicking (T-10-17).
                    let agent_id = match agent_id_opt {
                        Some(a) => a,
                        None => {
                            return Json(JsonRpcResponse::error(
                                id,
                                JSONRPC_UNKNOWN_AGENT,
                                "no agent bound to this MCP session".into(),
                            ))
                            .into_response();
                        }
                    };

                    match name {
                        "get_pending_user_messages" => {
                            match super::tools::call_get_pending_user_messages(
                                &agent_id, &sessions, &pool,
                            )
                            .await
                            {
                                Ok(result) => {
                                    Json(JsonRpcResponse::success(id, result)).into_response()
                                }
                                Err(e) => Json(JsonRpcResponse::error(
                                    id,
                                    JSONRPC_INTERNAL_ERROR,
                                    e,
                                ))
                                .into_response(),
                            }
                        }
                        "request_user_input" => {
                            match super::tools::call_request_user_input(
                                &agent_id, args, &app, &pool,
                            )
                            .await
                            {
                                Ok(result) => {
                                    Json(JsonRpcResponse::success(id, result)).into_response()
                                }
                                Err(e) => Json(JsonRpcResponse::error(
                                    id,
                                    JSONRPC_INTERNAL_ERROR,
                                    e,
                                ))
                                .into_response(),
                            }
                        }
                        _ => Json(JsonRpcResponse::error(
                            id,
                            JSONRPC_METHOD_NOT_FOUND,
                            format!("unknown tool: {name}"),
                        ))
                        .into_response(),
                    }
                }

                _ => Json(JsonRpcResponse::error(
                    id,
                    JSONRPC_METHOD_NOT_FOUND,
                    format!("unknown method: {other}"),
                ))
                .into_response(),
            }
        }
    }
}

/// GET /mcp — SSE upgrade for server-initiated notifications. Not implemented
/// in v1 (Claude falls back to POST-polling via `tools/call`). Returns 405.
pub async fn mcp_get_handler<R: tauri::Runtime>(
    Extension(_state): Extension<Arc<McpState>>,
    Extension(_app): Extension<tauri::AppHandle<R>>,
) -> Response {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        "SSE upgrade not supported in aitc-chat v1",
    )
        .into_response()
}

/// DELETE /mcp — graceful session teardown. Removes the session from the
/// registry. 204 No Content on success, 404 on unknown id.
pub async fn mcp_delete_handler<R: tauri::Runtime>(
    Extension(state): Extension<Arc<McpState>>,
    Extension(_app): Extension<tauri::AppHandle<R>>,
    headers: HeaderMap,
) -> Response {
    let sid = match session_id_from(&headers) {
        Some(s) => s,
        None => return (StatusCode::NOT_FOUND, "").into_response(),
    };
    let mut g = state.sessions.lock().await;
    if g.remove(&sid).is_some() {
        (StatusCode::NO_CONTENT, "").into_response()
    } else {
        (StatusCode::NOT_FOUND, "").into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::self_register::RateLimiter;
    use crate::db::events::tests::make_pool_with_chat_schema;
    use axum::{
        extract::DefaultBodyLimit,
        routing::{delete, get, post},
        Router,
    };
    use std::sync::Arc;
    use tokio::net::TcpListener;

    const MCP_BODY_MAX_BYTES: usize = 2 * 1024 * 1024;

    /// Minimal axum server wired with only the /mcp routes + the Extension
    /// layers they need. Does NOT mount /register or /hook — those live under
    /// the real `build_router` helper and are exercised in
    /// `self_register::tests`. Returns (base_url, state, pool).
    pub(crate) async fn spawn_mcp_server() -> (
        String,
        Arc<McpState>,
        Arc<LiveSessionRegistry>,
        sqlx::SqlitePool,
    ) {
        let state = McpState::new_arc();
        let sessions = LiveSessionRegistry::new_arc();
        let pool = make_pool_with_chat_schema().await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();

        let _rate_limiter = Arc::new(RateLimiter::new());
        let router: Router = Router::new()
            .route(
                "/mcp",
                post(mcp_post_handler::<tauri::test::MockRuntime>),
            )
            .route(
                "/mcp",
                get(mcp_get_handler::<tauri::test::MockRuntime>),
            )
            .route(
                "/mcp",
                delete(mcp_delete_handler::<tauri::test::MockRuntime>),
            )
            .layer(DefaultBodyLimit::max(MCP_BODY_MAX_BYTES))
            .layer(Extension(state.clone()))
            .layer(Extension(sessions.clone()))
            .layer(Extension(pool.clone()))
            .layer(Extension(app_handle));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        (
            format!("http://127.0.0.1:{port}"),
            state,
            sessions,
            pool,
        )
    }

    #[tokio::test]
    async fn initialize_sets_mcp_session_id_header_and_returns_protocol_version() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("X-AITC-Session", "A-1")
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name":"claude","version":"t"}}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let sid = resp
            .headers()
            .get("mcp-session-id")
            .expect("Mcp-Session-Id header must be present")
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(sid.len(), 36, "UUIDv4 hyphenated shape is 36 chars");
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(body["result"]["serverInfo"]["name"], "aitc-chat");
        assert!(body["result"]["capabilities"]["tools"].is_object());
    }

    #[tokio::test]
    async fn unknown_session_returns_404() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", "nope-nope-nope-nope-nope-nope-nope-ii")
            .json(&serde_json::json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404);
    }

    #[tokio::test]
    async fn tools_list_without_session_returns_404() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .json(&serde_json::json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404);
    }

    async fn init_session(url: &str, agent_id: &str) -> String {
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("X-AITC-Session", agent_id)
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":1,"method":"initialize",
                "params":{"protocolVersion":"2025-03-26","capabilities":{}}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        resp.headers()
            .get("mcp-session-id")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn tools_list_returns_two_tool_surface() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let sid = init_session(&url, "A-1").await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .json(&serde_json::json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        let tools = body["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2);
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"get_pending_user_messages"));
        assert!(names.contains(&"request_user_input"));
    }

    #[tokio::test]
    async fn tools_call_get_pending_returns_empty_messages() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let sid = init_session(&url, "A-1").await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":3,"method":"tools/call",
                "params":{"name":"get_pending_user_messages","arguments":{}}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["result"]["isError"], false);
        let text = body["result"]["content"][0]["text"].as_str().unwrap();
        let inner: serde_json::Value = serde_json::from_str(text).unwrap();
        assert!(inner["messages"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn tools_call_request_user_input_inserts_system_note_row() {
        let (url, _state, _sess, pool) = spawn_mcp_server().await;
        let sid = init_session(&url, "A-42").await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":4,"method":"tools/call",
                "params":{"name":"request_user_input","arguments":{"prompt":"Confirm?"}}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["result"]["isError"], false);
        // system_note row landed for A-42.
        let events = crate::db::events::list_events_for_agent(&pool, "A-42", None, 10)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "system_note");
        assert_eq!(events[0].payload_json["kind"], "awaiting_user");
    }

    #[tokio::test]
    async fn tools_call_without_agent_binding_returns_jsonrpc_error() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        // Initialize without X-AITC-Session header — agent_id stays None.
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":1,"method":"initialize",
                "params":{"protocolVersion":"2025-03-26","capabilities":{}}
            }))
            .send()
            .await
            .unwrap();
        let sid = resp
            .headers()
            .get("mcp-session-id")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":3,"method":"tools/call",
                "params":{"name":"get_pending_user_messages","arguments":{}}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["error"]["code"], -32001);
        assert!(body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("no agent"));
    }

    #[tokio::test]
    async fn tools_call_unknown_tool_returns_method_not_found() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let sid = init_session(&url, "A-1").await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":3,"method":"tools/call",
                "params":{"name":"does_not_exist","arguments":{}}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn notifications_initialized_returns_202() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let sid = init_session(&url, "A-1").await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .json(&serde_json::json!({
                "jsonrpc":"2.0","method":"notifications/initialized"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 202);
    }

    #[tokio::test]
    async fn unknown_method_returns_method_not_found() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let sid = init_session(&url, "A-1").await;
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":5,"method":"resources/list"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn get_mcp_returns_405() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let resp = reqwest::Client::new()
            .get(format!("{url}/mcp"))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 405);
    }

    #[tokio::test]
    async fn delete_with_valid_session_returns_204_and_removes() {
        let (url, state, _sess, _pool) = spawn_mcp_server().await;
        let sid = init_session(&url, "A-1").await;
        // Confirm session registered.
        assert_eq!(state.sessions.lock().await.len(), 1);
        let resp = reqwest::Client::new()
            .delete(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 204);
        assert_eq!(state.sessions.lock().await.len(), 0);
        // Deleting again → 404.
        let resp = reqwest::Client::new()
            .delete(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404);
    }

    #[tokio::test]
    async fn delete_without_session_header_returns_404() {
        let (url, _state, _sess, _pool) = spawn_mcp_server().await;
        let resp = reqwest::Client::new()
            .delete(format!("{url}/mcp"))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404);
    }

    #[tokio::test]
    async fn too_many_sessions_rejects_initialize() {
        let (url, state, _sess, _pool) = spawn_mcp_server().await;
        // Fill the registry directly to MAX to avoid spamming 64 HTTP calls.
        {
            let mut g = state.sessions.lock().await;
            for i in 0..super::MAX_MCP_SESSIONS {
                g.insert(
                    format!("filler-{i}"),
                    McpSession {
                        agent_id: None,
                        initialized: true,
                        created_at_ms: now_ms(),
                    },
                );
            }
            assert_eq!(g.len(), super::MAX_MCP_SESSIONS);
        }
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("X-AITC-Session", "A-1")
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":1,"method":"initialize",
                "params":{"protocolVersion":"2025-03-26","capabilities":{}}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["error"]["code"], -32002);
        assert!(body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("too many sessions"));
    }

    #[tokio::test]
    async fn reinit_with_existing_session_id_is_idempotent() {
        let (url, state, _sess, _pool) = spawn_mcp_server().await;
        let sid = init_session(&url, "A-1").await;
        assert_eq!(state.sessions.lock().await.len(), 1);
        // Re-init with the same Mcp-Session-Id → reuse.
        let resp = reqwest::Client::new()
            .post(format!("{url}/mcp"))
            .header("Mcp-Session-Id", &sid)
            .header("X-AITC-Session", "A-1")
            .json(&serde_json::json!({
                "jsonrpc":"2.0","id":1,"method":"initialize",
                "params":{"protocolVersion":"2025-03-26","capabilities":{}}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        // Still exactly one session in the registry.
        assert_eq!(state.sessions.lock().await.len(), 1);
    }
}
