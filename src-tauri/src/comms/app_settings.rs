//! Thin wrapper over an `app_settings` key/value table. Phase 8 uses it to
//! persist the allowlist of tools that trigger approval gating (D-20) and is
//! the natural place to stash other scalar prefs as the app grows.
//!
//! `pretool_gated_tools` is the critical one for Plan 08: it controls which
//! tool names the `/hook` handler gates on (D-19 default allowlist). Read is
//! NOT in the default list — Read gating is handled via the protected_paths
//! OR-semantics path (D-21).

use sqlx::{Pool, Sqlite};

/// D-19 default tool allowlist — mutating tools only. Read/LS/Grep/Glob/
/// WebFetch/WebSearch/Task pass through unless a protected_paths entry
/// catches them (D-21 OR semantics).
const DEFAULT_GATED: &[&str] = &["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"];

/// Ensure the `app_settings` table exists.
pub async fn ensure_schema(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS app_settings ( \
            key TEXT PRIMARY KEY, \
            value TEXT NOT NULL, \
            updated_at TEXT NOT NULL DEFAULT (datetime('now')) \
         )",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("ensure app_settings schema: {e}"))?;
    Ok(())
}

/// Read the configured PreToolUse-gated tool allowlist. Bootstraps the D-19
/// default on first read so every instance starts gated on Edit/Write/Bash
/// etc. even if the user never touches the settings UI.
pub async fn get_pretool_gated_tools(pool: &Pool<Sqlite>) -> Result<Vec<String>, String> {
    ensure_schema(pool).await?;
    let row = sqlx::query_scalar::<_, String>(
        "SELECT value FROM app_settings WHERE key = 'pretool_gated_tools'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("select pretool_gated_tools: {e}"))?;
    if let Some(json_str) = row {
        let v: Vec<String> = serde_json::from_str(&json_str)
            .map_err(|e| format!("parse pretool_gated_tools: {e}"))?;
        return Ok(v);
    }
    // Bootstrap default.
    let default_vec: Vec<String> = DEFAULT_GATED.iter().map(|s| s.to_string()).collect();
    let default_json = serde_json::to_string(&default_vec).unwrap();
    sqlx::query("INSERT INTO app_settings (key, value) VALUES ('pretool_gated_tools', ?)")
        .bind(&default_json)
        .execute(pool)
        .await
        .map_err(|e| format!("insert default pretool_gated_tools: {e}"))?;
    Ok(default_vec)
}

/// Replace the tool allowlist. Upserts the row.
#[allow(dead_code)] // Plan 08-05 wires this into the settings UI.
pub async fn set_pretool_gated_tools(
    pool: &Pool<Sqlite>,
    tools: &[String],
) -> Result<(), String> {
    ensure_schema(pool).await?;
    let json_str = serde_json::to_string(tools).map_err(|e| format!("serialize: {e}"))?;
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('pretool_gated_tools', ?, datetime('now')) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(&json_str)
    .execute(pool)
    .await
    .map_err(|e| format!("upsert pretool_gated_tools: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Passive hook consent (Phase 8 D-04) — dedup of per-repo consent prompts.
//
// Each repo the passive-bridge sees a Claude process in gets a single row:
//   key   = "passive_hook_consent:{repo_cwd}"
//   value ∈ { "accepted", "declined" }
//
// Accepted repos are re-scanned at startup so stale sidecar paths auto-heal
// (Pitfall 6). Declined repos are remembered forever — we never re-prompt.
// The initial emit writes "declined" as a dedup sentinel so the event fires
// at-most-once per (cwd, AITC session); the frontend accept command flips
// the row to "accepted" (and runs the install).
// ---------------------------------------------------------------------------

/// Returns all `(repo_cwd, decision)` entries where decision ∈ {"accepted",
/// "declined"}. Used at startup to re-run install in accepted repos.
pub async fn get_passive_hook_consent_repos(
    pool: &Pool<Sqlite>,
) -> Result<Vec<(String, String)>, String> {
    ensure_schema(pool).await?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM app_settings WHERE key LIKE 'passive_hook_consent:%'",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("select passive_hook_consent: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|(k, v)| {
            (
                k.trim_start_matches("passive_hook_consent:").to_string(),
                v,
            )
        })
        .collect())
}

/// Fast existence check — the passive-bridge reads this every tick per
/// candidate to decide whether to emit a new consent prompt.
pub async fn has_passive_hook_consent_entry(
    pool: &Pool<Sqlite>,
    repo_cwd: &str,
) -> Result<bool, String> {
    ensure_schema(pool).await?;
    let key = format!("passive_hook_consent:{repo_cwd}");
    let r: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM app_settings WHERE key = ?")
            .bind(&key)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("check passive_hook_consent: {e}"))?;
    Ok(r.is_some())
}

/// Upsert the decision for a repo. `decision` must be "accepted" or
/// "declined"; any other value is rejected to keep the column a closed
/// enumeration the startup scanner can rely on.
pub async fn record_passive_hook_consent(
    pool: &Pool<Sqlite>,
    repo_cwd: &str,
    decision: &str,
) -> Result<(), String> {
    if !matches!(decision, "accepted" | "declined") {
        return Err(format!("invalid decision: {decision}"));
    }
    ensure_schema(pool).await?;
    let key = format!("passive_hook_consent:{repo_cwd}");
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(&key)
    .bind(decision)
    .execute(pool)
    .await
    .map_err(|e| format!("upsert passive_hook_consent: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> Pool<Sqlite> {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn pretool_gated_tools_default_bootstraps_on_first_read() {
        let p = pool().await;
        let v1 = get_pretool_gated_tools(&p).await.unwrap();
        assert_eq!(v1, vec!["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"]);
        // Second call reads the persisted row, not re-bootstraps.
        let v2 = get_pretool_gated_tools(&p).await.unwrap();
        assert_eq!(v1, v2);
    }

    #[tokio::test]
    async fn set_pretool_gated_tools_roundtrips() {
        let p = pool().await;
        let _ = get_pretool_gated_tools(&p).await.unwrap(); // bootstrap
        set_pretool_gated_tools(&p, &["Bash".to_string()])
            .await
            .unwrap();
        let v = get_pretool_gated_tools(&p).await.unwrap();
        assert_eq!(v, vec!["Bash"]);
    }

    #[tokio::test]
    async fn ensure_schema_is_idempotent() {
        let p = pool().await;
        ensure_schema(&p).await.unwrap();
        ensure_schema(&p).await.unwrap();
        // Writing and reading still works.
        set_pretool_gated_tools(&p, &["Edit".to_string()]).await.unwrap();
        let v = get_pretool_gated_tools(&p).await.unwrap();
        assert_eq!(v, vec!["Edit"]);
    }

    // ---------------- Passive hook consent (Phase 8 D-04) ----------------

    #[tokio::test]
    async fn record_and_retrieve_consent() {
        let p = pool().await;
        record_passive_hook_consent(&p, "/a/b", "accepted").await.unwrap();
        record_passive_hook_consent(&p, "/c/d", "declined").await.unwrap();
        let mut v = get_passive_hook_consent_repos(&p).await.unwrap();
        v.sort();
        assert_eq!(
            v,
            vec![
                ("/a/b".into(), "accepted".into()),
                ("/c/d".into(), "declined".into()),
            ]
        );
    }

    #[tokio::test]
    async fn has_consent_entry_roundtrip() {
        let p = pool().await;
        assert!(!has_passive_hook_consent_entry(&p, "/a/b").await.unwrap());
        record_passive_hook_consent(&p, "/a/b", "declined").await.unwrap();
        assert!(has_passive_hook_consent_entry(&p, "/a/b").await.unwrap());
    }

    #[tokio::test]
    async fn reject_invalid_decision() {
        let p = pool().await;
        assert!(record_passive_hook_consent(&p, "/a", "maybe").await.is_err());
    }

    #[tokio::test]
    async fn record_overwrites_previous_decision() {
        // accept-then-decline and vice versa are both valid transitions.
        let p = pool().await;
        record_passive_hook_consent(&p, "/a/b", "declined").await.unwrap();
        record_passive_hook_consent(&p, "/a/b", "accepted").await.unwrap();
        let v = get_passive_hook_consent_repos(&p).await.unwrap();
        assert_eq!(v, vec![("/a/b".into(), "accepted".into())]);
    }
}
