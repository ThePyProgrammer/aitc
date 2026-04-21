//! Wave 0 smoke tests — answer the two research open questions before
//! downstream plans commit to the architecture.
//!
//! Open Question 1: Does `tauri::ipc::Channel<T>` outlive its registering
//! command? We prove here at the type level that the channel implements
//! `Clone + Send + Sync + 'static`, which is the necessary (not sufficient)
//! condition for storing a clone in app state and sending from a background
//! actor. The full runtime lifetime test (drop the command scope, send from
//! a later scope inside a real Tauri command) lives in Plan 02-04 Task 2.
//!
//! Open Question 2: What is `sysinfo::System::refresh_processes_specifics`
//! cost on a typical dev Windows box? Target <50ms for 1000ms polling
//! cadence. We run a `#[ignore]`'d microbenchmark that prints the measured
//! average. The value is then persisted to the `BENCH_RESULT` comment below
//! for downstream Plan 02-03 to consume.
//!
//! BENCH_RESULT (Wave 0): sysinfo refresh averaged 24ms on dev Windows box
//! (417 processes, samples=[34, 22, 19, 21, 26]; target <50ms; rustc 1.94.1).
//! Polling cadence decision: 1000ms OK — comfortable headroom under the 50ms
//! target; Plan 02-03 may proceed with 1Hz polling without tuning.

use crate::pipeline::events::{Attribution, FileEvent, FileEventBatch, FileEventKind};
use std::path::PathBuf;
use std::time::Instant;

/// Smoke test #1: verify that `tauri::ipc::Channel<FileEventBatch>` satisfies
/// the bounds the downstream actor needs: `Clone + Send + Sync + 'static`.
///
/// These are the bounds required to:
/// - store a clone in `tauri::State` / `app.manage()` (`Send + Sync + 'static`)
/// - hand a clone to a `tokio::spawn`'d background task (`Send + 'static`)
/// - keep the original in the frontend-facing command handler (`Clone`)
///
/// ## What this test proves
///
/// If this module compiles, `Channel<FileEventBatch>` is Clone+Send+Sync+'static.
/// The assertion happens at monomorphization; runtime behavior is a no-op.
///
/// ## What this test does NOT prove
///
/// - Whether the channel errors or silently drops when the webview unmounts
/// - Whether `send()` panics after the registering command scope has ended
///
/// Both deferred to Plan 02-04 Task 2, which exercises the channel inside a
/// real Tauri command with an actual webview.
#[test]
fn channel_type_is_clone_send_sync_static() {
    fn assert_clone<T: Clone>() {}
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}
    fn assert_static<T: 'static>() {}

    assert_clone::<tauri::ipc::Channel<FileEventBatch>>();
    assert_send::<tauri::ipc::Channel<FileEventBatch>>();
    assert_sync::<tauri::ipc::Channel<FileEventBatch>>();
    assert_static::<tauri::ipc::Channel<FileEventBatch>>();
}

/// Smoke test #2: `FileEventBatch` serializes cleanly for Channel transport.
///
/// `Channel<T>` goes through serde_json under the hood when sending to the
/// frontend. This proves our batch type round-trips through that boundary
/// with the expected camelCase field names (`batchId`, `droppedBatches`,
/// `events`).
#[test]
fn file_event_batch_serializes_for_channel_transport() {
    let batch = FileEventBatch {
        events: vec![
            FileEvent::new(
                PathBuf::from("C:\\Users\\test\\repo\\src\\main.rs"),
                FileEventKind::Modify,
                Attribution::Pid(1234),
            ),
            FileEvent::new(
                PathBuf::from("C:\\Users\\test\\repo\\README.md"),
                FileEventKind::Create,
                Attribution::Unattributed,
            ),
        ],
        batch_id: 42,
        dropped_batches: 0,
    };
    let json = serde_json::to_string(&batch).expect("serialize");
    assert!(json.contains("\"batchId\":42"), "missing batchId: {json}");
    assert!(
        json.contains("\"droppedBatches\":0"),
        "missing droppedBatches: {json}"
    );
    assert!(json.contains("\"events\""), "missing events field: {json}");
}

