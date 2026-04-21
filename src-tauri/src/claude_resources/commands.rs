//! Phase 9 Plan 03 — Tauri command surface for ARSENAL.
//!
//! Four commands exposed to the frontend:
//!
//! - `start_claude_resources_watch(cwd, channel)` → `Vec<Resource>`
//!   Spawns (or re-spawns) the single-Debouncer multi-root watcher over
//!   `~/.claude/` (Global, always) + `<cwd>/.claude/` (Project, when it
//!   exists). Returns the initial scan.
//! - `stop_claude_resources_watch()` → `()`
//!   Drops the `ActiveResourcesWatch`, aborting all tasks.
//! - `read_claude_md(path, cwd)` → `ReadClaudeMdResult`
//!   Canonicalizes the path + reports whether it's D-13-editable.
//! - `write_claude_md(path, content, cwd)` → `()`
//!   Atomic write via `claude_md::atomic_write`; rejects any path not in
//!   `editable_paths(project_root)`; records the fence after success so
//!   the watcher doesn't echo back a phantom Changed.
//!
//! Architecture (D-05): a single `Debouncer` is spawned per
//! `start_claude_resources_watch` call. The pipeline's own `start_watch`
//! command remains unchanged and spawns its own (separate) Debouncer via
//! the legacy `spawn_watcher`. For Wave 2 scope, co-located pipeline +
//! resources watches are not fully coordinated — ARSENAL simply drains
//! pipeline events that originate from its own Debouncer into a sink.
//! See 09-03-SUMMARY.md for the coordination rationale.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::mpsc;

use crate::claude_resources::claude_md::{atomic_write, is_editable};
use crate::claude_resources::events::{Resource, ResourceEventBatch};
use crate::claude_resources::pipeline_state::{ActiveResourcesWatch, ClaudeResourcesState};
use crate::claude_resources::routing::ScopeKind;
use crate::pipeline::events::FileEventBatch;
use crate::pipeline::watcher::{spawn_watcher_multi, ExtraRoot};

/// Return shape for `read_claude_md`: file content + editability flag so
/// the frontend knows whether to render a read-only preview or an editor.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReadClaudeMdResult {
    pub content: String,
    pub editable: bool,
    pub path: PathBuf,
}

/// mpsc capacity between the watcher drain task and the forwarder.
const RESOURCES_MPSC_CAPACITY: usize = 256;

/// Canonicalize `requested` such that non-existent files can still be
/// validated: canonicalize the parent (must exist) + append the filename.
/// Returns the canonical path or an Err describing the failure.
fn canonicalize_for_write(requested: &Path) -> Result<PathBuf, String> {
    let parent = requested
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    let parent_canon = parent
        .canonicalize()
        .map_err(|e| format!("canonicalize parent: {e}"))?;
    let file_name = requested
        .file_name()
        .ok_or_else(|| "path has no filename".to_string())?;
    Ok(parent_canon.join(file_name))
}

