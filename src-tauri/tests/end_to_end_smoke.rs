//! Phase 6 end-to-end smoke test. Drives the passive bridge + forwarder
//! persistence on a real tempdir repo. Marked `#[ignore]` by default because
//! it hits the filesystem (and in CI, `git` may not be on PATH); run explicitly
//! with `cargo test --test end_to_end_smoke -- --ignored`.

mod common;

use aitc_lib::agents::adapter::{AgentInfo, AgentState};
use aitc_lib::agents::AgentRegistry;
use aitc_lib::pipeline::passive_bridge::bridge_tick;
use aitc_lib::pipeline::process_snapshot::{CandidateProc, ProcessSnapshot};
use std::sync::Arc;
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
    bridge_tick(&reg, &snap).await.unwrap();
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
