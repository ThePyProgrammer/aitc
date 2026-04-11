-- Conflict resolution records (HIST-02, D-11)
CREATE TABLE IF NOT EXISTS conflict_resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conflict_event_id INTEGER REFERENCES conflict_events(id),
    file_path TEXT NOT NULL,
    agent_a_id TEXT NOT NULL,
    agent_b_id TEXT NOT NULL,
    resolution_type TEXT NOT NULL CHECK(resolution_type IN ('accept_a', 'accept_b', 'manual', 'mixed')),
    backup_base_path TEXT,
    backup_a_path TEXT,
    backup_b_path TEXT,
    backup_merged_path TEXT,
    hunk_resolutions TEXT, -- JSON: [{hunkIndex, choice, customContent?}]
    notification_status TEXT DEFAULT 'pending',
    resolved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session file tracking junction table (D-09, HIST-01)
CREATE TABLE IF NOT EXISTS session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
    file_path TEXT NOT NULL,
    write_count INTEGER NOT NULL DEFAULT 1,
    last_written_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, file_path)
);

CREATE INDEX idx_session_files_session ON session_files(session_id);
CREATE INDEX idx_session_files_path ON session_files(file_path);
CREATE INDEX idx_conflict_resolutions_event ON conflict_resolutions(conflict_event_id);

-- Add file_count to agent_sessions for quick access (D-09)
ALTER TABLE agent_sessions ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0;

-- Add resolution_id to conflict_events for linking
ALTER TABLE conflict_events ADD COLUMN resolution_id INTEGER REFERENCES conflict_resolutions(id);
