-- Phase 10: agent_events table backs the new first-class chat UI.
-- D-13: event_type is a free-form string (forward-compat); D-14 locks columns;
-- D-21: one-shot migration copies existing chat_messages rows then empties the source.

CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    approval_request_id INTEGER REFERENCES approval_requests(id),
    sequence_number INTEGER,
    delivery_status TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_events_agent_created ON agent_events(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_session_sequence ON agent_events(session_id, sequence_number);

-- D-21 one-shot data migration: chat_messages -> agent_events.
-- Use CASE on direction to map to 'user_text' / 'assistant_text' per RESEARCH.md § Stored data.
-- delivery_status only carries on outbound rows; inbound rows get NULL.
INSERT INTO agent_events (agent_id, session_id, event_type, payload_json, approval_request_id, sequence_number, delivery_status, created_at)
SELECT
    agent_id,
    NULL,
    CASE direction WHEN 'outbound' THEN 'user_text' ELSE 'assistant_text' END,
    json_object('content', content),
    approval_request_id,
    ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at),
    CASE direction WHEN 'outbound' THEN delivery_status ELSE NULL END,
    created_at
FROM chat_messages;

-- Leave chat_messages in place but empty (D-21 "later cleanup phase can drop it").
DELETE FROM chat_messages;
