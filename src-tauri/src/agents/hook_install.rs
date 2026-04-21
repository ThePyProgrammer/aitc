//! Merge-safe writer for `cwd/.claude/settings.local.json` (D-01, D-02, Pitfall 4).
//!
//! Plan 01 (Wave 0) scaffolded this module with `todo!("plan 04")` stubs and
//! `#[should_panic]` contract-lock tests. Plan 04 (this file) implements:
//!
//! - Hand-rolled JSON merge (NOT json-patch / RFC 7396 — that replaces arrays
//!   wholesale, clobbering user hook entries). See 08-RESEARCH.md Pattern 4.
//! - Idempotent: re-running install with the same sidecar path leaves one AITC
//!   entry. Different sidecar path (e.g. AITC update, Pitfall 6) replaces in
//!   place so paths auto-heal after an AITC upgrade.
//! - Atomic: write tmp then rename, so a crash mid-write never corrupts the
//!   user's `settings.local.json`.
//! - Refuses to overwrite a settings.local.json with a non-object top-level
//!   (we'd clobber user data if we did).

use serde_json::{json, Value};
use sqlx::{Pool, Sqlite};
use std::path::Path;

/// Install the aitc-hook sidecar into `<cwd>/.claude/settings.local.json`.
///
/// Creates `.claude/` if missing. Merges AITC's PreToolUse entry into any
/// existing hooks config without clobbering sibling top-level keys, other
/// hook event names (PostToolUse, Stop, etc.), or the user's own PreToolUse
/// entries. Idempotent. Atomic via tmp-then-rename.
pub fn install_aitc_hook(cwd: &Path, sidecar_abs_path: &str) -> Result<(), String> {
    let dot_claude = cwd.join(".claude");
    std::fs::create_dir_all(&dot_claude).map_err(|e| format!("mkdir .claude: {e}"))?;
    let path = dot_claude.join("settings.local.json");

    let mut root: Value = if path.exists() {
        let contents = std::fs::read_to_string(&path)
            .map_err(|e| format!("read existing settings.local.json: {e}"))?;
        if contents.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&contents)
                .map_err(|e| format!("parse existing settings.local.json: {e}"))?
        }
    } else {
        json!({})
    };

    // Refuse to overwrite a non-object top-level (T-08-08): the file belongs
    // to the user, and replacing their array/string with our object would be
    // data loss masquerading as a merge.
    if !root.is_object() {
        return Err("settings.local.json top-level must be an object".into());
    }

    let our_entry = json!({
        "matcher": "*",
        "hooks": [{
            "type": "command",
            "command": sidecar_abs_path
        }]
    });

    upsert_pretool_entry(&mut root, our_entry);

    let tmp = path.with_file_name("settings.local.json.tmp");
    let rendered =
        serde_json::to_string_pretty(&root).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&tmp, rendered).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("atomic rename: {e}"))?;
    Ok(())
}

