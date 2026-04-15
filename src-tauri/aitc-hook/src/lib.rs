//! AITC sidecar library: parse Claude PreToolUse stdin, resolve the AITC
//! server port, POST to `/hook`, translate an AITC decision into the modern
//! Claude Code `hookSpecificOutput` envelope.
//!
//! NEVER emits the deprecated top-level decision/reason form — always
//! uses `hookSpecificOutput.permissionDecision` per the
//! 2025-era Anthropic hook contract (Pitfall 1 in 08-RESEARCH.md).
//!
//! Downstream plans MUST import these exact names:
//!   - `AitcDecision` (tag = "kind", snake_case)
//!   - `HookRequest<'a>` (snake_case fields)
//!   - `ClaudePreToolUse`
//!   - `resolve_port() -> Option<u16>`
//!   - `build_allow_envelope() -> serde_json::Value`
//!   - `build_allow_with_edits_envelope(&Value) -> serde_json::Value`
//!   - `parse_claude_stdin(&str) -> Result<ClaudePreToolUse, String>`
//!   - `post_and_translate(&str, &HookRequest) -> Result<AitcDecision, String>`

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Deserialized Claude Code PreToolUse stdin payload.
///
/// See <https://docs.claude.com/en/docs/claude-code/hooks#pretooluse>. Only
/// the fields the sidecar needs are typed — everything else is ignored via
/// serde's default behavior (untagged extra fields are skipped).
#[derive(Debug, Deserialize)]
pub struct ClaudePreToolUse {
    pub session_id: Option<String>,
    pub tool_name: String,
    #[serde(default)]
    pub tool_input: Value,
    pub cwd: Option<String>,
    pub hook_event_name: Option<String>,
    pub transcript_path: Option<String>,
}

/// Payload that the sidecar POSTs to the AITC `/hook` endpoint.
///
/// Wire shape (serde_json):
/// ```json
/// {
///   "pid": 12345,
///   "session_id": "sess_abc123",
///   "tool_name": "Edit",
///   "tool_input": { "file_path": "...", ... },
///   "cwd": "/home/dev/proj"
/// }
/// ```
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct HookRequest<'a> {
    pub pid: u32,
    pub session_id: Option<&'a str>,
    pub tool_name: &'a str,
    pub tool_input: &'a Value,
    pub cwd: Option<&'a str>,
}

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
    AllowWithEdits { updated_input: Value },
    Deny { reason: String },
}

/// Parse the JSON payload Claude Code writes on the sidecar's stdin.
///
/// Returns a typed `ClaudePreToolUse` on success, or a `String` describing
/// the parse failure. The caller (main.rs) maps `Err` into exit-code 2 per
/// the fail-safe deny contract (D-11).
pub fn parse_claude_stdin(raw: &str) -> Result<ClaudePreToolUse, String> {
    serde_json::from_str(raw).map_err(|e| format!("stdin parse: {e}"))
}

/// Build the modern PreToolUse `hookSpecificOutput` envelope for an Allow
/// decision. This is the JSON the sidecar writes on stdout when AITC
/// approves the tool call.
///
/// NEVER emits a top-level `decision` key — that form is deprecated and
/// silently locked out by the Claude Code runtime.
pub fn build_allow_envelope() -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow"
        }
    })
}

/// Build the modern PreToolUse `hookSpecificOutput` envelope for an
/// AllowWithEdits decision, embedding `updatedInput`. Claude Code rewrites
/// the tool's input from `updatedInput` before executing the tool (only
/// supported for `Edit` / `MultiEdit` tools per D-17).
pub fn build_allow_with_edits_envelope(updated_input: &Value) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": updated_input
        }
    })
}

/// Resolve the AITC server port.
///
/// Precedence:
///   1. `AITC_PORT` env var — if it parses as `u16` in `1..=65535`, use it.
///      Otherwise fall through.
///   2. `AITC_PORT_FILE_OVERRIDE` env var — test hook; if set, read that
///      file instead of `~/.aitc/port`.
///   3. `~/.aitc/port` — production path (per D-06).
///
/// Returns `None` if none of these yield a valid port. `main.rs` maps `None`
/// to an `AITC unreachable: no port` fail-safe deny (D-11).
///
/// T-08-06 (Input Validation): `parse::<u16>` + bounds check `> 0` rejects
/// port `0` and numbers outside `1..=65535` before they reach `ureq`.
pub fn resolve_port() -> Option<u16> {
    if let Ok(s) = std::env::var("AITC_PORT") {
        if let Ok(p) = s.parse::<u16>() {
            if p > 0 {
                return Some(p);
            }
        }
        // Invalid env var (zero, unparseable, out-of-range) → fall through.
    }

    let path = if let Ok(p) = std::env::var("AITC_PORT_FILE_OVERRIDE") {
        std::path::PathBuf::from(p)
    } else {
        dirs::home_dir()?.join(".aitc").join("port")
    };

    let s = std::fs::read_to_string(&path).ok()?;
    let p: u16 = s.trim().parse().ok()?;
    if p == 0 {
        None
    } else {
        Some(p)
    }
}

/// POST the `HookRequest` body to `url` (typically
/// `http://127.0.0.1:{port}/hook`) and deserialize the AITC decision from
/// the response body.
///
/// Every error path returns `Err(String)` so `main.rs` can map it to a
/// fail-safe deny (exit 2 + stderr). No panics, no unwraps.
pub fn post_and_translate(url: &str, body: &HookRequest) -> Result<AitcDecision, String> {
    let payload = serde_json::to_value(body).map_err(|e| format!("serialize: {e}"))?;

    let mut resp = ureq::post(url)
        .send_json(&payload)
        .map_err(|e| format!("AITC unreachable: {e}"))?;

    let status = resp.status();
    if status != 200 {
        return Err(format!("AITC unreachable: status {status}"));
    }

    let body_bytes = resp
        .body_mut()
        .read_to_vec()
        .map_err(|e| format!("AITC bad response: {e}"))?;
    serde_json::from_slice::<AitcDecision>(&body_bytes)
        .map_err(|e| format!("AITC bad response: {e}"))
}
