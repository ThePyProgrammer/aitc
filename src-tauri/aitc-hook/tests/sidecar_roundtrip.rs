//! End-to-end sidecar tests: spawn a mock axum `/hook` server, run the
//! compiled `aitc-hook` binary as a subprocess, pipe a Claude PreToolUse
//! fixture to stdin, and assert on stdout / stderr / exit-code.
//!
//! These tests exercise the full stdin → POST → stdout/exit translation:
//! they verify the modern envelope shape, the fail-safe deny contract, the
//! session_id + pid wire, and the empty-stdin rejection.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Arc;

use axum::{routing::post, Json, Router};
use serde_json::{json, Value};

fn sidecar_path() -> String {
    // CARGO_BIN_EXE_aitc-hook is set by cargo for integration tests of
    // this crate's binary target. See
    // https://doc.rust-lang.org/cargo/reference/environment-variables.html
    env!("CARGO_BIN_EXE_aitc-hook").to_string()
}

fn fixture_stdin() -> String {
    include_str!("../../tests/fixtures/pretool_use_stdin.json").to_string()
}

/// Spin up a mock `/hook` server on 127.0.0.1:0 that captures the inbound
/// body and replies with the given response JSON. Returns `(port,
/// join_handle, captured_body)` — `join_handle` is detached and will exit
/// when the test process does; `captured_body` is a shared `Mutex` holding
/// the last body the server received (or `None` if never called).
async fn spawn_mock_hook(
    response: Value,
) -> (
    u16,
    tokio::task::JoinHandle<()>,
    Arc<std::sync::Mutex<Option<Value>>>,
) {
    let captured = Arc::new(std::sync::Mutex::new(None::<Value>));
    let captured_handler = captured.clone();

    let app = Router::new().route(
        "/hook",
        post(move |Json(body): Json<Value>| {
            let captured = captured_handler.clone();
            let resp = response.clone();
            async move {
                *captured.lock().unwrap() = Some(body);
                Json(resp)
            }
        }),
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (port, handle, captured)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sidecar_roundtrip_allow() {
    let (port, _h, _cap) = spawn_mock_hook(json!({"kind": "allow"})).await;

    let mut child = Command::new(sidecar_path())
        .env("AITC_PORT", port.to_string())
        .env_remove("AITC_PORT_FILE_OVERRIDE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(fixture_stdin().as_bytes())
        .unwrap();

    let out = child.wait_with_output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );

    let parsed: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(parsed["hookSpecificOutput"]["permissionDecision"], "allow");
    assert_eq!(parsed["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    assert!(
        parsed.get("decision").is_none(),
        "must not emit deprecated top-level `decision`"
    );
    assert!(
        parsed.get("reason").is_none(),
        "must not emit deprecated top-level `reason`"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sidecar_roundtrip_allow_with_edits() {
    let (port, _h, _cap) = spawn_mock_hook(json!({
        "kind": "allow_with_edits",
        "updated_input": {"file_path": "/x.ts", "old_string": "a", "new_string": "c"}
    }))
    .await;

    let mut child = Command::new(sidecar_path())
        .env("AITC_PORT", port.to_string())
        .env_remove("AITC_PORT_FILE_OVERRIDE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(fixture_stdin().as_bytes())
        .unwrap();

    let out = child.wait_with_output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );

    let parsed: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(parsed["hookSpecificOutput"]["permissionDecision"], "allow");
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["new_string"],
        "c"
    );
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["old_string"],
        "a"
    );
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["file_path"],
        "/x.ts"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sidecar_roundtrip_deny() {
    let (port, _h, _cap) =
        spawn_mock_hook(json!({"kind": "deny", "reason": "user said no"})).await;

    let mut child = Command::new(sidecar_path())
        .env("AITC_PORT", port.to_string())
        .env_remove("AITC_PORT_FILE_OVERRIDE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(fixture_stdin().as_bytes())
        .unwrap();

    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("user said no"),
        "stderr must include the deny reason, got: {stderr}"
    );
    assert!(
        out.stdout.is_empty(),
        "deny path must not write stdout JSON"
    );
}

#[test]
fn sidecar_fail_safe_on_unreachable_port() {
    // Claim a port then immediately drop the listener to get a
    // definitely-closed port on this host.
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);

    let mut child = Command::new(sidecar_path())
        .env("AITC_PORT", port.to_string())
        .env_remove("AITC_PORT_FILE_OVERRIDE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(fixture_stdin().as_bytes())
        .unwrap();

    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("AITC unreachable"),
        "expected fail-safe deny, stderr was: {stderr}"
    );
}

#[test]
fn sidecar_fail_safe_on_missing_port() {
    let td = tempfile::TempDir::new().unwrap();
    let non_existent = td.path().join("definitely_not_a_port_file");

    let mut child = Command::new(sidecar_path())
        .env_remove("AITC_PORT")
        .env("AITC_PORT_FILE_OVERRIDE", &non_existent)
        // Also isolate HOME so we don't accidentally read a real
        // ~/.aitc/port on the developer's machine.
        .env("HOME", td.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(fixture_stdin().as_bytes())
        .unwrap();

    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("AITC unreachable") || stderr.contains("no port"),
        "expected fail-safe deny, stderr was: {stderr}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sidecar_forwards_session_id_and_pid() {
    let (port, _h, captured) = spawn_mock_hook(json!({"kind": "allow"})).await;

    let mut child = Command::new(sidecar_path())
        .env("AITC_PORT", port.to_string())
        .env_remove("AITC_PORT_FILE_OVERRIDE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(fixture_stdin().as_bytes())
        .unwrap();

    let out = child.wait_with_output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Give the mock server a moment to finish writing the captured body.
    // In practice this is already done (the sidecar has exited) but add a
    // defensive yield for CI.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let body = captured
        .lock()
        .unwrap()
        .clone()
        .expect("mock server should have captured the body");
    assert_eq!(body["session_id"], "sess_abc123");
    assert_eq!(body["tool_name"], "Edit");
    assert!(body["pid"].as_u64().unwrap() > 0);
    assert_eq!(body["cwd"], "/home/dev/proj");
    assert_eq!(body["tool_input"]["file_path"], "/home/dev/proj/src/app.ts");
}

#[test]
fn sidecar_rejects_empty_stdin() {
    let td = tempfile::TempDir::new().unwrap();
    let mut child = Command::new(sidecar_path())
        .env("AITC_PORT", "9999")
        .env_remove("AITC_PORT_FILE_OVERRIDE")
        .env("HOME", td.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.as_mut().unwrap().write_all(b"").unwrap();

    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("stdin parse") || stderr.contains("empty"),
        "stderr was: {stderr}"
    );
}
