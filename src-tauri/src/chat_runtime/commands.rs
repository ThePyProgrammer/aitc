//! Phase 10: Tauri command surface for the CHAT tab.
//!
//! Six commands drive the chat UI; all are registered in lib.rs via
//! `collect_commands!` so `tauri-specta` regenerates matching TS bindings.
//!
//! Plan 02: real bodies. Inner `*_inner` helpers take plain refs so unit
//! tests can exercise them without Tauri State wrappers.

#![allow(dead_code)]

use std::sync::Arc;
use tauri::Emitter;

use super::session_registry::LiveSessionRegistry;
use super::types::{AgentEvent, ChatChannel, OutboundFrame, MAX_CHAT_MESSAGE_BYTES};
use crate::agents::registry::AgentRegistry;

/// Capability lookup for outbound chat. Plan 02 uses a simple rule: only
/// `claude-code` supports duplex; everything else is read-only (D-02).
/// Plan 04 may widen this when the adapter trait grows a capability API.
pub(crate) fn adapter_chat_duplex(adapter_type: &str) -> bool {
    matches!(adapter_type, "claude-code")
}

#[tauri::command]
#[specta::specta]
pub async fn send_chat_message_to_agent(
    agent_id: String,
    content: String,
    pool: tauri::State<'_, sqlx::SqlitePool>,
    sessions: tauri::State<'_, Arc<LiveSessionRegistry>>,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<AgentEvent, String> {
    send_chat_message_to_agent_inner(
        &agent_id,
        &content,
        pool.inner(),
        sessions.inner(),
        registry.inner(),
        &app_handle,
    )
    .await
}

