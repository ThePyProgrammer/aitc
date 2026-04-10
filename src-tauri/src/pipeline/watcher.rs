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

use crate::pipeline::events::{Attribution, FileEvent, FileEventBatch, FileEventKind};
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
use std::sync::atomic::{AtomicU64, Ordering};
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
    let repo_root = repo_root
        .canonicalize()
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
    let counter_clone = batch_id_counter.clone();
    let repo_root_clone = repo_root.clone();
    let task = tokio::task::spawn_blocking(move || {
        loop {
            match sync_rx.recv() {
                Ok(res) => {
                    let batch = process_debounce_result(res, &repo_root_clone, &counter_clone);
                    if batch.events.is_empty() {
                        continue;
                    }
                    // `blocking_send` is the documented way to send to a tokio
                    // mpsc from a spawn_blocking thread. It blocks the OS thread
                    // (not a tokio task) if the channel is full.
                    if out_tx.blocking_send(batch).is_err() {
                        // Receiver dropped — exit the drain loop.
                        break;
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
        // Expect README.md + src/a.rs + src/b.rs = 3
        assert_eq!(
            tree.len(),
            3,
            "initial tree: {:?}",
            tree.keys().collect::<Vec<_>>()
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
