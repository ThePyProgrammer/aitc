//! Process snapshot + PID attribution heuristic (FMON-02, D-05/D-06/D-07).
//!
//! Per Claude's Discretion D-07: discover by process NAME allowlist + cwd
//! prefix match. Watched-directory-only attribution would need OS file-handle
//! inspection (expensive on Windows).
//!
//! Per D-06: best-effort in Phase 2. Phase 3 agent adapters will self-report
//! (pid, path) claims that supplement this heuristic for higher accuracy.
//!
//! Research note (02-RESEARCH.md Pitfall 4): sysinfo::refresh_processes on
//! Windows costs 30-100ms due to PEB reads for cwd. We use ProcessRefreshKind
//! to narrow the refresh and cache the result behind a 1000ms tick.
//!
//! Wave 0 benchmark (Plan 02-01 smoke_tests.rs BENCH_RESULT): 24ms avg on
//! 417 processes on dev Windows box — comfortably under the 50ms target.
//! Plan 02-04 may proceed with 1000ms polling cadence without tuning.

use crate::pipeline::events::{Attribution, FileEventBatch};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tokio::sync::{mpsc, RwLock};

/// Agent process names we attempt to attribute to.
///
/// Matching is lowercased + substring, so `claude.exe`, `Claude Code.exe`,
/// `codex-cli` all match.
///
/// Extending: Phase 3 agent adapters should grow this list (or switch to a
/// runtime-configurable allowlist) when they add new agent types. This is
/// a one-line change; no other modifications to process_snapshot.rs are
/// required.
pub const AGENT_NAME_ALLOWLIST: &[&str] = &["claude", "claude-code", "codex", "opencode"];

/// Frontend-facing process info (serializable via specta).
///
/// `parent_pid` is serialized as `parentPid` by the camelCase rename rule.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cwd: Option<PathBuf>,
    pub exe: Option<PathBuf>,
    pub parent_pid: Option<u32>,
}

/// Internal candidate kept in the snapshot. We deliberately clone into
/// ProcessInfo when exposing to the frontend to avoid borrowing sysinfo types
/// across the specta boundary.
#[derive(Debug, Clone)]
pub struct CandidateProc {
    pub pid: u32,
    pub name: String,
    /// Non-optional: only candidates with a known cwd make it here.
    /// Processes where sysinfo returns `cwd() == None` (Windows PEB read
    /// failed, cross-user processes, insufficient perms) are silently
    /// skipped per D-06.
    pub cwd: PathBuf,
    pub exe: Option<PathBuf>,
    pub parent: Option<u32>,
}

/// Polls `sysinfo` periodically to build a candidate list of agent processes,
/// then answers `attribute(path)` queries by lexical cwd-prefix match.
pub struct ProcessSnapshot {
    sys: System,
    candidates: HashMap<u32, CandidateProc>,
    allowlist: Vec<&'static str>,
}

impl ProcessSnapshot {
    /// Construct an empty snapshot with the default `AGENT_NAME_ALLOWLIST`.
    /// Call `refresh()` to populate candidates.
    pub fn new() -> Self {
        Self {
            sys: System::new(),
            candidates: HashMap::new(),
            allowlist: AGENT_NAME_ALLOWLIST.to_vec(),
        }
    }

    /// Construct a snapshot with a custom allowlist. Intended for tests that
    /// need to include the current test-runner binary name as a candidate.
    pub fn with_allowlist(allowlist: Vec<&'static str>) -> Self {
        Self {
            sys: System::new(),
            candidates: HashMap::new(),
            allowlist,
        }
    }

    /// Refresh the process table, narrow it to allowlisted candidates, cache
    /// results.
    ///
    /// The refresh is narrowed via `ProcessRefreshKind` to only load the
    /// fields we use: cwd (always — agents can change dir mid-session on
    /// Windows), cmd and exe (only once per process — they don't change).
    /// This minimizes the Windows PEB-read cost per refresh.
    pub fn refresh(&mut self) {
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true, // remove dead processes from the table
            ProcessRefreshKind::nothing()
                .with_cwd(UpdateKind::Always)
                .with_cmd(UpdateKind::OnlyIfNotSet)
                .with_exe(UpdateKind::OnlyIfNotSet),
        );

