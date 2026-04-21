//! CRUD helpers for the Phase 10 `agent_events` table.
//! Plan 02 fills in the bodies.
//!
//! Threat mitigations:
//! - T-10-02 / T-10-12: all queries use sqlx bind parameters, never string concat.
//! - T-10-04: payload_json column holds JSON blobs; callers are responsible for
//!   not storing secrets. User/assistant text is NOT a secret per D-18.

use crate::chat_runtime::types::AgentEvent;
use sqlx::{Row, SqlitePool};

#[allow(dead_code)]
pub(crate) fn map_agent_event_row(row: &sqlx::sqlite::SqliteRow) -> Result<AgentEvent, String> {
    let payload_str: String = row.get("payload_json");
    let payload_json: serde_json::Value = serde_json::from_str(&payload_str)
        .map_err(|e| format!("payload_json parse: {e}"))?;
    // Explicit Option<T> typing: sqlx-sqlite's String decode silently yields
    // "" for NULL columns when the target is `String`. Option<String> is the
    // correct decode target for nullable TEXT/INTEGER columns — `None` for
    // NULL, `Some(v)` for a real value.
    Ok(AgentEvent {
        id: row.get("id"),
        agent_id: row.get("agent_id"),
        session_id: row.try_get::<Option<String>, _>("session_id").unwrap_or(None),
        event_type: row.get("event_type"),
        payload_json,
        approval_request_id: row
            .try_get::<Option<i64>, _>("approval_request_id")
            .unwrap_or(None),
        sequence_number: row
            .try_get::<Option<i64>, _>("sequence_number")
            .unwrap_or(None),
        created_at: row.get("created_at"),
        delivery_status: row
            .try_get::<Option<String>, _>("delivery_status")
            .unwrap_or(None),
    })
}

/// Insert a single row into `agent_events`. When `sequence_number` is None
/// and `session_id` is Some, auto-computes the next monotonic sequence number
/// scoped to that session_id (MAX+1). Returns the fully hydrated row.
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub async fn insert_agent_event(
    pool: &SqlitePool,
    agent_id: &str,
    session_id: Option<&str>,
    event_type: &str,
    payload_json: &serde_json::Value,
    approval_request_id: Option<i64>,
    sequence_number: Option<i64>,
    delivery_status: Option<&str>,
) -> Result<AgentEvent, String> {
    let seq = match (sequence_number, session_id) {
        (Some(n), _) => Some(n),
        (None, Some(sid)) => {
            let row: Option<(Option<i64>,)> = sqlx::query_as(
                "SELECT MAX(sequence_number) FROM agent_events WHERE session_id = ?",
            )
            .bind(sid)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("seq lookup: {e}"))?;
            Some(row.and_then(|t| t.0).unwrap_or(0) + 1)
        }
        (None, None) => None,
    };

    let payload_str = serde_json::to_string(payload_json)
        .map_err(|e| format!("payload serialize: {e}"))?;

    let row = sqlx::query(
        "INSERT INTO agent_events \
         (agent_id, session_id, event_type, payload_json, approval_request_id, sequence_number, delivery_status) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         RETURNING id, agent_id, session_id, event_type, payload_json, approval_request_id, sequence_number, delivery_status, created_at"
    )
    .bind(agent_id)
    .bind(session_id)
    .bind(event_type)
    .bind(&payload_str)
    .bind(approval_request_id)
    .bind(seq)
    .bind(delivery_status)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("insert agent_event failed: {e}"))?;

    map_agent_event_row(&row)
}

