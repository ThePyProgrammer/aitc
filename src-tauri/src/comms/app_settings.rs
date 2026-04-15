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
}
