//! Phase 10: long-lived Claude Code subprocess launcher.
//!
//! Plan 02 wires the real `tokio::process::Command` invocation with piped
//! stdin/stdout/stderr; Wave 0 (Plan 01) just declares the symbol so
//! chat_runtime::commands and supervisor.rs can import it.
//!
//! Target CLI:
//!   claude --input-format stream-json --output-format stream-json --verbose \
//!          [--mcp-config <path> --strict-mcp-config] \
//!          [--include-partial-messages] \
//!          <intent>
//!
//! See PATTERNS.md Pattern A and RESEARCH.md Pattern 1 for the full
//! invocation shape.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use tokio::process::Child;

pub struct LaunchLiveSessionResult {
    pub pid: u32,
    pub child: Child,
    pub mcp_config_path: Option<PathBuf>,
}

/// Spawn the long-lived Claude Code subprocess for a chattable session.
///
/// `aitc_port` is injected as `AITC_PORT` env (Phase 3 precedent) so the
/// `/register` + `/hook` + `/mcp` sidecar routes remain addressable.
pub async fn launch_live_session(
    _program: &str,
    _intent: &str,
    _cwd: &Path,
    _aitc_port: u16,
    _mcp_config_path: Option<&Path>,
    _env_vars: Option<Vec<(&str, &str)>>,
) -> Result<LaunchLiveSessionResult, String> {
    todo!(
        "Plan 02 — piped stdin/stdout/stderr, inject --input-format stream-json \
         --output-format stream-json --verbose --mcp-config <p> --strict-mcp-config \
         --include-partial-messages, positional intent"
    )
}