/// Benchmark #1: `sysinfo::System::refresh_processes_specifics` cost.
///
/// Target: <50ms per refresh to justify a 1000ms polling cadence for Plan 02-03.
///
/// Marked `#[ignore]` so it only runs on-demand via
/// `cargo test -- --ignored --nocapture`. The Wave 0 run captures the number
/// and persists it to the `BENCH_RESULT` comment at the top of this file.
///
/// Research finding (02-RESEARCH.md Pitfall 4): sysinfo's Windows PEB reads
/// cost roughly 30–100ms on a typical dev box with ~300 processes. If this
/// benchmark reports ≥50ms, downstream Plan 02-03 must either reduce refresh
/// scope via `ProcessRefreshKind` or increase the polling tick to 2000ms.
/// If it reports ≥500ms, this test fails hard — 1000ms polling at that cost
/// would peg a CPU core, and Plan 02-03 must solve the cost problem before
/// proceeding.
#[test]
#[ignore]
fn bench_sysinfo_refresh_cost() {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    let mut sys = System::new();
    // Warm-up refresh (first call is slower due to initial allocations).
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cwd(UpdateKind::Always)
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .with_exe(UpdateKind::OnlyIfNotSet),
    );

    // Measured runs.
    let mut samples = Vec::with_capacity(5);
    for _ in 0..5 {
        let t0 = Instant::now();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_cwd(UpdateKind::Always)
                .with_cmd(UpdateKind::OnlyIfNotSet)
                .with_exe(UpdateKind::OnlyIfNotSet),
        );
        samples.push(t0.elapsed().as_millis());
    }
    let avg_ms: u128 = samples.iter().sum::<u128>() / samples.len() as u128;
    let process_count = sys.processes().len();

    println!(
        "bench_sysinfo_refresh_cost: {} processes, avg={}ms, samples={:?}",
        process_count, avg_ms, samples
    );

    // Hard failure threshold: at 500ms per refresh, 1000ms polling pegs a CPU.
    assert!(
        avg_ms < 500,
        "sysinfo refresh averaged {}ms over {} samples — this will peg a CPU at 1Hz polling. \
         Plan 02-03 must either (a) narrow ProcessRefreshKind, (b) pre-filter by name, or \
         (c) increase polling tick. See 02-RESEARCH.md Pitfall 4.",
        avg_ms,
        samples.len()
    );

    if avg_ms >= 50 {
        println!(
            "WARNING: sysinfo refresh averaged {}ms > 50ms target. \
             Plan 02-03 should document the measured value and consider polling at 2000ms.",
            avg_ms
        );
    }
}

/// Phase 6 Plan 04 end-to-end backend smoke: passive_bridge upserts a
/// PASSIVE-{pid} entry from a seeded snapshot, then the forwarder-path helper
/// (`persist_attributed_batch`) persists a session_files row for the same PID.
///
/// This chains Task 1 (bridge) and Task 2 (forwarder persist) in a single
/// library-level smoke. The full Tauri-layer end-to-end lives in
/// `src-tauri/tests/end_to_end_smoke.rs` (Plan 05).
#[tokio::test]
async fn bridge_populates_registry_and_records_session_file() {
    use crate::agents::AgentRegistry;
    use crate::pipeline::events::{FileEvent, FileEventBatch, FileEventKind};
    use crate::pipeline::process_snapshot::{CandidateProc, ProcessSnapshot};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    // Phase-6-relevant schema subset.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    for stmt in [
        "CREATE TABLE agent_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL, agent_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'idle',
            started_at TEXT NOT NULL, ended_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            file_count INTEGER NOT NULL DEFAULT 0
        )",
        "CREATE TABLE session_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
            file_path TEXT NOT NULL,
            write_count INTEGER NOT NULL DEFAULT 1,
            last_written_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(session_id, file_path)
        )",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    let reg = Arc::new(AgentRegistry::new());
    let snap = Arc::new(RwLock::new(ProcessSnapshot::from_candidates_for_test(vec![
        CandidateProc {
            pid: 4242,
            name: "claude-code".into(),
            cwd: PathBuf::from("/tmp/smoke-cwd"),
            exe: None,
            parent: None,
        },
    ])));

    // (a) bridge tick → PASSIVE-4242 appears.
    crate::pipeline::passive_bridge::bridge_tick(&reg, &snap, None, None, None).await.unwrap();
    assert!(reg.get_agent("PASSIVE-4242").await.is_some());

    // (b) forwarder-path persistence for the same PID.
    let batch = FileEventBatch {
        events: vec![FileEvent {
            path: PathBuf::from("src/live.rs"),
            kind: FileEventKind::Modify,
            attribution: Attribution::Pid(4242),
            timestamp_ms: 0,
        }],
        batch_id: 0,
        dropped_batches: 0,
    };
    crate::pipeline::commands::persist_attributed_batch(&batch, &reg, &pool).await;

    let (cnt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM session_files")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        cnt, 1,
        "expected exactly one session_files row after forwarder persist"
    );

    // And the session row is linked to the passive agent id.
    let (agent_id,): (String,) = sqlx::query_as(
        "SELECT agent_id FROM agent_sessions
         JOIN session_files ON session_files.session_id = agent_sessions.id LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(agent_id, "PASSIVE-4242");
}
