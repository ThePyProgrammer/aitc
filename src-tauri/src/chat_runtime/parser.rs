//! Phase 10: stream-json NDJSON parser task.
//!
//! Plan 02: full implementation. `spawn_stream_json_reader` wraps the child
//! stdout in a `BufReader::lines` iterator and dispatches each decoded
//! envelope onto the `StreamEvent` tagged enum, forwarded through an mpsc
//! `sink`. The downstream aggregator (Task 2 of Plan 04 / supervisor.rs) is
//! the single owner of DB writes + Tauri emits.
//!
//! Threat mitigations:
//! - T-10-07: per-line `serde_json::from_str` inside `match`; malformed lines
//!   produce `tracing::warn!` and are skipped. Never panics.
//! - T-10-07 cont.: lines longer than `MAX_STREAM_JSON_LINE_BYTES` are dropped
//!   with a warn. `tokio::io::Lines::next_line()` already handles arbitrary
//!   line length, so we inspect `.len()` post-read.
//! - Pitfall 2: `{type:"system", subtype:"hook_*"}` envelopes map to
//!   `SystemNote`, NOT `AssistantText`. Hooks are lifecycle metadata, not
//!   user-visible chat content.
//! - D-17: the 250ms idle-flush fires when text_delta chunks pause; the
//!   accumulator is emitted as a partial `AssistantText` and cleared.

#![allow(dead_code)]

use tokio::io::AsyncBufReadExt;
use tokio::process::{ChildStderr, ChildStdout};
use tokio::sync::mpsc;

use super::types::{StreamEvent, MAX_STREAM_JSON_LINE_BYTES};

/// Spawn the stdout reader task. Reads stream-json NDJSON lines and emits
/// `StreamEvent` variants on `sink`. Terminates when stdout closes (EOF) and
/// emits a final `StreamEvent::StdoutClosed` before returning.
pub fn spawn_stream_json_reader(
    stdout: ChildStdout,
    agent_id: String,
    sink: mpsc::Sender<StreamEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(run_stream_json_reader(stdout, agent_id, sink))
}

/// Inner async body — broken out so unit tests can drive it via
/// `tokio::io::duplex` without a real child process.
async fn run_stream_json_reader(
    stdout: ChildStdout,
    agent_id: String,
    sink: mpsc::Sender<StreamEvent>,
) {
    drive_stream_json_reader(stdout, agent_id, sink).await;
}

/// Generic reader body — takes any `AsyncRead + Unpin` so it can be driven by
/// a `tokio::io::DuplexStream` during tests or by `ChildStdout` at runtime.
pub(crate) async fn drive_stream_json_reader<R>(
    reader: R,
    agent_id: String,
    sink: mpsc::Sender<StreamEvent>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let buf = tokio::io::BufReader::new(reader);
    let mut lines = buf.lines();
    let mut accumulated_text = String::new();
    // Start the idle timer disabled (far in the future). It's re-armed when
    // a text_delta arrives into `accumulated_text`.
    let idle_disabled = tokio::time::Instant::now() + std::time::Duration::from_secs(3600);
    let mut idle_deadline: tokio::time::Instant = idle_disabled;

    loop {
        tokio::select! {
            line_result = lines.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        if line.len() > MAX_STREAM_JSON_LINE_BYTES {
                            tracing::warn!(
                                agent_id = %agent_id,
                                len = line.len(),
                                "stream-json line exceeds MAX_STREAM_JSON_LINE_BYTES, skipping"
                            );
                            continue;
                        }
                        let text_delta_seen = dispatch_line(
                            &line, &agent_id, &sink, &mut accumulated_text,
                        )
                        .await;
                        if text_delta_seen {
                            // D-17: arm 250ms idle flush.
                            idle_deadline = tokio::time::Instant::now()
                                + std::time::Duration::from_millis(250);
                        }
                    }
                    Ok(None) => {
                        // EOF — subprocess closed stdout.
                        let _ = sink.send(StreamEvent::StdoutClosed).await;
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(agent_id = %agent_id, err = %e, "stdout read err");
                        let _ = sink.send(StreamEvent::StdoutClosed).await;
                        break;
                    }
                }
            }
            _ = tokio::time::sleep_until(idle_deadline) => {
                if !accumulated_text.is_empty() {
                    let _ = sink
                        .send(StreamEvent::AssistantText {
                            content: std::mem::take(&mut accumulated_text),
                            model: None,
                        })
                        .await;
                }
                // Disable the timer until the next text_delta arrives.
                idle_deadline = tokio::time::Instant::now()
                    + std::time::Duration::from_secs(3600);
            }
        }
    }
}

