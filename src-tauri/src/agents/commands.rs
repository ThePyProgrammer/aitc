//! Tauri command surface for agent management (Phase 3, Plan 02).
//!
//! Commands:
//!   - list_agents() -> Vec<AgentInfo>
//!   - launch_agent(agent_type, cwd, intent) -> AgentInfo
//!   - terminate_agent(agent_id) -> ()
//!   - update_agent_intent(agent_id, intent) -> ()
//!   - get_agent_logs(agent_id) -> Vec<String>

use crate::agents::adapter::{AgentInfo, AgentState, LaunchOptions};
use crate::agents::hook_waiters::{HookDecision, WaiterRegistry};
use crate::agents::launcher;
use crate::agents::registry::AgentRegistry;
use crate::agents::AitcPort;
use crate::chat_runtime::session_registry::{LiveSession, LiveSessionRegistry};
use crate::pipeline::pipeline_state::PipelineState;
use sqlx::{Pool, Sqlite};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;

/// List all currently tracked agents.
#[tauri::command]
#[specta::specta]
pub async fn list_agents(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<AgentInfo>, String> {
    Ok(registry.all_agents().await)
}

/// List adapter types whose launch binary resolves on PATH.
///
/// Used by the Deploy dialog to hide agent types that aren't installed,
/// so users can't select launches that are guaranteed to fail.
#[tauri::command]
#[specta::specta]
pub async fn list_available_agent_types(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<String>, String> {
    Ok(registry.available_adapter_types())
}

/// Launch a new agent of the given type in the specified working directory.
///
/// T-03-05 mitigations:
/// - Validates cwd exists and is a directory.
/// - Only launches binaries matched by registered adapters (no arbitrary PATH exec).
///
/// Phase 10 D-06 + D-12: branches on `adapter.capabilities().chat_duplex`.
/// Duplex adapters (claude-code) take the chat_runtime path — parser +
/// outbound writer + supervisor + aggregator own stdin/stdout/stderr, and a
/// `LiveSession` is registered so `send_chat_message_to_agent` can reach the
/// subprocess. Read-only adapters (codex/opencode/generic) go through
/// `spawn_raw_capture_tasks` — stdout/stderr lines become raw_stdout /
/// raw_stderr rows in agent_events.
#[tauri::command]
#[specta::specta]
pub async fn launch_agent(
    agent_type: String,
    cwd: String,
    intent: Option<String>,
    options: Option<LaunchOptions>,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
    pipeline: tauri::State<'_, PipelineState>,
    pool: tauri::State<'_, Pool<Sqlite>>,
    chat_sessions: tauri::State<'_, Arc<LiveSessionRegistry>>,
    aitc_port: tauri::State<'_, AitcPort>,
    app_handle: tauri::AppHandle,
) -> Result<AgentInfo, String> {
    launch_agent_inner(
        agent_type,
        cwd,
        intent,
        options,
        registry.inner(),
        pipeline.inner(),
        pool.inner(),
        chat_sessions.inner(),
        aitc_port.inner().0,
        app_handle,
    )
    .await
}

/// Inner body of `launch_agent` factored out so `relaunch_agent_session` can
/// reuse the same spawn + routing logic without double-wrapping Tauri State.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn launch_agent_inner<R: tauri::Runtime>(
    agent_type: String,
    cwd: String,
    intent: Option<String>,
    options: Option<LaunchOptions>,
    registry: &Arc<AgentRegistry>,
    pipeline: &PipelineState,
    pool: &Pool<Sqlite>,
    chat_sessions: &Arc<LiveSessionRegistry>,
    aitc_port: u16,
    app_handle: tauri::AppHandle<R>,
) -> Result<AgentInfo, String> {
    // T-03-05: Validate cwd -- canonicalize to resolve symlinks and `..` components,
    // preventing path traversal attacks.
    let cwd_path = PathBuf::from(&cwd)
        .canonicalize()
        .map_err(|e| format!("cwd is invalid or inaccessible: {e}"))?;
    if !cwd_path.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd_path.display()));
    }

    // Constrain launches to the currently watched repo. Anything outside it
    // would spawn an agent whose edits AITC can't observe -- the whole point
    // of the tool. If no watch is active we allow the launch (the radar view
    // already refuses to do useful work without one, so the user will see the
    // missing context before the agent does damage).
    if let Some(active) = pipeline.inner.lock().await.as_ref() {
        if !cwd_path.starts_with(&active.repo_root) {
            return Err(format!(
                "cwd {} is outside the watched repo {}. \
                 Point the agent at the monitored directory or a subdirectory.",
                cwd_path.display(),
                active.repo_root.display(),
            ));
        }
    }

    // T-03-05: Find adapter by exact agent_type -- reject unknown types.
    // Uses exact match (not substring) to prevent "code" matching "claude-code".
    let adapter = registry
        .find_adapter_by_type(&agent_type)
        .ok_or_else(|| format!("No registered adapter for agent type '{agent_type}'"))?;
    let caps = adapter.capabilities();

    // Phase 10: if the caller passed an explicit agent_id (via D-04 relaunch
    // or test fixtures), honor it — otherwise mint a fresh one now so the
    // duplex adapter can write the per-session MCP config BEFORE spawning.
    // Minting: 4-hex truncation of a UUIDv4 keeps the existing 4-char shape.
    let mut opts = options.unwrap_or_default();
    let agent_id = match opts.agent_id.as_deref() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            let hex = uuid::Uuid::new_v4().simple().to_string();
            format!("KAGENT-{}", &hex[..4].to_uppercase())
        }
    };
    opts.agent_id = Some(agent_id.clone());
    if opts.aitc_port.is_none() {
        opts.aitc_port = Some(aitc_port);
    }

    // Launch via the adapter -- returns (pid, child). For duplex adapters
    // the child has piped stdio; the command layer takes ownership of the
    // pipes below.
    let (pid, child) = adapter.launch(cwd_path.clone(), intent.clone(), opts).await?;

    let info = AgentInfo {
        id: agent_id.clone(),
        agent_type: adapter.adapter_type().to_string(),
        protocol: "cli".to_string(),
        state: AgentState::Running,
        pid: Some(pid),
        cwd: Some(cwd_path.clone()),
        intent: intent.clone(),
    };

    registry
        .upsert_agent(agent_id.clone(), info.clone(), adapter.clone(), true)
        .await?;

    if caps.chat_duplex {
        // D-06: wire the long-lived stream-json runtime. Take the three
        // pipes and hand them to parser + stderr reader + aggregator +
        // outbound writer + supervisor.
        let mut child = child;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "adapter returned live session without stdin pipe".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "adapter returned live session without stdout pipe".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "adapter returned live session without stderr pipe".to_string())?;

        let (frame_tx, frame_rx) = tokio::sync::mpsc::channel::<
            crate::chat_runtime::types::OutboundFrame,
        >(64);
        let (delivery_tx, mut delivery_rx) = tokio::sync::mpsc::channel::<
            crate::chat_runtime::types::DeliveryUpdate,
        >(64);
        let (event_tx, event_rx) = tokio::sync::mpsc::channel::<
            crate::chat_runtime::types::StreamEvent,
        >(256);

        // Register the LiveSession so send_chat_message_to_agent can reach
        // the stdin writer. bind_session_id gets called later by the
        // aggregator when the stream-json `init` envelope arrives.
        chat_sessions
            .register(LiveSession {
                agent_id: agent_id.clone(),
                session_id: None,
                stdin_tx: frame_tx,
                archived: false,
                last_read_at: None,
            })
            .await;

        // Parser (stdout) + stderr reader share the event_tx sink.
        crate::chat_runtime::parser::spawn_stream_json_reader(
            stdout,
            agent_id.clone(),
            event_tx.clone(),
        );
        crate::chat_runtime::parser::spawn_raw_stderr_reader(
            stderr,
            agent_id.clone(),
            event_tx.clone(),
        );
        // Dropping our local clone of event_tx ensures the aggregator
        // receives a channel-close once both readers finish.
        drop(event_tx);

        // Aggregator consumes StreamEvents and owns DB + Tauri emit.
        crate::chat_runtime::parser::spawn_event_aggregator(
            event_rx,
            agent_id.clone(),
            pool.clone(),
            chat_sessions.clone(),
            app_handle.clone(),
        );

        // Outbound writer: serializes OutboundFrames as JSONL stdin.
        crate::chat_runtime::outbound::spawn_outbound_writer(
            stdin,
            frame_rx,
            delivery_tx,
            agent_id.clone(),
        );

        // Delivery-update forwarder: mirror the status onto agent_events
        // and emit agent-delivery-updated.
        let pool_d = pool.clone();
        let app_d = app_handle.clone();
        let agent_id_d = agent_id.clone();
        tokio::spawn(async move {
            while let Some(u) = delivery_rx.recv().await {
                let _ = crate::db::events::update_event_delivery_status(
                    &pool_d, u.event_id, &u.status,
                )
                .await;
                if let Err(e) = app_d.emit("agent-delivery-updated", &u) {
                    tracing::debug!(
                        agent_id = %agent_id_d,
                        err = %e,
                        "delivery-updated emit failed"
                    );
                }
            }
        });

        // Supervisor: wait on child, mark_archived, insert session_boundary
        // row, emit agent-session-ended (D-03 + D-04).
        crate::chat_runtime::supervisor::spawn_supervisor(
            child,
            agent_id.clone(),
            chat_sessions.clone(),
            pool.clone(),
            app_handle.clone(),
        );
    } else {
        // D-12: read-only transcript. Capture stdout/stderr line-by-line
        // into agent_events (raw_stdout / raw_stderr).
        spawn_raw_capture_tasks(child, agent_id.clone(), pool.clone(), app_handle.clone());
    }

    Ok(info)
}

