//! Agent-session lifecycle helpers (HIST-01).
//!
//! Prerequisite for Phase 6 forwarder session-file recording. `record_session_file`
//! in conflict/resolution.rs is the Tauri command; this module exposes the
//! internal function so the pipeline forwarder can call it without going through
//! the Tauri invoke path (D-09).

use sqlx::SqlitePool;

/// Return the id of the currently-open session for `agent_id`, inserting one if none exists.
/// "Open" = `ended_at IS NULL`.
pub async fn ensure_open_session(
    agent_id: &str,
    agent_type: &str,
    pool: &SqlitePool,
) -> Result<i64, String> {
    let mut tx = pool.begin().await.map_err(|e| format!("begin tx: {e}"))?;

    if let Some((id,)) = sqlx::query_as::<_, (i64,)>(
        "SELECT id FROM agent_sessions
         WHERE agent_id = ? AND ended_at IS NULL
         ORDER BY id DESC LIMIT 1",
    )
    .bind(agent_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("select open session: {e}"))?
    {
        tx.commit().await.map_err(|e| format!("commit: {e}"))?;
        return Ok(id);
    }

    let result = sqlx::query(
        "INSERT INTO agent_sessions (agent_id, agent_type, status, started_at)
         VALUES (?, ?, 'running', datetime('now'))",
    )
    .bind(agent_id)
    .bind(agent_type)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("insert session: {e}"))?;

    let id = result.last_insert_rowid();
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(id)
}

/// Mark the currently-open session for `agent_id` as completed.
#[allow(dead_code)]
pub async fn close_session(agent_id: &str, pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        "UPDATE agent_sessions
         SET ended_at = datetime('now'), status = 'completed'
         WHERE agent_id = ? AND ended_at IS NULL",
    )
    .bind(agent_id)
    .execute(pool)
    .await
    .map_err(|e| format!("close session: {e}"))?;
    Ok(())
}

/// Non-Tauri variant of record_session_file. Called from the pipeline forwarder.
#[allow(dead_code)]
pub async fn record_session_file_internal(
    session_id: i64,
    file_path: &str,
    pool: &SqlitePool,
) -> Result<(), String> {
    sqlx::query(
        r#"INSERT INTO session_files (session_id, file_path, write_count, last_written_at)
           VALUES (?, ?, 1, datetime('now'))
           ON CONFLICT(session_id, file_path) DO UPDATE SET
             write_count = write_count + 1,
             last_written_at = datetime('now')"#,
    )
    .bind(session_id)
    .bind(file_path)
    .execute(pool)
    .await
    .map_err(|e| format!("record session file: {e}"))?;

    sqlx::query(
        r#"UPDATE agent_sessions SET file_count = (
             SELECT COUNT(*) FROM session_files WHERE session_id = ?
           ) WHERE id = ?"#,
    )
    .bind(session_id)
    .bind(session_id)
    .execute(pool)
    .await
    .map_err(|e| format!("update file_count: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool_with_schema() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                agent_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                started_at TEXT NOT NULL,
                ended_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                adapter_type TEXT, protocol TEXT, intent TEXT, pid INTEGER, cwd TEXT,
                file_count INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE session_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
                file_path TEXT NOT NULL,
                write_count INTEGER NOT NULL DEFAULT 1,
                last_written_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(session_id, file_path)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn session_lifecycle_ensure_session_is_idempotent() {
        let pool = pool_with_schema().await;
        let a = ensure_open_session("A1", "claude-code", &pool).await.unwrap();
        let b = ensure_open_session("A1", "claude-code", &pool).await.unwrap();
        assert_eq!(a, b);
    }

    #[tokio::test]
    async fn session_lifecycle_ensure_session_creates_new_after_close() {
        let pool = pool_with_schema().await;
        let a = ensure_open_session("A1", "claude-code", &pool).await.unwrap();
        close_session("A1", &pool).await.unwrap();
        let b = ensure_open_session("A1", "claude-code", &pool).await.unwrap();
        assert_ne!(a, b);
    }

    #[tokio::test]
    async fn session_lifecycle_record_session_file_internal_increments_write_count() {
        let pool = pool_with_schema().await;
        let sid = ensure_open_session("A1", "t", &pool).await.unwrap();
        record_session_file_internal(sid, "src/foo.rs", &pool).await.unwrap();
        record_session_file_internal(sid, "src/foo.rs", &pool).await.unwrap();
        let (wc,): (i64,) = sqlx::query_as(
            "SELECT write_count FROM session_files WHERE session_id = ? AND file_path = ?",
        )
        .bind(sid)
        .bind("src/foo.rs")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(wc, 2);
    }

    #[tokio::test]
    async fn session_lifecycle_record_session_file_internal_updates_aggregate() {
        let pool = pool_with_schema().await;
        let sid = ensure_open_session("A1", "t", &pool).await.unwrap();
        record_session_file_internal(sid, "a.rs", &pool).await.unwrap();
        record_session_file_internal(sid, "b.rs", &pool).await.unwrap();
        let (fc,): (i64,) = sqlx::query_as(
            "SELECT file_count FROM agent_sessions WHERE id = ?",
        )
        .bind(sid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(fc, 2);
    }

    #[tokio::test]
    async fn session_lifecycle_close_session_sets_ended_at() {
        let pool = pool_with_schema().await;
        ensure_open_session("A1", "t", &pool).await.unwrap();
        close_session("A1", &pool).await.unwrap();
        let (ended, status): (Option<String>, String) = sqlx::query_as(
            "SELECT ended_at, status FROM agent_sessions WHERE agent_id = ?",
        )
        .bind("A1")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(ended.is_some());
        assert_eq!(status, "completed");
    }
}
