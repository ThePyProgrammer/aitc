use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use crate::conflict::types::{ConflictAlert, FileWriteRecord};
use crate::pipeline::events::{Attribution, FileEventBatch, FileEventKind};

/// Sliding-window conflict detection engine.
///
/// Maintains a per-file record of recent writes and checks for overlapping
/// writes by different agents within the configurable time window.
pub struct ConflictEngine {
    /// Per-file sliding window of recent writes.
    recent_writes: HashMap<PathBuf, Vec<FileWriteRecord>>,
    /// The detection window duration.
    window: Duration,
    /// Cache of PID -> agent ID mappings (populated from registry lookups).
    pid_to_agent_id: HashMap<u32, String>,
    /// Batch counter for periodic sweep scheduling.
    batch_count: u64,
}

impl ConflictEngine {
    /// Create a new engine with the given detection window.
    pub fn new(window: Duration) -> Self {
        Self {
            recent_writes: HashMap::new(),
            window,
            pid_to_agent_id: HashMap::new(),
            batch_count: 0,
        }
    }

    /// Update the conflict detection window.
    pub fn set_window(&mut self, window: Duration) {
        self.window = window;
    }

    /// Register a PID -> agent ID mapping. Called when the registry learns
    /// about a new agent process.
    pub fn update_pid_mapping(&mut self, pid: u32, agent_id: String) {
        self.pid_to_agent_id.insert(pid, agent_id);
    }

    /// Process a batch of file events and return any detected conflicts.
    ///
    /// For each write event (Create or Modify) with a `Pid` attribution:
    /// 1. Evict expired entries from the file's sliding window
    /// 2. Check for writes by a *different* agent within the window
    /// 3. Record this write for future comparison
    pub fn process_batch(&mut self, batch: &FileEventBatch) -> Vec<ConflictAlert> {
        let mut alerts = Vec::new();
        let window_ms = self.window.as_millis() as i64;

        for event in &batch.events {
            // Only process write events (Create or Modify)
            match &event.kind {
                FileEventKind::Create | FileEventKind::Modify => {}
                _ => continue,
            }

            // Skip events we can't attribute to a specific agent
            let pid = match &event.attribution {
                Attribution::Pid(pid) => *pid,
                Attribution::Ambiguous(_) | Attribution::Unattributed => continue,
            };

            // Resolve agent ID from PID mapping, fall back to PID-based ID
            let agent_id = self
                .pid_to_agent_id
                .get(&pid)
                .cloned()
                .unwrap_or_else(|| format!("PID-{pid}"));

            // Get or create the file's write records
            let records = self.recent_writes.entry(event.path.clone()).or_default();

            // Evict entries older than the window
            records.retain(|r| event.timestamp_ms - r.timestamp_ms <= window_ms);

            // Check for conflicts: any remaining record from a DIFFERENT agent?
            for existing in records.iter() {
                if existing.agent_id != agent_id {
                    let conflict_id = format!(
                        "CNFL-{}-{:x}",
                        event.timestamp_ms,
                        // Simple hash from path + pids for uniqueness
                        {
                            let mut h: u64 = 0;
                            for b in event.path.to_string_lossy().bytes() {
                                h = h.wrapping_mul(31).wrapping_add(b as u64);
                            }
                            h ^ (existing.pid as u64) ^ (pid as u64)
                        }
                    );

                    alerts.push(ConflictAlert {
                        id: conflict_id,
                        file_path: event.path.clone(),
                        agent_a_id: existing.agent_id.clone(),
                        agent_a_pid: existing.pid,
                        agent_b_id: agent_id.clone(),
                        agent_b_pid: pid,
                        detected_at_ms: event.timestamp_ms,
                        conflict_window_ms: self.window.as_millis() as u64,
                        hunk_hints_a: existing.byte_range,
                        hunk_hints_b: None, // Current event has no byte range info yet
                        dismissed: false,
                    });

                    // Only generate one alert per file per event (avoid duplicates
                    // when multiple earlier agents touched the same file)
                    break;
                }
            }

            // Record this write
            records.push(FileWriteRecord {
                agent_id,
                pid,
                timestamp_ms: event.timestamp_ms,
                byte_range: None,
            });
        }

        // Periodic sweep every 100 batches to clean up empty file entries
        self.batch_count += 1;
        if self.batch_count % 100 == 0 {
            self.sweep_empty_files();
        }

        alerts
    }

    /// Evict all entries older than the current window from all files.
    pub fn evict_expired(&mut self, now_ms: i64) {
        let window_ms = self.window.as_millis() as i64;
        for records in self.recent_writes.values_mut() {
            records.retain(|r| now_ms - r.timestamp_ms <= window_ms);
        }
    }

