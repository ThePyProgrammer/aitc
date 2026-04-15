//! Phase 8 Plan 06 — Cross-crate end-to-end integration test.
//!
//! One `cargo test --test hook_e2e_with_real_sidecar` drives the entire
//! Phase 8 stack:
//!
//!   compiled `aitc-hook` binary (subprocess)
//!        └─ stdin: Claude PreToolUse JSON
//!        └─ stdout: modern `hookSpecificOutput.permissionDecision` envelope
//!        └─ exit code: 0 on allow / allow_with_edits, 2 on deny / failure
//!
//!   real axum router built by `start_registration_server`
//!        └─ /hook handler blocks on `WaiterRegistry` signal
//!        └─ inserts into real SQLite `approval_requests` row
//!        └─ AbandonGuard marks the row `abandoned` on client disconnect
//!
//! Sidecar binary lookup: `cargo build -p aitc-hook` must have been run
//! before. We locate the binary by walking up from `current_exe()` to the
//! `target/` dir and then into `{profile}/aitc-hook{.exe}`. The `env!`
//! macro trick (used by the sidecar's OWN integration tests) only works
//! for the crate that owns the `[[bin]]` — from the outer `aitc` crate we
//! must resolve the path manually.
//!
//! Mitigations (08-06-PLAN.md §threat_model):
//!   - T-08-E1: `sidecar_binary_path()` panics with a clear error if the
//!     binary is missing so CI surface the root cause.
//!   - T-08-E2: `pending_row_id()` / the abandoned-status poll both cap
//!     at 2s with 50ms granularity — fast when the system is healthy,
//!     not infinite when it's not.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use aitc_lib::agents::hook_waiters::{HookDecision, WaiterRegistry};
use aitc_lib::agents::registry::AgentRegistry;
use aitc_lib::agents::self_register::start_registration_server;
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePoolOptions;
use tokio::task::JoinHandle;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Locate the compiled `aitc-hook` binary on disk. Walks up from the
/// current test binary's path until it finds `target/`, then descends into
/// `{profile}/aitc-hook{.exe}`. Panics with actionable guidance when the
/// binary is missing (T-08-E1).
fn sidecar_binary_path() -> std::path::PathBuf {
    let mut p = std::env::current_exe().expect("current_exe");
    // current_exe is .../target/debug/deps/hook_e2e_with_real_sidecar-<hash>
    loop {
        if p.ends_with("target") {
            break;
        }
        if !p.pop() {
            panic!(
                "failed to locate target/ dir walking up from {:?}",
                std::env::current_exe().unwrap()
            );
        }
    }
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    let mut bin = p.join(profile).join("aitc-hook");
    if cfg!(target_os = "windows") {
        bin.set_extension("exe");
    }
    assert!(
        bin.exists(),
        "sidecar binary missing at {bin:?}; run `cargo build -p aitc-hook` before this test"
    );
    bin
}

/// Load the Plan 01 stdin fixture (Edit tool, cwd=/home/dev/proj).
fn fixture() -> String {
    std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pretool_use_stdin.json"),
    )
    .expect("read pretool_use_stdin.json fixture")
}

/// Mirror of `end_to_end_smoke::spawn_hook_test_server` but returning the
/// port as a bare `u16` (because the sidecar accepts AITC_PORT as a
/// number, not a URL) and going through `start_registration_server` (the
/// production entry point, not the hand-rolled `build_router`).
async fn setup_server() -> (u16, Arc<WaiterRegistry>, sqlx::SqlitePool) {
    let mut registry_inner = AgentRegistry::new();
    registry_inner
        .register_adapter(Arc::new(aitc_lib::agents::claude_code::ClaudeCodeAdapter));
    let registry = Arc::new(registry_inner);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect in-memory sqlite");

    // Hand-rolled schema mirroring the smoke-test setup — avoids the
    // migration runner (sqlx::migrate!) to keep the test hermetic from the
    // production migration sequence.
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
    // preferred_port = 0 → OS-assigned. start_registration_server is the
    // production entry point so the test proves the whole public path.
    let port = start_registration_server(
        registry.clone(),
        pool.clone(),
        waiters.clone(),
        app.handle().clone(),
        0,
    )
    .await
    .expect("start_registration_server");

    (port, waiters, pool)
}