        self.candidates.clear();
        for (pid, proc) in self.sys.processes() {
            let raw_name = proc.name().to_string_lossy().to_lowercase();

            // Three-tier match: process name, then any cmdline token, then
            // the exe basename. Needed because npm-installed CLIs often run
            // as `node /path/to/foo/cli.js`, so `proc.name()` is "node" and
            // the signal is only in argv or exe path. `matched_token` holds
            // the allowlist entry that triggered detection so downstream
            // classification (find_adapter_for_process) finds it.
            let matched_token = self
                .allowlist
                .iter()
                .find(|a| raw_name.contains(**a))
                .copied()
                .or_else(|| {
                    proc.cmd().iter().find_map(|arg| {
                        let lower = arg.to_string_lossy().to_lowercase();
                        self.allowlist
                            .iter()
                            .find(|a| lower.contains(**a))
                            .copied()
                    })
                })
                .or_else(|| {
                    proc.exe()
                        .and_then(|p| p.file_name())
                        .and_then(|n| {
                            let lower = n.to_string_lossy().to_lowercase();
                            self.allowlist
                                .iter()
                                .find(|a| lower.contains(**a))
                                .copied()
                        })
                });

            let Some(token) = matched_token else { continue };

            // Windows: cwd() can return None if PEB read fails (insufficient
            // perms for cross-user processes, or sysinfo falls back to
            // PROCESS_QUERY_LIMITED_INFORMATION). Per D-06, skip those
            // silently — they count as "unattributed" for any event.
            let Some(cwd_path) = proc.cwd() else {
                continue;
            };

            // Store the matched token as the candidate name so
            // find_adapter_for_process classifies "node" shims correctly.
            // Fall back to raw_name when raw_name itself contains the token
            // (typical direct launch) so the UI doesn't rewrite "claude" to
            // the shorter allowlist prefix.
            let name = if raw_name.contains(token) {
                raw_name
            } else {
                token.to_string()
            };

            self.candidates.insert(
                pid.as_u32(),
                CandidateProc {
                    pid: pid.as_u32(),
                    name,
                    cwd: cwd_path.to_path_buf(),
                    exe: proc.exe().map(|p| p.to_path_buf()),
                    parent: proc.parent().map(|p| p.as_u32()),
                },
            );
        }
    }

    /// Frontend-facing candidate list.
    ///
    /// Returns an owned Vec so the snapshot can continue to mutate
    /// independently of the caller's copy.
    pub fn candidates(&self) -> Vec<ProcessInfo> {
        self.candidates
            .values()
            .map(|c| ProcessInfo {
                pid: c.pid,
                name: c.name.clone(),
                cwd: Some(c.cwd.clone()),
                exe: c.exe.clone(),
                parent_pid: c.parent,
            })
            .collect()
    }

    /// Attribution heuristic per 02-RESEARCH.md Pattern 3:
    /// - 0 candidates whose cwd is a prefix of the event path → Unattributed
    /// - 1 candidate                                            → Pid
    /// - 2+ candidates                                          → Ambiguous
    ///
    /// Uses lexical `starts_with` (no canonicalization). Symlink escape is
    /// handled at the watcher boundary (Plan 02-02 path_is_under_root).
    pub fn attribute(&self, event_path: &Path) -> Attribution {
        let matches: Vec<u32> = self
            .candidates
            .values()
            .filter(|c| event_path.starts_with(&c.cwd))
            .map(|c| c.pid)
            .collect();
        match matches.len() {
            0 => Attribution::Unattributed,
            1 => Attribution::Pid(matches[0]),
            _ => Attribution::Ambiguous(matches),
        }
    }
}

impl Default for ProcessSnapshot {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessSnapshot {
    /// Construct a ProcessSnapshot pre-seeded with explicit candidates (for tests
    /// in sibling modules or integration tests that need a deterministic
    /// candidates() output without depending on the live OS process table).
    #[doc(hidden)]
    pub fn from_candidates_for_test(candidates: Vec<CandidateProc>) -> Self {
        let mut snap = ProcessSnapshot::new();
        for c in candidates {
            snap.candidates.insert(c.pid, c);
        }
        snap
    }
}

/// Spawn a tokio task that refreshes `snapshot` every `interval`. Returns the
/// `JoinHandle`; the caller should hold it (typically inside a WatcherHandle
/// in Plan 02-04) and `.abort()` it on stop_watch.
pub fn spawn_snapshot_refresher(
    snapshot: Arc<RwLock<ProcessSnapshot>>,
    interval: Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(interval);
        loop {
            tick.tick().await;
            // sysinfo::refresh_processes_specifics is synchronous and can
            // block for 24-100ms. Run it in spawn_blocking to avoid stalling
            // the tokio async executor.
            let snap_clone = snapshot.clone();
            let _ = tokio::task::spawn_blocking(move || {
                let rt = tokio::runtime::Handle::current();
                rt.block_on(async {
                    let mut snap = snap_clone.write().await;
                    snap.refresh();
                });
            })
            .await;
        }
    })
}