/// Paginated reader. Newest-first (frontend TanStack Virtual reverse-scroll
/// assumes this ordering). `before_id` is an exclusive cursor — pass the
/// smallest id from the current page for the next page. `limit` is clamped
/// to `[1, 200]`.
#[allow(dead_code)]
pub async fn list_events_for_agent(
    pool: &SqlitePool,
    agent_id: &str,
    before_id: Option<i64>,
    limit: i64,
) -> Result<Vec<AgentEvent>, String> {
    let effective_limit = limit.clamp(1, 200);
    let rows = match before_id {
        Some(bid) => {
            sqlx::query(
                "SELECT id, agent_id, session_id, event_type, payload_json, approval_request_id, \
                        sequence_number, delivery_status, created_at \
                 FROM agent_events WHERE agent_id = ? AND id < ? \
                 ORDER BY id DESC LIMIT ?",
            )
            .bind(agent_id)
            .bind(bid)
            .bind(effective_limit)
            .fetch_all(pool)
            .await
        }
        None => {
            sqlx::query(
                "SELECT id, agent_id, session_id, event_type, payload_json, approval_request_id, \
                        sequence_number, delivery_status, created_at \
                 FROM agent_events WHERE agent_id = ? \
                 ORDER BY id DESC LIMIT ?",
            )
            .bind(agent_id)
            .bind(effective_limit)
            .fetch_all(pool)
            .await
        }
    }
    .map_err(|e| format!("list_events_for_agent: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows.iter() {
        out.push(map_agent_event_row(row)?);
    }
    Ok(out)
}

/// Defensive filter: only flips `delivery_status` on rows where
/// `event_type = 'user_text'`. Assistant / tool rows should never receive a
/// delivery_status update (D-10).
#[allow(dead_code)]
pub async fn update_event_delivery_status(
    pool: &SqlitePool,
    event_id: i64,
    status: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE agent_events SET delivery_status = ? \
         WHERE id = ? AND event_type = 'user_text'",
    )
    .bind(status)
    .bind(event_id)
    .execute(pool)
    .await
    .map_err(|e| format!("update_event_delivery_status: {e}"))?;
    Ok(())
}

