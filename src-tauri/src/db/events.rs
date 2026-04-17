//! CRUD helpers for the Phase 10 `agent_events` table.
//! Plan 02 provides real implementations; Wave 0 provides the compiling skeleton.
//!
//! Threat mitigations:
//! - T-10-02: all queries use sqlx bind parameters, never string concat.
//! - T-10-04: payload_json column holds JSON blobs; callers are responsible for
//!   not storing secrets. User/assistant text is NOT a secret per D-18.

use crate::chat_runtime::types::AgentEvent;
use sqlx::{Row, SqlitePool};

#[allow(dead_code)]
pub(crate) fn map_agent_event_row(row: &sqlx::sqlite::SqliteRow) -> Result<AgentEvent, String> {
    let payload_str: String = row.get("payload_json");
    let payload_json: serde_json::Value = serde_json::from_str(&payload_str)
        .map_err(|e| format!("payload_json parse: {e}"))?;
    Ok(AgentEvent {
        id: row.get("id"),
        agent_id: row.get("agent_id"),
        session_id: row.try_get("session_id").ok(),
        event_type: row.get("event_type"),
        payload_json,
        approval_request_id: row.try_get("approval_request_id").ok(),
        sequence_number: row.try_get("sequence_number").ok(),
        created_at: row.get("created_at"),
        delivery_status: row.try_get("delivery_status").ok(),
    })
}

#[allow(dead_code)]
pub async fn insert_agent_event(
    _pool: &SqlitePool,
    _agent_id: &str,
    _session_id: Option<&str>,
    _event_type: &str,
    _payload_json: &serde_json::Value,
    _approval_request_id: Option<i64>,
    _sequence_number: Option<i64>,
    _delivery_status: Option<&str>,
) -> Result<AgentEvent, String> {
    todo!("Plan 02 — INSERT INTO agent_events ... RETURNING ... + map_agent_event_row")
}

#[allow(dead_code)]
pub async fn list_events_for_agent(
    _pool: &SqlitePool,
    _agent_id: &str,
    _before_id: Option<i64>,
    _limit: i64,
) -> Result<Vec<AgentEvent>, String> {
    todo!("Plan 02 — paginated reads, newest-first, filter by before_id when Some")
}

#[allow(dead_code)]
pub async fn update_event_delivery_status(
    _pool: &SqlitePool,
    _event_id: i64,
    _status: &str,
) -> Result<(), String> {
    todo!("Plan 02 — UPDATE agent_events SET delivery_status = ? WHERE id = ? and event_type = 'user_text'")
}

#[allow(dead_code)]
pub async fn delete_events_for_agent(
    _pool: &SqlitePool,
    _agent_id: &str,
) -> Result<u64, String> {
    todo!("Plan 02 — DELETE FROM agent_events WHERE agent_id = ?; return rows_affected")
}

#[cfg(test)]
mod tests {
    // Plan 02 fills these. Wave 0 just needs the module declared.
}
