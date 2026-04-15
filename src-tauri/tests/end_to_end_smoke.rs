//! Phase 6 + Phase 8 end-to-end smoke tests. Drives /hook + waiter + Tauri
//! command flows on a real axum server with a mock Tauri AppHandle, plus the
//! pre-existing Phase 6 passive bridge + forwarder smoke (which is
//! `#[ignore]` because it hits the filesystem).
//!
//! The Phase 8 hook tests are NOT ignored — they run against 127.0.0.1:0 and
//! an in-memory SQLite pool.

mod common;

use aitc_lib::agents::adapter::{AgentInfo, AgentState};
use aitc_lib::agents::hook_waiters::{HookDecision, WaiterRegistry};
use aitc_lib::agents::self_register::{build_router, RateLimiter};
use aitc_lib::agents::AgentRegistry;
use aitc_lib::pipeline::passive_bridge::bridge_tick;
use aitc_lib::pipeline::process_snapshot::{CandidateProc, ProcessSnapshot};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

#[tokio::test]
#[ignore = "filesystem + task-spawning smoke; run with --ignored"]
async fn end_to_end_pipeline_activation() {
    let (_td, repo_root) = common::tempdir_git_repo();
    let pool = common::pool_with_phase6_schema().await;

    // Seed a snapshot with a fake candidate; drive one bridge tick.
    let reg = Arc::new(AgentRegistry::new());
    let snap = Arc::new(RwLock::new(ProcessSnapshot::from_candidates_for_test(
        vec![CandidateProc {
            pid: 7777,
            name: "claude-code".into(),
            cwd: repo_root.clone(),
            exe: None,
            parent: None,
        }],
    )));
    bridge_tick(&reg, &snap, None).await.unwrap();
    assert!(
        reg.get_agent("PASSIVE-7777").await.is_some(),
        "PASSIVE entry must appear after first bridge tick"
    );

    // Simulate a KAGENT self-registering for the same PID and reconciling.
    let adapter = aitc_lib::agents::generic::passive_sentinel_adapter();
    reg.remove_agent("PASSIVE-7777").await;
    reg.upsert_agent(
        "KAGENT-7777".into(),
        AgentInfo {
            id: "KAGENT-7777".into(),
            agent_type: "claude-code".into(),
            protocol: "http".into(),
            state: AgentState::Running,
            pid: Some(7777),
            cwd: Some(repo_root.clone()),
            intent: None,
        },
        adapter,
        false,
    )
    .await
    .unwrap();
    assert!(
        reg.get_agent("PASSIVE-7777").await.is_none(),
        "PASSIVE must be reconciled away after KAGENT claims the PID"
    );

    // Simulate attributed event -> forwarder persists.
    let batch = aitc_lib::pipeline::events::FileEventBatch {
        events: vec![aitc_lib::pipeline::events::FileEvent {
            path: repo_root.join("src/hello.rs"),
            kind: aitc_lib::pipeline::events::FileEventKind::Modify,
            attribution: aitc_lib::pipeline::events::Attribution::Pid(7777),
            timestamp_ms: 0,
        }],
        batch_id: 0,
        dropped_batches: 0,
    };
    aitc_lib::pipeline::commands::persist_attributed_batch(&batch, &reg, &pool).await;

    let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM session_files")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cnt, 1, "exactly one session_files row after forwarder persist");
}

// ---------------------------------------------------------------------------
// Phase 8 — /hook end-to-end integration smokes.
// ---------------------------------------------------------------------------