#[allow(dead_code)]
pub async fn delete_events_for_agent(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<u64, String> {
    let result = sqlx::query("DELETE FROM agent_events WHERE agent_id = ?")
        .bind(agent_id)
        .execute(pool)
        .await
        .map_err(|e| format!("delete_events_for_agent: {e}"))?;
    Ok(result.rows_affected())
}

/// Used by the parser's turn-complete branch to flip the most recent
/// user_text row to delivery_status='consumed'.
#[allow(dead_code)]
pub async fn find_last_user_text_id(
    pool: &SqlitePool,
    agent_id: &str,
    session_id: Option<&str>,
) -> Result<Option<i64>, String> {
    let row = match session_id {
        Some(sid) => sqlx::query_as::<_, (i64,)>(
            "SELECT id FROM agent_events \
             WHERE agent_id = ? AND session_id = ? AND event_type = 'user_text' \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(agent_id)
        .bind(sid)
        .fetch_optional(pool)
        .await,
        None => sqlx::query_as::<_, (i64,)>(
            "SELECT id FROM agent_events \
             WHERE agent_id = ? AND event_type = 'user_text' \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(agent_id)
        .fetch_optional(pool)
        .await,
    }
    .map_err(|e| format!("find_last_user_text_id: {e}"))?;
    Ok(row.map(|(id,)| id))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Spin up an in-memory SQLite pool seeded with the schema required by
    /// Phase 10 tests (approval_requests FK target + chat_messages source +
    /// agent_events target + 006_agent_events migration body).
    pub async fn make_pool_with_chat_schema() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        // Minimal approval_requests table so the FK references resolve.
        sqlx::query(
            "CREATE TABLE approval_requests ( \
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                agent_id TEXT, \
                request_type TEXT NOT NULL, \
                status TEXT NOT NULL DEFAULT 'pending', \
                created_at TEXT NOT NULL DEFAULT (datetime('now')) \
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        // chat_messages source for the 006 migration INSERT...SELECT.
        sqlx::query(
            "CREATE TABLE chat_messages ( \
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                agent_id TEXT NOT NULL, \
                direction TEXT NOT NULL, \
                content TEXT NOT NULL, \
                delivery_status TEXT NOT NULL DEFAULT 'queued', \
                approval_request_id INTEGER, \
                created_at TEXT NOT NULL DEFAULT (datetime('now')) \
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        // 006 schema.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS agent_events ( \
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                agent_id TEXT NOT NULL, \
                session_id TEXT, \
                event_type TEXT NOT NULL, \
                payload_json TEXT NOT NULL, \
                approval_request_id INTEGER REFERENCES approval_requests(id), \
                sequence_number INTEGER, \
                delivery_status TEXT, \
                created_at TEXT NOT NULL DEFAULT (datetime('now')) \
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_agent_events_agent_created ON agent_events(agent_id, created_at)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_agent_events_session_sequence ON agent_events(session_id, sequence_number)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    /// Re-run the 006 migration body to verify idempotency. The migrator in
    /// production is driven by `sqlx::migrate!`, which runs each file exactly
    /// once — idempotency here is about the `IF NOT EXISTS` + deterministic
    /// outcome even if the file were somehow re-executed.
    async fn run_006_migration_body(pool: &SqlitePool) {
        sqlx::query(
            "INSERT INTO agent_events (agent_id, session_id, event_type, payload_json, approval_request_id, sequence_number, delivery_status, created_at) \
             SELECT agent_id, NULL, \
                 CASE direction WHEN 'outbound' THEN 'user_text' ELSE 'assistant_text' END, \
                 json_object('content', content), \
                 approval_request_id, \
                 ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at), \
                 CASE direction WHEN 'outbound' THEN delivery_status ELSE NULL END, \
                 created_at \
             FROM chat_messages",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM chat_messages")
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn insert_then_list_round_trip() {
        let pool = make_pool_with_chat_schema().await;
        let payload = serde_json::json!({"content": "hi"});
        let ev = insert_agent_event(
            &pool, "A-1", Some("sess-1"), "user_text", &payload, None, None, Some("queued"),
        )
        .await
        .unwrap();
        assert_eq!(ev.agent_id, "A-1");
        assert_eq!(ev.event_type, "user_text");
        assert_eq!(ev.sequence_number, Some(1));
        assert_eq!(ev.delivery_status.as_deref(), Some("queued"));
        assert_eq!(ev.payload_json["content"], serde_json::json!("hi"));

        let list = list_events_for_agent(&pool, "A-1", None, 50).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, ev.id);
    }

    #[tokio::test]
    async fn sequence_number_auto_increments_per_session() {
        let pool = make_pool_with_chat_schema().await;
        for i in 0..3 {
            let payload = serde_json::json!({"content": format!("m{i}")});
            let ev = insert_agent_event(
                &pool, "A-1", Some("sess-1"), "assistant_text", &payload, None, None, None,
            )
            .await
            .unwrap();
            assert_eq!(ev.sequence_number, Some(i + 1));
        }
        // Different session — sequence restarts.
        let payload = serde_json::json!({"content": "other"});
        let ev = insert_agent_event(
            &pool, "A-1", Some("sess-2"), "assistant_text", &payload, None, None, None,
        )
        .await
        .unwrap();
        assert_eq!(ev.sequence_number, Some(1));
    }

    #[tokio::test]
    async fn update_event_delivery_status_only_touches_user_text() {
        let pool = make_pool_with_chat_schema().await;
        let user_ev = insert_agent_event(
            &pool, "A-1", Some("sess-1"), "user_text",
            &serde_json::json!({"content": "m"}), None, None, Some("queued"),
        )
        .await
        .unwrap();
        let asst_ev = insert_agent_event(
            &pool, "A-1", Some("sess-1"), "assistant_text",
            &serde_json::json!({"content": "m"}), None, None, None,
        )
        .await
        .unwrap();

        // Updating the user_text row works.
        update_event_delivery_status(&pool, user_ev.id, "delivered")
            .await
            .unwrap();
        // Updating the assistant_text row is a no-op (defensive filter).
        update_event_delivery_status(&pool, asst_ev.id, "delivered")
            .await
            .unwrap();

        let list = list_events_for_agent(&pool, "A-1", None, 50).await.unwrap();
        let user_row = list.iter().find(|e| e.id == user_ev.id).unwrap();
        let asst_row = list.iter().find(|e| e.id == asst_ev.id).unwrap();
        assert_eq!(user_row.delivery_status.as_deref(), Some("delivered"));
        assert_eq!(asst_row.delivery_status, None);
    }

    #[tokio::test]
    async fn list_events_paginates_correctly_newest_first() {
        let pool = make_pool_with_chat_schema().await;
        for i in 0..5 {
            insert_agent_event(
                &pool, "A-1", Some("sess-1"), "assistant_text",
                &serde_json::json!({"content": format!("m{i}")}), None, None, None,
            )
            .await
            .unwrap();
        }
        // First page — newest 2.
        let page1 = list_events_for_agent(&pool, "A-1", None, 2).await.unwrap();
        assert_eq!(page1.len(), 2);
        assert!(page1[0].id > page1[1].id, "must be newest-first");
        // Next page — anchored at smallest id from page1.
        let cursor = page1.last().unwrap().id;
        let page2 = list_events_for_agent(&pool, "A-1", Some(cursor), 2).await.unwrap();
        assert_eq!(page2.len(), 2);
        assert!(page2[0].id < cursor);
    }

    #[tokio::test]
    async fn limit_clamped_to_range() {
        let pool = make_pool_with_chat_schema().await;
        for _ in 0..3 {
            insert_agent_event(
                &pool, "A-1", None, "system_note",
                &serde_json::json!({"text":"x"}), None, None, None,
            )
            .await
            .unwrap();
        }
        // limit=0 -> clamped to 1.
        let out = list_events_for_agent(&pool, "A-1", None, 0).await.unwrap();
        assert_eq!(out.len(), 1);
        // limit=10000 -> clamped to 200 (we only have 3 rows, so this gives us 3).
        let out = list_events_for_agent(&pool, "A-1", None, 10_000).await.unwrap();
        assert_eq!(out.len(), 3);
    }

    #[tokio::test]
    async fn delete_events_for_agent_returns_count() {
        let pool = make_pool_with_chat_schema().await;
        for _ in 0..3 {
            insert_agent_event(
                &pool, "A-1", None, "system_note",
                &serde_json::json!({"text":"x"}), None, None, None,
            )
            .await
            .unwrap();
        }
        insert_agent_event(
            &pool, "B-1", None, "system_note",
            &serde_json::json!({"text":"x"}), None, None, None,
        )
        .await
        .unwrap();

        let n = delete_events_for_agent(&pool, "A-1").await.unwrap();
        assert_eq!(n, 3);
        let a_rows = list_events_for_agent(&pool, "A-1", None, 50).await.unwrap();
        assert!(a_rows.is_empty());
        let b_rows = list_events_for_agent(&pool, "B-1", None, 50).await.unwrap();
        assert_eq!(b_rows.len(), 1);
    }

    #[tokio::test]
    async fn find_last_user_text_id_returns_newest_user_text() {
        let pool = make_pool_with_chat_schema().await;
        let u1 = insert_agent_event(
            &pool, "A-1", Some("sess-1"), "user_text",
            &serde_json::json!({"content":"m"}), None, None, Some("queued"),
        )
        .await
        .unwrap();
        let _a1 = insert_agent_event(
            &pool, "A-1", Some("sess-1"), "assistant_text",
            &serde_json::json!({"content":"ok"}), None, None, None,
        )
        .await
        .unwrap();
        let u2 = insert_agent_event(
            &pool, "A-1", Some("sess-1"), "user_text",
            &serde_json::json!({"content":"m2"}), None, None, Some("queued"),
        )
        .await
        .unwrap();

        let last = find_last_user_text_id(&pool, "A-1", Some("sess-1"))
            .await
            .unwrap();
        assert_eq!(last, Some(u2.id));
        assert_ne!(last, Some(u1.id));
        // No session scope.
        let last_any = find_last_user_text_id(&pool, "A-1", None).await.unwrap();
        assert_eq!(last_any, Some(u2.id));
    }

    #[tokio::test]
    async fn migration_006_data_body_idempotent_on_empty_source() {
        let pool = make_pool_with_chat_schema().await;
        // Seed chat_messages.
        sqlx::query(
            "INSERT INTO chat_messages (agent_id, direction, content, delivery_status) VALUES \
             ('A-1', 'outbound', 'hello', 'delivered'), \
             ('A-1', 'inbound', 'hi back', 'delivered')",
        )
        .execute(&pool)
        .await
        .unwrap();

        // First run — migrates 2 rows, empties chat_messages.
        run_006_migration_body(&pool).await;
        let list = list_events_for_agent(&pool, "A-1", None, 50).await.unwrap();
        assert_eq!(list.len(), 2);
        // Outbound rows carry delivery_status; inbound rows do NOT.
        let user_rows: Vec<_> = list.iter().filter(|e| e.event_type == "user_text").collect();
        let asst_rows: Vec<_> = list.iter().filter(|e| e.event_type == "assistant_text").collect();
        assert_eq!(user_rows.len(), 1);
        assert_eq!(asst_rows.len(), 1);
        assert_eq!(user_rows[0].delivery_status.as_deref(), Some("delivered"));
        assert_eq!(asst_rows[0].delivery_status, None);

        // Second run against the now-empty chat_messages: zero-row INSERT SELECT.
        run_006_migration_body(&pool).await;
        let list2 = list_events_for_agent(&pool, "A-1", None, 50).await.unwrap();
        assert_eq!(list2.len(), 2, "migration body is idempotent on empty source");
    }
}