/// Hand-rolled upsert for `hooks.PreToolUse`. Preserves user entries and other
/// hook event names verbatim; replaces any existing AITC entry (detected by
/// matching the exact current command OR the `aitc-hook` / `aitc-hook.exe`
/// basename suffix, which lets us heal stale paths after an AITC update per
/// Pitfall 6); otherwise appends.
pub fn upsert_pretool_entry(root: &mut Value, our_entry: Value) {
    let our_command = our_entry["hooks"][0]["command"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let root_obj = root
        .as_object_mut()
        .expect("caller guarantees root is object");
    let hooks = root_obj.entry("hooks").or_insert_with(|| json!({}));
    // If `hooks` exists but isn't an object, replace it — the caller has
    // already guaranteed the root is an object; a malformed `hooks` subtree
    // isn't recoverable, and the alternative is silent data drop.
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks_obj = hooks.as_object_mut().expect("hooks must be object");
    let pretool = hooks_obj
        .entry("PreToolUse")
        .or_insert_with(|| json!([]));
    if !pretool.is_array() {
        *pretool = json!([]);
    }
    let arr = pretool.as_array_mut().expect("PreToolUse must be array");

    // Detect any entry whose first hook command is either our exact command,
    // or has a basename of `aitc-hook`/`aitc-hook.exe`. The basename match
    // enables Pitfall 6 stale-path healing.
    let is_aitc_entry = |entry: &Value| -> bool {
        let Some(hs) = entry["hooks"].as_array() else {
            return false;
        };
        hs.iter().any(|h| {
            let cmd = h["command"].as_str().unwrap_or("");
            cmd == our_command
                || cmd.ends_with("/aitc-hook")
                || cmd.ends_with("\\aitc-hook.exe")
                || cmd.ends_with("/aitc-hook.exe")
        })
    };

    for entry in arr.iter_mut() {
        if is_aitc_entry(entry) {
            *entry = our_entry;
            return;
        }
    }
    arr.push(our_entry);
}

/// On AITC startup, re-run `install_aitc_hook` for every accepted repo so a
/// new sidecar path (after AITC update / Pitfall 6) auto-heals stale entries.
/// Returns the list of repo cwds that were successfully healed.
///
/// Swallows per-repo errors and logs them — a single broken repo should never
/// block other repos from being healed or stall startup.
pub async fn reinstall_accepted_repos_on_startup(
    pool: &Pool<Sqlite>,
    sidecar_abs_path: &str,
) -> Vec<String> {
    use crate::comms::app_settings::get_passive_hook_consent_repos;
    let entries = match get_passive_hook_consent_repos(pool).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "reinstall_accepted_repos: load failed");
            return vec![];
        }
    };
    let mut healed = Vec::new();
    for (cwd, decision) in entries {
        if decision != "accepted" {
            continue;
        }
        let path = std::path::Path::new(&cwd);
        if !path.exists() {
            // Repo was deleted / moved. Skip silently; next bridge_tick will
            // re-prompt if the user opens a new repo with the same cwd.
            continue;
        }
        match install_aitc_hook(path, sidecar_abs_path) {
            Ok(()) => healed.push(cwd.clone()),
            Err(e) => {
                tracing::warn!(cwd = %cwd, error = %e, "reinstall for accepted repo failed")
            }
        }
    }
    healed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    #[test]
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
        assert!(arr
            .iter()
            .any(|e| e["hooks"][0]["command"] == "/usr/local/bin/user-linter"));
        assert!(arr
            .iter()
            .any(|e| e["hooks"][0]["command"] == "/opt/aitc/bin/aitc-hook"));
    }

    #[test]
    fn upsert_is_idempotent() {
        let mut root = json!({});
        let our = json!({
            "matcher": "*",
            "hooks": [{"type": "command", "command": "/opt/aitc/bin/aitc-hook"}]
        });
        upsert_pretool_entry(&mut root, our.clone());
        upsert_pretool_entry(&mut root, our);
        let arr = root["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
    }

    #[test]
    fn upsert_replaces_stale_aitc_path() {
        let mut root = json!({
            "hooks": {
                "PreToolUse": [{
                    "matcher": "*",
                    "hooks": [{"type": "command", "command": "/old/path/aitc-hook"}]
                }]
            }
        });
        let new = json!({
            "matcher": "*",
            "hooks": [{"type": "command", "command": "/new/path/aitc-hook"}]
        });
        upsert_pretool_entry(&mut root, new);
        let arr = root["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["hooks"][0]["command"], "/new/path/aitc-hook");
    }

    #[test]
    fn upsert_preserves_other_hook_event_names() {
        let mut root = json!({
            "hooks": {
                "PreToolUse": [],
                "PostToolUse": [{"matcher": "*", "hooks":[{"type":"command","command":"/x/y"}]}],
                "Stop": [{"matcher": "*", "hooks":[{"type":"command","command":"/stop"}]}]
            }
        });
        let our = json!({"matcher":"*","hooks":[{"type":"command","command":"/aitc-hook"}]});
        upsert_pretool_entry(&mut root, our);
        assert_eq!(
            root["hooks"]["PostToolUse"][0]["hooks"][0]["command"],
            "/x/y"
        );
        assert_eq!(root["hooks"]["Stop"][0]["hooks"][0]["command"], "/stop");
    }

    #[test]
    fn install_creates_settings_local_json_when_missing() {
        let td = TempDir::new().unwrap();
        install_aitc_hook(td.path(), "/opt/aitc/bin/aitc-hook").unwrap();
        let p = td.path().join(".claude").join("settings.local.json");
        assert!(p.exists());
        let root: Value =
            serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let arr = root["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["hooks"][0]["command"], "/opt/aitc/bin/aitc-hook");
    }

    #[test]
    fn install_preserves_unrelated_top_level_keys() {
        let td = TempDir::new().unwrap();
        let dc = td.path().join(".claude");
        std::fs::create_dir_all(&dc).unwrap();
        std::fs::write(
            dc.join("settings.local.json"),
            r#"{"someOtherKey":"x","hooks":{"PreToolUse":[]}}"#,
        )
        .unwrap();
        install_aitc_hook(td.path(), "/opt/aitc/bin/aitc-hook").unwrap();
        let root: Value =
            serde_json::from_str(&std::fs::read_to_string(dc.join("settings.local.json")).unwrap())
                .unwrap();
        assert_eq!(root["someOtherKey"], "x");
        assert_eq!(root["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn install_is_atomic_via_tmp_rename() {
        // Sanity-check: the successful install path produces exactly the
        // expected file and NO lingering `.tmp` file. This is the atomic-
        // write post-condition.
        let td = TempDir::new().unwrap();
        install_aitc_hook(td.path(), "/a").unwrap();
        let dc = td.path().join(".claude");
        assert!(dc.join("settings.local.json").exists());
        assert!(
            !dc.join("settings.local.json.tmp").exists(),
            "tmp file must be renamed away"
        );
    }

    #[test]
    fn install_rejects_non_object_top_level() {
        let td = TempDir::new().unwrap();
        let dc = td.path().join(".claude");
        std::fs::create_dir_all(&dc).unwrap();
        std::fs::write(
            dc.join("settings.local.json"),
            r#"["not","an","object"]"#,
        )
        .unwrap();
        let r = install_aitc_hook(td.path(), "/aitc-hook");
        assert!(
            r.is_err(),
            "must refuse to overwrite non-object top-level"
        );
    }

    #[test]
    fn install_handles_empty_file() {
        let td = TempDir::new().unwrap();
        let dc = td.path().join(".claude");
        std::fs::create_dir_all(&dc).unwrap();
        std::fs::write(dc.join("settings.local.json"), "").unwrap();
        install_aitc_hook(td.path(), "/opt/aitc/bin/aitc-hook").unwrap();
        let root: Value = serde_json::from_str(
            &std::fs::read_to_string(dc.join("settings.local.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            root["hooks"]["PreToolUse"].as_array().unwrap()[0]["hooks"][0]["command"],
            "/opt/aitc/bin/aitc-hook"
        );
    }

    #[tokio::test]
    async fn reinstall_accepted_repos_skips_declined() {
        use crate::comms::app_settings::{ensure_schema, record_passive_hook_consent};
        use sqlx::sqlite::SqlitePoolOptions;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        ensure_schema(&pool).await.unwrap();
        let accepted_dir = TempDir::new().unwrap();
        let declined_dir = TempDir::new().unwrap();
        record_passive_hook_consent(&pool, accepted_dir.path().to_str().unwrap(), "accepted")
            .await
            .unwrap();
        record_passive_hook_consent(&pool, declined_dir.path().to_str().unwrap(), "declined")
            .await
            .unwrap();
        let healed =
            reinstall_accepted_repos_on_startup(&pool, "/opt/aitc/bin/aitc-hook").await;
        assert_eq!(healed.len(), 1);
        assert!(healed[0].contains(accepted_dir.path().to_str().unwrap()));
        assert!(accepted_dir
            .path()
            .join(".claude/settings.local.json")
            .exists());
        assert!(!declined_dir
            .path()
            .join(".claude/settings.local.json")
            .exists());
    }

    #[tokio::test]
    async fn reinstall_accepted_repos_heals_stale_paths() {
        use crate::comms::app_settings::{ensure_schema, record_passive_hook_consent};
        use sqlx::sqlite::SqlitePoolOptions;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        ensure_schema(&pool).await.unwrap();
        let td = TempDir::new().unwrap();
        // Seed an accepted repo with a stale AITC hook command.
        install_aitc_hook(td.path(), "/old/path/aitc-hook").unwrap();
        record_passive_hook_consent(&pool, td.path().to_str().unwrap(), "accepted")
            .await
            .unwrap();
        let healed =
            reinstall_accepted_repos_on_startup(&pool, "/new/path/aitc-hook").await;
        assert_eq!(healed.len(), 1);
        let root: Value = serde_json::from_str(
            &std::fs::read_to_string(td.path().join(".claude/settings.local.json")).unwrap(),
        )
        .unwrap();
        let arr = root["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(arr.len(), 1, "stale entry must be replaced in place");
        assert_eq!(arr[0]["hooks"][0]["command"], "/new/path/aitc-hook");
    }
}