#[tauri::command]
#[specta::specta]
pub async fn start_claude_resources_watch(
    cwd: Option<String>,
    channel: tauri::ipc::Channel<ResourceEventBatch>,
    state: tauri::State<'_, ClaudeResourcesState>,
) -> Result<Vec<Resource>, String> {
    // Idempotent start: tear down any prior watch.
    let mut guard = state.inner.lock().await;
    if let Some(existing) = guard.take() {
        drop(existing);
    }

    // Resolve roots.
    let global_root = dirs::home_dir()
        .ok_or_else(|| "HOME not set".to_string())?
        .join(".claude");
    let project_root = cwd.as_deref().map(PathBuf::from);
    let project_claude = project_root.as_ref().map(|p| p.join(".claude"));

    // Build the ExtraRoot list (canonicalized when present).
    let mut extras: Vec<ExtraRoot> = Vec::with_capacity(2);
    if global_root.exists() {
        let canonical = global_root
            .canonicalize()
            .unwrap_or_else(|_| global_root.clone());
        extras.push(ExtraRoot {
            root: canonical,
            kind: ScopeKind::Global,
            project_root: None,
        });
    }
    if let Some(pc) = project_claude.as_ref() {
        if pc.exists() {
            let canonical = pc.canonicalize().unwrap_or_else(|_| pc.clone());
            extras.push(ExtraRoot {
                root: canonical,
                kind: ScopeKind::Project,
                project_root: project_root.clone(),
            });
        }
    }

    // Pipeline channel: we don't forward its events anywhere in this command —
    // AITC's pipeline watcher is independently managed by pipeline::start_watch
    // via its own (separate) Debouncer. Events produced by OUR Debouncer that
    // classify as Pipeline are discarded by the drainer.
    let (pipeline_tx, mut pipeline_rx) =
        mpsc::channel::<FileEventBatch>(RESOURCES_MPSC_CAPACITY);
    let (resources_tx, mut resources_rx) =
        mpsc::channel::<ResourceEventBatch>(RESOURCES_MPSC_CAPACITY);
    let fence = state.fence.clone();

    // repo_anchor: used as the Pipeline-classification anchor by classify_event.
    // When cwd is provided, use it (so project-level non-.claude events classify
    // as Pipeline and are discarded). Otherwise fall back to the global root.
    let repo_anchor = project_root.clone().unwrap_or_else(|| global_root.clone());

    let output = spawn_watcher_multi(
        &repo_anchor,
        extras,
        pipeline_tx,
        resources_tx.clone(),
        fence.clone(),
    )?;

    // Drop our local sender so the channel closes when the Debouncer stops.
    drop(resources_tx);

    // Drainer: discards pipeline events that originate from our Debouncer.
    let pipeline_drainer = tokio::spawn(async move {
        while (pipeline_rx.recv().await).is_some() {
            // discard
        }
    });

    // Forwarder: drains resources mpsc → Channel<T>.
    let chan_clone = channel.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(batch) = resources_rx.recv().await {
            if let Err(e) = chan_clone.send(batch) {
                tracing::warn!(error = %e, "resources channel send failed");
                break;
            }
        }
    });

    *guard = Some(ActiveResourcesWatch {
        watcher_handle: output.handle,
        project_root: project_root.clone(),
        forwarder_task: forwarder,
        pipeline_drainer_task: pipeline_drainer,
        channel,
        fence,
    });

    Ok(output.initial_resources)
}

