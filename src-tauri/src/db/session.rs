//! Agent-session lifecycle helpers (HIST-01).
//!
//! TODO(plan-03): implement ensure_open_session + close_session per
//! 06-RESEARCH.md Example 3 and Pitfall 2.

use sqlx::SqlitePool;

#[allow(dead_code)]
pub async fn ensure_open_session(
    _agent_id: &str,
    _agent_type: &str,
    _pool: &SqlitePool,
) -> Result<i64, String> {
    Err("TODO(plan-03): implement ensure_open_session".into())
}

#[allow(dead_code)]
pub async fn close_session(_agent_id: &str, _pool: &SqlitePool) -> Result<(), String> {
    Err("TODO(plan-03): implement close_session".into())
}

#[cfg(test)]
mod tests {
    // Named test group for VALIDATION.md: `cargo test --lib session_lifecycle`
    #[test]
    #[ignore = "Wave 0 stub - implemented in Plan 03"]
    fn session_lifecycle_placeholder() {
        panic!("TODO(plan-03)");
    }

    #[test]
    #[ignore = "Wave 0 stub"]
    fn ensure_session_is_idempotent() {
        panic!("TODO(plan-03)");
    }
}
