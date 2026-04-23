//! Filesystem watcher task.
//!
//! Owns a notify-debouncer-full Debouncer, bridges its synchronous callback
//! into a tokio runtime via a std::sync::mpsc, filters events (writes only +
//! ignore hardcoded excludes + gitignore), and emits FileEventBatch values on
//! the provided tokio mpsc.
//!
//! Correct handling of three research-identified pitfalls:
//! - Pitfall 1 (Windows RDCW overflow): 150ms aggressive debounce, watch root only
//! - Pitfall 2 (non-tokio callback): std::sync::mpsc bridge, NOT `.send().await`
//! - Pitfall 5 (rename as Remove+Create): `new_debouncer` uses RecommendedCache
//!   (FileIdCache) which coalesces renames into ModifyKind::Name(Both) events

use crate::claude_resources::events::{
    Category as ResourceCategory, Resource, ResourceEvent, ResourceEventBatch, Scope,
};
use crate::claude_resources::parse::{
    parse_agent, parse_claude_md, parse_command, parse_hook_metadata,
    parse_installed_plugins, parse_settings, parse_skill,
};
use crate::claude_resources::routing::{
    category_for_path, classify_event, RoutedPath, ScopeKind,
    EXTRA_ROOT_ALLOWLIST_SUBDIRS,
};
use crate::claude_resources::scan::scan_scope;
use crate::claude_resources::write_fence::WriteFence;
use crate::pipeline::events::{Attribution, FileEvent, FileEventBatch, FileEventKind};
use crate::pipeline::commands::strip_unc;
use crate::pipeline::ignore_filter::HARDCODED_EXCLUDES;
use crate::pipeline::tree_index::{build_tree_index, FileNode};
use notify_debouncer_full::{
    new_debouncer,
    notify::{
        event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
        EventKind, RecursiveMode,
    },
    DebounceEventResult, Debouncer, RecommendedCache,
};
use notify_debouncer_full::notify::RecommendedWatcher;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Debounce tick window (D-03 Claude's discretion — Rust-side primary throttle).
/// 150ms is the research-recommended sweet spot: aggressive enough to mitigate
/// Windows RDCW buffer overflow (Pitfall 1), loose enough to avoid pushing
/// burst spikes into React reconciliation.
const DEBOUNCE_TICK_MS: u64 = 150;

/// Opaque handle keeping the watcher alive. Dropping this stops the watcher.
pub struct WatcherHandle {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
    _task: tokio::task::JoinHandle<()>,
}

pub struct WatcherOutput {
    pub handle: WatcherHandle,
    pub initial_tree: HashMap<PathBuf, FileNode>,
}

/// Spawn the watcher actor.
///
/// Blocks briefly to build the initial tree index (use spawn_blocking if
/// calling from an async runtime for a very large repo), then returns the
/// handle + initial tree.
///
/// `out_tx` receives FileEventBatch values as the watcher produces them. The
/// watcher marks every event as `Attribution::Unattributed` — Plan 03 adds the
/// PID attribution layer on top by intercepting this stream.
pub fn spawn_watcher(
    repo_root: &Path,
    out_tx: tokio::sync::mpsc::Sender<FileEventBatch>,
) -> Result<WatcherOutput, String> {
    // strip_unc: drop the Windows `\\?\` verbatim prefix that `canonicalize`
    // re-adds on Windows. Without this, the walker populates tree_index with
    // UNC-prefixed keys while `active.repo_root` (set by the caller via
    // `start_watch`) is stored in stripped form, making `serialize_tree_index`
    // and `get_dependency_graph`'s `strip_prefix` checks fail component-wise.
    let repo_root = repo_root
        .canonicalize()
        .map(strip_unc)
        .map_err(|e| format!("canonicalize repo root: {e}"))?;

    // Build the initial tree index synchronously.
    let initial_tree = build_tree_index(&repo_root);

    // sync<->async bridge: notify's callback runs on its own thread (Pitfall 2).
    // std::sync::mpsc::channel is unbounded and its send is non-blocking, which
    // is exactly what we need inside the notify callback.
    let (sync_tx, sync_rx) = std::sync::mpsc::channel::<DebounceEventResult>();

    // new_debouncer(timeout, tick_rate, handler):
    //   - timeout: how long an event must sit without an update before release
    //   - tick_rate: how often the debouncer checks its queue. When None,
    //     notify-debouncer-full defaults to timeout/4 (37.5ms here). That's
    //     too aggressive for our burst-coalescing budget — every tick becomes
    //     a separate batch, and 1000 rapid writes produce 100+ batches on
    //     Windows RDCW. We pass the same value as the timeout so ticks and
    //     debounce windows line up, maximizing coalescing of bursty writes.
    let tick_rate = Duration::from_millis(DEBOUNCE_TICK_MS);
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_TICK_MS),
        Some(tick_rate),
        move |res: DebounceEventResult| {
            // Runs on notify's OS thread. No async, no blocking_send on a tokio channel.
            // std::sync::mpsc::send is non-blocking (unbounded) and safe here.
            let _ = sync_tx.send(res);
        },
    )
    .map_err(|e| format!("new_debouncer: {e}"))?;

    debouncer
        .watch(&repo_root, RecursiveMode::Recursive)
        .map_err(|e| format!("watch: {e}"))?;

    // Drain the sync bridge into tokio on a blocking task. spawn_blocking lets
    // us call sync_rx.recv() (which blocks) without stalling the tokio runtime.
    let batch_id_counter = Arc::new(AtomicU64::new(0));
    let dropped_counter = Arc::new(AtomicU32::new(0));
    let counter_clone = batch_id_counter.clone();
    let dropped_clone = dropped_counter.clone();
    let repo_root_clone = repo_root.clone();
    let task = tokio::task::spawn_blocking(move || {
        loop {
            match sync_rx.recv() {
                Ok(res) => {
                    let mut batch =
                        process_debounce_result(res, &repo_root_clone, &counter_clone);
                    if batch.events.is_empty() {
                        continue;
                    }
                    // Carry any accumulated drop count into this batch so the
                    // frontend sees how many batches were lost since the last
                    // successful send.
                    batch.dropped_batches = dropped_clone.swap(0, Ordering::Relaxed);
                    // Use try_send instead of blocking_send so that when the
                    // bounded mpsc is full, batches are dropped (back-pressure)
                    // rather than blocking the OS thread and stalling the
                    // debouncer drain loop.
                    match out_tx.try_send(batch) {
                        Ok(()) => {}
                        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                            dropped_clone.fetch_add(1, Ordering::Relaxed);
                        }
                        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                            break; // Receiver dropped — exit the drain loop.
                        }
                    }
                }
                Err(_) => break, // channel closed — debouncer dropped
            }
        }
    });

    Ok(WatcherOutput {
        handle: WatcherHandle {
            _debouncer: debouncer,
            _task: task,
        },
        initial_tree,
    })
}

