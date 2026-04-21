pub mod events;
pub mod session;

use sqlx::sqlite::SqlitePoolOptions;
use tauri::Manager;

pub async fn init_db(
    app: &tauri::AppHandle,
) -> Result<sqlx::SqlitePool, Box<dyn std::error::Error + Send + Sync>> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("failed to create app data dir: {e}"))?;

    let db_path = app_dir.join("aitc.db");

    // WR-03: Enable foreign key enforcement per connection. SQLite requires
    // this pragma on each connection or `session_files.session_id REFERENCES
    // agent_sessions(id)` is silently ignored and orphan rows corrupt the
    // file_count aggregate.
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // Run embedded migrations
    sqlx::migrate!("./src/db/migrations").run(&pool).await?;

    Ok(pool)
}