/// Decode a single JSONL line and emit zero-or-more `StreamEvent`s on the
/// sink. Returns `true` if a text_delta was accumulated (so the caller can
/// arm the 250ms idle flush).
async fn dispatch_line(
    line: &str,
    agent_id: &str,
    sink: &mpsc::Sender<StreamEvent>,
    accumulated_text: &mut String,
) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let v: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(
                agent_id = %agent_id,
                err = %e,
                snippet = %trimmed.chars().take(120).collect::<String>(),
                "malformed stream-json line, skipping"
            );
            return false;
        }
    };
    let top_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match top_type {
        "system" => {
            dispatch_system(&v, sink).await;
            false
        }
        "stream_event" => dispatch_stream_event(&v, sink, accumulated_text).await,
        "assistant" => {
            dispatch_assistant(&v, sink, accumulated_text).await;
            false
        }
        "user" => {
            dispatch_user(&v, sink).await;
            false
        }
        "result" => {
            dispatch_result(&v, sink, accumulated_text).await;
            false
        }
        "rate_limit_event" => {
            // Not routed anywhere for v1 — just skip silently. The orchestrator
            // would log it at debug level if we wanted visibility.
            false
        }
        _ => {
            tracing::debug!(
                agent_id = %agent_id,
                top_type = %top_type,
                "unhandled stream-json top-level type, skipping"
            );
            false
        }
    }
}

async fn dispatch_system(v: &serde_json::Value, sink: &mpsc::Sender<StreamEvent>) {
    let subtype = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
    match subtype {
        "init" => {
            if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                let _ = sink
                    .send(StreamEvent::SessionStarted {
                        session_id: sid.to_string(),
                    })
                    .await;
            }
        }
        // Pitfall 2: hook lifecycle metadata — surface as SystemNote so the
        // UI can render it subtly, not as assistant chat text.
        "hook_started" | "hook_response" | "hook_completed" => {
            let hook_name = v
                .get("hook_name")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            let text = format!("[{subtype}] {hook_name}");
            let _ = sink.send(StreamEvent::SystemNote { text }).await;
        }
        _ => {
            // Unknown system subtype — log and surface as a generic note.
            let text = format!("[system/{subtype}]");
            let _ = sink.send(StreamEvent::SystemNote { text }).await;
        }
    }
}

/// Returns `true` when the line is a text_delta chunk (so the caller can arm
/// the 250ms idle-flush deadline).
async fn dispatch_stream_event(
    v: &serde_json::Value,
    sink: &mpsc::Sender<StreamEvent>,
    accumulated_text: &mut String,
) -> bool {
    let event = match v.get("event") {
        Some(e) => e,
        None => return false,
    };
    let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if event_type == "content_block_delta" {
        if let Some(delta) = event.get("delta") {
            let delta_type = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if delta_type == "text_delta" {
                if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                    accumulated_text.push_str(text);
                    let _ = sink
                        .send(StreamEvent::AssistantDelta {
                            delta: text.to_string(),
                        })
                        .await;
                    return true;
                }
            }
        }
    }
    // All other stream_event kinds (message_start, content_block_start, etc.)
    // are lifecycle-only — not surfaced.
    false
}

