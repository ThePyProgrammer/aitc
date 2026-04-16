-- Phase 8: Extend approval_requests to carry Claude Code PreToolUse context.
-- Adds tool_name, tool_input_json (serialized JSON of Claude's tool_input),
-- and session_id (Claude's PreToolUse session_id for correlation).
-- Introduces the 'abandoned' status value used when /hook detects client
-- disconnect via the AbandonGuard drop path. No existing row is affected:
-- pretool_use rows are the first consumers of the new columns.

ALTER TABLE approval_requests ADD COLUMN tool_name TEXT;
ALTER TABLE approval_requests ADD COLUMN tool_input_json TEXT;
-- session_id already exists from 001_initial_schema.sql (INTEGER REFERENCES agent_sessions).
-- Phase 8 uses Claude's string session_id for hook correlation, stored in a separate column.
ALTER TABLE approval_requests ADD COLUMN hook_session_id TEXT;

-- No CHECK constraint on status exists (verified against migrations 001-004),
-- so 'abandoned' can be inserted without dropping/recreating a constraint.
-- Add an index on tool_name to keep future "filter by tool" queries cheap.
CREATE INDEX IF NOT EXISTS idx_approval_requests_tool ON approval_requests(tool_name);
CREATE INDEX IF NOT EXISTS idx_approval_requests_hook_session ON approval_requests(hook_session_id);
