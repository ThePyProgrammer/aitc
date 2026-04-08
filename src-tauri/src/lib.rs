mod db;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // System tray (D-13)
            tray::setup_tray(app)?;

            // SQLite database
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Initialize DB; capture success/failure before any .await
                let db_ok = match db::init_db(&app_handle).await {
                    Ok(pool) => {
                        app_handle.manage(pool);
                        true
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize database: {}", e);
                        false
                    }
                };

                if db_ok {
                    // Wait 2 seconds for branded splash display (D-14)
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }

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
            let window = app.get_webview_window("main").unwrap();
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
