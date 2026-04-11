---
phase: 04-core-ui-views
plan: 02
subsystem: communications-hub-ui
tags: [comms, approval-workflow, zustand, diff-viewer, ui]
dependency_graph:
  requires: [04-01]
  provides: [commsStore, CommsView, InlineDiff, ApprovalActions]
  affects: [Sidebar]
tech_stack:
  added: [diff, "@tanstack/react-virtual", "@types/diff"]
  patterns: [zustand-store-per-domain, tdd-red-green, tanstack-virtual, contentEditable-diff-editing]
key_files:
  created:
    - src/stores/commsStore.ts
    - src/stores/__tests__/commsStore.test.ts
    - src/views/CommsHub/RequestQueue.tsx
    - src/views/CommsHub/ApprovalRequestCard.tsx
    - src/views/CommsHub/RequestDetail.tsx
    - src/views/CommsHub/InlineDiff.tsx
    - src/views/CommsHub/ApprovalActions.tsx
    - src/components/ui/UrgencyBadge.tsx
    - src/components/ui/PendingCountBadge.tsx
  modified:
    - src/views/CommsView.tsx
    - src/components/layout/Sidebar.tsx
    - package.json
    - package-lock.json
decisions:
  - "Used contentEditable for inline diff editing instead of controlled textarea -- matches D-05 spec for click-to-edit UX"
  - "Edit-mode freeze in commsStore prevents incoming real-time updates from overwriting user edits (Pitfall 3 mitigation)"
  - "Two-step deny confirmation with 3s auto-revert timeout for T-04-07 threat mitigation"
metrics:
  duration_seconds: 595
  completed: "2026-04-10T17:29:32Z"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 15
  tests_total_passing: 53
  files_created: 9
  files_modified: 4
---

# Phase 4 Plan 02: Communications Hub Approval Workflow UI Summary

Zustand commsStore with full approval lifecycle (approve/deny/askMore/approveWithEdits), real-time event subscription, edit-mode freeze, and chat messaging. 3-panel CommsView with virtualized request queue, inline diff viewer with contentEditable editing, and 4-action approval buttons with keyboard shortcuts.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | 35f741a | test(04-02): add failing tests for commsStore approval workflow |
| 2 | 84fdfd4 | feat(04-02): implement commsStore with approval workflow and chat messaging |
| 3 | 4d6d34a | feat(04-02): add Communications Hub 3-panel layout with approval UI |

## Task Results

### Task 1: commsStore with approval workflow + tests (TDD)

- **RED:** 15 test cases written covering fetchRequests, selectRequest, approve/deny/askMore/approveWithEdits, subscribeToApprovals, pendingCount, setEditing freeze, sendMessage, fetchMessages, selectedRequest, reset
- **GREEN:** commsStore implementation following existing agentStore/conflictStore Zustand patterns
- Key features: edit-mode freeze (editingRequestId prevents incoming updates for frozen request), pendingCount/selectedRequest computed getters, optimistic sendMessage with invoke callback
- All 15 tests passing

### Task 2: Communications Hub 3-panel layout with approval UI components

- **CommsView.tsx:** 3-panel layout (280px | flex-1 | 260px) with lifecycle mount (fetchRequests + subscribeToApprovals with cleanup), keyboard shortcuts (Arrow Up/Down, Enter, A, D, Escape), empty state with blinking cursor
- **RequestQueue.tsx:** Virtualized via @tanstack/react-virtual (estimateSize 72, overscan 5), sorted newest first, pending-only filter, PENDING_APPROVALS header with count badge
- **ApprovalRequestCard.tsx:** Agent ID, request type, truncated file path (40 chars), UrgencyBadge, timestamp, selected state with primary left border, phosphor-in animation
- **InlineDiff.tsx:** Parses unified diff format and fallback via diffLines from 'diff' library. Added lines (#8eff71, rgba(142,255,113,0.05) bg), removed lines (#ff7351, rgba(255,115,81,0.05) bg, strikethrough), unchanged lines (#adaaaa). contentEditable on added lines for edit-to-approve workflow. Renders as text nodes (T-04-06 XSS mitigation)
- **ApprovalActions.tsx:** APPROVE (primary bg, hidden when edits exist), DENY (error bg, 2-step CONFIRM_DENY with 3s timeout -- T-04-07), ASK_FOR_MORE_INFO (ghost button, reveals inline text input), APPROVE_WITH_EDITS (primary bg, visible only with edits)
- **UrgencyBadge.tsx:** low/medium/high variants with appropriate color schemes
- **PendingCountBadge.tsx:** Primary-colored count with pulse animation on new requests, follows ConflictNavBadge pattern
- **Sidebar.tsx:** Added PendingCountBadge on COMMS nav item

## Deviations from Plan

None -- plan executed exactly as written.

## Threat Mitigations Applied

| Threat ID | Component | Mitigation |
|-----------|-----------|------------|
| T-04-06 | InlineDiff.tsx | Diff content rendered as JSX text nodes (React default escaping). No dangerouslySetInnerHTML. contentEditable captures only plain text via innerText |
| T-04-07 | ApprovalActions.tsx | Two-step deny confirmation with 3s auto-revert timeout prevents accidental denial |

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| TELEMETRY_PANEL placeholder | src/views/CommsView.tsx | Right panel (260px) is a placeholder -- will be implemented in Plan 04-04 |

## Self-Check: PASSED
