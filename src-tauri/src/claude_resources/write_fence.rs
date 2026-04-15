//! Phase 9 Plan 02 — self-write suppression registry.
//!
//! When the app writes a CLAUDE.md (D-14 save flow), the notify watcher
//! will re-emit that path as a Modify event ~100-150ms later. Without a
//! fence, the user would see a spurious "file changed on disk" banner for
//! their own save. `WriteFence::record` stamps the path with an expiry
//! `Instant`; `was_ours` returns true for any read until the TTL elapses.
//!
//! Cloneable via `Arc<RwLock<..>>` so Plan 03 can hand a copy to both the
//! watcher drain task and the `write_claude_md` Tauri command handler
//! without further wrapping (RESEARCH Pattern 4, Pitfall 3).

#![allow(dead_code)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

/// Default TTL — must exceed the 150ms debouncer window + a margin for
/// tokio scheduling delay. 2 seconds is the research-recommended value
/// (Pitfall 3).
pub const DEFAULT_TTL: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct WriteFence {
    inner: Arc<RwLock<HashMap<PathBuf, Instant>>>,
    ttl: Duration,
}

impl WriteFence {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            ttl: DEFAULT_TTL,
        }
    }

    /// Construct a fence with a custom TTL. Public so integration tests in
    /// Plan 03 can exercise expiry behavior deterministically.
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            ttl,
        }
    }

    /// Stamp `path` as "we just wrote this" with expiry = now + ttl.
    pub fn record(&self, path: PathBuf) {
        let expires_at = Instant::now() + self.ttl;
        self.inner
            .write()
            .expect("WriteFence lock poisoned")
            .insert(path, expires_at);
    }

    /// Return true iff `path` is in the registry AND its expiry hasn't
    /// passed. Called by the watcher drain task before emitting an
    /// `ExternalEdit` event.
    pub fn was_ours(&self, path: &Path) -> bool {
        match self
            .inner
            .read()
            .expect("WriteFence lock poisoned")
            .get(path)
        {
            Some(expiry) => Instant::now() < *expiry,
            None => false,
        }
    }

    /// Drop all expired entries. Call periodically (e.g. once per drained
    /// batch) to bound memory growth.
    pub fn gc(&self) {
        let now = Instant::now();
        self.inner
            .write()
            .expect("WriteFence lock poisoned")
            .retain(|_, exp| now < *exp);
    }

    /// Test helper: current map size.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.inner.read().unwrap().len()
    }
}

impl Default for WriteFence {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn records_and_detects_within_ttl() {
        let fence = WriteFence::new();
        let path = PathBuf::from("/tmp/CLAUDE.md");
        fence.record(path.clone());
        assert!(fence.was_ours(&path));
    }

    #[test]
    fn expires_after_ttl() {
        let fence = WriteFence::with_ttl(Duration::from_millis(100));
        let path = PathBuf::from("/tmp/a");
        fence.record(path.clone());
        assert!(fence.was_ours(&path));
        thread::sleep(Duration::from_millis(150));
        assert!(
            !fence.was_ours(&path),
            "should have expired after ttl + margin"
        );
    }

    #[test]
    fn unrelated_path_returns_false() {
        let fence = WriteFence::new();
        fence.record(PathBuf::from("/a"));
        assert!(!fence.was_ours(Path::new("/b")));
    }

    #[test]
    fn clone_shares_state() {
        let fence = WriteFence::new();
        let clone = fence.clone();
        let path = PathBuf::from("/tmp/shared");
        fence.record(path.clone());
        assert!(
            clone.was_ours(&path),
            "clone must see records made via the original handle"
        );
    }

    #[test]
    fn periodic_cleanup_removes_expired() {
        let fence = WriteFence::with_ttl(Duration::from_millis(50));
        fence.record(PathBuf::from("/tmp/x"));
        fence.record(PathBuf::from("/tmp/y"));
        assert_eq!(fence.len(), 2);
        thread::sleep(Duration::from_millis(120));
        fence.gc();
        assert_eq!(fence.len(), 0, "gc should prune all expired entries");
    }

    #[test]
    fn configurable_ttl() {
        let fence = WriteFence::with_ttl(Duration::from_millis(200));
        let path = PathBuf::from("/tmp/ttl-test");
        fence.record(path.clone());
        thread::sleep(Duration::from_millis(50));
        assert!(fence.was_ours(&path), "still within 200ms");
        thread::sleep(Duration::from_millis(200));
        assert!(!fence.was_ours(&path), "past 200ms ttl");
    }
}
