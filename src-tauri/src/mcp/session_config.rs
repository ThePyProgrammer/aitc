//! Phase 10: per-session MCP client config writer.
//!
//! Each launched Claude Code session gets a `.claude/aitc-mcp-<agent_id>.json`
//! file pointing at `http://127.0.0.1:<aitc_port>/mcp`. Injected via the
//! `--mcp-config <path> --strict-mcp-config` CLI flags on `claude`.
//!
//! Plan 03 writes the file atomically via `tempfile::NamedTempFile::new_in(...)
//! .persist(...)` (Phase 9 pattern). agent_id is regex-validated before use
//! (T-10-19 path traversal mitigation).

#![allow(dead_code)]

use std::io::Write;
use std::path::{Path, PathBuf};

/// Characters allowed in an `agent_id` for the purposes of forming a config
/// filename. Deliberately narrow — rejects `.`, `/`, `\`, quotes, and any
/// unicode — because the validated id is spliced into a filesystem path.
const AGENT_ID_ALLOWED: &str =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/// Validate `agent_id` shape before using it inside any filesystem path.
/// `^[A-Za-z0-9_-]{1,128}$` — same regex the threat model references
/// (T-10-19). Returns true iff the id is safe to splice into a path.
fn agent_id_valid(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| AGENT_ID_ALLOWED.contains(c))
}

/// Write a Claude-compatible MCP config JSON file pointing at the AITC MCP
/// endpoint for this agent. Atomic via tempfile + persist — a crash mid-write
/// never leaves a partial config for Claude to read.
///
/// Shape (D-11, consumed by Plan 04's `claude --mcp-config <path>` argv):
/// ```json
/// {
///   "mcpServers": {
///     "aitc-chat": {
///       "type": "http",
///       "url": "http://127.0.0.1:<AITC_PORT>/mcp",
///       "headers": { "X-AITC-Session": "<agent_id>" }
///     }
///   }
/// }
/// ```
///
/// Returns the absolute path to the persisted file on success.
pub fn write_session_mcp_config(
    cwd: &Path,
    agent_id: &str,
    aitc_port: u16,
) -> Result<PathBuf, String> {
    if !agent_id_valid(agent_id) {
        return Err(format!("invalid agent_id shape: {agent_id:?}"));
    }
    let dot_claude = cwd.join(".claude");
    std::fs::create_dir_all(&dot_claude).map_err(|e| format!("mkdir .claude: {e}"))?;

    let target = dot_claude.join(format!("aitc-mcp-{agent_id}.json"));
    let body = serde_json::json!({
        "mcpServers": {
            "aitc-chat": {
                "type": "http",
                "url": format!("http://127.0.0.1:{aitc_port}/mcp"),
                "headers": { "X-AITC-Session": agent_id }
            }
        }
    });
    let rendered =
        serde_json::to_string_pretty(&body).map_err(|e| format!("serialize mcp config: {e}"))?;

    // Create the temp file in the SAME directory as the target so the
    // eventual `persist` is a same-filesystem rename (cross-device renames
    // silently fall back to non-atomic copy + unlink).
    let mut tmp = tempfile::NamedTempFile::new_in(&dot_claude)
        .map_err(|e| format!("tempfile: {e}"))?;
    tmp.write_all(rendered.as_bytes())
        .map_err(|e| format!("tmp write_all: {e}"))?;
    tmp.flush().map_err(|e| format!("tmp flush: {e}"))?;
    tmp.persist(&target)
        .map_err(|e| format!("persist: {}", e.error))?;

    Ok(target)
}

