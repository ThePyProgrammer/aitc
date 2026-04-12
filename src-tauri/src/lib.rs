mod agents;
mod comms;
mod conflict;
mod db;
mod pipeline;
pub mod system_load;
mod tray;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            agents::commands::list_agents,
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
        .typ::<agents::AgentInfo>()
        .typ::<agents::AgentState>()
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
        .typ::<conflict::resolution::ApprovalHistoryRecord>();

    #[cfg(debug_assertions)]
    specta_builder
        .export(
            specta_typescript::Typescript::default(),
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

            // Start the self-registration server
            let registry_clone = agent_registry.clone();
            tauri::async_runtime::spawn(async move {
                match agents::self_register::start_registration_server(registry_clone, 9417).await {
                    Ok(port) => tracing::info!(port, "AITC registration server started"),
                    Err(e) => tracing::warn!(error = %e, "Failed to start registration server"),
                }
            });

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
            app.manage(pool);

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
