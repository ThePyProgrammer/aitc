pub mod agents;
mod comms;
mod conflict;
mod db;
pub mod pipeline;
pub mod claude_resources;
mod repo_session;
pub mod system_load;
mod tray;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install a tracing subscriber so `tracing::info!`/`warn!`/`error!` calls
    // in this crate actually reach the dev console. Honour RUST_LOG when set
    // (e.g. RUST_LOG=aitc_lib=debug), defaulting to `info` otherwise. The
    // try_init() avoids panicking in test/binary contexts that may have
    // already initialized a subscriber.
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_writer(std::io::stderr)
        .try_init();

    repo_session::capture_launch_cwd();

    // Build the agent registry with built-in adapters
    let mut agent_registry = agents::AgentRegistry::new();
    agent_registry.register_adapter(Arc::new(agents::claude_code::ClaudeCodeAdapter));
    agent_registry.register_adapter(Arc::new(agents::codex::CodexAdapter));
    agent_registry.register_adapter(Arc::new(agents::opencode::OpenCodeAdapter));
    // TODO: Load GenericAdapter configs from ~/.aitc/agents/*.toml
    let agent_registry = Arc::new(agent_registry);

    let specta_builder = tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            pipeline::commands::start_watch,
            pipeline::commands::stop_watch,
            pipeline::commands::list_worktrees,
            pipeline::commands::get_tree_index,
            pipeline::commands::get_dependency_graph,
            repo_session::get_launch_cwd,
            repo_session::detect_git_root,
            repo_session::persist_last_repo,
            repo_session::get_last_repo,
            agents::commands::list_agents,
            agents::commands::list_available_agent_types,
            agents::commands::launch_agent,
            agents::commands::terminate_agent,
            agents::commands::update_agent_intent,
            agents::commands::get_agent_logs,
            agents::notifications::get_notification_prefs,
            agents::notifications::update_notification_prefs,
            conflict::commands::list_conflicts,
            conflict::commands::dismiss_conflict,
            conflict::commands::get_conflict_settings,
            conflict::commands::update_conflict_window,
            comms::commands::list_approval_requests,
            comms::commands::approve_request,
            comms::commands::deny_request,
            comms::commands::ask_more_info,
            comms::commands::approve_with_edits,
            comms::commands::send_chat_message,
            comms::commands::list_chat_messages,
            comms::commands::update_message_delivery_status,
            comms::commands::list_protected_paths,
            comms::commands::add_protected_path,
            comms::commands::remove_protected_path,
            system_load::get_system_load,
            conflict::resolution::read_conflict_files,
            conflict::resolution::apply_resolution,
            conflict::resolution::list_conflict_resolutions,
            conflict::resolution::list_session_files,
            conflict::resolution::record_session_file,
            conflict::resolution::list_sessions,
            conflict::resolution::list_approval_history,
        ])
        .typ::<pipeline::events::FileEvent>()
        .typ::<pipeline::events::FileEventBatch>()
        .typ::<pipeline::events::FileEventKind>()
        .typ::<pipeline::events::Attribution>()
        .typ::<pipeline::process_snapshot::ProcessInfo>()
        .typ::<pipeline::worktree::Worktree>()
        .typ::<pipeline::deps::DependencyEdgeDto>()
        .typ::<pipeline::deps::EdgeKind>()
        .typ::<agents::AgentInfo>()
        .typ::<agents::AgentState>()
        .typ::<agents::adapter::LaunchOptions>()
        .typ::<agents::notifications::NotificationPrefs>()
        .typ::<conflict::ConflictAlert>()
        .typ::<comms::types::ApprovalRequest>()
        .typ::<comms::types::ChatMessage>()
        .typ::<comms::types::ProtectedPath>()
        .typ::<comms::types::TreeIndexEntry>()
        .typ::<system_load::SystemLoadInfo>()
        .typ::<conflict::resolution::ConflictFileVersions>()
        .typ::<conflict::resolution::HunkResolution>()
        .typ::<conflict::resolution::ResolutionRecord>()
        .typ::<conflict::resolution::SessionRecord>()
        .typ::<conflict::resolution::SessionFileRecord>()
        .typ::<conflict::resolution::ApprovalHistoryRecord>()
        .typ::<claude_resources::events::ResourceEvent>()
        .typ::<claude_resources::events::ResourceEventBatch>()
        .typ::<claude_resources::events::Resource>()
        .typ::<claude_resources::events::ResourceId>()
        .typ::<claude_resources::events::Category>()
        .typ::<claude_resources::events::Scope>()
        .typ::<claude_resources::events::ResourceMetadata>();

    #[cfg(debug_assertions)]
    specta_builder
        .export(
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number),
            "../src/bindings.ts",
        )
        .expect("failed to export specta bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pipeline::PipelineState::new())
        .manage(agent_registry.clone())
        .manage(agents::notifications::NotificationState::new())
        .manage(conflict::ConflictState::new(5000))
        .manage(system_load::SystemLoadState::new())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            // System tray (D-13)
            tray::setup_tray(app)?;

            // SQLite database -- initialized synchronously via block_on so the pool
            // is registered as managed state before any Tauri command can fire.
            // CR-01: Previously spawned as an async task, creating a race window
            // where commands requiring Pool<Sqlite> could panic.
            let app_handle = app.handle().clone();
            let pool = tauri::async_runtime::block_on(db::init_db(&app_handle))
                .unwrap_or_else(|e| {
                    eprintln!("Failed to initialize database: {}", e);
                    app_handle.exit(1);
                    // Exit should terminate, but satisfy the type system
                    panic!("Database initialization failed: {e}");
                });
            app.manage(pool.clone());

            // Phase 8: WaiterRegistry is shared between the axum /hook
            // handler (Extension) and the Tauri comms commands (State).
            let waiters: Arc<agents::hook_waiters::WaiterRegistry> =
                agents::hook_waiters::WaiterRegistry::new_arc();
            app.manage(waiters.clone());

            // Start the self-registration + /hook server (HIST-01: needs
            // pool for ensure_open_session; Phase 8: needs waiters + app
            // handle for hook_handler).
            let registry_clone = agent_registry.clone();
            let pool_for_server = pool.clone();
            let waiters_for_server = waiters.clone();
            let app_for_server = app.handle().clone();
            let app_for_port = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match agents::self_register::start_registration_server(
                    registry_clone,
                    pool_for_server,
                    waiters_for_server,
                    app_for_server,
                    9417,
                )
                .await
                {
                    Ok(port) => {
                        tracing::info!(port, "AITC registration server started");
                        // Phase 8 D-06: write ~/.aitc/port so the sidecar
                        // can discover us without AITC_PORT env. PortFileGuard
                        // is stashed on managed state so Drop fires on exit.
                        match pipeline::port_file::write_port(port) {
                            Ok(guard) => {
                                app_for_port.manage(std::sync::Mutex::new(Some(guard)));
                            }
                            Err(e) => tracing::warn!(error = %e, "port_file write failed"),
                        }
                    }
                    Err(e) => tracing::warn!(error = %e, "Failed to start registration server"),
                }
            });

            // Initialize BackupManager for conflict resolution file snapshots
            let app_dir = app
                .handle()
                .path()
                .app_data_dir()
                .map_err(|e| format!("failed to get app data dir for backups: {e}"))?;
            let backup_manager = conflict::backup::BackupManager::new(app_dir);
            app.manage(backup_manager);

            // Splash screen display + transition to main window
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait 2 seconds for branded splash display (D-14)
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;

                // Close splash, show main
                if let Some(splash) = app_handle.get_webview_window("splashscreen") {
                    let _ = splash.close();
                }
                if let Some(main) = app_handle.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            });

            // Close-to-tray behavior (D-12): intercept window close
            let Some(window) = app.get_webview_window("main") else {
                eprintln!("main window not found -- check tauri.conf.json window labels");
                return Err("main window not found".into());
            };
            window.on_window_event({
                let window = window.clone();
                move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Terminate every AITC-launched agent before the process exits.
            // Self-registered / passively-scanned agents (launched_by_aitc=false)
            // are left alone -- those belong to the user, not to us.
            //
            // RunEvent::Exit fires after the main loop has stopped and all
            // windows are down, so we're safe to block the thread briefly.
            // RunEvent::ExitRequested fires before that (e.g. on Cmd+Q) but
            // we already prevent close-to-tray via the window handler above,
            // so the only paths that reach Exit are actual quits (menu Quit,
            // app.exit(), SIGTERM from the dev-server hot reload).
            if matches!(event, tauri::RunEvent::Exit) {
                terminate_launched_agents_on_exit(app_handle);
            }
        });
}

