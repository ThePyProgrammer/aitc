---
phase: 04-core-ui-views
plan: 01
subsystem: comms-backend
tags: [rust, tauri-commands, sqlite, approval-workflow, chat, protected-paths, pipeline]
dependency_graph:
  requires: [pipeline-broadcast-channel, db-migrations, agent-registry]
  provides: [comms-commands, approval-workflow-api, chat-api, protected-path-trigger, tree-index-api]
  affects: [frontend-comms-hub, frontend-radar, frontend-tower-control]
tech_stack:
  added: [glob-0.3]
  patterns: [internal-function-delegation, broadcast-subscriber-fan-out, parameterized-sql, tauri-event-push]
key_files:
  created:
    - src-tauri/src/db/migrations/003_comms_chat.sql
    - src-tauri/src/comms/mod.rs
    - src-tauri/src/comms/types.rs
    - src-tauri/src/comms/commands.rs
    - src-tauri/src/comms/protected_path_trigger.rs
  modified:
    - src-tauri/src/pipeline/commands.rs
    - src-tauri/src/pipeline/pipeline_state.rs
    - src-tauri/src/lib.rs
    - src-tauri/Cargo.toml
    - src-tauri/Cargo.lock
decisions:
  - "Migration numbered 003 (not 002 as plan specified) because 002_phase3_enrichment.sql already exists"
  - "Used sqlx::query with manual row mapping instead of sqlx::query_as for flexibility with nullable columns"
  - "Agent ID in protected path trigger derived from PID using KAGENT format matching agents/commands.rs pattern"
metrics:
  duration: 15m
  completed: "2026-04-10"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 4 Plan 01: Comms Backend Foundation Summary

Rust backend for approval workflow, chat messaging, protected path triggers, and tree index exposure -- all via parameterized SQL and Tauri IPC commands

## What Was Built

### Task 1: DB Migration and Comms Module Types
- Created `003_comms_chat.sql` migration enriching `approval_requests` with diff_content, urgency, agent_id, response_note, edited_content columns
- Added `chat_messages` table with direction/delivery_status constraints and agent+timestamp index
- Added `protected_paths` table for D-07 glob pattern storage
- Created `comms/types.rs` with `ApprovalRequest`, `ChatMessage`, `ProtectedPath`, `TreeIndexEntry` structs (all specta-exported, serde camelCase)

### Task 2: Comms Tauri Commands, Protected Path Trigger, and get_tree_index
- **Approval workflow** (6 commands): `list_approval_requests`, `create_approval_request`, `approve_request`, `deny_request`, `ask_more_info`, `approve_with_edits`
- **Chat messaging** (3 commands): `send_chat_message`, `list_chat_messages`, `update_message_delivery_status`
- **Protected paths** (3 commands): `list_protected_paths`, `add_protected_path`, `remove_protected_path`
- **Internal function**: `create_approval_request_internal` for use by protected path trigger without Tauri State wrappers
- **Protected path trigger** (`protected_path_trigger.rs`): Subscribes to pipeline broadcast channel, matches write/create events against DB-stored glob patterns, generates synthetic approval requests with deduplication (T-04-14)
- **Tree index** (`get_tree_index`): Exposes pipeline tree data as `Vec<TreeIndexEntry>` for radar spatial map
- **Pipeline wiring**: Protected path watcher spawned alongside conflict engine, stored in `ActiveWatch`, aborted on stop_watch
- **OS notifications**: `dispatch_approval_notification` fires native notification on approval request creation
- **Tauri events**: `approval-request-created`, `approval-resolved`, `approval-updated`, `chat-message-sent` events for real-time frontend push

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migration numbered 003 instead of 002**
- **Found during:** Task 1
- **Issue:** Plan specified `002_comms_chat.sql` but `002_phase3_enrichment.sql` already exists from Phase 3
- **Fix:** Named migration `003_comms_chat.sql` instead; sqlx::migrate! auto-discovers by filename order
- **Files modified:** src-tauri/src/db/migrations/003_comms_chat.sql

**2. [Rule 3 - Blocking] db/mod.rs unchanged**
- **Found during:** Task 1
- **Issue:** Plan said to update db/mod.rs to apply migration 002, but db/mod.rs uses `sqlx::migrate!` macro which auto-discovers all migration files in the directory
- **Fix:** No changes needed to db/mod.rs -- the macro handles it automatically
- **Files modified:** None (correct behavior)

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-04-01 | All SQL queries use `sqlx::query().bind()` parameterized queries -- no string interpolation |
| T-04-03 | `create_approval_request_internal` called only from Rust backend (trigger or command); frontend cannot fabricate requests |
| T-04-14 | Deduplication check prevents duplicate pending requests for same agent_id + file_path |

## Decisions Made

1. Migration numbered 003 to avoid collision with existing 002_phase3_enrichment.sql
2. Manual row mapping via `sqlx::query` + `Row::get` for nullable column flexibility
3. Agent ID in protected path trigger uses KAGENT-XXXX format consistent with agents/commands.rs

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 4c7155e | DB migration 003 and comms module types |
| 2 | 64c73f4 | Comms Tauri commands, protected path trigger, get_tree_index |

## Known Stubs

None -- all commands are fully implemented with real SQL queries and event emission.

## Self-Check: PASSED

- All 6 created files exist on disk
- Both commits (4c7155e, 64c73f4) present in git log
- cargo check exits 0
- cargo test: 98 passed, 2 failed (pre-existing conflict engine test failures, not related to this plan)
