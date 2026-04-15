//! settings.local.json merge writer for Claude Code PreToolUse hooks (D-01, D-02).
//!
//! Plan 01 (Wave 0) creates the stub + red tests that lock the contract.
//! Plan 04 implements the real merge per RESEARCH Pattern 4 + Pitfall 4:
//! hand-rolled upsert that preserves existing user PreToolUse entries and is
//! idempotent under repeat invocation.

use std::path::Path;

/// Install the aitc-hook sidecar into `<cwd>/.claude/settings.local.json`.
/// Plan 04 implements. Returns `Err` if the settings file cannot be read or
/// written; the CLI form surfaces these via tracing.
pub fn install_aitc_hook(_cwd: &Path, _sidecar_abs_path: &str) -> Result<(), String> {
    todo!("plan 04")
}

/// In-place upsert of our PreToolUse entry into a parsed settings JSON root.
/// Implementation (Plan 04) MUST preserve pre-existing user entries and be
/// idempotent on repeat calls.
pub fn upsert_pretool_entry(_root: &mut serde_json::Value, _our_entry: serde_json::Value) {
    todo!("plan 04")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    #[should_panic(expected = "plan 04")]
    fn upsert_preserves_existing_user_entries() {
        let mut root = json!({
            "hooks": {
                "PreToolUse": [{
                    "matcher": "Edit",
                    "hooks": [{"type": "command", "command": "/usr/local/bin/user-linter"}]
                }]
            }
        });
        let our = json!({
            "matcher": "*",
            "hooks": [{"type": "command", "command": "/opt/aitc/bin/aitc-hook"}]
        });
        upsert_pretool_entry(&mut root, our);
        let arr = root["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 2, "must keep user's existing entry AND ours");
    }

    #[test]
    #[should_panic(expected = "plan 04")]
    fn upsert_is_idempotent() {
        let mut root = json!({});
        let our = json!({
            "matcher": "*",
            "hooks": [{"type": "command", "command": "/opt/aitc/bin/aitc-hook"}]
        });
        upsert_pretool_entry(&mut root, our.clone());
        upsert_pretool_entry(&mut root, our);
        let arr = root["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 1, "re-running install must not duplicate AITC entry");
    }
}