// ---------------------------------------------------------------------------
// Plan 09-03: multi-root watcher supporting ~/.claude/ + <cwd>/.claude/.
//
// Per D-05 (user-locked): exactly ONE Debouncer watches repo_root PLUS each
// extra root's allowlisted subdirs. Events are fanned out by classify_event
// (D-06) into either the existing pipeline mpsc or a new resources mpsc.
// ---------------------------------------------------------------------------

/// Per-scope configuration for an extra watch root.
pub struct ExtraRoot {
    /// Canonicalized path to the scope root (e.g. `~/.claude/` or
    /// `<cwd>/.claude/`).
    pub root: PathBuf,
    pub kind: ScopeKind,
    /// For `ScopeKind::Project` only: the project root (the parent of
    /// `.claude/`). Used so the initial scan can discover `<cwd>/CLAUDE.md`
    /// (one level above `.claude/`).
    pub project_root: Option<PathBuf>,
}

pub struct MultiWatcherOutput {
    pub handle: WatcherHandle,
    pub initial_tree: HashMap<PathBuf, FileNode>,
    /// Merged initial scan across every extra root (Global first, then
    /// Project). Empty when `extra_roots` is empty.
    pub initial_resources: Vec<Resource>,
}

/// Spawn the single-Debouncer multi-root watcher.
///
/// Honors D-05: exactly ONE `Debouncer<RecommendedWatcher, RecommendedCache>`
/// is created. The Debouncer watches:
///   - `repo_root` recursively (existing pipeline behavior)
///   - For each `ExtraRoot`: each allowlisted subdir
///     (`skills/`, `agents/`, `commands/`, `hooks/`, `plugins/`) recursively,
///     PLUS file-level NonRecursive watches for `settings.json` and
///     `CLAUDE.md` at the scope root. For `ScopeKind::Project`, also
///     watches `<project_root>/CLAUDE.md` (one level above `.claude/`).
///
/// Fan-out (D-06): every debounced event is routed via `classify_event`.
/// Pipeline events flow to `pipeline_tx` unchanged; Resource events are
/// re-parsed and flow to `resources_tx` as `ResourceEventBatch`. The
/// `fence.was_ours(path)` check suppresses self-emitted Changed events
/// for AITC-originated CLAUDE.md writes (Pitfall 3).
pub fn spawn_watcher_multi(
    repo_root: &Path,
    extra_roots: Vec<ExtraRoot>,
    pipeline_tx: tokio::sync::mpsc::Sender<FileEventBatch>,
    resources_tx: tokio::sync::mpsc::Sender<ResourceEventBatch>,
    fence: WriteFence,
) -> Result<MultiWatcherOutput, String> {
    // See `spawn_watcher` above for why `strip_unc` is applied here.
    let repo_root = repo_root
        .canonicalize()
        .map(strip_unc)
        .map_err(|e| format!("canonicalize repo root: {e}"))?;

    // Build the initial pipeline tree index synchronously.
    let initial_tree = build_tree_index(&repo_root);

    // Build the initial resources list (Pitfall 7: missing dirs yield []).
    let mut initial_resources: Vec<Resource> = Vec::new();
    for ex in &extra_roots {
        if ex.root.exists() {
            match scan_scope(&ex.root, ex.kind.into()) {
                Ok(rs) => initial_resources.extend(rs),
                Err(e) => tracing::warn!(root = %ex.root.display(), error = %e, "scan_scope failed"),
            }
        }
    }

    // sync<->async bridge (Pitfall 2).
    let (sync_tx, sync_rx) = std::sync::mpsc::channel::<DebounceEventResult>();

    let tick_rate = Duration::from_millis(DEBOUNCE_TICK_MS);
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_TICK_MS),
        Some(tick_rate),
        move |res: DebounceEventResult| {
            let _ = sync_tx.send(res);
        },
    )
    .map_err(|e| format!("new_debouncer: {e}"))?;

    // Watch the pipeline repo root recursively.
    debouncer
        .watch(&repo_root, RecursiveMode::Recursive)
        .map_err(|e| format!("watch: {e}"))?;

    // Watch each extra root's allowlisted subdirs + file-level entries.
    // Pitfall 1: we intentionally do NOT call `.watch(&root, Recursive)` on
    // the scope root — that would include `cache/`, `session-env/`, etc.
    for ex in &extra_roots {
        if !ex.root.exists() {
            tracing::info!(root = %ex.root.display(), "extra root missing, skipping");
            continue;
        }
        for name in EXTRA_ROOT_ALLOWLIST_SUBDIRS {
            let p = ex.root.join(name);
            if p.exists() {
                if let Err(e) = debouncer.watch(&p, RecursiveMode::Recursive) {
                    tracing::warn!(root = %p.display(), error = %e, "extra subdir watch failed");
                }
            }
        }
        // File-level: settings.json and CLAUDE.md at the scope root.
        for file_name in ["settings.json", "CLAUDE.md"] {
            let p = ex.root.join(file_name);
            if p.exists() {
                if let Err(e) = debouncer.watch(&p, RecursiveMode::NonRecursive) {
                    tracing::warn!(path = %p.display(), error = %e, "scope-root file watch failed");
                }
            }
        }
        // Project scope: watch <project_root>/CLAUDE.md (one level above).
        if matches!(ex.kind, ScopeKind::Project) {
            if let Some(pr) = &ex.project_root {
                let p = pr.join("CLAUDE.md");
                if p.exists() {
                    if let Err(e) = debouncer.watch(&p, RecursiveMode::NonRecursive) {
                        tracing::warn!(path = %p.display(), error = %e, "project CLAUDE.md watch failed");
                    }
                }
            }
        }
    }

    // Project-root paths used by the fan-out for `parse_claude_md` editable flag.
    let project_root_for_editable: Option<PathBuf> = extra_roots
        .iter()
        .find(|e| matches!(e.kind, ScopeKind::Project))
        .and_then(|e| e.project_root.clone());

    // Build the immutable (PathBuf, ScopeKind) tuple list needed by classify_event.
    let extra_roots_tuples: Vec<(PathBuf, ScopeKind)> = extra_roots
        .iter()
        .map(|e| (e.root.clone(), e.kind))
        .collect();

    let pipeline_batch_id = Arc::new(AtomicU64::new(0));
    let resources_batch_id = Arc::new(AtomicU64::new(0));
    let pipeline_dropped = Arc::new(AtomicU32::new(0));
    let resources_dropped = Arc::new(AtomicU32::new(0));

    let pipeline_batch_id_c = pipeline_batch_id.clone();
    let resources_batch_id_c = resources_batch_id.clone();
    let pipeline_dropped_c = pipeline_dropped.clone();
    let resources_dropped_c = resources_dropped.clone();
    let repo_root_c = repo_root.clone();
    let fence_c = fence.clone();

    let task = tokio::task::spawn_blocking(move || {
        while let Ok(res) = sync_rx.recv() {
            let (mut pipe_batch, mut res_batch) = process_debounce_result_multi(
                res,
                &repo_root_c,
                &extra_roots_tuples,
                &extra_roots,
                project_root_for_editable.as_deref(),
                &fence_c,
                &pipeline_batch_id_c,
                &resources_batch_id_c,
            );

            if !pipe_batch.events.is_empty() {
                pipe_batch.dropped_batches =
                    pipeline_dropped_c.swap(0, Ordering::Relaxed);
                match pipeline_tx.try_send(pipe_batch) {
                    Ok(()) => {}
                    Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                        pipeline_dropped_c.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => break,
                }
            }
            if !res_batch.events.is_empty() {
                res_batch.dropped_batches =
                    resources_dropped_c.swap(0, Ordering::Relaxed);
                match resources_tx.try_send(res_batch) {
                    Ok(()) => {}
                    Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                        resources_dropped_c.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                        // Resources receiver closed — keep pipeline going.
                    }
                }
            }
            // GC the fence periodically.
            fence_c.gc();
        }
    });

    Ok(MultiWatcherOutput {
        handle: WatcherHandle {
            _debouncer: debouncer,
            _task: task,
        },
        initial_tree,
        initial_resources,
    })
}