/// Best-effort cleanup — removes the per-session config file on agent
/// teardown. Ignores ErrorKind::NotFound so the call is idempotent.
/// Returns Ok(()) when the agent_id is invalid rather than erroring, since
/// a crash-path caller shouldn't have its cleanup blocked by a malformed id.
pub fn delete_session_mcp_config(cwd: &Path, agent_id: &str) -> Result<(), String> {
    if !agent_id_valid(agent_id) {
        return Ok(()); // best-effort; skip silently
    }
    let target = cwd
        .join(".claude")
        .join(format!("aitc-mcp-{agent_id}.json"));
    match std::fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove_file: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_id_valid_accepts_simple_ids() {
        assert!(agent_id_valid("A-1"));
        assert!(agent_id_valid("KAGENT-12345"));
        assert!(agent_id_valid("claude_code_session_abc"));
        assert!(agent_id_valid("a"));
    }

    #[test]
    fn agent_id_valid_rejects_traversal_and_bogus_ids() {
        assert!(!agent_id_valid(""));
        assert!(!agent_id_valid("../etc/passwd"));
        assert!(!agent_id_valid("../../foo"));
        assert!(!agent_id_valid("a/b"));
        assert!(!agent_id_valid("a\\b"));
        assert!(!agent_id_valid("a.b"));
        assert!(!agent_id_valid("a b"));
        assert!(!agent_id_valid("a\"b"));
        assert!(!agent_id_valid("a\0b"));
        // Over 128 chars.
        assert!(!agent_id_valid(&"x".repeat(129)));
        // Unicode rejected (narrow ASCII allowlist).
        assert!(!agent_id_valid("ábc"));
    }

    #[test]
    fn write_session_mcp_config_produces_valid_json_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = write_session_mcp_config(tmp.path(), "KAGENT-1234", 9417).unwrap();
        assert!(path.exists());
        assert!(path.ends_with(".claude/aitc-mcp-KAGENT-1234.json"));

        let body = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["mcpServers"]["aitc-chat"]["type"], "http");
        assert_eq!(
            parsed["mcpServers"]["aitc-chat"]["url"],
            "http://127.0.0.1:9417/mcp"
        );
        assert_eq!(
            parsed["mcpServers"]["aitc-chat"]["headers"]["X-AITC-Session"],
            "KAGENT-1234"
        );
    }

    #[test]
    fn write_session_mcp_config_rejects_invalid_agent_id() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(write_session_mcp_config(tmp.path(), "../etc", 9417).is_err());
        assert!(write_session_mcp_config(tmp.path(), "", 9417).is_err());
        assert!(write_session_mcp_config(tmp.path(), &"x".repeat(200), 9417).is_err());
        assert!(write_session_mcp_config(tmp.path(), "has space", 9417).is_err());
    }

    #[test]
    fn write_session_mcp_config_is_atomic_over_existing_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        // First write at port 1111.
        let _ = write_session_mcp_config(tmp.path(), "A-1", 1111).unwrap();
        // Second write at port 2222 — must fully replace, not mix.
        let path = write_session_mcp_config(tmp.path(), "A-1", 2222).unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("http://127.0.0.1:2222/mcp"));
        assert!(
            !body.contains("1111"),
            "old port must not leak into replaced file"
        );
    }

    #[test]
    fn write_session_mcp_config_creates_dot_claude_dir_if_missing() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(!tmp.path().join(".claude").exists());
        let path = write_session_mcp_config(tmp.path(), "A-1", 9417).unwrap();
        assert!(tmp.path().join(".claude").exists());
        assert!(path.exists());
    }

    #[test]
    fn delete_session_mcp_config_is_idempotent() {
        let tmp = tempfile::TempDir::new().unwrap();
        // Delete a nonexistent file → Ok.
        assert!(delete_session_mcp_config(tmp.path(), "A-1").is_ok());
        // Write, delete, delete — all three ok.
        let path = write_session_mcp_config(tmp.path(), "A-1", 9417).unwrap();
        assert!(path.exists());
        assert!(delete_session_mcp_config(tmp.path(), "A-1").is_ok());
        assert!(!path.exists());
        assert!(delete_session_mcp_config(tmp.path(), "A-1").is_ok());
    }

    #[test]
    fn delete_session_mcp_config_ok_on_invalid_agent_id() {
        let tmp = tempfile::TempDir::new().unwrap();
        // Path-traversal id is a no-op, not an error (best-effort cleanup).
        assert!(delete_session_mcp_config(tmp.path(), "../etc/passwd").is_ok());
    }
}