/// Walk the registry and terminate every agent we launched. Called from the
/// RunEvent::Exit handler so spawned claude/codex/opencode processes don't
/// get orphaned to init when AITC quits (a particular problem during dev
/// hot-reload on Linux).
fn terminate_launched_agents_on_exit(app_handle: &tauri::AppHandle) {
    let Some(registry_state) = app_handle.try_state::<Arc<agents::AgentRegistry>>() else {
        return;
    };
    let registry = registry_state.inner().clone();

    tauri::async_runtime::block_on(async move {
        // Snapshot the launched-by-aitc subset under the read lock, then drop
        // it before calling terminate_process so the terminate path can
        // re-enter the registry freely if it ever needs to.
        let launched: Vec<(String, u32)> = {
            let agents = registry.agents_read().await;
            agents
                .iter()
                .filter_map(|(id, managed)| {
                    if managed.launched_by_aitc {
                        managed.info.pid.map(|pid| (id.clone(), pid))
                    } else {
                        None
                    }
                })
                .collect()
        };

        if launched.is_empty() {
            return;
        }
        tracing::info!(
            count = launched.len(),
            "terminating AITC-launched agents on shutdown"
        );
        for (id, pid) in launched {
            if let Err(e) = agents::launcher::terminate_process(pid).await {
                tracing::warn!(
                    agent_id = %id,
                    pid,
                    error = %e,
                    "shutdown terminate failed"
                );
            }
        }
    });
}
