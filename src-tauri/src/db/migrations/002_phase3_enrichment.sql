-- Phase 3: Enrich agent_sessions with adapter and intent data
ALTER TABLE agent_sessions ADD COLUMN adapter_type TEXT;
ALTER TABLE agent_sessions ADD COLUMN protocol TEXT;
ALTER TABLE agent_sessions ADD COLUMN intent TEXT;
ALTER TABLE agent_sessions ADD COLUMN pid INTEGER;
ALTER TABLE agent_sessions ADD COLUMN cwd TEXT;
ALTER TABLE agent_sessions ADD COLUMN launched_by_aitc INTEGER NOT NULL DEFAULT 0;

-- Phase 3: Enrich conflict_events with window and hunk data
ALTER TABLE conflict_events ADD COLUMN conflict_window_ms INTEGER;
ALTER TABLE conflict_events ADD COLUMN agent_a_id TEXT;
ALTER TABLE conflict_events ADD COLUMN agent_b_id TEXT;
ALTER TABLE conflict_events ADD COLUMN hunk_hints TEXT;