/// Phase 10 D-12: read-only transcript capture for codex/opencode/generic
/// adapters. Spawns two reader tasks (stdout + stderr) that insert raw_*
/// rows and emit `agent-event-appended` so the transcript still updates
/// live. A third waiter task awaits `child.wait()` so the Child isn't
/// dropped mid-read (which would SIGKILL on Unix).
fn spawn_raw_capture_tasks<R: tauri::Runtime>(
    mut child: tokio::process::Child,
    agent_id: String,
    pool: Pool<Sqlite>,
    app: tauri::AppHandle<R>,
) {
    use tokio::io::AsyncBufReadExt;

    if let Some(stdout) = child.stdout.take() {
        let pool = pool.clone();
        let app = app.clone();
        let agent_id_c = agent_id.clone();
        tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let payload = serde_json::json!({ "line": line });
                match crate::db::events::insert_agent_event(
                    &pool,
                    &agent_id_c,
                    None,
                    "raw_stdout",
                    &payload,
                    None,
                    None,
                    None,
                )
                .await
                {
                    Ok(row) => {
                        let _ = app.emit("agent-event-appended", &row);
                    }
                    Err(e) => tracing::warn!(
                        agent_id = %agent_id_c,
                        err = %e,
                        "raw_stdout insert failed"
                    ),
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let pool = pool.clone();
        let app = app.clone();
        let agent_id_c = agent_id.clone();
        tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let payload = serde_json::json!({ "line": line });
                match crate::db::events::insert_agent_event(
                    &pool,
                    &agent_id_c,
                    None,
                    "raw_stderr",
                    &payload,
                    None,
                    None,
                    None,
                )
                .await
                {
                    Ok(row) => {
                        let _ = app.emit("agent-event-appended", &row);
                    }
                    Err(e) => tracing::warn!(
                        agent_id = %agent_id_c,
                        err = %e,
                        "raw_stderr insert failed"
                    ),
                }
            }
        });
    }

    // Waiter task: reap the subprocess on exit so Child isn't dropped early.
    // We don't update registry state from here (read-only adapters already
    // surface transitions via process scan); the child.wait() keeps the pipe
    // alive until the last byte is drained.
    tokio::spawn(async move {
        let _ = child.wait().await;
        tracing::debug!(agent_id = %agent_id, "read-only subprocess exited");
    });
}

