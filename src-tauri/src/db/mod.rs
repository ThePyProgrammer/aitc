use sqlx::sqlite::SqlitePoolOptions;
use tauri::Manager;

pub async fn init_db(
    app: &tauri::AppHandle,
) -> Result<sqlx::SqlitePool, Box<dyn std::error::Error + Send + Sync>> {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

    let db_path = app_dir.join("aitc.db");
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await?;

    // Run embedded migrations
    sqlx::migrate!("./src/db/migrations").run(&pool).await?;

    Ok(pool)
}