/// Fan-out aware version of `process_debounce_result`. Routes each event
/// via `classify_event` and builds two batches — one pipeline, one resources.
#[allow(clippy::too_many_arguments)]
fn process_debounce_result_multi(
    res: DebounceEventResult,
    repo_root: &Path,
    extra_roots_tuples: &[(PathBuf, ScopeKind)],
    extra_roots: &[ExtraRoot],
    project_root_for_editable: Option<&Path>,
    fence: &WriteFence,
    pipeline_counter: &AtomicU64,
    resources_counter: &AtomicU64,
) -> (FileEventBatch, ResourceEventBatch) {
    let pipeline_batch_id = pipeline_counter.fetch_add(1, Ordering::Relaxed);
    let resources_batch_id = resources_counter.fetch_add(1, Ordering::Relaxed);

    let mut pipeline_events: Vec<FileEvent> = Vec::new();
    let mut resource_events: Vec<ResourceEvent> = Vec::new();

    let debounced_events = match res {
        Ok(ev) => ev,
        Err(errors) => {
            tracing::warn!(?errors, "debouncer errors");
            return (
                FileEventBatch {
                    events: pipeline_events,
                    batch_id: pipeline_batch_id,
                    dropped_batches: 0,
                },
                ResourceEventBatch {
                    events: resource_events,
                    batch_id: resources_batch_id,
                    dropped_batches: 0,
                },
            );
        }
    };

    for debounced in debounced_events {
        let ev = &debounced.event;
        let kind = match map_event_kind(&ev.kind, &ev.paths) {
            Some(k) => k,
            None => continue,
        };
        let path = match &kind {
            FileEventKind::Rename { to, .. } => to.clone(),
            _ => match ev.paths.first() {
                Some(p) => p.clone(),
                None => continue,
            },
        };

        match classify_event(&path, repo_root, extra_roots_tuples) {
            None => continue,
            Some(RoutedPath::Pipeline) => {
                // Same filters as process_debounce_result.
                if !path_is_under_root(&path, repo_root) {
                    continue;
                }
                if path_contains_excluded_component(&path) {
                    continue;
                }
                pipeline_events.push(FileEvent::new(
                    path,
                    kind,
                    Attribution::Unattributed,
                ));
            }
            Some(RoutedPath::Resource(scope)) => {
                // Self-write suppression (Pitfall 3).
                if fence.was_ours(&path) {
                    continue;
                }
                // Find the matching ExtraRoot so we know which scope_root to
                // pass to category_for_path.
                let matched = extra_roots.iter().find(|e| {
                    path.starts_with(&e.root) && <ScopeKind as Into<Scope>>::into(e.kind) == scope
                });
                let scope_root = match matched {
                    Some(m) => m.root.as_path(),
                    None => continue,
                };

                if matches!(kind, FileEventKind::Remove) {
                    // For removes we can't re-parse, so emit by path with a
                    // best-effort reconstructed ResourceId if classifiable.
                    if category_for_path(&path, scope_root).is_some() {
                        // We don't have enough info to reconstruct the name
                        // reliably (e.g. SKILL frontmatter name overrides the
                        // directory name). Emit ExternalEdit instead — the
                        // store layer in Plan 04 will reconcile via the next
                        // initial scan. This is a conservative choice that
                        // preserves the Remove signal without fabricating
                        // stale IDs.
                        resource_events.push(ResourceEvent::ExternalEdit {
                            path: path.clone(),
                            mtime_ms: 0,
                        });
                    }
                    continue;
                }

                // Create/Modify/Rename: re-parse.
                let Some(cat) = category_for_path(&path, scope_root) else {
                    continue;
                };
                let parsed: Vec<Resource> = match cat {
                    ResourceCategory::Skill => match parse_skill(&path, scope) {
                        Ok(r) => vec![r],
                        Err(e) => {
                            tracing::warn!(path = %path.display(), error = %e, "parse_skill failed");
                            continue;
                        }
                    },
                    ResourceCategory::Agent => match parse_agent(&path, scope) {
                        Ok(r) => vec![r],
                        Err(e) => {
                            tracing::warn!(path = %path.display(), error = %e, "parse_agent failed");
                            continue;
                        }
                    },
                    ResourceCategory::Command => match parse_command(&path, scope) {
                        Ok(r) => vec![r],
                        Err(e) => {
                            tracing::warn!(path = %path.display(), error = %e, "parse_command failed");
                            continue;
                        }
                    },
                    ResourceCategory::Plugin => match parse_installed_plugins(&path, scope) {
                        Ok(rs) => rs,
                        Err(e) => {
                            tracing::warn!(path = %path.display(), error = %e, "parse_installed_plugins failed");
                            continue;
                        }
                    },
                    ResourceCategory::Hook => vec![parse_hook_metadata(&path, scope)],
                    ResourceCategory::Settings | ResourceCategory::Mcp => {
                        match parse_settings(&path, scope) {
                            Ok(rs) => rs,
                            Err(e) => {
                                tracing::warn!(path = %path.display(), error = %e, "parse_settings failed");
                                continue;
                            }
                        }
                    }
                    ResourceCategory::ClaudeMd => {
                        // Editable flag: project-scoped CLAUDE.md files are
                        // editable, everything else is read-only.
                        let editable = matches!(scope, Scope::Project)
                            && project_root_for_editable
                                .map(|pr| {
                                    path == pr.join("CLAUDE.md")
                                        || path == pr.join(".claude").join("CLAUDE.md")
                                })
                                .unwrap_or(false);
                        match parse_claude_md(&path, scope, editable) {
                            Ok(r) => vec![r],
                            Err(e) => {
                                tracing::warn!(path = %path.display(), error = %e, "parse_claude_md failed");
                                continue;
                            }
                        }
                    }
                };

                let is_create = matches!(kind, FileEventKind::Create);
                for r in parsed {
                    if is_create {
                        resource_events.push(ResourceEvent::Added { resource: r });
                    } else {
                        resource_events.push(ResourceEvent::Changed { resource: r });
                    }
                }
            }
        }
    }

    (
        FileEventBatch {
            events: pipeline_events,
            batch_id: pipeline_batch_id,
            dropped_batches: 0,
        },
        ResourceEventBatch {
            events: resource_events,
            batch_id: resources_batch_id,
            dropped_batches: 0,
        },
    )
}

