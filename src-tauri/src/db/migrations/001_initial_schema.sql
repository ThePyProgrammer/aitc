-- Agent session records (foundation for HIST-01)
CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conflict event log (foundation for HIST-02)
CREATE TABLE IF NOT EXISTS conflict_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_a_id INTEGER REFERENCES agent_sessions(id),
    session_b_id INTEGER REFERENCES agent_sessions(id),
    file_path TEXT NOT NULL,
    resolution TEXT,
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);

-- Approval request log (foundation for HIST-03)
CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES agent_sessions(id),
    request_type TEXT NOT NULL,
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);

-- App settings (key-value store)
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
