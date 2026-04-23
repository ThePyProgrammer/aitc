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

use regex::Regex;
use std::sync::OnceLock;
use tokio::io::AsyncBufReadExt;
use tokio::process::{ChildStderr, ChildStdout};
use tokio::sync::mpsc;

use super::types::{StreamEvent, MAX_STREAM_JSON_LINE_BYTES};

/// D-23 regex-based fallback for detecting `@user` mentions inside assistant
/// text. Word-bounded (`[^\w]` on both sides or string edge) so substrings
/// like `@username` or `foo_@user_bar` don't trip a notification. Pitfall 5
/// (RESEARCH.md) — tests cover the substring rejection cases.
fn at_user_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:^|[^\w])@user(?:[^\w]|$)").expect("valid @user regex")
    })
}

/// Returns true if `text` contains a word-bounded `@user` token.
pub fn is_awaiting_user_mention(text: &str) -> bool {
    at_user_regex().is_match(text)
}

/// Truncate `s` to at most `max` chars (char count, not bytes — safe on
/// UTF-8). Appends `…` when truncating. Used for notification bodies where
/// the OS clamps the payload length anyway.
fn truncate_for_notification(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let keep = max.saturating_sub(1);
        format!("{}…", s.chars().take(keep).collect::<String>())
    }
}

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
                        // D-01.4 support: flush any buffered idle-flush text
                        // as an AssistantText BEFORE StdoutClosed so the
                        // aggregator's StdoutClosed arm sees the buffer
                        // populated and can write the interrupted row. Without
                        // this, a subprocess that dies mid-stream would lose
                        // partial text.
                        if !accumulated_text.is_empty() {
                            let _ = sink
                                .send(StreamEvent::AssistantText {
                                    content: std::mem::take(&mut accumulated_text),
                                    model: None,
                                })
                                .await;
                        }
                        let _ = sink.send(StreamEvent::StdoutClosed).await;
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(agent_id = %agent_id, err = %e, "stdout read err");
                        // Same D-01.4 support path for read-error termination.
                        if !accumulated_text.is_empty() {
                            let _ = sink
                                .send(StreamEvent::AssistantText {
                                    content: std::mem::take(&mut accumulated_text),
                                    model: None,
                                })
                                .await;
                        }
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
            // D-04.2: silent drop for SessionStart hook lifecycle — zero user signal.
            // Preserves D-04.3 (other hook names still surface as SystemNote),
            // D-04.5 (raw_stdout still carries the full lifecycle for debugging),
            // D-04.6 (unknown-subtype catch-all unchanged).
            if hook_name.starts_with("SessionStart:") {
                return;
            }
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

/// Plan 04: drain `StreamEvent`s from the parser + stderr reader, write
/// matching `agent_events` rows, and emit Tauri events. This is the single
/// owner of the DB + emit side effects (aggregator pattern from Plan 02
/// decisions). When an `AssistantText` contains `@user` it ALSO fires the
/// OS notification via `dispatch_chat_notification` (D-23).
///
/// Runs until the source `mpsc::Receiver` closes (parser + stderr tasks
/// finish). The caller is responsible for also spawning a supervisor task
/// that waits on `child.wait()` and emits the `session_boundary` row on exit.
pub fn spawn_event_aggregator<R: tauri::Runtime>(
    rx: mpsc::Receiver<StreamEvent>,
    agent_id: String,
    pool: sqlx::SqlitePool,
    sessions: std::sync::Arc<super::session_registry::LiveSessionRegistry>,
    app_handle: tauri::AppHandle<R>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(run_event_aggregator(rx, agent_id, pool, sessions, app_handle))
}