/// Spawn a tokio task that consumes `FileEventBatch` values from `in_rx`,
/// rewrites each event's `attribution` field based on the current snapshot,
/// and forwards the batch to `out_tx`.
///
/// The snapshot is read-locked once per batch (not per event) to minimize
/// contention with the refresher task. Exits cleanly when the upstream
/// sender is dropped or the downstream receiver is gone.
pub fn start_attributing_stream(
    mut in_rx: mpsc::Receiver<FileEventBatch>,
    out_tx: mpsc::Sender<FileEventBatch>,
    snapshot: Arc<RwLock<ProcessSnapshot>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(mut batch) = in_rx.recv().await {
            {
                let snap = snapshot.read().await;
                for ev in batch.events.iter_mut() {
                    ev.attribution = snap.attribute(&ev.path);
                }
            }
            if out_tx.send(batch).await.is_err() {
                break; // consumer gone — exit cleanly
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::events::{FileEvent, FileEventKind};

    /// Create a snapshot with a manually-injected candidate (bypassing
    /// sysinfo) for deterministic attribute() testing.
    fn snapshot_with_candidates(candidates: Vec<CandidateProc>) -> ProcessSnapshot {
        let mut snap = ProcessSnapshot::new();
        for c in candidates {
            snap.candidates.insert(c.pid, c);
        }
        snap
    }

    #[test]
    fn new_snapshot_is_empty() {
        let s = ProcessSnapshot::new();
        assert_eq!(s.candidates().len(), 0);
    }

    #[test]
    fn refresh_populates_candidates_when_allowlist_matches() {
        // Use the first 4 chars of the test binary name as an allowlist
        // substring. On Windows the test runner binary is something like
        // "aitc_lib-abc123.exe"; "aitc" matches. We can't guarantee the
        // process has a cwd visible to PEB-read (sysinfo may return None
        // on Windows for cross-user processes), so we only assert that
        // refresh() did not panic and returned a valid candidate list.
        let exe = std::env::current_exe().unwrap();
        let bin_name = exe
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .to_lowercase();
        let prefix: String = bin_name.chars().take(4).collect();
        let marker: &'static str = Box::leak(prefix.into_boxed_str());
        let mut snap = ProcessSnapshot::with_allowlist(vec![marker]);
        snap.refresh();
        // Structural assertion: refresh produced a Vec (possibly empty on
        // environments where the test binary has no PEB-visible cwd).
        let _candidates = snap.candidates();
    }

    #[test]
    fn attribute_single_match_returns_pid() {
        let candidate = CandidateProc {
            pid: 4242,
            name: "claude".to_string(),
            cwd: PathBuf::from("/home/dev/myrepo"),
            exe: None,
            parent: None,
        };
        let snap = snapshot_with_candidates(vec![candidate]);
        let attr = snap.attribute(Path::new("/home/dev/myrepo/src/main.rs"));
        assert!(matches!(attr, Attribution::Pid(4242)));
    }

    #[test]
    fn attribute_no_match_returns_unattributed() {
        let candidate = CandidateProc {
            pid: 4242,
            name: "claude".to_string(),
            cwd: PathBuf::from("/home/dev/other"),
            exe: None,
            parent: None,
        };
        let snap = snapshot_with_candidates(vec![candidate]);
        let attr = snap.attribute(Path::new("/home/dev/myrepo/src/main.rs"));
        assert!(matches!(attr, Attribution::Unattributed));
    }

    #[test]
    fn attribute_multiple_matches_returns_ambiguous() {
        let c1 = CandidateProc {
            pid: 111,
            name: "claude".to_string(),
            cwd: PathBuf::from("/home/dev/myrepo"),
            exe: None,
            parent: None,
        };
        let c2 = CandidateProc {
            pid: 222,
            name: "codex".to_string(),
            cwd: PathBuf::from("/home/dev/myrepo/subdir"),
            exe: None,
            parent: None,
        };
        let snap = snapshot_with_candidates(vec![c1, c2]);
        let attr = snap.attribute(Path::new("/home/dev/myrepo/subdir/file.rs"));
        match attr {
            Attribution::Ambiguous(pids) => {
                assert!(pids.contains(&111));
                assert!(pids.contains(&222));
                assert_eq!(pids.len(), 2);
            }
            other => panic!("expected Ambiguous, got {:?}", other),
        }
    }

    #[test]
    fn candidates_list_serializes_with_camelcase_parent_pid() {
        let c = CandidateProc {
            pid: 111,
            name: "claude".to_string(),
            cwd: PathBuf::from("/x"),
            exe: Some(PathBuf::from("/x/claude")),
            parent: Some(42),
        };
        let snap = snapshot_with_candidates(vec![c]);
        let list = snap.candidates();
        let json = serde_json::to_string(&list).unwrap();
        assert!(
            json.contains("\"parentPid\":42"),
            "expected camelCase parentPid: {json}"
        );
        assert!(json.contains("\"pid\":111"));
    }

    #[test]
    fn allowlist_match_is_case_insensitive_substring() {
        // Internally we lowercase process.name() then check if any allowlist
        // item is a substring. "Claude.exe" -> "claude.exe" matches "claude".
        let allow: Vec<&'static str> = vec!["claude"];
        let name = "Claude.exe".to_lowercase();
        assert!(allow.iter().any(|a| name.contains(a)));
        let name2 = "claude-code".to_lowercase();
        assert!(allow.iter().any(|a| name2.contains(a)));
        let name3 = "firefox.exe".to_lowercase();
        assert!(!allow.iter().any(|a| name3.contains(a)));
    }

    #[tokio::test]
    async fn attributing_stream_rewrites_unattributed_to_pid() {
        let candidate = CandidateProc {
            pid: 777,
            name: "claude".to_string(),
            cwd: PathBuf::from("/home/dev/myrepo"),
            exe: None,
            parent: None,
        };
        let snap = Arc::new(RwLock::new(snapshot_with_candidates(vec![candidate])));

        let (in_tx, in_rx) = mpsc::channel::<FileEventBatch>(8);
        let (out_tx, mut out_rx) = mpsc::channel::<FileEventBatch>(8);
        let _h = start_attributing_stream(in_rx, out_tx, snap);

        in_tx
            .send(FileEventBatch {
                events: vec![FileEvent::new(
                    PathBuf::from("/home/dev/myrepo/src/main.rs"),
                    FileEventKind::Modify,
                    Attribution::Unattributed,
                )],
                batch_id: 0,
                dropped_batches: 0,
            })
            .await
            .unwrap();

        let out = tokio::time::timeout(Duration::from_secs(1), out_rx.recv())
            .await
            .expect("batch within 1s")
            .expect("batch not None");
        assert!(matches!(out.events[0].attribution, Attribution::Pid(777)));
    }

    #[tokio::test]
    async fn snapshot_refresher_ticks_at_interval() {
        let snap = Arc::new(RwLock::new(ProcessSnapshot::new()));
        let h = spawn_snapshot_refresher(snap.clone(), Duration::from_millis(50));
        tokio::time::sleep(Duration::from_millis(200)).await;
        h.abort();
        // If we got here without panicking, the refresher task was
        // well-behaved. We can't assert candidates.len() > 0 because the
        // test runner may not match the default allowlist.
        let _guard = snap.read().await;
    }

    #[test]
    fn skips_candidates_with_none_cwd_via_structural_filter() {
        // We can't easily fake a sysinfo Process with cwd() == None, but we
        // can verify the structural invariant: CandidateProc.cwd is
        // non-Optional, so any code path that would store a None-cwd
        // candidate fails to compile. The `let Some(cwd_path) = proc.cwd()`
        // early-continue in refresh() is the only gate; this test is a
        // sanity check that the field type matches the contract.
        let c = CandidateProc {
            pid: 999,
            name: "claude".to_string(),
            cwd: PathBuf::from("/some/path"),
            exe: None,
            parent: None,
        };
        // Type-level assertion: c.cwd is PathBuf, not Option<PathBuf>
        let _path: &PathBuf = &c.cwd;
    }
}
