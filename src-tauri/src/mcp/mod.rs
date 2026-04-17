//! Phase 10: AITC-as-MCP-server module.
//!
//! Hosts the Streamable HTTP MCP endpoint on the existing `self_register`
//! axum router (D-11 — same port as `/register` and `/hook`). Per-session
//! Claude Code configs wire Claude into this server via
//! `claude --mcp-config <path> --strict-mcp-config`.
//!
//! Plan 03 fills in real tool dispatch and wires the router routes. The
//! exported constants are shared between the streamable_http handlers
//! (header lookups, spec-pinned protocol version) and the session_config
//! writer (the `X-AITC-Session` header name matches what Claude forwards).

#![allow(dead_code)]

pub mod session_config;
pub mod streamable_http;
pub mod tools;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Header carrying the MCP session id across POST/GET/DELETE requests.
/// Lowercase because `axum::http::HeaderMap` lookups are case-insensitive
/// but compare against the canonical lowercase form.
pub const MCP_SESSION_HEADER: &str = "mcp-session-id";

/// Header Claude forwards (per `write_session_mcp_config`) carrying the
/// AITC-assigned agent_id for this session. Server reads it on `initialize`
/// to bind the MCP session to the right agent.
pub const AITC_SESSION_HEADER: &str = "x-aitc-session";

/// Protocol version the server speaks — pinned to the Claude Code 2.1.x
/// supported revision (MCP spec 2025-03-26).
pub const MCP_PROTOCOL_VERSION: &str = "2025-03-26";

/// T-10-20: unbounded `McpState.sessions` is a DoS vector; cap at 64. In
/// practice each AITC user runs 1-5 agents simultaneously — 64 is ample
/// headroom. `initialize` returns JSON-RPC error -32002 when the cap
/// would be exceeded.
pub const MAX_MCP_SESSIONS: usize = 64;

#[derive(Default)]
pub struct McpState {
    pub sessions: Mutex<HashMap<String, McpSession>>,
}

#[derive(Debug, Clone)]
pub struct McpSession {
    pub agent_id: Option<String>,
    pub initialized: bool,
    pub created_at_ms: u64,
}

impl McpState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_arc() -> Arc<Self> {
        Arc::new(Self::default())
    }
}
