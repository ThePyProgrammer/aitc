//! AITC sidecar library surface.
//!
//! Plan 01 (Wave 0) ships the type + function signatures locked by
//! `08-01-PLAN.md <interfaces>`. Plan 03 (Wave 1) fills in the real bodies
//! (port resolution, envelope construction, HTTP client wiring).
//!
//! Downstream plans MUST import these exact names:
//!   - `AitcDecision` (tag = "kind", snake_case)
//!   - `HookRequest<'a>` (snake_case fields)
//!   - `resolve_port() -> Option<u16>`
//!   - `build_allow_envelope() -> serde_json::Value`
//!   - `build_allow_with_edits_envelope(&Value) -> serde_json::Value`

use serde::{Deserialize, Serialize};

/// Decision emitted by the AITC backend `/hook` endpoint.
///
/// Wire representation (matches Plan 02's `HookDecision` serialization):
///   - `{"kind": "allow"}`
///   - `{"kind": "allow_with_edits", "updated_input": {...}}`
///   - `{"kind": "deny", "reason": "..."}`
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AitcDecision {
    Allow,
    AllowWithEdits { updated_input: serde_json::Value },
    Deny { reason: String },
}

/// Payload that the sidecar POSTs to the AITC `/hook` endpoint.
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct HookRequest<'a> {
    pub pid: u32,
    pub session_id: Option<&'a str>,
    pub tool_name: &'a str,
    pub tool_input: &'a serde_json::Value,
    pub cwd: Option<&'a str>,
}

/// Resolve the AITC server port.
///
/// Plan 03 implements: check `AITC_PORT` env var first, then fall back to
/// `~/.aitc/port` per D-06. Wave 0 stub returns `None` to keep any code
/// that calls it along the "unreachable server" branch.
pub fn resolve_port() -> Option<u16> {
    // STUB — Plan 03 fills in.
    None
}

/// Build the modern PreToolUse `hookSpecificOutput` envelope for an Allow
/// decision. Plan 03 implements the real shape per Claude contract.
pub fn build_allow_envelope() -> serde_json::Value {
    // STUB — Plan 03 turns this RED test GREEN.
    serde_json::json!({})
}

/// Build the modern PreToolUse `hookSpecificOutput` envelope for an
/// AllowWithEdits decision, embedding `updatedInput`. Plan 03 implements.
pub fn build_allow_with_edits_envelope(_updated_input: &serde_json::Value) -> serde_json::Value {
    // STUB — Plan 03 turns this RED test GREEN.
    serde_json::json!({})
}
