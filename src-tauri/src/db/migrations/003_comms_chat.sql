-- Enrich existing approval_requests with diff content, urgency, agent context
ALTER TABLE approval_requests ADD COLUMN diff_content TEXT;
ALTER TABLE approval_requests ADD COLUMN urgency TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE approval_requests ADD COLUMN agent_id TEXT;
ALTER TABLE approval_requests ADD COLUMN response_note TEXT;
ALTER TABLE approval_requests ADD COLUMN edited_content TEXT;

-- Chat messages table (COMM-04, D-15)
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
    content TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'queued'
        CHECK(delivery_status IN ('delivered', 'queued', 'unsupported')),
    approval_request_id INTEGER REFERENCES approval_requests(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chat_messages_agent ON chat_messages(agent_id, created_at);
CREATE INDEX idx_approval_requests_status ON approval_requests(status);

-- Protected paths for synthetic approval requests (D-07)
CREATE TABLE IF NOT EXISTS protected_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    glob_pattern TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