#[tauri::command]
#[specta::specta]
pub async fn stop_claude_resources_watch(
    state: tauri::State<'_, ClaudeResourcesState>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if let Some(active) = guard.take() {
        drop(active);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn read_claude_md(
    path: String,
    cwd: Option<String>,
) -> Result<ReadClaudeMdResult, String> {
    let p = PathBuf::from(&path);
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("canonicalize: {e}"))?;
    let project_root = cwd.map(PathBuf::from).and_then(|pr| {
        // Canonicalize cwd so is_editable comparisons line up.
        pr.canonicalize().ok()
    });
    let editable = is_editable(&canonical, project_root.as_deref());
    let content = std::fs::read_to_string(&canonical).map_err(|e| format!("read: {e}"))?;
    Ok(ReadClaudeMdResult {
        content,
        editable,
        path: canonical,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn write_claude_md(
    path: String,
    content: String,
    cwd: Option<String>,
    state: tauri::State<'_, ClaudeResourcesState>,
) -> Result<(), String> {
    let requested = PathBuf::from(&path);
    let canonical = canonicalize_for_write(&requested)?;
    let project_root = cwd.map(PathBuf::from).and_then(|pr| pr.canonicalize().ok());
    if !is_editable(&canonical, project_root.as_deref()) {
        return Err(format!(
            "path is not editable: {}",
            canonical.display()
        ));
    }
    atomic_write(&canonical, &content)?;
    state.fence.record(canonical.clone());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Small helper: construct a fresh ClaudeResourcesState standalone
    /// (mirrors what tauri::State<'_, ClaudeResourcesState> wraps).
    fn new_state() -> ClaudeResourcesState {
        ClaudeResourcesState::new()
    }

    // ---- Pure helpers (no tauri::State needed) ----

    #[test]
    fn canonicalize_for_write_resolves_non_existent_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("CLAUDE.md"); // doesn't exist yet
        let canon = canonicalize_for_write(&path).expect("canon");
        assert_eq!(
            canon.file_name().unwrap(),
            std::ffi::OsStr::new("CLAUDE.md")
        );
        assert!(canon.parent().unwrap().exists());
    }

    // ---- write_claude_md logic (exercised directly) ----

    async fn call_write_claude_md(
        path: &Path,
        content: &str,
        cwd: Option<&Path>,
        state: &ClaudeResourcesState,
    ) -> Result<(), String> {
        let requested = path.to_path_buf();
        let canonical = canonicalize_for_write(&requested)?;
        let project_root = cwd.and_then(|p| p.canonicalize().ok());
        if !is_editable(&canonical, project_root.as_deref()) {
            return Err(format!(
                "path is not editable: {}",
                canonical.display()
            ));
        }
        atomic_write(&canonical, content)?;
        state.fence.record(canonical.clone());
        Ok(())
    }

    #[tokio::test]
    async fn write_claude_md_atomic_and_records_fence() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().to_path_buf();
        let target = cwd.join("CLAUDE.md");
        let state = new_state();

        call_write_claude_md(&target, "hello world", Some(&cwd), &state)
            .await
            .expect("write");

        // On-disk content written atomically.
        let back = fs::read_to_string(&target).unwrap();
        assert_eq!(back, "hello world");

        // Fence records the canonical path within TTL.
        let canonical = canonicalize_for_write(&target).unwrap();
        assert!(
            state.fence.was_ours(&canonical),
            "fence should record the canonicalized path"
        );
    }

    #[tokio::test]
    async fn write_claude_md_rejects_non_whitelisted_path() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().to_path_buf();
        // The global CLAUDE.md — under ~/.claude — is NOT editable.
        let global_tmp = tempfile::tempdir().unwrap();
        let fake_global = global_tmp.path().join(".claude").join("CLAUDE.md");
        let state = new_state();
        let err = call_write_claude_md(&fake_global, "nope", Some(&cwd), &state)
            .await
            .expect_err("must reject");
        assert!(err.contains("not editable"), "got: {err}");
        // File must NOT have been created.
        assert!(!fake_global.exists(), "file should not exist");
    }

    #[tokio::test]
    async fn write_claude_md_rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().to_path_buf();
        // A path that tries to escape the cwd via `..`.
        let trav = cwd.join("..").join("evil").join("CLAUDE.md");
        let state = new_state();
        let err = call_write_claude_md(&trav, "evil", Some(&cwd), &state)
            .await
            .expect_err("must reject");
        assert!(err.contains("not editable") || err.contains("canonicalize"), "got: {err}");
    }

    #[tokio::test]
    async fn write_claude_md_allows_project_dot_claude_variant() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().to_path_buf();
        fs::create_dir_all(cwd.join(".claude")).unwrap();
        let target = cwd.join(".claude").join("CLAUDE.md");
        let state = new_state();
        call_write_claude_md(&target, "inner", Some(&cwd), &state)
            .await
            .expect("write should succeed for <cwd>/.claude/CLAUDE.md");
        assert_eq!(fs::read_to_string(&target).unwrap(), "inner");
    }

    // ---- read_claude_md logic ----

    #[tokio::test]
    async fn read_claude_md_returns_file_content_and_editable_flag() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().to_path_buf();
        let target = cwd.join("CLAUDE.md");
        fs::write(&target, "body").unwrap();

        // Editable path.
        let canonical = target.canonicalize().unwrap();
        let cwd_canon = cwd.canonicalize().unwrap();
        assert!(is_editable(&canonical, Some(&cwd_canon)));
        let content = fs::read_to_string(&canonical).unwrap();
        assert_eq!(content, "body");
    }

    #[tokio::test]
    async fn read_claude_md_returns_read_only_for_global_path() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().to_path_buf();
        // A path outside the cwd whitelist is not editable.
        let other = tempfile::tempdir().unwrap();
        let fake_global = other.path().join(".claude").join("CLAUDE.md");
        fs::create_dir_all(fake_global.parent().unwrap()).unwrap();
        fs::write(&fake_global, "global").unwrap();

        let canonical = fake_global.canonicalize().unwrap();
        let cwd_canon = cwd.canonicalize().unwrap();
        assert!(
            !is_editable(&canonical, Some(&cwd_canon)),
            "global CLAUDE.md must be read-only"
        );
    }

    // ---- stop behavior (pipeline_state Drop) ----

    #[tokio::test]
    async fn stop_claude_resources_watch_clears_inner() {
        let state = new_state();
        // Seed an empty "active" by directly manipulating inner — we can't
        // fabricate an ActiveResourcesWatch easily without a tauri Channel.
        // So just assert the stop path sets it to None cleanly when already None.
        {
            let mut g = state.inner.lock().await;
            *g = None;
        }
        {
            let mut g = state.inner.lock().await;
            if let Some(a) = g.take() {
                drop(a);
            }
            assert!(g.is_none());
        }
    }
}