async fn dispatch_assistant(
    v: &serde_json::Value,
    sink: &mpsc::Sender<StreamEvent>,
    accumulated_text: &mut String,
) {
    let message = match v.get("message") {
        Some(m) => m,
        None => return,
    };
    let model = message
        .get("model")
        .and_then(|m| m.as_str())
        .map(String::from);
    let content = match message.get("content").and_then(|c| c.as_array()) {
        Some(arr) => arr,
        None => return,
    };
    for block in content {
        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match block_type {
            "text" => {
                // Whole-turn text. Discard the delta accumulator (the turn is
                // now authoritatively represented by this block) and emit a
                // single AssistantText.
                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                    accumulated_text.clear();
                    let _ = sink
                        .send(StreamEvent::AssistantText {
                            content: text.to_string(),
                            model: model.clone(),
                        })
                        .await;
                }
            }
            "tool_use" => {
                let tool_name = block
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let tool_use_id = block
                    .get("id")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let tool_input = block
                    .get("input")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let _ = sink
                    .send(StreamEvent::ToolUse {
                        tool_name,
                        tool_input,
                        tool_use_id,
                        // Plan 04 will wire approval_request_id via the hook
                        // waiter registry. Leave None for Plan 02 — the UI
                        // can still render the card without it.
                        approval_request_id: None,
                    })
                    .await;
            }
            _ => {
                // Other assistant block types (e.g. "thinking") — ignore.
            }
        }
    }
}

async fn dispatch_user(v: &serde_json::Value, sink: &mpsc::Sender<StreamEvent>) {
    let message = match v.get("message") {
        Some(m) => m,
        None => return,
    };
    let content = match message.get("content").and_then(|c| c.as_array()) {
        Some(arr) => arr,
        None => return,
    };
    for block in content {
        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if block_type == "tool_result" {
            let tool_use_id = block
                .get("tool_use_id")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            let content_val = block
                .get("content")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let is_error = block
                .get("is_error")
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            let _ = sink
                .send(StreamEvent::ToolResult {
                    tool_use_id,
                    content: content_val,
                    is_error,
                })
                .await;
        }
    }
}

async fn dispatch_result(
    v: &serde_json::Value,
    sink: &mpsc::Sender<StreamEvent>,
    accumulated_text: &mut String,
) {
    // Flush any buffered assistant text FIRST so the aggregator sees
    // AssistantText before TurnComplete (D-17 ordering guarantee).
    if !accumulated_text.is_empty() {
        let _ = sink
            .send(StreamEvent::AssistantText {
                content: std::mem::take(accumulated_text),
                model: None,
            })
            .await;
    }
    // Prefer the explicit terminal_reason field; fall back to subtype.
    let terminal_reason = v
        .get("terminal_reason")
        .and_then(|s| s.as_str())
        .or_else(|| v.get("subtype").and_then(|s| s.as_str()))
        .unwrap_or("completed")
        .to_string();
    let is_error = v
        .get("is_error")
        .and_then(|b| b.as_bool())
        .unwrap_or(false);
    let _ = sink
        .send(StreamEvent::TurnComplete {
            terminal_reason,
            is_error,
        })
        .await;
}