pub(crate) async fn send_chat_message_to_agent_inner<R: tauri::Runtime>(
    agent_id: &str,
    content: &str,
    pool: &sqlx::SqlitePool,
    sessions: &Arc<LiveSessionRegistry>,
    registry: &Arc<AgentRegistry>,
    app_handle: &tauri::AppHandle<R>,
) -> Result<AgentEvent, String> {
    // T-10-09: size cap BEFORE any DB write.
    if content.len() > MAX_CHAT_MESSAGE_BYTES {
        return Err("message exceeds 256 KiB limit".into());
    }

    let agent = registry
        .get_agent(agent_id)
        .await
        .ok_or_else(|| format!("unknown agent: {agent_id}"))?;

    let duplex = adapter_chat_duplex(&agent.agent_type);
    let payload = serde_json::json!({ "content": content });

    if !duplex {
        // Read-only adapter (Codex / OpenCode / Generic): insert unsupported
        // row so the UI shows a red X next to the user message. No stdin
        // write, no auto-resume.
        let row = crate::db::events::insert_agent_event(
            pool,
            agent_id,
            None,
            "user_text",
            &payload,
            None,
            None,
            Some("unsupported"),
        )
        .await?;
        if let Err(e) = app_handle.emit("agent-event-appended", &row) {
            tracing::debug!(err = %e, "agent-event-appended emit failed (readonly)");
        }
        return Ok(row);
    }

    let session_id = sessions.session_id_for(agent_id).await;
    let stdin_tx = sessions.get_stdin_tx(agent_id).await;

    match stdin_tx {
        Some(tx) => {
            let row = crate::db::events::insert_agent_event(
                pool,
                agent_id,
                session_id.as_deref(),
                "user_text",
                &payload,
                None,
                None,
                Some("queued"),
            )
            .await?;
            if let Err(e) = app_handle.emit("agent-event-appended", &row) {
                tracing::debug!(err = %e, "agent-event-appended emit failed (duplex)");
            }
            let frame = OutboundFrame {
                event_id: row.id,
                content: content.to_string(),
            };
            if let Err(e) = tx.send(frame).await {
                tracing::warn!(
                    agent_id = %agent_id,
                    err = %e,
                    "outbound enqueue failed — writer task absent"
                );
                let _ = crate::db::events::update_event_delivery_status(
                    pool,
                    row.id,
                    "unsupported",
                )
                .await;
            }
            Ok(row)
        }
        None => {
            // Archived or never-registered session → auto_resume.
            let cwd = agent
                .cwd
                .clone()
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            crate::chat_runtime::auto_resume::auto_resume_send(
                agent_id,
                content,
                session_id.as_deref(),
                &cwd,
                pool,
                app_handle,
            )
            .await
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn list_agent_events(
    agent_id: String,
    before_id: Option<i64>,
    limit: Option<i64>,
    pool: tauri::State<'_, sqlx::SqlitePool>,
) -> Result<Vec<AgentEvent>, String> {
    crate::db::events::list_events_for_agent(
        pool.inner(),
        &agent_id,
        before_id,
        limit.unwrap_or(50),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_chat_channels(
    pool: tauri::State<'_, sqlx::SqlitePool>,
    sessions: tauri::State<'_, Arc<LiveSessionRegistry>>,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<ChatChannel>, String> {
    list_chat_channels_inner(pool.inner(), sessions.inner(), registry.inner()).await
}

pub(crate) async fn list_chat_channels_inner(
    pool: &sqlx::SqlitePool,
    sessions: &Arc<LiveSessionRegistry>,
    registry: &Arc<AgentRegistry>,
) -> Result<Vec<ChatChannel>, String> {
    let agents = registry.all_agents().await;
    let mut out = Vec::with_capacity(agents.len());
    for info in agents {
        let adapter_type = info.agent_type.clone();
        let status = format!("{:?}", info.state).to_lowercase();
        let archived = sessions.is_archived(&info.id).await;
        let chat_duplex = adapter_chat_duplex(&adapter_type);
        let current_session_id = sessions.session_id_for(&info.id).await;

        // last_event: newest row for this agent (if any).
        let last_row = sqlx::query(
            "SELECT id, agent_id, session_id, event_type, payload_json, approval_request_id, \
                    sequence_number, delivery_status, created_at \
             FROM agent_events WHERE agent_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(&info.id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("last_event lookup: {e}"))?;
        let last_event = match last_row {
            Some(row) => Some(crate::db::events::map_agent_event_row(&row)?),
            None => None,
        };

        let last_read = sessions.last_read_for(&info.id).await;
        let unread_row: Option<(i64,)> = sqlx::query_as(
            "SELECT COUNT(*) FROM agent_events WHERE agent_id = ? AND created_at > ?",
        )
        .bind(&info.id)
        .bind(last_read.unwrap_or_else(|| "1970-01-01".into()))
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("unread_count: {e}"))?;
        let unread_count = unread_row.map(|t| t.0).unwrap_or(0);

        out.push(ChatChannel {
            agent_id: info.id,
            adapter_type,
            status,
            archived,
            chat_duplex,
            last_event,
            unread_count,
            current_session_id,
        });
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn clear_agent_thread(
    agent_id: String,
    pool: tauri::State<'_, sqlx::SqlitePool>,
    app_handle: tauri::AppHandle,
) -> Result<u64, String> {
    let n = crate::db::events::delete_events_for_agent(pool.inner(), &agent_id).await?;
    if let Err(e) = app_handle.emit("agent-thread-cleared", &agent_id) {
        tracing::debug!(err = %e, "agent-thread-cleared emit failed");
    }
    Ok(n)
}

#[tauri::command]
#[specta::specta]
pub async fn mark_agent_events_read(
    agent_id: String,
    sessions: tauri::State<'_, Arc<LiveSessionRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    sessions.mark_read(&agent_id).await;
    if let Err(e) = app_handle.emit("agent-events-marked-read", &agent_id) {
        tracing::debug!(err = %e, "agent-events-marked-read emit failed");
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn relaunch_agent_session(
    agent_id: String,
    pool: tauri::State<'_, sqlx::SqlitePool>,
    sessions: tauri::State<'_, Arc<LiveSessionRegistry>>,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
    pipeline: tauri::State<'_, crate::pipeline::pipeline_state::PipelineState>,
    aitc_port: tauri::State<'_, crate::agents::AitcPort>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // D-04: reactivate an archived session under the same agent_id so the
    // existing agent_events transcript stays attached. Pull the prior
    // adapter_type + cwd + intent from the registry, remove the stale
    // LiveSession entry, then delegate to launch_agent_inner which will
    // (a) generate a fresh subprocess with the SAME agent_id (forced via
    // LaunchOptions.agent_id) and (b) register a new LiveSession.
    let prior = registry
        .get_agent(&agent_id)
        .await
        .ok_or_else(|| format!("unknown agent: {agent_id}"))?;
    let adapter_type = prior.agent_type.clone();
    let cwd = prior
        .cwd
        .clone()
        .ok_or_else(|| "agent has no cwd (cannot relaunch)".to_string())?;
    let intent = prior.intent.clone();
    let cwd_str = cwd
        .to_str()
        .ok_or_else(|| "agent cwd is not valid UTF-8".to_string())?
        .to_string();

    // Drop the stale LiveSession entry first — supervisor already flipped
    // archived=true, but this frees the mpsc slot so the writer task that
    // was draining the prior receiver can exit cleanly.
    sessions.remove(&agent_id).await;

    let opts = crate::agents::adapter::LaunchOptions {
        agent_id: Some(agent_id.clone()),
        aitc_port: Some(aitc_port.inner().0),
        ..Default::default()
    };

    crate::agents::commands::launch_agent_inner(
        adapter_type,
        cwd_str,
        intent,
        Some(opts),
        registry.inner(),
        pipeline.inner(),
        pool.inner(),
        sessions.inner(),
        aitc_port.inner().0,
        app_handle.clone(),
    )
    .await?;

    if let Err(e) = app_handle.emit("agent-session-resumed", &agent_id) {
        tracing::debug!(
            agent_id = %agent_id,
            err = %e,
            "agent-session-resumed emit failed"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::adapter::{
        AgentAdapter, AgentInfo, AgentState, LaunchOptions,
    };
    use crate::chat_runtime::session_registry::LiveSession;
    use crate::db::events::tests::make_pool_with_chat_schema;
    use async_trait::async_trait;
    use std::path::PathBuf;
    use tokio::sync::mpsc;

    struct DummyAdapter {
        name: &'static str,
    }
    #[async_trait]
    impl AgentAdapter for DummyAdapter {
        fn adapter_type(&self) -> &str {
            self.name
        }
        fn process_patterns(&self) -> Vec<String> {
            vec![self.name.to_string()]
        }
        fn launch_binary(&self) -> String {
            self.name.to_string()
        }
        async fn launch(
            &self,
            _cwd: PathBuf,
            _intent: Option<String>,
            _options: LaunchOptions,
        ) -> Result<(u32, tokio::process::Child), String> {
            Err("dummy".into())
        }
        async fn get_state(&self, _pid: u32) -> AgentState {
            AgentState::Running
        }
        async fn get_intent(&self, _pid: u32) -> Option<String> {
            None
        }
        async fn terminate(&self, _pid: u32) -> Result<(), String> {
            Err("dummy".into())
        }
    }

    async fn seed_agent(registry: &Arc<AgentRegistry>, id: &str, adapter_type: &'static str) {
        let info = AgentInfo {
            id: id.to_string(),
            agent_type: adapter_type.to_string(),
            protocol: "test".into(),
            state: AgentState::Running,
            pid: Some(1234),
            cwd: Some(std::env::temp_dir()),
            intent: None,
        };
        registry
            .upsert_agent(
                id.to_string(),
                info,
                Arc::new(DummyAdapter { name: adapter_type }),
                true,
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn send_oversize_message_rejected() {
        let pool = make_pool_with_chat_schema().await;
        let sessions: Arc<LiveSessionRegistry> = LiveSessionRegistry::new_arc();
        let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::new());
        seed_agent(&registry, "A-1", "claude-code").await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let huge = "x".repeat(MAX_CHAT_MESSAGE_BYTES + 1);
        let result = send_chat_message_to_agent_inner(
            "A-1",
            &huge,
            &pool,
            &sessions,
            &registry,
            &app_handle,
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("256"));
        // And zero rows were written.
        let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn send_to_unknown_agent_returns_err() {
        let pool = make_pool_with_chat_schema().await;
        let sessions: Arc<LiveSessionRegistry> = LiveSessionRegistry::new_arc();
        let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::new());
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let result = send_chat_message_to_agent_inner(
            "NEVER",
            "hi",
            &pool,
            &sessions,
            &registry,
            &app_handle,
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown agent"));
    }

    #[tokio::test]
    async fn send_to_readonly_adapter_inserts_unsupported_row() {
        let pool = make_pool_with_chat_schema().await;
        let sessions: Arc<LiveSessionRegistry> = LiveSessionRegistry::new_arc();
        let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::new());
        seed_agent(&registry, "A-1", "codex").await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let row = send_chat_message_to_agent_inner(
            "A-1",
            "hi",
            &pool,
            &sessions,
            &registry,
            &app_handle,
        )
        .await
        .unwrap();
        assert_eq!(row.event_type, "user_text");
        assert_eq!(row.delivery_status.as_deref(), Some("unsupported"));
    }

    #[tokio::test]
    async fn send_to_duplex_adapter_with_live_session_inserts_queued_and_enqueues_frame() {
        let pool = make_pool_with_chat_schema().await;
        let sessions: Arc<LiveSessionRegistry> = LiveSessionRegistry::new_arc();
        let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::new());
        seed_agent(&registry, "A-1", "claude-code").await;

        let (frame_tx, mut frame_rx) = mpsc::channel::<OutboundFrame>(8);
        sessions
            .register(LiveSession {
                agent_id: "A-1".into(),
                session_id: Some("0d836c4f-8546-4aeb-a994-6fb94ba800b7".into()),
                stdin_tx: frame_tx,
                archived: false,
                last_read_at: None,
            })
            .await;

        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let row = send_chat_message_to_agent_inner(
            "A-1",
            "hello",
            &pool,
            &sessions,
            &registry,
            &app_handle,
        )
        .await
        .unwrap();
        assert_eq!(row.event_type, "user_text");
        assert_eq!(row.delivery_status.as_deref(), Some("queued"));
        // Frame reached the writer channel with the same event_id.
        let frame = tokio::time::timeout(std::time::Duration::from_secs(1), frame_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(frame.event_id, row.id);
        assert_eq!(frame.content, "hello");
    }

    #[tokio::test]
    async fn send_to_archived_duplex_adapter_falls_through_to_auto_resume() {
        let pool = make_pool_with_chat_schema().await;
        let sessions: Arc<LiveSessionRegistry> = LiveSessionRegistry::new_arc();
        let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::new());
        seed_agent(&registry, "A-1", "claude-code").await;

        // Don't register a live session AT ALL — is_archived returns true
        // conservatively, get_stdin_tx returns None, so we fall through.
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let result = send_chat_message_to_agent_inner(
            "A-1",
            "hi",
            &pool,
            &sessions,
            &registry,
            &app_handle,
        )
        .await;
        // auto_resume_send with session_id=None returns the specific
        // "no session_id available" error — this confirms the fallthrough.
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no session_id"));
    }

    #[tokio::test]
    async fn list_agent_events_paginates_correctly() {
        let pool = make_pool_with_chat_schema().await;
        for _ in 0..4 {
            crate::db::events::insert_agent_event(
                &pool,
                "A-1",
                Some("s"),
                "assistant_text",
                &serde_json::json!({"content":"x"}),
                None,
                None,
                None,
            )
            .await
            .unwrap();
        }
        let page1 = crate::db::events::list_events_for_agent(&pool, "A-1", None, 2)
            .await
            .unwrap();
        assert_eq!(page1.len(), 2);
        let cursor = page1.last().unwrap().id;
        let page2 = crate::db::events::list_events_for_agent(&pool, "A-1", Some(cursor), 2)
            .await
            .unwrap();
        assert_eq!(page2.len(), 2);
        assert!(page2[0].id < cursor);
    }

    #[tokio::test]
    async fn list_chat_channels_joins_registry_sessions_and_events() {
        let pool = make_pool_with_chat_schema().await;
        let sessions: Arc<LiveSessionRegistry> = LiveSessionRegistry::new_arc();
        let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::new());
        seed_agent(&registry, "A-claude", "claude-code").await;
        seed_agent(&registry, "A-codex", "codex").await;

        // Register a live session for A-claude so archived=false.
        let (tx, _rx) = mpsc::channel::<OutboundFrame>(4);
        sessions
            .register(LiveSession {
                agent_id: "A-claude".into(),
                session_id: None,
                stdin_tx: tx,
                archived: false,
                last_read_at: None,
            })
            .await;

        // Insert one event for A-claude.
        crate::db::events::insert_agent_event(
            &pool,
            "A-claude",
            None,
            "assistant_text",
            &serde_json::json!({"content":"hey"}),
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let channels = list_chat_channels_inner(&pool, &sessions, &registry)
            .await
            .unwrap();
        assert_eq!(channels.len(), 2);
        let c_claude = channels.iter().find(|c| c.agent_id == "A-claude").unwrap();
        let c_codex = channels.iter().find(|c| c.agent_id == "A-codex").unwrap();
        assert_eq!(c_claude.adapter_type, "claude-code");
        assert!(c_claude.chat_duplex);
        assert!(!c_claude.archived);
        assert!(c_claude.last_event.is_some());
        assert_eq!(c_claude.unread_count, 1);
        assert_eq!(c_codex.adapter_type, "codex");
        assert!(!c_codex.chat_duplex);
        assert!(c_codex.archived); // no session registered ⇒ conservative
        assert!(c_codex.last_event.is_none());
        assert_eq!(c_codex.unread_count, 0);
    }

    #[tokio::test]
    async fn clear_agent_thread_deletes_all_and_returns_count() {
        let pool = make_pool_with_chat_schema().await;
        for _ in 0..3 {
            crate::db::events::insert_agent_event(
                &pool,
                "A-1",
                None,
                "system_note",
                &serde_json::json!({"text":"x"}),
                None,
                None,
                None,
            )
            .await
            .unwrap();
        }
        // Inline the body of clear_agent_thread so we don't need Tauri State.
        let n = crate::db::events::delete_events_for_agent(&pool, "A-1")
            .await
            .unwrap();
        assert_eq!(n, 3);
        let remaining = crate::db::events::list_events_for_agent(&pool, "A-1", None, 50)
            .await
            .unwrap();
        assert!(remaining.is_empty());
    }

    #[tokio::test]
    async fn mark_read_stamps_last_read_and_resets_unread() {
        let pool = make_pool_with_chat_schema().await;
        let sessions: Arc<LiveSessionRegistry> = LiveSessionRegistry::new_arc();
        let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::new());
        seed_agent(&registry, "A-1", "claude-code").await;

        let (tx, _rx) = mpsc::channel::<OutboundFrame>(4);
        sessions
            .register(LiveSession {
                agent_id: "A-1".into(),
                session_id: None,
                stdin_tx: tx,
                archived: false,
                last_read_at: None,
            })
            .await;

        crate::db::events::insert_agent_event(
            &pool,
            "A-1",
            None,
            "assistant_text",
            &serde_json::json!({"content":"a"}),
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let before = list_chat_channels_inner(&pool, &sessions, &registry)
            .await
            .unwrap();
        let c_before = before.iter().find(|c| c.agent_id == "A-1").unwrap();
        assert_eq!(c_before.unread_count, 1);

        sessions.mark_read("A-1").await;

        let after = list_chat_channels_inner(&pool, &sessions, &registry)
            .await
            .unwrap();
        let c_after = after.iter().find(|c| c.agent_id == "A-1").unwrap();
        assert_eq!(c_after.unread_count, 0);
    }

    // `relaunch_agent_session` test is intentionally omitted here: its body
    // requires `tauri::State<'_, _>` for SqlitePool + LiveSessionRegistry +
    // AgentRegistry + PipelineState + AitcPort simultaneously, which can't
    // be fabricated outside a running Tauri runtime. The underlying
    // `launch_agent_inner` has integration coverage in agents::commands::tests.
}
