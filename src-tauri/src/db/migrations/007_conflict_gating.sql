-- Phase 17: switch PreToolUse gating from tool-category to conflict-based.
-- Adds two nullable columns to approval_requests:
--   * conflict_with_agent_id — the OTHER agent whose write triggered the
--     gate (NULL for protected_path gates, legacy rows, future reasons).
--   * gate_reason — enum-shaped string: 'file_conflict' | 'protected_path'
--     | 'unknown' (NULL on legacy rows created before this migration).
-- Also empties pretool_gated_tools so the old category-based gating is off
-- by default (17-CONTEXT.md D-18). The storage key stays in app_settings
-- for future power-user revival (17-CONTEXT.md D-19) — DO NOT drop it.
--
-- No CHECK constraint on gate_reason — follows the precedent of migrations
-- 001-004 (status has no CHECK either, see 005 comment). Validation lives
-- in Rust via the GateReason enum (17-02-PLAN introduces this).
--
-- No new indexes — no query path filters by these columns today.
-- Adding indexes now would cost write throughput on create_approval_request_internal
-- for zero read benefit.

ALTER TABLE approval_requests ADD COLUMN conflict_with_agent_id TEXT;
ALTER TABLE approval_requests ADD COLUMN gate_reason TEXT;

-- Disable the legacy tool-category gating on existing installs.
UPDATE app_settings
   SET value = '[]'
 WHERE key = 'pretool_gated_tools';

-- On fresh installs the row didn't exist, so `get_pretool_gated_tools`
-- would bootstrap the default 5-item allowlist on first read (see
-- comms/app_settings.rs:50-57 "Bootstrap default"). The INSERT OR IGNORE
-- here forecloses that — the row exists empty, so the bootstrap branch
-- is never taken and the category gate stays off by default.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('pretool_gated_tools', '[]');