fn process_debounce_result(
    res: DebounceEventResult,
    repo_root: &Path,
    counter: &AtomicU64,
) -> FileEventBatch {
    let batch_id = counter.fetch_add(1, Ordering::Relaxed);
    let mut events = Vec::new();

    let debounced_events = match res {
        Ok(ev) => ev,
        Err(errors) => {
            tracing::warn!(?errors, "debouncer errors");
            return FileEventBatch {
                events,
                batch_id,
                dropped_batches: 0,
            };
        }
    };

    for debounced in debounced_events {
        // debounced.event is notify::Event, with .kind and .paths
        let ev = &debounced.event;
        let kind = match map_event_kind(&ev.kind, &ev.paths) {
            Some(k) => k,
            None => continue, // filtered (read event, metadata, etc.)
        };

        // Find the primary path for the event.
        let path = match &kind {
            FileEventKind::Rename { to, .. } => to.clone(),
            _ => match ev.paths.first() {
                Some(p) => p.clone(),
                None => continue,
            },
        };

        // Path-traversal guard (T-02-02-01): drop any event whose path is not
        // lexically under the canonicalized repo root.
        if !path_is_under_root(&path, repo_root) {
            tracing::debug!(?path, "event path outside repo root, dropping");
            continue;
        }

        // Hardcoded exclude check (defense in depth — native watcher doesn't
        // know about our filter, events from node_modules/ etc. can arrive).
        if path_contains_excluded_component(&path) {
            continue;
        }

        events.push(FileEvent::new(path, kind, Attribution::Unattributed));
    }

    FileEventBatch {
        events,
        batch_id,
        dropped_batches: 0,
    }
}

