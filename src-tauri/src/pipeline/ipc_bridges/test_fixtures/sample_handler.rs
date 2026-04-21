// Phase 12 Wave 0 fixture — 3 handler shapes:
//   ping       = `pub fn`        — no channel arg, matches binding 1 (V-12-05, V-12-06)
//   start_watch= `pub async fn`  + Channel<T>  — matches binding 2 (V-12-03, V-12-06)
//   (dangling_command intentionally absent — V-12-12 missing-handler path)

#[tauri::command]
#[specta::specta]
pub fn ping() -> Result<(), String> { Ok(()) }

#[tauri::command]
#[specta::specta]
pub async fn start_watch(
    repo_root: String,
    channel: tauri::ipc::Channel<FileEventBatch>,
) -> Result<Vec<Worktree>, String> {
    Ok(Vec::new())
}

// Extra `async fn` variant (no `pub`) for V-12-06 coverage.
#[tauri::command]
async fn internal_helper() -> Result<(), String> { Ok(()) }
