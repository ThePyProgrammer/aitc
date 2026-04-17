//! Phase 10: per-session MCP client config writer.
//!
//! Each launched Claude Code session gets a `.claude/mcp-<agent_id>.json`
//! file pointing at `http://127.0.0.1:<aitc_port>/mcp`. Injected via the
//! `--mcp-config <path> --strict-mcp-config` CLI flags on `claude`.
//!
//! Wave 0 (Plan 01) declares the symbol. Plan 03 writes the file atomically
//! via `tempfile::NamedTempFile::new_in(...).persist(...)` (Phase 9 pattern).

#![allow(dead_code, unused_variables)]

use std::path::{Path, PathBuf};

pub fn write_session_mcp_config(
    _cwd: &Path,
    _agent_id: &str,
    _aitc_port: u16,
) -> Result<PathBuf, String> {
    todo!("Plan 03 — tempfile + atomic persist into <cwd>/.claude/mcp-<agent>.json")
}