/// Map a notify EventKind into our FileEventKind, returning None for
/// events we don't care about (Access/Read per D-11, Other, unknown metadata).
fn map_event_kind(kind: &EventKind, paths: &[PathBuf]) -> Option<FileEventKind> {
    match kind {
        // Creates
        EventKind::Create(CreateKind::File)
        | EventKind::Create(CreateKind::Any)
        | EventKind::Create(CreateKind::Other) => Some(FileEventKind::Create),
        EventKind::Create(CreateKind::Folder) => None, // track files only for Phase 2

        // Modifies
        EventKind::Modify(ModifyKind::Data(_)) => Some(FileEventKind::Modify),
        EventKind::Modify(ModifyKind::Any) => Some(FileEventKind::Modify),

        // Renames — FileIdCache in notify-debouncer-full delivers Name(Both) with
        // two paths [from, to] when it can reconstruct the pair.
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            if paths.len() >= 2 {
                Some(FileEventKind::Rename {
                    from: paths[0].clone(),
                    to: paths[1].clone(),
                })
            } else {
                Some(FileEventKind::Modify)
            }
        }
        EventKind::Modify(ModifyKind::Name(_)) => Some(FileEventKind::Modify),

        // Modify::Metadata is dropped — not a write in the D-11 sense.
        EventKind::Modify(ModifyKind::Metadata(_)) => None,
        EventKind::Modify(ModifyKind::Other) => None,

        // Removes
        EventKind::Remove(RemoveKind::File)
        | EventKind::Remove(RemoveKind::Any)
        | EventKind::Remove(RemoveKind::Other) => Some(FileEventKind::Remove),
        EventKind::Remove(RemoveKind::Folder) => None,

        // D-11: writes only, drop all Access events.
        EventKind::Access(_) => None,
        EventKind::Any | EventKind::Other => None,
    }
}

