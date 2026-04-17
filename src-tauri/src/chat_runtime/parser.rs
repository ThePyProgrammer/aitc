//! Phase 10: stream-json NDJSON parser task.
//!
//! Plan 02 implements `tokio::io::BufReader::lines()` + per-line
//! `serde_json::from_str` dispatch onto the `StreamEvent` tagged enum.
//! Wave 0 (Plan 01) declares the public entrypoints.

#![allow(dead_code)]

use tokio::process::{ChildStderr, ChildStdout};
use tokio::sync::mpsc;

use super::types::StreamEvent;

/// Spawn the stdout reader task. Reads stream-json NDJSON lines and emits
/// `StreamEvent` variants on `sink`. Terminates when stdout closes.
pub fn spawn_stream_json_reader(
    _stdout: ChildStdout,
    _agent_id: String,
    _sink: mpsc::Sender<StreamEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move { todo!("Plan 02 — BufReader::lines + serde_json dispatch") })
}

/// Spawn the stderr reader task. Each line becomes a `StreamEvent::RawStderr`.
pub fn spawn_raw_stderr_reader(
    _stderr: ChildStderr,
    _agent_id: String,
    _sink: mpsc::Sender<StreamEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move { todo!("Plan 02 — BufReader::lines + forward to sink as RawStderr") })
}
