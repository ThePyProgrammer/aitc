//! File event types shared across the Phase 2 pipeline.
//!
//! These types are the canonical contract that downstream plans (02, 03, 04)
//! depend on. They are:
//! - Serializable via serde for `tauri::ipc::Channel` transport to the frontend
//! - Exported via specta for type-safe TypeScript bindings
//! - Cheap to clone (all owned data, no Arc-wrapping required at this layer)

use chrono::Utc;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

/// The kind of filesystem mutation observed.
///
/// Writes-only per D-11 — no read events. Rename carries both source and
/// destination paths so consumers don't need to correlate a separate
/// Remove+Create pair (the debouncer already does that work).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileEventKind {
    Create,
    Modify,
    Remove,
    Rename { from: PathBuf, to: PathBuf },
}

/// Which process we believe authored the file event.
///
/// Per D-05/D-06 this is best-effort. `Unattributed` is the common fallback
/// when sysinfo's process snapshot couldn't find an agent whose cwd contains
/// the event's path. `Ambiguous` carries every candidate PID so the UI can
/// surface the disambiguation rather than pick wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Attribution {
    Pid(u32),
    Ambiguous(Vec<u32>),
    Unattributed,
}

/// A single debounced, attributed filesystem event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEvent {
    pub path: PathBuf,
    pub kind: FileEventKind,
    /// Unix timestamp in milliseconds (UTC). i64 rather than u64 to match the
    /// `chrono::DateTime::timestamp_millis()` return type.
    pub timestamp_ms: i64,
    pub attribution: Attribution,
}

impl FileEvent {
    /// Construct a new event stamped with the current UTC time.
    pub fn new(path: PathBuf, kind: FileEventKind, attribution: Attribution) -> Self {
        Self {
            path,
            kind,
            timestamp_ms: Utc::now().timestamp_millis(),
            attribution,
        }
    }
}

/// A batch of events sent across the IPC boundary in one payload.
///
/// Batching amortizes the serde + Channel overhead across many events. The
/// `dropped_batches` counter is how the Rust side signals back-pressure to the
/// frontend: when the bounded tokio mpsc between the watcher and the sender
/// actor is full, whole batches are dropped and this counter increments.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEventBatch {
    pub events: Vec<FileEvent>,
    pub batch_id: u64,
    pub dropped_batches: u32,
}

impl FileEventBatch {
    pub fn new_empty() -> Self {
        Self {
            events: Vec::new(),
            batch_id: 0,
            dropped_batches: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_event_constructs_with_create_kind() {
        let ev = FileEvent::new(
            PathBuf::from("/tmp/foo.txt"),
            FileEventKind::Create,
            Attribution::Unattributed,
        );
        assert!(matches!(ev.kind, FileEventKind::Create));
        assert!(matches!(ev.attribution, Attribution::Unattributed));
        assert!(ev.timestamp_ms > 0);
    }

    #[test]
    fn empty_batch_has_zero_counts() {
        let b = FileEventBatch::new_empty();
        assert_eq!(b.events.len(), 0);
        assert_eq!(b.batch_id, 0);
        assert_eq!(b.dropped_batches, 0);
    }

    #[test]
    fn rename_event_roundtrips_json() {
        let ev = FileEvent::new(
            PathBuf::from("/tmp/a.txt"),
            FileEventKind::Rename {
                from: PathBuf::from("/tmp/a.txt"),
                to: PathBuf::from("/tmp/b.txt"),
            },
            Attribution::Pid(1234),
        );
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: FileEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(ev, back);
    }

    #[test]
    fn attribution_pid_serializes_camelcase() {
        let a = Attribution::Pid(1234);
        let json = serde_json::to_string(&a).expect("serialize");
        // #[serde(tag = "kind", content = "value", rename_all = "camelCase")]
        // should yield {"kind":"pid","value":1234}
        assert!(
            json.contains("\"kind\":\"pid\""),
            "expected camelCase 'pid' tag, got: {json}"
        );
        assert!(json.contains("1234"), "expected pid value 1234, got: {json}");
    }
}