/// Poll `approval_requests` for up to 2 seconds until a pretool_use row
/// appears. Returns the row id. (T-08-E2: bounded polling, no infinite loop.)
async fn pending_row_id(pool: &sqlx::SqlitePool) -> Option<i64> {
    for _ in 0..40 {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM approval_requests \
             WHERE request_type = 'pretool_use' AND status = 'pending' \
             ORDER BY id DESC LIMIT 1",
        )
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
        if let Some((id,)) = row {
            return Some(id);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    None
}

/// Launch the sidecar binary as a subprocess with the given `AITC_PORT`
/// and pipe the fixture JSON to its stdin. Runs on a blocking thread so
/// `wait_with_output` doesn't stall the tokio runtime. Returns the join
/// handle — await it for the completed `Output`.
fn spawn_sidecar(port: u16) -> JoinHandle<std::process::Output> {
    let sidecar = sidecar_binary_path();
    let fixture_bytes = fixture();
    tokio::task::spawn_blocking(move || {
        let mut child = Command::new(sidecar)
            .env("AITC_PORT", port.to_string())
            .env_remove("AITC_PORT_FILE_OVERRIDE")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn aitc-hook");
        child
            .stdin
            .as_mut()
            .expect("stdin")
            .write_all(fixture_bytes.as_bytes())
            .expect("write stdin");
        child.wait_with_output().expect("wait_with_output")
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// allow: user approves the Edit; sidecar emits the modern envelope and
/// exits 0.
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn e2e_allow_roundtrip_with_real_sidecar() {
    let (port, waiters, pool) = setup_server().await;
    let handle = spawn_sidecar(port);

    let row_id = pending_row_id(&pool)
        .await
        .expect("pretool_use row must appear within 2s of the sidecar posting");

    // UPDATE before signal mirrors the approve_request command body
    // (Pitfall 8 atomic gate).
    let updated = sqlx::query(
        "UPDATE approval_requests SET status='approved', resolved_at=datetime('now') \
         WHERE id = ? AND status='pending'",
    )
    .bind(row_id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(updated.rows_affected(), 1, "row must still be pending when we approve");
    assert!(
        waiters.signal(row_id, HookDecision::Allow).await,
        "waiter for row {row_id} must be registered when the sidecar is blocked on /hook"
    );

    let out = handle.await.unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "sidecar must exit 0 on allow; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    let parsed: Value = serde_json::from_slice(&out.stdout).expect("stdout must be JSON");
    assert_eq!(parsed["hookSpecificOutput"]["permissionDecision"], "allow");
    assert_eq!(parsed["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    assert!(
        parsed.get("decision").is_none(),
        "must never emit deprecated top-level `decision` field (08-RESEARCH Pitfall 1)"
    );
}

/// allow_with_edits: user modified Claude's proposed new_string; sidecar
/// must surface the user-edited payload as `updatedInput`.
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn e2e_allow_with_edits_roundtrip_with_real_sidecar() {
    let (port, waiters, pool) = setup_server().await;
    let handle = spawn_sidecar(port);

    let row_id = pending_row_id(&pool).await.expect("row");

    sqlx::query(
        "UPDATE approval_requests SET status='approved', resolved_at=datetime('now') \
         WHERE id = ? AND status='pending'",
    )
    .bind(row_id)
    .execute(&pool)
    .await
    .unwrap();
    let edited_input = json!({
        "file_path": "/home/dev/proj/src/app.ts",
        "old_string": "const x = 1;",
        "new_string": "FROM_USER_EDIT"
    });
    waiters
        .signal(row_id, HookDecision::AllowWithEdits(edited_input))
        .await;

    let out = handle.await.unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "sidecar must exit 0 on allow_with_edits; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    let parsed: Value = serde_json::from_slice(&out.stdout).expect("stdout must be JSON");
    assert_eq!(parsed["hookSpecificOutput"]["permissionDecision"], "allow");
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["new_string"],
        "FROM_USER_EDIT",
        "user-edited new_string must round-trip through AITC → sidecar → stdout"
    );
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["file_path"],
        "/home/dev/proj/src/app.ts"
    );
    assert!(
        parsed.get("decision").is_none(),
        "must never emit deprecated top-level `decision` field"
    );
}

/// deny: sidecar must exit 2 with the deny reason on stderr and NO JSON
/// on stdout (any stdout JSON would be misinterpreted as allow by Claude).
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn e2e_deny_roundtrip_with_real_sidecar() {
    let (port, waiters, pool) = setup_server().await;
    let handle = spawn_sidecar(port);

    let row_id = pending_row_id(&pool).await.expect("row");

    sqlx::query(
        "UPDATE approval_requests SET status='denied', resolved_at=datetime('now') \
         WHERE id = ? AND status='pending'",
    )
    .bind(row_id)
    .execute(&pool)
    .await
    .unwrap();
    waiters
        .signal(row_id, HookDecision::Deny("user rejected".into()))
        .await;

    let out = handle.await.unwrap();
    assert_eq!(out.status.code(), Some(2), "deny path must exit 2");
    assert!(
        out.stdout.is_empty(),
        "deny path must NOT write stdout JSON (Claude would treat any stdout as allow)"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("user rejected"),
        "deny reason must surface on stderr so Claude shows it to the user; got: {stderr}"
    );
}

/// abandon: if the sidecar dies mid-POST (Claude Ctrl+C'd), the
/// AbandonGuard drop path must mark the DB row `abandoned` within ~2s.
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn e2e_abandon_when_sidecar_killed() {
    let (port, _waiters, pool) = setup_server().await;
    let sidecar = sidecar_binary_path();
    let fixture_bytes = fixture();

    // Spawn but KEEP the child handle so we can kill it mid-flight.
    let mut child = Command::new(&sidecar)
        .env("AITC_PORT", port.to_string())
        .env_remove("AITC_PORT_FILE_OVERRIDE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn aitc-hook");
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(fixture_bytes.as_bytes())
        .unwrap();
    // Close stdin so the sidecar proceeds to POST /hook. Without this,
    // `read_to_string` would block forever waiting for more input.
    drop(child.stdin.take());

    let row_id = pending_row_id(&pool)
        .await
        .expect("pretool_use row must appear before we kill the sidecar");

    // Kill the child — this drops the TCP connection mid-POST, triggering
    // the axum handler's AbandonGuard.
    child.kill().expect("kill child");
    let _ = child.wait();

    // Poll DB for up to 2s for the row to transition to 'abandoned'.
    let mut final_status = String::new();
    for _ in 0..40 {
        let r: Option<(String,)> =
            sqlx::query_as("SELECT status FROM approval_requests WHERE id = ?")
                .bind(row_id)
                .fetch_optional(&pool)
                .await
                .unwrap();
        if let Some((s,)) = r {
            final_status = s;
            if final_status == "abandoned" {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(
        final_status, "abandoned",
        "AbandonGuard must mark row {row_id} abandoned after the sidecar disconnects"
    );
}