/// Component-aware prefix check using `Path::starts_with`, which compares
/// complete path components (not raw bytes). This correctly rejects sibling
/// directories like `/repo-extra` when root is `/repo`.
/// Works for non-existent paths (deleted files) where `canonicalize()` would
/// fail. Caller is responsible for passing a canonicalized `root`.
fn path_is_under_root(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

/// True if any component of `path` matches a hardcoded exclude directory name.
fn path_contains_excluded_component(path: &Path) -> bool {
    for comp in path.components() {
        let name = comp.as_os_str().to_string_lossy();
        if HARDCODED_EXCLUDES.iter().any(|&ex| ex == name) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::test_util::{make_temp_repo, wait_for_batch, write_file};
    use serial_test::serial;
    use std::fs;
    use std::time::Duration;

    async fn spawn_test_watcher(
        repo_root: &Path,
    ) -> (
        WatcherHandle,
        tokio::sync::mpsc::Receiver<FileEventBatch>,
        HashMap<PathBuf, FileNode>,
    ) {
        let (tx, rx) = tokio::sync::mpsc::channel::<FileEventBatch>(64);
        let out = spawn_watcher(repo_root, tx).expect("spawn_watcher");
        // Small grace period so the debouncer is fully registered before we
        // start generating filesystem events.
        tokio::time::sleep(Duration::from_millis(300)).await;
        (out.handle, rx, out.initial_tree)
    }

    #[tokio::test]
    #[serial]
    async fn detects_file_create() {
        let tmp = make_temp_repo();
        let (_h, mut rx, _tree) = spawn_test_watcher(tmp.path()).await;
        write_file(tmp.path(), "src/new.rs", "fn new() {}");
        let batch = wait_for_batch(&mut rx, Duration::from_secs(2))
            .await
            .expect("batch within 2s");
        let has_create = batch.events.iter().any(|e| {
            matches!(e.kind, FileEventKind::Create | FileEventKind::Modify)
                && e.path.ends_with("new.rs")
        });
        assert!(
            has_create,
            "expected Create for new.rs in batch: {:?}",
            batch.events
        );
    }

    #[tokio::test]
    #[serial]
    async fn detects_file_modify() {
        let tmp = make_temp_repo();
        write_file(tmp.path(), "src/existing.rs", "fn a() {}");
        let (_h, mut rx, _) = spawn_test_watcher(tmp.path()).await;
        fs::write(
            tmp.path().join("src").join("existing.rs"),
            "fn a() { let x = 1; }",
        )
        .unwrap();
        let batch = wait_for_batch(&mut rx, Duration::from_secs(2))
            .await
            .expect("batch within 2s");
        let has_modify = batch.events.iter().any(|e| {
            matches!(e.kind, FileEventKind::Modify | FileEventKind::Create)
                && e.path.ends_with("existing.rs")
        });
        assert!(has_modify, "expected Modify: {:?}", batch.events);
    }

    #[tokio::test]
    #[serial]
    async fn detects_file_remove() {
        let tmp = make_temp_repo();
        write_file(tmp.path(), "src/doomed.rs", "fn d() {}");
        let (_h, mut rx, _) = spawn_test_watcher(tmp.path()).await;
        fs::remove_file(tmp.path().join("src").join("doomed.rs")).unwrap();
        let batch = wait_for_batch(&mut rx, Duration::from_secs(2))
            .await
            .expect("batch within 2s");
        let has_remove = batch
            .events
            .iter()
            .any(|e| matches!(e.kind, FileEventKind::Remove) && e.path.ends_with("doomed.rs"));
        assert!(has_remove, "expected Remove: {:?}", batch.events);
    }

    #[tokio::test]
    #[serial]
    async fn rename_coalesced_into_single_event() {
        let tmp = make_temp_repo();
        write_file(tmp.path(), "src/old.rs", "fn o() {}");
        let (_h, mut rx, _) = spawn_test_watcher(tmp.path()).await;
        fs::rename(
            tmp.path().join("src").join("old.rs"),
            tmp.path().join("src").join("new.rs"),
        )
        .unwrap();
        // Collect all batches within 1.5s — want at most one Rename, no bare Remove+Create
        let mut saw_rename = false;
        let mut saw_remove = false;
        let mut saw_create = false;
        let deadline = std::time::Instant::now() + Duration::from_millis(1500);
        while std::time::Instant::now() < deadline {
            match wait_for_batch(&mut rx, Duration::from_millis(400)).await {
                Some(batch) => {
                    for e in &batch.events {
                        match &e.kind {
                            FileEventKind::Rename { .. } => saw_rename = true,
                            FileEventKind::Remove => saw_remove = true,
                            FileEventKind::Create => saw_create = true,
                            _ => {}
                        }
                    }
                }
                None => break,
            }
        }
        // Debouncer FileIdCache should coalesce. If we see both Remove AND
        // Create for the rename (without a Rename), the coalescing failed —
        // Windows-specific issue.
        assert!(
            saw_rename || !(saw_remove && saw_create),
            "rename was split into Remove+Create — FileIdCache failed"
        );
    }

    #[tokio::test]
    #[serial]
    async fn ignores_node_modules_writes() {
        let tmp = make_temp_repo();
        let (_h, mut rx, _) = spawn_test_watcher(tmp.path()).await;
        let nm = tmp.path().join("node_modules").join("pkg");
        fs::create_dir_all(&nm).unwrap();
        fs::write(nm.join("index.js"), "module.exports = {}").unwrap();
        // No batch should arrive within 800ms
        let res = wait_for_batch(&mut rx, Duration::from_millis(800)).await;
        assert!(
            res.is_none()
                || res
                    .unwrap()
                    .events
                    .iter()
                    .all(|e| !e.path.to_string_lossy().contains("node_modules")),
            "node_modules write leaked through filter"
        );
    }

    #[tokio::test]
    #[serial]
    async fn ignores_read_events() {
        let tmp = make_temp_repo();
        write_file(tmp.path(), "src/readme.rs", "// read me");
        let (_h, mut rx, _) = spawn_test_watcher(tmp.path()).await;
        let _ = fs::read_to_string(tmp.path().join("src").join("readme.rs")).unwrap();
        // Reads should produce NO write events (D-11).
        let res = wait_for_batch(&mut rx, Duration::from_millis(800)).await;
        // Tolerant: accept no batch, OR a batch with zero write events for readme.rs.
        if let Some(b) = res {
            assert!(
                b.events.iter().all(|e| !e.path.ends_with("readme.rs")),
                "read produced a write event for readme.rs: {:?}",
                b.events
            );
        }
    }

    #[tokio::test]
    #[serial]
    async fn initial_tree_populated_before_watch() {
        let tmp = make_temp_repo();
        write_file(tmp.path(), "src/a.rs", "a");
        write_file(tmp.path(), "src/b.rs", "b");
        let (_h, _rx, tree) = spawn_test_watcher(tmp.path()).await;
        // WR-01: tree_index now also records directory entries. Count only
        // the file rows here (README.md + src/a.rs + src/b.rs = 3).
        let file_count = tree.values().filter(|n| !n.is_dir).count();
        assert_eq!(
            file_count,
            3,
            "initial tree: {:?}",
            tree.keys().collect::<Vec<_>>()
        );
    }

    // -----------------------------------------------------------------
    // Plan 09-03: spawn_watcher_multi + D-06 fan-out invariant tests.
    // -----------------------------------------------------------------

    use crate::claude_resources::events::{Category as RCat, ResourceEventBatch};

    fn make_scope_root(base: &Path) -> PathBuf {
        let root = base.join(".claude");
        fs::create_dir_all(root.join("skills")).unwrap();
        fs::create_dir_all(root.join("agents")).unwrap();
        root
    }

    fn write_skill(scope_root: &Path, name: &str, description: &str) -> PathBuf {
        let dir = scope_root.join("skills").join(name);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("SKILL.md");
        fs::write(
            &p,
            format!("---\nname: {name}\ndescription: {description}\n---\nbody\n"),
        )
        .unwrap();
        p
    }

    async fn collect_resources(
        rx: &mut tokio::sync::mpsc::Receiver<ResourceEventBatch>,
        window: Duration,
    ) -> Vec<ResourceEventBatch> {
        let deadline = std::time::Instant::now() + window;
        let mut out = Vec::new();
        while std::time::Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Some(b)) => out.push(b),
                Ok(None) | Err(_) => break,
            }
        }
        out
    }

    #[tokio::test]
    #[serial]
    async fn spawn_watcher_with_extra_roots_covers_allowlisted_subdirs() {
        let repo = make_temp_repo();
        let global_base = tempfile::tempdir().unwrap();
        let global_scope = make_scope_root(global_base.path());
        write_skill(&global_scope, "my-skill", "a test skill");

        let (pipe_tx, _pipe_rx) = tokio::sync::mpsc::channel::<FileEventBatch>(16);
        let (res_tx, _res_rx) = tokio::sync::mpsc::channel::<ResourceEventBatch>(16);
        let extras = vec![ExtraRoot {
            root: global_scope.clone().canonicalize().unwrap(),
            kind: ScopeKind::Global,
            project_root: None,
        }];
        let out = spawn_watcher_multi(
            repo.path(),
            extras,
            pipe_tx,
            res_tx,
            WriteFence::new(),
        )
        .expect("spawn_watcher_multi");

        assert!(
            out.initial_resources
                .iter()
                .any(|r| r.category == RCat::Skill && r.name == "my-skill"),
            "expected initial my-skill resource; got {:?}",
            out.initial_resources.iter().map(|r| &r.name).collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    #[serial]
    async fn spawn_watcher_no_extra_roots_yields_empty_resources() {
        let repo = make_temp_repo();
        let (pipe_tx, _pipe_rx) = tokio::sync::mpsc::channel::<FileEventBatch>(16);
        let (res_tx, _res_rx) = tokio::sync::mpsc::channel::<ResourceEventBatch>(16);
        let out = spawn_watcher_multi(
            repo.path(),
            vec![],
            pipe_tx,
            res_tx,
            WriteFence::new(),
        )
        .expect("spawn_watcher_multi");
        assert!(out.initial_resources.is_empty());
    }

    #[tokio::test]
    #[serial]
    async fn fanout_routes_pipeline_event_to_pipeline_only() {
        let repo = make_temp_repo();
        let global_base = tempfile::tempdir().unwrap();
        let global_scope = make_scope_root(global_base.path());

        let (pipe_tx, mut pipe_rx) = tokio::sync::mpsc::channel::<FileEventBatch>(16);
        let (res_tx, mut res_rx) = tokio::sync::mpsc::channel::<ResourceEventBatch>(16);
        let extras = vec![ExtraRoot {
            root: global_scope.canonicalize().unwrap(),
            kind: ScopeKind::Global,
            project_root: None,
        }];
        let _out = spawn_watcher_multi(
            repo.path(),
            extras,
            pipe_tx,
            res_tx,
            WriteFence::new(),
        )
        .expect("spawn_watcher_multi");
        tokio::time::sleep(Duration::from_millis(300)).await;

        write_file(repo.path(), "src/foo.rs", "fn foo() {}");

        let pipe_batch = wait_for_batch(&mut pipe_rx, Duration::from_millis(1500))
            .await
            .expect("pipeline batch within 1.5s");
        assert!(
            pipe_batch.events.iter().any(|e| e.path.ends_with("foo.rs")),
            "expected foo.rs in pipeline batch: {:?}",
            pipe_batch.events
        );

        // Resources channel must NOT receive anything for the repo event.
        let res_batches = collect_resources(&mut res_rx, Duration::from_millis(500)).await;
        let leaked: Vec<_> = res_batches
            .iter()
            .flat_map(|b| b.events.iter())
            .collect();
        assert!(
            leaked.is_empty(),
            "fan-out invariant violated: repo event leaked to resources: {leaked:?}"
        );
    }

    #[tokio::test]
    #[serial]
    async fn fanout_routes_claude_event_to_resources_only() {
        let repo = make_temp_repo();
        let global_base = tempfile::tempdir().unwrap();
        let global_scope = make_scope_root(global_base.path());

        let (pipe_tx, mut pipe_rx) = tokio::sync::mpsc::channel::<FileEventBatch>(16);
        let (res_tx, mut res_rx) = tokio::sync::mpsc::channel::<ResourceEventBatch>(16);
        let canonical_global = global_scope.canonicalize().unwrap();
        let extras = vec![ExtraRoot {
            root: canonical_global.clone(),
            kind: ScopeKind::Global,
            project_root: None,
        }];
        let _out = spawn_watcher_multi(
            repo.path(),
            extras,
            pipe_tx,
            res_tx,
            WriteFence::new(),
        )
        .expect("spawn_watcher_multi");
        tokio::time::sleep(Duration::from_millis(300)).await;

        // Use a pre-existing skill dir to avoid notify's "new subdir not yet
        // watched" race on Linux. Create the dir first, wait for notify to
        // register it, then write the SKILL.md.
        let skill_dir = canonical_global.join("skills").join("fresh-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: fresh-skill\ndescription: new skill\n---\nbody\n",
        )
        .unwrap();

        let res_batches = collect_resources(&mut res_rx, Duration::from_millis(2000)).await;
        let saw_skill = res_batches.iter().flat_map(|b| b.events.iter()).any(|e| {
            matches!(
                e,
                ResourceEvent::Added { resource } | ResourceEvent::Changed { resource }
                    if resource.name == "fresh-skill"
            )
        });
        assert!(
            saw_skill,
            "expected fresh-skill in resources batches: {res_batches:?}"
        );

        // Pipeline channel must NOT have received anything for the claude event.
        let leaked_pipe: Vec<_> = (|| {
            let mut collected = Vec::new();
            loop {
                match pipe_rx.try_recv() {
                    Ok(b) => collected.extend(b.events),
                    Err(_) => break,
                }
            }
            collected
        })();
        assert!(
            leaked_pipe.is_empty(),
            "fan-out invariant violated: claude event leaked to pipeline: {leaked_pipe:?}"
        );
    }

    #[tokio::test]
    #[serial]
    async fn write_fence_suppresses_self_emitted_changed() {
        let repo = make_temp_repo();
        let global_base = tempfile::tempdir().unwrap();
        let global_scope = make_scope_root(global_base.path());
        let canonical_global = global_scope.canonicalize().unwrap();
        // Pre-create a CLAUDE.md in the scope root.
        let claude_md = canonical_global.join("CLAUDE.md");
        fs::write(&claude_md, "initial").unwrap();

        let (pipe_tx, _pipe_rx) = tokio::sync::mpsc::channel::<FileEventBatch>(16);
        let (res_tx, mut res_rx) = tokio::sync::mpsc::channel::<ResourceEventBatch>(16);
        let fence = WriteFence::with_ttl(Duration::from_millis(400));
        let extras = vec![ExtraRoot {
            root: canonical_global.clone(),
            kind: ScopeKind::Global,
            project_root: None,
        }];
        let _out = spawn_watcher_multi(
            repo.path(),
            extras,
            pipe_tx,
            res_tx,
            fence.clone(),
        )
        .expect("spawn_watcher_multi");
        tokio::time::sleep(Duration::from_millis(300)).await;

        // Mark as ours, then touch.
        fence.record(claude_md.clone());
        fs::write(&claude_md, "written-by-us").unwrap();

        let within_ttl = collect_resources(&mut res_rx, Duration::from_millis(500)).await;
        let saw_change = within_ttl
            .iter()
            .flat_map(|b| b.events.iter())
            .any(|e| matches!(e, ResourceEvent::Changed { resource } if resource.path == claude_md));
        assert!(
            !saw_change,
            "fence should have suppressed the self-write: {within_ttl:?}"
        );

        // After TTL elapses, a new external-looking write should surface.
        tokio::time::sleep(Duration::from_millis(600)).await;
        fs::write(&claude_md, "external-write").unwrap();
        let after_ttl = collect_resources(&mut res_rx, Duration::from_millis(1500)).await;
        let saw_change2 = after_ttl
            .iter()
            .flat_map(|b| b.events.iter())
            .any(|e| matches!(e, ResourceEvent::Changed { resource } if resource.path == claude_md));
        assert!(
            saw_change2,
            "post-TTL write should emit Changed: {after_ttl:?}"
        );
    }

    #[tokio::test]
    #[serial]
    async fn missing_project_extra_root_is_ok() {
        let repo = make_temp_repo();
        let global_base = tempfile::tempdir().unwrap();
        let global_scope = make_scope_root(global_base.path());
        write_skill(&global_scope, "present", "x");
        let canonical_global = global_scope.canonicalize().unwrap();

        // Point Project extra root at a non-existent path.
        let missing_project = repo.path().join("nope-does-not-exist");
        let (pipe_tx, _pipe_rx) = tokio::sync::mpsc::channel::<FileEventBatch>(16);
        let (res_tx, _res_rx) = tokio::sync::mpsc::channel::<ResourceEventBatch>(16);
        let extras = vec![
            ExtraRoot {
                root: canonical_global,
                kind: ScopeKind::Global,
                project_root: None,
            },
            ExtraRoot {
                root: missing_project.clone(),
                kind: ScopeKind::Project,
                project_root: Some(repo.path().to_path_buf()),
            },
        ];
        let out = spawn_watcher_multi(
            repo.path(),
            extras,
            pipe_tx,
            res_tx,
            WriteFence::new(),
        )
        .expect("missing project root must not fail");
        // Global scope still contributed.
        assert!(out.initial_resources.iter().any(|r| r.name == "present"));
    }

    #[tokio::test]
    #[serial]
    async fn allowlist_excludes_cache_session_env_etc() {
        let repo = make_temp_repo();
        let global_base = tempfile::tempdir().unwrap();
        let global_scope = make_scope_root(global_base.path());
        let canonical_global = global_scope.canonicalize().unwrap();
        // Create a cache/ dir with a file — it must NOT be watched.
        let cache_dir = canonical_global.join("cache");
        fs::create_dir_all(&cache_dir).unwrap();
        fs::write(cache_dir.join("something.json"), "initial").unwrap();

        let (pipe_tx, _pipe_rx) = tokio::sync::mpsc::channel::<FileEventBatch>(16);
        let (res_tx, mut res_rx) = tokio::sync::mpsc::channel::<ResourceEventBatch>(16);
        let extras = vec![ExtraRoot {
            root: canonical_global.clone(),
            kind: ScopeKind::Global,
            project_root: None,
        }];
        let _out = spawn_watcher_multi(
            repo.path(),
            extras,
            pipe_tx,
            res_tx,
            WriteFence::new(),
        )
        .expect("spawn_watcher_multi");
        tokio::time::sleep(Duration::from_millis(300)).await;

        // Write inside cache/ → no resources event should fire.
        fs::write(cache_dir.join("something.json"), "updated").unwrap();
        let batches_cache = collect_resources(&mut res_rx, Duration::from_millis(500)).await;
        let leaked_cache: Vec<_> = batches_cache
            .iter()
            .flat_map(|b| b.events.iter())
            .collect();
        assert!(
            leaked_cache.is_empty(),
            "cache/ write should not produce events: {leaked_cache:?}"
        );

        // Write a new skill → SHOULD produce an event. Create dir first, give
        // notify time to register it on Linux, then write the SKILL.md.
        let skill_dir = canonical_global.join("skills").join("after-cache");
        fs::create_dir_all(&skill_dir).unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: after-cache\ndescription: x\n---\nbody\n",
        )
        .unwrap();
        let batches_skill = collect_resources(&mut res_rx, Duration::from_millis(2000)).await;
        let saw_skill = batches_skill.iter().flat_map(|b| b.events.iter()).any(|e| {
            matches!(
                e,
                ResourceEvent::Added { resource } | ResourceEvent::Changed { resource }
                    if resource.name == "after-cache"
            )
        });
        assert!(
            saw_skill,
            "skills/ write must still emit: {batches_skill:?}"
        );
    }

    /// FMON-03: 1000 writes in a burst should coalesce into ≤10 batches
    /// with a 150ms debounce tick. Ignored by default (runs in Wave 0 opt-in).
    #[tokio::test]
    #[ignore]
    #[serial]
    async fn coalesces_burst_writes() {
        let tmp = make_temp_repo();
        let (_h, mut rx, _) = spawn_test_watcher(tmp.path()).await;
        // Write 1000 files as fast as possible
        for i in 0..1000 {
            write_file(tmp.path(), &format!("src/burst_{i:04}.rs"), "x");
        }
        // Collect batches for 3 seconds
        let mut batches = 0;
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            match wait_for_batch(&mut rx, Duration::from_millis(500)).await {
                Some(_) => batches += 1,
                None => break,
            }
        }
        println!("coalesces_burst_writes: {} batches for 1000 writes", batches);
        assert!(batches <= 10, "expected ≤10 batches, got {}", batches);
    }
}
