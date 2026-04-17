//! Phase 10: AITC-as-MCP-server module.
//!
//! Hosts the Streamable HTTP MCP endpoint on the existing `self_register`
//! axum router (D-11 — same port as `/register` and `/hook`). Per-session
//! Claude Code configs wire Claude into this server via
//! `claude --mcp-config <path> --strict-mcp-config`.
//!
//! Wave 0 (Plan 01) lays down the types + empty state container. Plan 03
//! fills in real tool dispatch and wires the router routes.

#![allow(dead_code)]

pub mod session_config;
pub mod streamable_http;
pub mod tools;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Header carrying the MCP session id across POST/GET/DELETE requests.
pub const MCP_SESSION_HEADER: &str = "mcp-session-id";

/// Protocol version the server speaks — pinned to the Claude Code 2.1.x
/// supported revision.
pub const MCP_PROTOCOL_VERSION: &str = "2025-03-26";

#[derive(Default)]
pub struct McpState {
    pub sessions: Mutex<HashMap<String, McpSession>>,
}

pub struct McpSession {
    pub agent_id: Option<String>,
    pub initialized: bool,
}

impl McpState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_arc() -> Arc<Self> {
        Arc::new(Self::default())
    }
}