/// Spawn the stderr reader task. Each line becomes a `StreamEvent::RawStderr`.
pub fn spawn_raw_stderr_reader(
    stderr: ChildStderr,
    agent_id: String,
    sink: mpsc::Sender<StreamEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let buf = tokio::io::BufReader::new(stderr);
        let mut lines = buf.lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.len() > MAX_STREAM_JSON_LINE_BYTES {
                        tracing::warn!(
                            agent_id = %agent_id,
                            len = line.len(),
                            "stderr line exceeds cap, skipping"
                        );
                        continue;
                    }
                    let _ = sink.send(StreamEvent::RawStderr { line }).await;
                }
                Ok(None) => break,
                Err(e) => {
                    tracing::warn!(agent_id = %agent_id, err = %e, "stderr read err");
                    break;
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    /// Drive the generic reader body via a duplex pipe and return every
    /// emitted StreamEvent.
    async fn run_reader_against_bytes(bytes: &[u8]) -> Vec<StreamEvent> {
        let (mut write_half, read_half) = tokio::io::duplex(64 * 1024);
        // Write + close the write side so the reader sees EOF.
        let buf = bytes.to_vec();
        let write_task = tokio::spawn(async move {
            write_half.write_all(&buf).await.unwrap();
            write_half.shutdown().await.unwrap();
            drop(write_half);
        });
        let (tx, mut rx) = mpsc::channel(256);
        let reader_task = tokio::spawn(drive_stream_json_reader(
            read_half,
            "A-1".to_string(),
            tx,
        ));
        let mut out = Vec::new();
        // Time-limit so a bug can't hang the test suite forever.
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while let Ok(Some(ev)) = tokio::time::timeout_at(deadline, rx.recv()).await {
            out.push(ev);
        }
        let _ = write_task.await;
        let _ = reader_task.await;
        out
    }

    fn load_fixture(name: &str) -> Vec<u8> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/stream_json")
            .join(name);
        std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {name}: {e}"))
    }

    #[tokio::test]
    async fn parses_single_turn_fixture_into_expected_events() {
        let bytes = load_fixture("single_turn_text.jsonl");
        let events = run_reader_against_bytes(&bytes).await;

        // Expected order: SessionStarted, ..AssistantDeltas.., AssistantText,
        // TurnComplete, StdoutClosed. Deltas are interleaved among message_*
        // stream_events; extract the session_id and the authoritative final
        // AssistantText.
        let session_started = events.iter().find_map(|e| match e {
            StreamEvent::SessionStarted { session_id } => Some(session_id.clone()),
            _ => None,
        });
        assert_eq!(
            session_started.as_deref(),
            Some("0d836c4f-8546-4aeb-a994-6fb94ba800b7")
        );

        // At least two AssistantDelta events ("O", "K").
        let deltas: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                StreamEvent::AssistantDelta { delta } => Some(delta.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(deltas.concat(), "OK");

        // One AssistantText with content="OK".
        let asst_texts: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                StreamEvent::AssistantText { content, model } => {
                    Some((content.clone(), model.clone()))
                }
                _ => None,
            })
            .collect();
        assert_eq!(asst_texts.len(), 1, "one final AssistantText expected");
        assert_eq!(asst_texts[0].0, "OK");
        assert!(
            asst_texts[0].1.as_deref().unwrap_or("").contains("claude-opus"),
            "model carried from assistant envelope"
        );

        // Exactly one TurnComplete at the end.
        let tc_count = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::TurnComplete { .. }))
            .count();
        assert_eq!(tc_count, 1);
        assert!(matches!(events.last(), Some(StreamEvent::StdoutClosed)));
    }

    #[tokio::test]
    async fn parses_multi_turn_preserves_session_id() {
        let bytes = load_fixture("multi_turn_persistent.jsonl");
        let events = run_reader_against_bytes(&bytes).await;
        let turn_completes: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::TurnComplete { .. }))
            .collect();
        assert_eq!(turn_completes.len(), 2);
        // Exactly one SessionStarted (across both turns) — init envelope
        // appears only in turn 1.
        let session_starts: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::SessionStarted { .. }))
            .collect();
        assert_eq!(session_starts.len(), 1);
    }

    #[tokio::test]
    async fn parses_tool_use_fixture_emits_tool_use_event() {
        let bytes = load_fixture("tool_use_edit.jsonl");
        let events = run_reader_against_bytes(&bytes).await;
        let tool_use = events.iter().find_map(|e| match e {
            StreamEvent::ToolUse {
                tool_name,
                tool_input,
                tool_use_id,
                ..
            } => Some((tool_name.clone(), tool_input.clone(), tool_use_id.clone())),
            _ => None,
        });
        let (name, input, id) = tool_use.expect("ToolUse emitted");
        assert_eq!(name, "Edit");
        assert_eq!(id, "toolu_01");
        assert_eq!(input["file_path"], serde_json::json!("/tmp/a.txt"));
        // ToolUse must appear before the TurnComplete at the end.
        let tool_use_pos = events
            .iter()
            .position(|e| matches!(e, StreamEvent::ToolUse { .. }))
            .unwrap();
        let tc_pos = events
            .iter()
            .position(|e| matches!(e, StreamEvent::TurnComplete { .. }))
            .unwrap();
        assert!(tool_use_pos < tc_pos);
    }

    #[tokio::test]
    async fn parses_tool_result_fixture_emits_tool_result_event() {
        let bytes = load_fixture("tool_result.jsonl");
        let events = run_reader_against_bytes(&bytes).await;
        let tr = events.iter().find_map(|e| match e {
            StreamEvent::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => Some((tool_use_id.clone(), content.clone(), *is_error)),
            _ => None,
        });
        let (id, content, is_error) = tr.expect("ToolResult emitted");
        assert_eq!(id, "toolu_01");
        assert_eq!(content, serde_json::json!("OK"));
        assert!(!is_error);
    }

    #[tokio::test]
    async fn parses_hook_started_response_emits_system_note_not_assistant() {
        let bytes = load_fixture("hook_started_response.jsonl");
        let events = run_reader_against_bytes(&bytes).await;
        // Pitfall 2: must be SystemNote, never AssistantText.
        let note_count = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::SystemNote { .. }))
            .count();
        let asst_count = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::AssistantText { .. }))
            .count();
        assert_eq!(note_count, 2);
        assert_eq!(asst_count, 0);
    }

    #[tokio::test]
    async fn parses_result_completed_bare_fixture() {
        let bytes = load_fixture("result_completed.jsonl");
        let events = run_reader_against_bytes(&bytes).await;
        let tc = events.iter().find_map(|e| match e {
            StreamEvent::TurnComplete {
                terminal_reason,
                is_error,
            } => Some((terminal_reason.clone(), *is_error)),
            _ => None,
        });
        let (reason, is_error) = tc.expect("TurnComplete emitted");
        assert_eq!(reason, "completed");
        assert!(!is_error);
    }

    #[tokio::test]
    async fn malformed_lines_skipped_without_panic() {
        let bytes = load_fixture("malformed.jsonl");
        let events = run_reader_against_bytes(&bytes).await;
        // Three malformed lines + EOF. No panic, only StdoutClosed plus
        // possibly-one AssistantDelta ({"ok":true}{"second":true} decodes as
        // one value with trailing garbage — serde_json::from_str rejects it,
        // so it counts as malformed). Either 0 or no-more-than-trivial events.
        assert!(
            matches!(events.last(), Some(StreamEvent::StdoutClosed)),
            "must terminate cleanly with StdoutClosed, got {:?}",
            events
        );
        // No AssistantText / AssistantDelta / TurnComplete emitted from
        // garbage.
        for e in &events[..events.len().saturating_sub(1)] {
            match e {
                StreamEvent::StdoutClosed => {}
                other => panic!("unexpected emitted event on garbage input: {:?}", other),
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn idle_flush_after_250ms_delta_gap() {
        // Feed one text_delta, then pause; the idle-flush should emit a
        // partial AssistantText after 250ms even though no assistant envelope
        // ever arrived.
        let (mut write_half, read_half) = tokio::io::duplex(64 * 1024);
        let chunk = b"{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"HI\"}},\"session_id\":\"s\"}\n";
        let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);
        let reader = tokio::spawn(drive_stream_json_reader(
            read_half,
            "A-1".to_string(),
            tx,
        ));
        write_half.write_all(chunk).await.unwrap();

        // First event: AssistantDelta("HI")
        let first = rx.recv().await.unwrap();
        assert!(matches!(first, StreamEvent::AssistantDelta { .. }));

        // Advance paused time past the 250ms idle deadline.
        tokio::time::advance(std::time::Duration::from_millis(260)).await;

        // Next emitted event should be the idle-flush AssistantText.
        let second =
            tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
                .await
                .unwrap()
                .unwrap();
        match second {
            StreamEvent::AssistantText { content, model } => {
                assert_eq!(content, "HI");
                assert!(model.is_none());
            }
            other => panic!("expected idle-flush AssistantText, got {:?}", other),
        }
        // Close write side so reader exits cleanly.
        drop(write_half);
        let _ = reader.await;
    }
}
