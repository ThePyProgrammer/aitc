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

    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // Run embedded migrations
    sqlx::migrate!("./src/db/migrations").run(&pool).await?;

    Ok(pool)
}