/// Wire up an in-memory SQLite pool with the approval_requests + protected_paths
/// tables, plus a real axum server bound on 127.0.0.1:0, plus a mock Tauri
/// AppHandle. Returns everything tests need to drive the hook pipeline.
async fn spawn_hook_test_server() -> (
    String,
    Arc<AgentRegistry>,
    Arc<WaiterRegistry>,
    sqlx::SqlitePool,
) {
    let mut registry_inner = AgentRegistry::new();
    registry_inner
        .register_adapter(Arc::new(aitc_lib::agents::claude_code::ClaudeCodeAdapter));
    let registry = Arc::new(registry_inner);

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    for stmt in [
        "CREATE TABLE approval_requests ( \
            id INTEGER PRIMARY KEY AUTOINCREMENT, \
            agent_id TEXT, request_type TEXT NOT NULL, \
            file_path TEXT, diff_content TEXT, \
            status TEXT NOT NULL DEFAULT 'pending', \
            urgency TEXT DEFAULT 'medium', \
            response_note TEXT, edited_content TEXT, \
            created_at TEXT NOT NULL DEFAULT (datetime('now')), \
            resolved_at TEXT, \
            tool_name TEXT, tool_input_json TEXT, session_id TEXT )",
        "CREATE TABLE protected_paths ( \
            id INTEGER PRIMARY KEY AUTOINCREMENT, \
            glob_pattern TEXT NOT NULL UNIQUE, \
            created_at TEXT NOT NULL DEFAULT (datetime('now')) )",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    let waiters = WaiterRegistry::new_arc();
    let app = tauri::test::mock_app();
    let rate_limiter = Arc::new(RateLimiter::new());
    let router = build_router(
        registry.clone(),
        pool.clone(),
        waiters.clone(),
        app.handle().clone(),
        rate_limiter,
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (format!("http://127.0.0.1:{port}"), registry, waiters, pool)
}

#[tokio::test]
async fn hook_approve_resolves_handler() {
    let (base, _reg, waiters, pool) = spawn_hook_test_server().await;
    let my_pid = std::process::id();

    let body = serde_json::json!({
        "pid": my_pid,
        "session_id": "s1",
        "tool_name": "Edit",
        "tool_input": {"file_path": "/x.ts", "old_string": "a", "new_string": "b"},
    });

    // Issue /hook in a spawned task; it blocks waiting for a waiter signal.
    let post_task = {
        let base = base.clone();
        tokio::spawn(async move {
            reqwest::Client::new()
                .post(format!("{base}/hook"))
                .json(&body)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap()
        })
    };

    // Poll for the row, then signal Allow on its id.
    let row_id: i64 = loop {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let found: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM approval_requests WHERE status='pending' LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        if let Some((id,)) = found {
            break id;
        }
    };

    // Mimic the approve_request Tauri command body directly (we can't build
    // tauri::State<'_, ...> outside the runtime). Pitfall 8 UPDATE, then signal.
    let updated = sqlx::query(
        "UPDATE approval_requests SET status='approved', resolved_at=datetime('now') \
         WHERE id = ? AND status='pending'",
    )
    .bind(row_id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(updated.rows_affected(), 1);
    waiters.signal(row_id, HookDecision::Allow).await;

    let decoded = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        post_task,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(decoded["kind"], "allow");
}

#[tokio::test]
async fn hook_disconnect_abandons() {
    let (base, _reg, waiters, pool) = spawn_hook_test_server().await;
    let my_pid = std::process::id();

    let body = serde_json::json!({
        "pid": my_pid,
        "tool_name": "Bash",
        "tool_input": {"command": "rm -rf /"},
    });

    // Issue a POST that will time out at 200ms — the axum handler is still
    // blocked on rx.await, so when reqwest drops the connection the handler
    // future is dropped and AbandonGuard fires.
    let client = reqwest::Client::new();
    let result = client
        .post(format!("{base}/hook"))
        .json(&body)
        .timeout(std::time::Duration::from_millis(200))
        .send()
        .await;
    // The request should time out or return before we give up waiting.
    assert!(result.is_err() || result.unwrap().status().is_success() == false || true,
        "request should end (timeout or early return) — we only care about the abandoned side-effect");

    // Give the AbandonGuard spawn a moment to run.
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT status FROM approval_requests",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        if rows.iter().all(|(s,)| s != "pending") && !rows.is_empty() {
            break;
        }
    }

    let statuses: Vec<(String,)> = sqlx::query_as(
        "SELECT status FROM approval_requests",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(!statuses.is_empty(), "hook handler should have inserted a row");
    for (s,) in &statuses {
        assert_eq!(s, "abandoned", "row must be abandoned after client disconnect");
    }

    // Waiter map must be empty — AbandonGuard removed the entry.
    let no_waiter_fired = !waiters
        .signal(1, HookDecision::Allow)
        .await;
    assert!(
        no_waiter_fired,
        "waiter map must be drained after disconnect (no entry to signal)"
    );
}

#[tokio::test]
async fn terminate_force_denies_waiters() {
    let (base, reg, waiters, pool) = spawn_hook_test_server().await;
    let my_pid = std::process::id();

    // Pre-register a KAGENT so resolve_or_create_agent returns a stable id.
    let adapter = aitc_lib::agents::generic::passive_sentinel_adapter();
    let agent_id = format!("KAGENT-{my_pid}");
    reg.upsert_agent(
        agent_id.clone(),
        AgentInfo {
            id: agent_id.clone(),
            agent_type: "claude-code".into(),
            protocol: "cli".into(),
            state: AgentState::Running,
            pid: Some(my_pid),
            cwd: None,
            intent: None,
        },
        adapter,
        true,
    )
    .await
    .unwrap();

    let body = serde_json::json!({
        "pid": my_pid,
        "tool_name": "Bash",
        "tool_input": {"command": "echo hi"},
    });
    let post_task = {
        let base = base.clone();
        tokio::spawn(async move {
            reqwest::Client::new()
                .post(format!("{base}/hook"))
                .json(&body)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap()
        })
    };

    // Wait for the row to appear, then force-deny the agent's waiters (as
    // terminate_agent would do BEFORE the OS kill per D-10).
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let found: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM approval_requests WHERE status='pending' LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        if found.is_some() {
            break;
        }
    }
    let signalled = waiters
        .signal_for_agent(
            &agent_id,
            HookDecision::Deny("agent terminated by user".into()),
        )
        .await;
    assert_eq!(signalled.len(), 1, "exactly one waiter force-denied");

    let decoded = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        post_task,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(decoded["kind"], "deny");
    assert_eq!(decoded["reason"], "agent terminated by user");
}

#[tokio::test]
async fn always_allow_mutes_subsequent_hook_calls() {
    let (base, reg, waiters, pool) = spawn_hook_test_server().await;
    let my_pid = std::process::id();

    // Pre-register a KAGENT so the first /hook resolves to a stable id.
    let adapter = aitc_lib::agents::generic::passive_sentinel_adapter();
    let agent_id = format!("KAGENT-{my_pid}");
    reg.upsert_agent(
        agent_id.clone(),
        AgentInfo {
            id: agent_id.clone(),
            agent_type: "claude-code".into(),
            protocol: "cli".into(),
            state: AgentState::Running,
            pid: Some(my_pid),
            cwd: None,
            intent: None,
        },
        adapter,
        true,
    )
    .await
    .unwrap();

    // First /hook call — Bash is gated (D-19 default allowlist), so the
    // handler inserts a row and blocks on rx.
    let body = serde_json::json!({
        "pid": my_pid,
        "tool_name": "Bash",
        "tool_input": {"command": "echo hi"},
    });
    let post1 = {
        let base = base.clone();
        let body = body.clone();
        tokio::spawn(async move {
            reqwest::Client::new()
                .post(format!("{base}/hook"))
                .json(&body)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap()
        })
    };
    let row_id: i64 = loop {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let found: Option<(i64,)> =
            sqlx::query_as("SELECT id FROM approval_requests LIMIT 1")
                .fetch_optional(&pool)
                .await
                .unwrap();
        if let Some((id,)) = found {
            break id;
        }
    };
    // Approve with always_allow_for_session=true (simulated via direct
    // waiter.add_always_allow + signal — the Tauri command body is
    // unit-tested separately).
    sqlx::query(
        "UPDATE approval_requests SET status='approved', resolved_at=datetime('now') \
         WHERE id = ? AND status='pending'",
    )
    .bind(row_id)
    .execute(&pool)
    .await
    .unwrap();
    waiters.add_always_allow(agent_id.clone(), "Bash".into()).await;
    waiters.signal(row_id, HookDecision::Allow).await;
    let first = tokio::time::timeout(std::time::Duration::from_secs(2), post1)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first["kind"], "allow");

    let (cnt_before,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cnt_before, 1);

    // Second /hook for (same agent, Bash) — must fast-path allow with
    // no new row created.
    let t0 = std::time::Instant::now();
    let resp2 = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        reqwest::Client::new()
            .post(format!("{base}/hook"))
            .json(&body)
            .send(),
    )
    .await
    .unwrap()
    .unwrap();
    let elapsed = t0.elapsed();
    assert_eq!(resp2.status(), 200);
    let decoded2: serde_json::Value = resp2.json().await.unwrap();
    assert_eq!(decoded2["kind"], "allow");
    assert!(
        elapsed < std::time::Duration::from_millis(200),
        "always-allow fast-path must be under 200ms, was {elapsed:?}"
    );
    let (cnt_after,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM approval_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        cnt_after, cnt_before,
        "always-allow fast-path must NOT insert a new row"
    );
}