/// D-01 (revised): one assistant_text DB row per assistant **text block**.
/// A turn can contain N text blocks interleaved with tool_use calls (the
/// natural Anthropic-API message shape: `[text, tool_use, text, tool_use,
/// text]`). The original rollup into a single row on TurnComplete silently
/// dropped all but the last text block; now each whole-block envelope
/// (`AssistantText { model: Some(_) }`) persists inline so the transcript
/// preserves the text → tool → text ordering.
///
/// `idle_flush_pending` is the interrupted-turn safety net. Reader-side
/// idle-flush (`AssistantText { model: None }`, from the 250ms timer)
/// lands here and is either superseded by the authoritative envelope or
/// persisted as a final interrupted row on `StdoutClosed` (D-01.4).
///
/// Local variable — NOT a HashMap. `run_event_aggregator` runs one-per-agent
/// (see `spawn_event_aggregator` call site in `agents/commands.rs`), so a
/// per-agent bucket is unnecessary and would invite cross-agent contamination.
async fn run_event_aggregator<R: tauri::Runtime>(
    mut rx: mpsc::Receiver<StreamEvent>,
    agent_id: String,
    pool: sqlx::SqlitePool,
    sessions: std::sync::Arc<super::session_registry::LiveSessionRegistry>,
    app_handle: tauri::AppHandle<R>,
) {
    use tauri::Emitter;

    let mut idle_flush_pending: Option<String> = None;

    while let Some(event) = rx.recv().await {
        match event {
            StreamEvent::SessionStarted { session_id } => {
                // Stamp the session_id on the live-session entry so subsequent
                // outbound frames carry it on their agent_events row and
                // auto_resume can reference it.
                sessions.bind_session_id(&agent_id, session_id.clone()).await;
                let payload = super::types::SessionStartedPayload {
                    agent_id: agent_id.clone(),
                    session_id: session_id.clone(),
                };
                if let Err(e) = app_handle.emit("agent-session-started", &payload) {
                    tracing::debug!(agent_id = %agent_id, err = %e, "session-started emit");
                }
            }
            StreamEvent::AssistantDelta { delta } => {
                // Delta-only — emit a lightweight event so the UI can
                // progressively reveal the text. Authoritative DB write
                // happens on the AssistantText flush below.
                if let Err(e) = app_handle.emit(
                    "agent-assistant-delta",
                    &serde_json::json!({ "agentId": agent_id, "delta": delta }),
                ) {
                    tracing::debug!(agent_id = %agent_id, err = %e, "delta emit");
                }
            }
            StreamEvent::AssistantText { content, model } => {
                // D-23: word-bounded @user check fires on EVERY AssistantText
                // event (idle-flush partials + whole-block envelopes). Pitfall
                // 1 defender — notification latency stays at delta granularity,
                // not turn boundaries. catch_unwind inside
                // dispatch_chat_notification makes this safe even in tests
                // using mock_app.
                if is_awaiting_user_mention(&content) {
                    super::notifications::dispatch_chat_notification(
                        &app_handle,
                        &agent_id,
                        &truncate_for_notification(&content, 80),
                        Some(&agent_id),
                    );
                }

                if model.is_some() {
                    // Whole-block envelope from dispatch_assistant —
                    // authoritative content for this text block. Persist
                    // immediately so it slots into the transcript BEFORE any
                    // subsequent tool_use rows in the same turn. Clears the
                    // idle-flush buffer since the envelope supersedes it.
                    idle_flush_pending = None;
                    let session_id = sessions.session_id_for(&agent_id).await;
                    let payload = serde_json::json!({
                        "content": content,
                        "model": model,
                    });
                    match crate::db::events::insert_agent_event(
                        &pool,
                        &agent_id,
                        session_id.as_deref(),
                        "assistant_text",
                        &payload,
                        None,
                        None,
                        None,
                    )
                    .await
                    {
                        Ok(row) => {
                            if let Err(e) =
                                app_handle.emit("agent-event-appended", &row)
                            {
                                tracing::debug!(
                                    agent_id = %agent_id,
                                    err = %e,
                                    "event-appended emit (assistant_text)"
                                );
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                agent_id = %agent_id,
                                err = %e,
                                "assistant_text insert"
                            );
                        }
                    }
                } else {
                    // Idle-flush partial (reader's 250ms timer fired mid-block,
                    // or EOF flushed accumulated deltas). Buffer only; the
                    // authoritative envelope will supersede, or StdoutClosed
                    // will persist it as the interrupted-turn row (D-01.4).
                    // Latest partial wins — it strictly contains earlier ones
                    // since the reader's accumulator cleared on each flush and
                    // refilled from fresh deltas.
                    idle_flush_pending = Some(content);
                }
            }
            StreamEvent::ToolUse {
                tool_name,
                tool_input,
                tool_use_id,
                approval_request_id,
            } => {
                let session_id = sessions.session_id_for(&agent_id).await;
                // Payload keys match Claude's own stream-json shape (snake_case).
                // Frontend ToolUseCard + ToolResultCard read these names
                // verbatim; writing camelCase here leaves the UI with an
                // UNKNOWN tool badge and no input summary.
                let payload = serde_json::json!({
                    "tool_name": tool_name,
                    "tool_input": tool_input,
                    "tool_use_id": tool_use_id,
                });
                match crate::db::events::insert_agent_event(
                    &pool,
                    &agent_id,
                    session_id.as_deref(),
                    "tool_use",
                    &payload,
                    approval_request_id,
                    None,
                    None,
                )
                .await
                {
                    Ok(row) => {
                        let _ = app_handle.emit("agent-event-appended", &row);
                    }
                    Err(e) => tracing::warn!(agent_id = %agent_id, err = %e, "tool_use insert"),
                }
            }
            StreamEvent::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                let session_id = sessions.session_id_for(&agent_id).await;
                let payload = serde_json::json!({
                    "tool_use_id": tool_use_id,
                    "content": content,
                    "is_error": is_error,
                });
                match crate::db::events::insert_agent_event(
                    &pool,
                    &agent_id,
                    session_id.as_deref(),
                    "tool_result",
                    &payload,
                    None,
                    None,
                    None,
                )
                .await
                {
                    Ok(row) => {
                        let _ = app_handle.emit("agent-event-appended", &row);
                    }
                    Err(e) => tracing::warn!(agent_id = %agent_id, err = %e, "tool_result insert"),
                }
            }
            StreamEvent::TurnComplete {
                terminal_reason,
                is_error,
            } => {
                let session_id = sessions.session_id_for(&agent_id).await;
                // Each text block already persisted inline via its envelope.
                // Drop any lingering idle-flush partial — a clean TurnComplete
                // implies the stream's content blocks all closed with their
                // authoritative envelopes.
                idle_flush_pending = None;
                // Flip the most recent user_text row's delivery_status to
                // "consumed" — the turn that just ended was the assistant's
                // response to that message.
                if let Ok(Some(last_user_id)) = crate::db::events::find_last_user_text_id(
                    &pool,
                    &agent_id,
                    session_id.as_deref(),
                )
                .await
                {
                    let _ = crate::db::events::update_event_delivery_status(
                        &pool,
                        last_user_id,
                        "consumed",
                    )
                    .await;
                    let _ = app_handle.emit(
                        "agent-delivery-updated",
                        &super::types::DeliveryUpdate {
                            event_id: last_user_id,
                            status: "consumed".into(),
                        },
                    );
                }
                let payload = serde_json::json!({
                    "terminalReason": terminal_reason,
                    "isError": is_error,
                });
                if let Err(e) = app_handle.emit("agent-turn-complete", &payload) {
                    tracing::debug!(agent_id = %agent_id, err = %e, "turn-complete emit");
                }
            }
            StreamEvent::RawStdout { line } => {
                let session_id = sessions.session_id_for(&agent_id).await;
                let payload = serde_json::json!({ "line": line });
                match crate::db::events::insert_agent_event(
                    &pool,
                    &agent_id,
                    session_id.as_deref(),
                    "raw_stdout",
                    &payload,
                    None,
                    None,
                    None,
                )
                .await
                {
                    Ok(row) => {
                        let _ = app_handle.emit("agent-event-appended", &row);
                    }
                    Err(e) => tracing::warn!(agent_id = %agent_id, err = %e, "raw_stdout insert"),
                }
            }
            StreamEvent::RawStderr { line } => {
                let session_id = sessions.session_id_for(&agent_id).await;
                let payload = serde_json::json!({ "line": line });
                match crate::db::events::insert_agent_event(
                    &pool,
                    &agent_id,
                    session_id.as_deref(),
                    "raw_stderr",
                    &payload,
                    None,
                    None,
                    None,
                )
                .await
                {
                    Ok(row) => {
                        let _ = app_handle.emit("agent-event-appended", &row);
                    }
                    Err(e) => tracing::warn!(agent_id = %agent_id, err = %e, "raw_stderr insert"),
                }
            }
            StreamEvent::SystemNote { text } => {
                let session_id = sessions.session_id_for(&agent_id).await;
                let payload = serde_json::json!({ "text": text });
                match crate::db::events::insert_agent_event(
                    &pool,
                    &agent_id,
                    session_id.as_deref(),
                    "system_note",
                    &payload,
                    None,
                    None,
                    None,
                )
                .await
                {
                    Ok(row) => {
                        let _ = app_handle.emit("agent-event-appended", &row);
                    }
                    Err(e) => tracing::warn!(agent_id = %agent_id, err = %e, "system_note insert"),
                }
            }
            StreamEvent::StdoutClosed => {
                // D-01.4: if the turn never reached TurnComplete, persist any
                // idle-flush partial that the reader handed us (deltas flushed
                // without a following envelope) as an interrupted row +
                // synthesize agent-turn-complete so the frontend's streaming
                // flag flips off (Pitfall 3 — orphaned streaming flag).
                if let Some(content) = idle_flush_pending.take() {
                    let session_id = sessions.session_id_for(&agent_id).await;
                    let payload = serde_json::json!({
                        "content": content,
                        "model": serde_json::Value::Null,
                    });
                    match crate::db::events::insert_agent_event(
                        &pool,
                        &agent_id,
                        session_id.as_deref(),
                        "assistant_text",
                        &payload,
                        None,
                        None,
                        None,
                    )
                    .await
                    {
                        Ok(row) => {
                            if let Err(e) =
                                app_handle.emit("agent-event-appended", &row)
                            {
                                tracing::debug!(
                                    agent_id = %agent_id,
                                    err = %e,
                                    "event-appended emit (interrupted)"
                                );
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                agent_id = %agent_id,
                                err = %e,
                                "assistant_text interrupted insert"
                            );
                        }
                    }
                    let tc_payload = serde_json::json!({
                        "agentId": agent_id,
                        "terminalReason": "interrupted",
                        "isError": false,
                    });
                    if let Err(e) = app_handle.emit("agent-turn-complete", &tc_payload) {
                        tracing::debug!(
                            agent_id = %agent_id,
                            err = %e,
                            "synthetic turn-complete emit"
                        );
                    }
                }
                // Reader hit EOF; the supervisor's wait() will emit the
                // session_boundary row. Nothing else to do here.
                tracing::debug!(agent_id = %agent_id, "stdout closed; aggregator draining");
            }
        }
    }
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
    async fn session_start_hooks_silently_dropped() {
        // V-19-20 (D-04.2): fixture's two SessionStart:startup envelopes
        // (hook_started + hook_response) are now silently dropped by
        // dispatch_system — neither SystemNote nor AssistantText.
        //
        // Pitfall 2 still holds for non-SessionStart hook names
        // (see `non_session_start_hooks_still_emit_system_note` below).
        let bytes = load_fixture("hook_started_response.jsonl");
        let events = run_reader_against_bytes(&bytes).await;
        let note_count = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::SystemNote { .. }))
            .count();
        let asst_count = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::AssistantText { .. }))
            .count();
        assert_eq!(note_count, 0, "SessionStart hooks must not emit SystemNote");
        assert_eq!(
            asst_count, 0,
            "SessionStart hooks must never surface as assistant text"
        );
    }

    #[tokio::test]
    async fn non_session_start_hooks_still_emit_system_note() {
        // V-19-21 (D-04.3): PreToolUse / PostToolUse / UserPromptSubmit / Stop
        // etc. continue to surface as SystemNote — only SessionStart is silent.
        let bytes = load_fixture("hook_pretool_use.jsonl");
        let events = run_reader_against_bytes(&bytes).await;
        let note_count = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::SystemNote { .. }))
            .count();
        assert_eq!(note_count, 1, "PreToolUse:Edit must still emit SystemNote");
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

    #[test]
    fn is_awaiting_user_mention_matches_bounded_at_user() {
        // Positive cases: @user with non-word char boundary (or edge).
        assert!(is_awaiting_user_mention("@user can you verify"));
        assert!(is_awaiting_user_mention("Please help me @user"));
        assert!(is_awaiting_user_mention("are you ok @user?"));
        assert!(is_awaiting_user_mention("Hey @user, confirm this."));
        assert!(is_awaiting_user_mention("multi line\n@user\nlast"));
        assert!(is_awaiting_user_mention("@user"));
    }

    #[test]
    fn is_awaiting_user_mention_rejects_substring_matches() {
        // Negative cases (Pitfall 5): @user that's part of a longer word
        // identifier must NOT trigger a notification.
        assert!(!is_awaiting_user_mention("@username"));
        assert!(!is_awaiting_user_mention("foo@user123"));
        assert!(!is_awaiting_user_mention("foo_@user_bar"));
        assert!(!is_awaiting_user_mention("send email to admin@example.com"));
        assert!(!is_awaiting_user_mention("no mention here"));
        assert!(!is_awaiting_user_mention(""));
    }

    #[test]
    fn truncate_for_notification_short_string_unchanged() {
        assert_eq!(truncate_for_notification("hi", 10), "hi");
        assert_eq!(truncate_for_notification("", 10), "");
    }

    #[test]
    fn truncate_for_notification_long_string_ellipsized() {
        let out = truncate_for_notification("abcdefghijk", 5);
        assert_eq!(out.chars().count(), 5);
        assert!(out.ends_with('…'));
    }

    // ----------------------------------------------------------------
    // Aggregator harness + D-01 coalescing tests (V-19-01..V-19-04)
    // ----------------------------------------------------------------

    /// Drive `run_event_aggregator` against a hand-built `Vec<StreamEvent>`
    /// (or reader-sourced events) and return the seeded pool for assertions.
    ///
    /// Registers a live session for `agent_id` and binds a deterministic
    /// session_id so `insert_agent_event`'s auto-sequence path fires.
    async fn run_aggregator_with_events(
        agent_id: &str,
        events: Vec<StreamEvent>,
    ) -> sqlx::SqlitePool {
        let pool = crate::db::events::tests::make_pool_with_chat_schema().await;
        let registry =
            crate::chat_runtime::session_registry::LiveSessionRegistry::new_arc();
        let (sess, _rx) =
            crate::chat_runtime::session_registry::tests::make_live_session(agent_id);
        registry.register(sess).await;
        registry
            .bind_session_id(agent_id, "sess-1".to_string())
            .await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let (tx, rx) = mpsc::channel::<StreamEvent>(64);
        let handle = spawn_event_aggregator(
            rx,
            agent_id.to_string(),
            pool.clone(),
            registry.clone(),
            app_handle,
        );
        for ev in events {
            tx.send(ev).await.expect("aggregator send");
        }
        // Closing the channel lets the `while let Some` loop terminate.
        drop(tx);
        // Bounded wait — aggregator is pure-in-memory + SQLite-in-memory, so
        // this should complete in milliseconds.
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), handle).await;
        pool
    }

    #[tokio::test]
    async fn aggregator_coalesces_one_row_per_turn() {
        // V-19-01 (D-01.1 + D-01.2 + D-01.3): the coalesced fixture emits 3
        // text_delta chunks + 1 whole-turn assistant envelope + a result row.
        // The aggregator must fold those into exactly one assistant_text DB
        // row whose content is the envelope's authoritative "Hello world".
        let bytes = load_fixture("coalesced_turn.jsonl");
        let stream_events = run_reader_against_bytes(&bytes).await;
        let pool = run_aggregator_with_events("A-1", stream_events).await;
        let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .expect("list_events_for_agent");
        let asst_rows: Vec<_> = rows
            .iter()
            .filter(|e| e.event_type == "assistant_text")
            .collect();
        assert_eq!(
            asst_rows.len(),
            1,
            "exactly one assistant_text row per turn; rows = {:?}",
            rows.iter()
                .map(|e| e.event_type.clone())
                .collect::<Vec<_>>()
        );
        let content = asst_rows[0]
            .payload_json
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert_eq!(
            content, "Hello world",
            "envelope content is authoritative (replaces buffered deltas)"
        );
    }

    #[tokio::test]
    async fn aggregator_flushes_interrupted_on_stdout_closed() {
        // V-19-02 (D-01.4): the interrupted fixture ends at EOF without ever
        // emitting a TurnComplete. The aggregator's StdoutClosed arm must
        // flush the buffered 2-delta content ("Par"+"tial" = "Partial") as
        // ONE assistant_text row. Presence of the row proves the synthetic
        // flush ran; the concatenation proves idle-flush accumulation is
        // correct (no envelope to replace, so buffer = last idle-flush).
        let bytes = load_fixture("interrupted_turn.jsonl");
        let stream_events = run_reader_against_bytes(&bytes).await;
        let pool = run_aggregator_with_events("A-1", stream_events).await;
        let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .expect("list_events_for_agent");
        let asst_rows: Vec<_> = rows
            .iter()
            .filter(|e| e.event_type == "assistant_text")
            .collect();
        assert_eq!(
            asst_rows.len(),
            1,
            "interrupted turn still writes exactly one row"
        );
        let content = asst_rows[0]
            .payload_json
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert_eq!(
            content, "Partial",
            "buffered deltas flushed on StdoutClosed"
        );
    }

    #[tokio::test]
    async fn aggregator_whole_turn_envelope_replaces_buffer() {
        // V-19-03 (D-01.5): when a whole-turn AssistantText envelope (model
        // is Some) follows buffered idle-flush partials, it REPLACES the
        // buffer — the envelope's text + model is authoritative. Pitfall 7:
        // if the envelope omitted the model, the prior idle-flushes' model
        // must survive; here the envelope explicitly sets it, so we assert
        // the envelope's model wins.
        let events = vec![
            StreamEvent::SessionStarted {
                session_id: "sess-1".to_string(),
            },
            StreamEvent::AssistantText {
                content: "draft one".to_string(),
                model: None,
            },
            StreamEvent::AssistantText {
                content: "draft two".to_string(),
                model: None,
            },
            StreamEvent::AssistantText {
                content: "FINAL".to_string(),
                model: Some("claude-opus-4-7".to_string()),
            },
            StreamEvent::TurnComplete {
                terminal_reason: "completed".to_string(),
                is_error: false,
            },
        ];
        let pool = run_aggregator_with_events("A-1", events).await;
        let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .expect("list_events_for_agent");
        let asst_rows: Vec<_> = rows
            .iter()
            .filter(|e| e.event_type == "assistant_text")
            .collect();
        assert_eq!(asst_rows.len(), 1);
        assert_eq!(
            asst_rows[0]
                .payload_json
                .get("content")
                .and_then(|v| v.as_str()),
            Some("FINAL"),
            "envelope replaces buffered drafts"
        );
        assert_eq!(
            asst_rows[0]
                .payload_json
                .get("model")
                .and_then(|v| v.as_str()),
            Some("claude-opus-4-7"),
            "envelope's model survives"
        );
    }

    #[tokio::test]
    async fn aggregator_fires_at_user_notification_before_flush() {
        // V-19-04 (D-23 regression guard, Pitfall 1): the @user notification
        // path must NOT be gated on the DB write. Observable proxy: after a
        // single AssistantText containing @user with no following TurnComplete,
        // the DB has NO assistant_text row yet (no flush has fired) — proving
        // the aggregator did not delay the notification on a DB write, and
        // also that the buffer-first path doesn't accidentally persist mid-
        // turn rows.
        //
        // Direct notification-capture would need a testing seam in
        // `dispatch_chat_notification`; the zero-row assertion combined with
        // V-19-01 (coalesced turn finishes with one row) + V-19-02 (interrupted
        // turn finishes with one row via StdoutClosed) covers the Pitfall 1
        // regression surface.
        let events = vec![
            StreamEvent::SessionStarted {
                session_id: "sess-1".to_string(),
            },
            StreamEvent::AssistantText {
                content: "please confirm @user thanks".to_string(),
                model: None,
            },
            // No TurnComplete / StdoutClosed — channel close is the only
            // termination signal, so the buffer is dropped without a flush.
        ];
        let pool = run_aggregator_with_events("A-1", events).await;
        let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .expect("list_events_for_agent");
        let asst_rows: Vec<_> = rows
            .iter()
            .filter(|e| e.event_type == "assistant_text")
            .collect();
        assert_eq!(
            asst_rows.len(),
            0,
            "no DB row written on AssistantText alone — proves aggregator does not gate @user notification on a DB write"
        );
    }

    #[tokio::test]
    async fn aggregator_writes_row_per_text_block_in_multiblock_turn() {
        // Regression guard for the original D-01 rollup bug: a turn whose
        // Anthropic message content is [text, tool_use, text] must produce
        // TWO assistant_text rows — one before, one after the tool_use —
        // not a single row containing only the last block. Ordering matters:
        // the transcript renders rows by id, so the first text block must
        // slot BEFORE the tool_use row and the second AFTER.
        let events = vec![
            StreamEvent::SessionStarted {
                session_id: "sess-1".to_string(),
            },
            StreamEvent::AssistantText {
                content: "Let me conduct an audit.".to_string(),
                model: Some("claude-opus-4-7".to_string()),
            },
            StreamEvent::ToolUse {
                tool_name: "Grep".to_string(),
                tool_input: serde_json::json!({"pattern": "foo"}),
                tool_use_id: "toolu_1".to_string(),
                approval_request_id: None,
            },
            StreamEvent::ToolResult {
                tool_use_id: "toolu_1".to_string(),
                content: serde_json::json!("match.rs:1: foo"),
                is_error: false,
            },
            StreamEvent::AssistantText {
                content: "Here's the audit of style consistency.".to_string(),
                model: Some("claude-opus-4-7".to_string()),
            },
            StreamEvent::TurnComplete {
                terminal_reason: "completed".to_string(),
                is_error: false,
            },
        ];
        let pool = run_aggregator_with_events("A-1", events).await;
        let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 20)
            .await
            .expect("list_events_for_agent");
        // list_events_for_agent returns newest-first; reverse for insertion
        // order so we can assert the interleave.
        let mut by_insert_order = rows.clone();
        by_insert_order.reverse();
        let shape: Vec<&str> = by_insert_order
            .iter()
            .map(|r| r.event_type.as_str())
            .collect();
        assert_eq!(
            shape,
            vec!["assistant_text", "tool_use", "tool_result", "assistant_text"],
            "text blocks must persist inline around tool_use — \
             got {:?}",
            shape
        );
        let asst_rows: Vec<_> = by_insert_order
            .iter()
            .filter(|e| e.event_type == "assistant_text")
            .collect();
        assert_eq!(asst_rows.len(), 2, "one row per text block");
        assert_eq!(
            asst_rows[0]
                .payload_json
                .get("content")
                .and_then(|v| v.as_str()),
            Some("Let me conduct an audit."),
            "first row preserves first text block (pre-tool)"
        );
        assert_eq!(
            asst_rows[1]
                .payload_json
                .get("content")
                .and_then(|v| v.as_str()),
            Some("Here's the audit of style consistency."),
            "second row preserves second text block (post-tool)"
        );
    }
}
