//! Phase 10: MCP JSON-RPC envelope types.
//!
//! Matches the MCP Streamable HTTP transport spec (2025-03-26 protocol
//! revision). Requests arrive via POST /mcp, responses either inline or via
//! SSE on GET /mcp. Plan 03 wires handlers to real tool dispatch; this file
//! also carries the JSON-RPC error-code constants shared by streamable_http
//! + tools.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// ---- Standard JSON-RPC 2.0 error codes (see jsonrpc.org/specification). ----
pub const JSONRPC_PARSE_ERROR: i32 = -32700;
pub const JSONRPC_INVALID_REQUEST: i32 = -32600;
pub const JSONRPC_METHOD_NOT_FOUND: i32 = -32601;
pub const JSONRPC_INVALID_PARAMS: i32 = -32602;
pub const JSONRPC_INTERNAL_ERROR: i32 = -32603;

// ---- AITC-specific application error codes (-32000..-32099 range reserved
//      by JSON-RPC 2.0 for implementation-defined server errors). ----
/// Tool call references an agent_id that no LiveSessionRegistry / Registry
/// entry resolves. Never panics; always returned as a typed JSON-RPC error.
pub const JSONRPC_UNKNOWN_AGENT: i32 = -32001;
/// `McpState.sessions.len() >= MAX_MCP_SESSIONS` on initialize (T-10-20).
pub const JSONRPC_TOO_MANY_SESSIONS: i32 = -32002;

/// JSON-RPC 2.0 request envelope. `id` is `None` for notifications
/// (fire-and-forget).
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// JSON-RPC 2.0 response envelope. Exactly one of `result` or `error` is
/// populated on a successful/failed call (notifications get no response).
#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

impl JsonRpcResponse {
    /// Construct a `result`-carrying success response. `id` is the client's
    /// request id echoed verbatim (per JSON-RPC 2.0); for requests with no
    /// id, callers pass `serde_json::Value::Null`.
    pub fn success(id: serde_json::Value, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    /// Construct an `error`-carrying failure response. Never returns HTTP
    /// status >= 400 — JSON-RPC errors ride the 200 body per the 2.0 spec
    /// (HTTP layer carries transport-level codes only).
    pub fn error(id: serde_json::Value, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError { code, message }),
        }
    }
}
