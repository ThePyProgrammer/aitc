//! Phase 10: MCP JSON-RPC envelope types.
//!
//! Matches the MCP Streamable HTTP transport spec (2025-03-26 protocol
//! revision). Requests arrive via POST /mcp, responses either inline or via
//! SSE on GET /mcp. Wave 0 (Plan 01) declares the type surface; Plan 03
//! wires handlers to real tool dispatch.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

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