/// Terminate a running agent by ID.
///
/// T-03-06 mitigation: Only terminates processes tracked in the registry.
/// Will not kill arbitrary PIDs.
///
/// Phase 8 D-10 force-deny: signals every pending hook waiter for this
/// agent with `HookDecision::Deny("agent terminated by user")` BEFORE the
/// OS kill. This prevents the EPIPE race where the sidecar dies mid-read
/// and Claude hangs waiting for a response that will never come. Also
/// clears the agent's always-allow set and session bindings so a
/// reconnection doesn't resurrect stale state.
#[tauri::command]
#[specta::specta]
pub async fn terminate_agent(
    agent_id: String,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
) -> Result<(), String> {
    let info = registry
        .get_agent(&agent_id)
        .await
        .ok_or_else(|| format!("Agent '{agent_id}' not found"))?;

    let pid = info
        .pid
        .ok_or_else(|| format!("Agent '{agent_id}' has no PID"))?;

    // D-10: force-deny BEFORE the OS kill so the sidecar gets a decision.
    waiters
        .signal_for_agent(
            &agent_id,
            HookDecision::Deny("agent terminated by user".into()),
        )
        .await;
    waiters.clear_always_allow_for_agent(&agent_id).await;
    waiters.clear_session_bindings_for_agent(&agent_id).await;

    // Terminate the process
    launcher::terminate_process(pid).await?;

    // Remove from registry
    registry.remove_agent(&agent_id).await;

    Ok(())
}

