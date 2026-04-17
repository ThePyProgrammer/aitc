//! Phase 10: MCP Streamable HTTP transport handlers.
//!
//! Hosted on the existing `self_register` axum router (D-11 — same port as
//! `/register` and `/hook`). Three routes:
//!   POST /mcp   — JSON-RPC requests (initialize, tools/list, tools/call)
//!   GET  /mcp   — SSE upgrade for server-initiated notifications
//!   DELETE /mcp — graceful session teardown
//!
//! Wave 0 (Plan 01) returns HTTP 501 Not Implemented on every route so the
//! module compiles and the router-extension-layer wiring pattern is clear.
//! Plan 03 provides the real bodies + tool-call dispatcher.

#![allow(dead_code, unused_variables)]

use axum::{extract::Extension, http::StatusCode, response::IntoResponse, Json};
use std::sync::Arc;

use super::types::{JsonRpcError, JsonRpcRequest, JsonRpcResponse};
use super::McpState;
use crate::chat_runtime::session_registry::LiveSessionRegistry;

pub async fn mcp_post_handler<R: tauri::Runtime>(
    Extension(_state): Extension<Arc<McpState>>,
    Extension(_sessions): Extension<Arc<LiveSessionRegistry>>,
    Extension(_app): Extension<tauri::AppHandle<R>>,
    _headers: axum::http::HeaderMap,
    Json(_body): Json<JsonRpcRequest>,
) -> axum::response::Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(JsonRpcResponse {
            jsonrpc: "2.0",
            id: serde_json::Value::Null,
            result: None,
            error: Some(JsonRpcError {
                code: -32601,
                message: "Plan 03".into(),
            }),
        }),
    )
        .into_response()
}

pub async fn mcp_get_handler<R: tauri::Runtime>(
    Extension(_state): Extension<Arc<McpState>>,
    Extension(_app): Extension<tauri::AppHandle<R>>,
) -> axum::response::Response {
    (StatusCode::NOT_IMPLEMENTED, "Plan 03 — SSE upgrade").into_response()
}

pub async fn mcp_delete_handler(
    Extension(_state): Extension<Arc<McpState>>,
    _headers: axum::http::HeaderMap,
) -> axum::response::Response {
    (StatusCode::NOT_IMPLEMENTED, "Plan 03 — session teardown").into_response()
}