    /// Remove file keys with no remaining records to prevent memory growth.
    pub fn sweep_empty_files(&mut self) {
        self.recent_writes.retain(|_, v| !v.is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::events::{Attribution, FileEvent, FileEventBatch, FileEventKind};
    use std::path::PathBuf;

    /// Helper to build a FileEventBatch from a list of (path, timestamp_ms, attribution) tuples.
    /// All events are Modify by default.
    fn make_batch(events: Vec<(PathBuf, i64, Attribution)>) -> FileEventBatch {
        make_batch_with_kind(
            events
                .into_iter()
                .map(|(p, t, a)| (p, t, a, FileEventKind::Modify))
                .collect(),
        )
    }

    fn make_batch_with_kind(
        events: Vec<(PathBuf, i64, Attribution, FileEventKind)>,
    ) -> FileEventBatch {
        FileEventBatch {
            events: events
                .into_iter()
                .map(|(path, timestamp_ms, attribution, kind)| FileEvent {
                    path,
                    kind,
                    timestamp_ms,
                    attribution,
                })
                .collect(),
            batch_id: 1,
            dropped_batches: 0,
        }
    }

    // Test 1: Two writes to same file by different PIDs within 5s window -> produces ConflictAlert
    #[test]
    fn test_conflict_detected_different_pids_within_window() {
        let mut engine = ConflictEngine::new(Duration::from_secs(5));
        let file = PathBuf::from("/repo/src/main.rs");

        // First write by PID 100 at t=1000
        let batch1 = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
        let alerts1 = engine.process_batch(&batch1);
        assert!(alerts1.is_empty(), "No conflict on first write");

        // Second write by PID 200 at t=3000 (within 5s window)
        let batch2 = make_batch(vec![(file.clone(), 3000, Attribution::Pid(200))]);
        let alerts2 = engine.process_batch(&batch2);
        assert_eq!(alerts2.len(), 1, "Should detect conflict");
        assert_eq!(alerts2[0].agent_a_pid, 100);
        assert_eq!(alerts2[0].agent_b_pid, 200);
        assert_eq!(alerts2[0].file_path, file);
        assert!(!alerts2[0].dismissed);
    }

    // Test 2: Two writes to same file by SAME PID within 5s window -> NO conflict
    #[test]
    fn test_no_conflict_same_pid() {
        let mut engine = ConflictEngine::new(Duration::from_secs(5));
        let file = PathBuf::from("/repo/src/main.rs");

        let batch1 = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
        let alerts1 = engine.process_batch(&batch1);
        assert!(alerts1.is_empty());

        let batch2 = make_batch(vec![(file.clone(), 3000, Attribution::Pid(100))]);
        let alerts2 = engine.process_batch(&batch2);
        assert!(
            alerts2.is_empty(),
            "Same PID should not trigger self-conflict"
        );
    }

    // Test 3: Two writes to same file by different PIDs OUTSIDE window (>5s apart) -> NO conflict
    #[test]
    fn test_no_conflict_outside_window() {
        let mut engine = ConflictEngine::new(Duration::from_secs(5));
        let file = PathBuf::from("/repo/src/main.rs");

        let batch1 = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
        engine.process_batch(&batch1);

        // 6001ms later (outside 5s window)
        let batch2 = make_batch(vec![(file.clone(), 6001, Attribution::Pid(200))]);
        let alerts2 = engine.process_batch(&batch2);
        assert!(
            alerts2.is_empty(),
            "Events outside window should not conflict"
        );
    }

    // Test 4: Two writes to different files by different PIDs within window -> NO conflict
    #[test]
    fn test_no_conflict_different_files() {
        let mut engine = ConflictEngine::new(Duration::from_secs(5));

        let batch1 = make_batch(vec![(
            PathBuf::from("/repo/a.rs"),
            1000,
            Attribution::Pid(100),
        )]);
        engine.process_batch(&batch1);

        let batch2 = make_batch(vec![(
            PathBuf::from("/repo/b.rs"),
            3000,
            Attribution::Pid(200),
        )]);
        let alerts2 = engine.process_batch(&batch2);
        assert!(
            alerts2.is_empty(),
            "Different files should not conflict"
        );
    }

    // Test 5: Unattributed events do NOT trigger conflicts
    #[test]
    fn test_unattributed_events_ignored() {
        let mut engine = ConflictEngine::new(Duration::from_secs(5));
        let file = PathBuf::from("/repo/src/main.rs");

        let batch1 = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
        engine.process_batch(&batch1);

        let batch2 = make_batch(vec![(file.clone(), 3000, Attribution::Unattributed)]);
        let alerts2 = engine.process_batch(&batch2);
        assert!(
            alerts2.is_empty(),
            "Unattributed events should not trigger conflicts"
        );
    }

    // Test 6: Ambiguous attribution does NOT trigger conflicts
    #[test]
    fn test_ambiguous_events_ignored() {
        let mut engine = ConflictEngine::new(Duration::from_secs(5));
        let file = PathBuf::from("/repo/src/main.rs");

        let batch1 = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
        engine.process_batch(&batch1);

        let batch2 = make_batch(vec![(
            file.clone(),
            3000,
            Attribution::Ambiguous(vec![100, 200]),
        )]);
        let alerts2 = engine.process_batch(&batch2);
        assert!(
            alerts2.is_empty(),
            "Ambiguous events should not trigger conflicts"
        );
    }

    // Test 7: evict_expired removes entries older than window
    #[test]
    fn test_evict_expired() {
        let mut engine = ConflictEngine::new(Duration::from_secs(5));
        let file = PathBuf::from("/repo/src/main.rs");

        // Add a write at t=1000
        let batch = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
        engine.process_batch(&batch);
        assert_eq!(engine.recent_writes.get(&file).unwrap().len(), 1);

        // Evict at t=7000 (6s later, past the 5s window)
        engine.evict_expired(7000);
        assert!(
            engine
                .recent_writes
                .get(&file)
                .map_or(true, |v| v.is_empty()),
            "Entry should be evicted after window expires"
        );
    }

    // Test 8: sweep_empty_files removes file keys with no remaining records
    #[test]
    fn test_sweep_empty_files() {
        let mut engine = ConflictEngine::new(Duration::from_secs(5));
        let file = PathBuf::from("/repo/src/main.rs");

        let batch = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
        engine.process_batch(&batch);
        assert!(engine.recent_writes.contains_key(&file));

        // Evict and sweep
        engine.evict_expired(7000);
        engine.sweep_empty_files();
        assert!(
            !engine.recent_writes.contains_key(&file),
            "Empty file key should be swept"
        );
    }

    // Test 9: ConflictAlert serializes to camelCase JSON with all fields
    #[test]
    fn test_conflict_alert_serialization() {
        let alert = ConflictAlert {
            id: "CNFL-1000-abc".to_string(),
            file_path: PathBuf::from("/repo/src/main.rs"),
            agent_a_id: "claude-code".to_string(),
            agent_a_pid: 100,
            agent_b_id: "codex".to_string(),
            agent_b_pid: 200,
            detected_at_ms: 3000,
            conflict_window_ms: 5000,
            hunk_hints_a: Some((0, 100)),
            hunk_hints_b: Some((50, 150)),
            dismissed: false,
        };
        let json = serde_json::to_string(&alert).expect("serialize");

        // Verify camelCase
        assert!(json.contains("\"agentAId\""), "should use camelCase: {json}");
        assert!(json.contains("\"agentAPid\""), "should use camelCase: {json}");
        assert!(json.contains("\"agentBId\""), "should use camelCase: {json}");
        assert!(json.contains("\"agentBPid\""), "should use camelCase: {json}");
        assert!(
            json.contains("\"detectedAtMs\""),
            "should use camelCase: {json}"
        );
        assert!(
            json.contains("\"conflictWindowMs\""),
            "should use camelCase: {json}"
        );
        assert!(
            json.contains("\"hunkHintsA\""),
            "should use camelCase: {json}"
        );
        assert!(
            json.contains("\"hunkHintsB\""),
            "should use camelCase: {json}"
        );
        assert!(
            json.contains("\"filePath\""),
            "should use camelCase: {json}"
        );

        // Verify roundtrip
        let back: ConflictAlert = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.id, "CNFL-1000-abc");
        assert_eq!(back.hunk_hints_a, Some((0, 100)));
    }

    // Test 10: Custom window duration (e.g., 10s) works correctly
    #[test]
    fn test_custom_window_duration() {
        let mut engine = ConflictEngine::new(Duration::from_secs(10));
        let file = PathBuf::from("/repo/src/main.rs");

        // Write by PID 100 at t=1000
        let batch1 = make_batch(vec![(file.clone(), 1000, Attribution::Pid(100))]);
        engine.process_batch(&batch1);

        // Write by PID 200 at t=8000 (7s later, within 10s window)
        let batch2 = make_batch(vec![(file.clone(), 8000, Attribution::Pid(200))]);
        let alerts = engine.process_batch(&batch2);
        assert_eq!(
            alerts.len(),
            1,
            "Should detect conflict within 10s window"
        );

        // Write by PID 300 at t=12000 (11s after first, outside 10s window, but within 10s of second)
        let batch3 = make_batch(vec![(file.clone(), 12000, Attribution::Pid(300))]);
        let alerts3 = engine.process_batch(&batch3);
        // PID 100's record at t=1000 is 11s old (expired), but PID 200's at t=8000 is 4s old (valid)
        assert_eq!(
            alerts3.len(),
            1,
            "Should detect conflict with PID 200 but not PID 100"
        );
        assert_eq!(alerts3[0].agent_a_pid, 200);
        assert_eq!(alerts3[0].agent_b_pid, 300);
    }
}