/// Update an agent's intent/task description (manual labeling per D-08 fallback).
#[tauri::command]
#[specta::specta]
pub async fn update_agent_intent(
    agent_id: String,
    intent: String,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<(), String> {
    // Verify agent exists
    if registry.get_agent(&agent_id).await.is_none() {
        return Err(format!("Agent '{agent_id}' not found"));
    }
    registry.update_intent(&agent_id, intent).await;
    Ok(())
}

/// Get the stdout log buffer for an agent.
///
/// T-03-08: accepted risk -- logs are local process output.
#[tauri::command]
#[specta::specta]
pub async fn get_agent_logs(
    agent_id: String,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<String>, String> {
    Ok(launcher::read_stdout_buffer(&registry, &agent_id).await)
}

// ---------------------------------------------------------------------------
// Phase 8 Plan 04: passive-claude-detected consent flow + sidecar resolution.
// ---------------------------------------------------------------------------

/// Resolve the absolute path of the `aitc-hook` sidecar binary at runtime.
///
/// Tauri v2 stages sidecars next to the main executable with the target-triple
/// suffix stripped, so `ShellExt::sidecar("aitc-hook")` is the canonical way to
/// resolve the path (dev builds use `target/debug/aitc-hook`; bundled releases
/// use the staged copy in the app's exec dir).
#[tauri::command]
#[specta::specta]
pub async fn resolve_sidecar_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    let cmd = app_handle
        .shell()
        .sidecar("aitc-hook")
        .map_err(|e| format!("sidecar lookup: {e}"))?;
    let std_cmd: std::process::Command = cmd.into();
    let program = std_cmd.get_program().to_string_lossy().to_string();
    if program.is_empty() {
        return Err("sidecar path resolution returned empty".into());
    }
    Ok(program)
}

/// Accept the passive-detected Claude hook consent prompt for `repo_cwd`:
/// records the decision in `app_settings` AND installs the AITC PreToolUse
/// hook into `<repo_cwd>/.claude/settings.local.json`.
#[tauri::command]
#[specta::specta]
pub async fn accept_passive_hook_consent(
    repo_cwd: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::comms::app_settings::record_passive_hook_consent(pool.inner(), &repo_cwd, "accepted")
        .await?;
    let sidecar_abs = resolve_sidecar_path(app_handle.clone()).await?;
    crate::agents::hook_install::install_aitc_hook(
        std::path::Path::new(&repo_cwd),
        &sidecar_abs,
    )?;
    Ok(())
}

/// Decline the passive-detected Claude hook consent prompt for `repo_cwd`:
/// records the decision so we never re-prompt. Does NOT install the hook.
#[tauri::command]
#[specta::specta]
pub async fn decline_passive_hook_consent(
    repo_cwd: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
) -> Result<(), String> {
    crate::comms::app_settings::record_passive_hook_consent(pool.inner(), &repo_cwd, "declined")
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;

    #[tokio::test]
    async fn list_agents_returns_empty_for_new_registry() {
        let registry = AgentRegistry::new();
        let all = registry.all_agents().await;
        assert!(all.is_empty());
    }

    // The accept/decline commands take `tauri::State<'_, Pool<Sqlite>>` which
    // can't be constructed outside a running Tauri runtime. Tests below
    // exercise the command bodies' core steps — app_settings upsert +
    // install — directly so we still cover the side-effects end-to-end.

    async fn fresh_pool() -> Pool<Sqlite> {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn accept_passive_hook_consent_writes_settings_local() {
        let pool = fresh_pool().await;
        let td = TempDir::new().unwrap();
        let cwd = td.path().to_str().unwrap().to_string();

        // Simulate the command body: record consent, then install with a
        // fake sidecar path (install doesn't validate the path exists).
        crate::comms::app_settings::record_passive_hook_consent(&pool, &cwd, "accepted")
            .await
            .unwrap();
        crate::agents::hook_install::install_aitc_hook(
            td.path(),
            "/fake/test/sidecar/aitc-hook",
        )
        .unwrap();

        assert!(td.path().join(".claude/settings.local.json").exists());
        assert!(
            crate::comms::app_settings::has_passive_hook_consent_entry(&pool, &cwd)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn decline_passive_hook_consent_records_only() {
        let pool = fresh_pool().await;
        let td = TempDir::new().unwrap();
        let cwd = td.path().to_str().unwrap().to_string();

        crate::comms::app_settings::record_passive_hook_consent(&pool, &cwd, "declined")
            .await
            .unwrap();

        assert!(
            !td.path().join(".claude/settings.local.json").exists(),
            "decline must not write settings.local.json"
        );
        let rows = crate::comms::app_settings::get_passive_hook_consent_repos(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, "declined");
    }

    // -----------------------------------------------------------------
    // Phase 10 — launch_agent routing tests.
    //
    // Uses a MockAdapter whose `launch` returns a real `cat` subprocess
    // with piped stdio. This lets us verify the duplex path actually
    // registers a LiveSession and plumbs stdin/stdout through the parser,
    // and that the read-only path does NOT register a session.
    // -----------------------------------------------------------------

    use crate::agents::adapter::{AdapterCapabilities, AgentAdapter};
    use async_trait::async_trait;

    struct MockAdapter {
        adapter_type: &'static str,
        chat_duplex: bool,
    }

    #[async_trait]
    impl AgentAdapter for MockAdapter {
        fn adapter_type(&self) -> &str {
            self.adapter_type
        }
        fn process_patterns(&self) -> Vec<String> {
            vec![self.adapter_type.to_string()]
        }
        fn launch_binary(&self) -> String {
            self.adapter_type.to_string()
        }
        async fn launch(
            &self,
            _cwd: PathBuf,
            _intent: Option<String>,
            _options: LaunchOptions,
        ) -> Result<(u32, tokio::process::Child), String> {
            // /bin/cat holds stdin open indefinitely — perfect for verifying
            // the plumbing without running the real Claude Code CLI.
            #[cfg(not(windows))]
            let prog = "cat";
            #[cfg(windows)]
            let prog = "more";
            let mut cmd = tokio::process::Command::new(prog);
            cmd.stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            let child = cmd
                .spawn()
                .map_err(|e| format!("mock spawn {prog}: {e}"))?;
            let pid = child.id().ok_or("no pid")?;
            Ok((pid, child))
        }
        async fn get_state(&self, _pid: u32) -> AgentState {
            AgentState::Running
        }
        async fn get_intent(&self, _pid: u32) -> Option<String> {
            None
        }
        async fn terminate(&self, _pid: u32) -> Result<(), String> {
            Ok(())
        }
        fn capabilities(&self) -> AdapterCapabilities {
            AdapterCapabilities {
                chat_duplex: self.chat_duplex,
            }
        }
    }

    async fn make_chat_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        // Seed the agent_events schema so the aggregator / raw-capture
        // tasks can INSERT on parser emissions. Mirror the 006 migration.
        sqlx::query(
            "CREATE TABLE agent_events ( \
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                agent_id TEXT NOT NULL, \
                session_id TEXT, \
                event_type TEXT NOT NULL, \
                payload_json TEXT NOT NULL, \
                approval_request_id INTEGER, \
                sequence_number INTEGER, \
                delivery_status TEXT, \
                created_at TEXT NOT NULL DEFAULT (datetime('now')) \
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn make_registry_with_mock(
        adapter_type: &'static str,
        chat_duplex: bool,
    ) -> Arc<AgentRegistry> {
        let mut reg = AgentRegistry::new();
        reg.register_adapter(Arc::new(MockAdapter {
            adapter_type,
            chat_duplex,
        }));
        Arc::new(reg)
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn launch_agent_for_duplex_adapter_registers_live_session() {
        let pool = make_chat_pool().await;
        let registry = make_registry_with_mock("mock-duplex", true);
        let pipeline = PipelineState::new();
        let sessions = LiveSessionRegistry::new_arc();
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();

        let td = TempDir::new().unwrap();
        let cwd = td.path().to_str().unwrap().to_string();

        let info = launch_agent_inner(
            "mock-duplex".to_string(),
            cwd,
            Some("hello".into()),
            None,
            &registry,
            &pipeline,
            &pool,
            &sessions,
            9417,
            app_handle,
        )
        .await
        .expect("launch_agent_inner");

        // Duplex adapter ⇒ a LiveSession got registered (not archived).
        assert!(!sessions.is_archived(&info.id).await);
        assert!(sessions.get_stdin_tx(&info.id).await.is_some());

        // Kill the mock subprocess so the test runtime drains.
        if let Some(pid) = info.pid {
            let _ = crate::agents::launcher::terminate_process(pid).await;
        }
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn launch_agent_for_readonly_adapter_does_not_register_live_session() {
        let pool = make_chat_pool().await;
        let registry = make_registry_with_mock("mock-readonly", false);
        let pipeline = PipelineState::new();
        let sessions = LiveSessionRegistry::new_arc();
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();

        let td = TempDir::new().unwrap();
        let cwd = td.path().to_str().unwrap().to_string();

        let info = launch_agent_inner(
            "mock-readonly".to_string(),
            cwd,
            None,
            None,
            &registry,
            &pipeline,
            &pool,
            &sessions,
            9417,
            app_handle,
        )
        .await
        .expect("launch_agent_inner");

        // Read-only: no LiveSession was registered ⇒ is_archived is the
        // conservative default (true) and there's no stdin_tx.
        assert!(sessions.is_archived(&info.id).await);
        assert!(sessions.get_stdin_tx(&info.id).await.is_none());

        if let Some(pid) = info.pid {
            let _ = crate::agents::launcher::terminate_process(pid).await;
        }
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn launch_agent_honors_explicit_agent_id_from_options() {
        // D-04 relaunch path: forcing an agent_id via LaunchOptions must
        // bypass the UUID minting logic.
        let pool = make_chat_pool().await;
        let registry = make_registry_with_mock("mock-duplex", true);
        let pipeline = PipelineState::new();
        let sessions = LiveSessionRegistry::new_arc();
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();

        let td = TempDir::new().unwrap();
        let cwd = td.path().to_str().unwrap().to_string();

        let opts = LaunchOptions {
            agent_id: Some("KAGENT-FIXED".into()),
            aitc_port: Some(9417),
            ..Default::default()
        };

        let info = launch_agent_inner(
            "mock-duplex".to_string(),
            cwd,
            Some("x".into()),
            Some(opts),
            &registry,
            &pipeline,
            &pool,
            &sessions,
            9417,
            app_handle,
        )
        .await
        .unwrap();
        assert_eq!(info.id, "KAGENT-FIXED");

        if let Some(pid) = info.pid {
            let _ = crate::agents::launcher::terminate_process(pid).await;
        }
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn relaunch_preserves_agent_id_via_launch_agent_inner() {
        // End-to-end D-04 validation: first launch (fresh mint), then
        // simulate archive, then re-call launch_agent_inner with the same
        // agent_id — must re-register a LiveSession under that id.
        let pool = make_chat_pool().await;
        let registry = make_registry_with_mock("mock-duplex", true);
        let pipeline = PipelineState::new();
        let sessions = LiveSessionRegistry::new_arc();
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();

        let td = TempDir::new().unwrap();
        let cwd = td.path().to_str().unwrap().to_string();

        // First launch.
        let first = launch_agent_inner(
            "mock-duplex".to_string(),
            cwd.clone(),
            Some("initial".into()),
            None,
            &registry,
            &pipeline,
            &pool,
            &sessions,
            9417,
            app_handle.clone(),
        )
        .await
        .unwrap();
        let agent_id = first.id.clone();
        assert!(!sessions.is_archived(&agent_id).await);

        // Simulate archive (supervisor would normally do this on exit).
        sessions.mark_archived(&agent_id).await;
        assert!(sessions.is_archived(&agent_id).await);

        // Drop the stale entry — mirrors relaunch_agent_session's teardown.
        sessions.remove(&agent_id).await;

        // Relaunch under the same agent_id.
        let opts = LaunchOptions {
            agent_id: Some(agent_id.clone()),
            aitc_port: Some(9417),
            ..Default::default()
        };
        let relaunched = launch_agent_inner(
            "mock-duplex".to_string(),
            cwd,
            first.intent.clone(),
            Some(opts),
            &registry,
            &pipeline,
            &pool,
            &sessions,
            9417,
            app_handle,
        )
        .await
        .unwrap();
        assert_eq!(relaunched.id, agent_id);
        assert!(!sessions.is_archived(&agent_id).await);
        assert!(sessions.get_stdin_tx(&agent_id).await.is_some());

        if let Some(pid) = first.pid {
            let _ = crate::agents::launcher::terminate_process(pid).await;
        }
        if let Some(pid) = relaunched.pid {
            let _ = crate::agents::launcher::terminate_process(pid).await;
        }
    }
}
