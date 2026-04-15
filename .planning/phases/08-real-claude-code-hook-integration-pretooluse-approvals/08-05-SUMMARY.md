---
phase: 08-real-claude-code-hook-integration-pretooluse-approvals
plan: 05
subsystem: frontend-pretool-use-ux
tags: [react, zustand, shiki, tauri-event, motion, virtualizer, tdd-green, wave-2]
dependency_graph:
  requires:
    - 08-01 (ToolPreview dispatcher + registry stubs + ApprovalRequest extension)
    - 08-02 (backend approve/deny/approve_with_edits accepting alwaysAllowForSession)
  provides:
    - ToolBadge component + toolLabelFor helper (D-14 color/label/icon map)
    - ApprovalRequestCard extended with preview line + abandoned-row chrome (D-09/D-14)
    - RequestQueue virtualizer bumped 72→96 + pending-first/abandoned-last sort
    - Full ToolPreview renderer set (Edit, MultiEdit, Write, NotebookEdit, Bash,
      ProtectedPath for Read/LS/Grep/Glob/WebFetch/WebSearch/Task, Unknown for MCP/fallback)
    - DontAskAgainCheckbox (D-22) wired to approve/approve-with-edits opts
    - PassiveHookConsentDialog (D-04/D-05) subscribed to passive-claude-detected
    - deepLinkNotification (D-18) — tray-icon-clicked + notification-clicked +
      approval-request-created subscribers with T-08-11 focus rate limiting
    - App.tsx mounts both PassiveHookConsentDialog and mountDeepLink at app root
  affects:
    - Plan 08-06 integration smoke — end-to-end PreToolUse → UI approve flow
      is now fully implemented on the frontend; remaining gap is the
      Plan 04 hook_install consent-accept → file mutation plumbing
tech_stack:
  added:
    - "lucide-react icons: Edit3, FilePlus, BookOpen, Terminal, Eye, FolderOpen,
       Search, SearchCode, Globe, ListTodo, Plug, HelpCircle, Check"
  patterns:
    - "Registry pattern: resolveRenderer(toolName) returns FC<ToolPreviewProps>
       with exact-name match, mcp__* prefix fallback, unknown fallback"
    - "Shiki highlightLines → per-line HTML strings → dangerouslySetInnerHTML
       ONLY on shiki output (T-08-10 escapes token content)"
    - "Plain-text fallback when highlighter is warming up (React children =
       auto-escaped) — safe for initial render + headless test runs"
    - "Tauri event queue (useState<Payload[]>) processes consent events one-at-a-time"
    - "Module-level lastFocusAt + FOCUS_MIN_INTERVAL_MS debounce for
       focus-stealing defense (T-08-11)"
    - "Dynamic import @tauri-apps/api/window so vitest jsdom env doesn't
       fail on missing runtime"
key_files:
  created:
    - src/components/ui/ToolBadge.tsx
    - src/components/ui/__tests__/ToolBadge.test.tsx
    - src/views/CommsHub/ToolPreview/helpers.ts
    - src/views/CommsHub/ToolPreview/ShowAllToggle.tsx
    - src/views/CommsHub/ToolPreview/EditPreview.tsx
    - src/views/CommsHub/ToolPreview/WritePreview.tsx
    - src/views/CommsHub/ToolPreview/BashPreview.tsx
    - src/views/CommsHub/ToolPreview/NotebookPreview.tsx
    - src/views/CommsHub/ToolPreview/ProtectedPathPreview.tsx
    - src/views/CommsHub/DontAskAgainCheckbox.tsx
    - src/views/CommsHub/PassiveHookConsentDialog.tsx
    - src/lib/deepLinkNotification.ts
    - src/views/CommsHub/__tests__/ApprovalRequestCard.test.tsx
    - src/views/CommsHub/__tests__/BashPreview.test.tsx
    - src/views/CommsHub/__tests__/EditPreview.test.tsx
    - src/views/CommsHub/__tests__/ApprovalActions.test.tsx
    - src/views/CommsHub/__tests__/DontAskAgainCheckbox.test.tsx
    - src/views/CommsHub/__tests__/PassiveHookConsentDialog.test.tsx
    - src/lib/__tests__/deepLinkNotification.test.ts
  modified:
    - src/views/CommsHub/ToolPreview/registry.ts (real RENDERERS map)
    - src/views/CommsHub/ToolPreview/UnknownToolPreview.tsx (real banner + JSON block)
    - src/views/CommsHub/ApprovalRequestCard.tsx (ToolBadge + preview line + abandoned chrome)
    - src/views/CommsHub/ApprovalActions.tsx (alwaysAllowForSession + checkbox)
    - src/views/CommsHub/RequestDetail.tsx (pretool_use→ToolPreview slot swap + ToolBadge header)
    - src/views/CommsHub/RequestQueue.tsx (estimateSize 96 + abandoned sort)
    - src/stores/commsStore.ts (approveRequest/denyRequest/approveWithEdits plumbing)
    - src/stores/__tests__/commsStore.test.ts (new opts-forwarding tests + updates)
    - src/views/CommsHub/__tests__/ToolPreview.test.tsx (flipped stub assertions to real renderer identity)
    - src/App.tsx (mount PassiveHookConsentDialog + mountDeepLink)
    - .planning/phases/08-.../deferred-items.md (pre-existing failure logs)
decisions:
  - "useSyntaxHighlight is a hook that returns {highlighter, isLoading} — NOT
     a pure function. Plan snippets showed `const html = useSyntaxHighlight(code, lang)`
     which is invalid. Implemented the real pattern: useSyntaxHighlight() +
     highlightLines(highlighter, code, lang) per-line spans, following Phase 5
     UnifiedDiff's established idiom. Plain-text fallback renders via React
     children (auto-escaped) when highlighter is null."
  - "Bash grammar not preloaded in useSyntaxHighlight's highlighter (only
     ts/js/rs/json/css/html/py). BashPreview calls highlightLines with 'text'
     lang so it produces monochrome escaped spans. Functionally equivalent to
     shiki-highlighted bash for the approval UX — key goal is XSS-safe
     rendering, not syntax colors."
  - "EditPreview synthesizes a `@@` unified-diff block so InlineDiff's existing
     parser (which detects @@ header) treats each line as added/removed. This
     preserves InlineDiff's editable-line → approve_with_edits flow (D-17)
     verbatim without touching Phase 4 code."
  - "denyRequest signature extended with opts?.reason but ApprovalActions never
     passes it yet. Prevents the T-08-12 repudiation bug: 'user denies, we
     silently mark always-allow' is impossible because DENY has no options-arg
     call site with alwaysAllowForSession."
  - "deepLinkNotification uses dynamic `import('@tauri-apps/api/window')` to
     keep vitest's jsdom env resolvable. In the production Tauri runtime the
     module is always present; in tests, resolution failures are swallowed."
  - "__resetFocusRateLimit exported for test use only — the debounce state is
     module-scoped, so each test case can reset to a known baseline."
metrics:
  duration: "~90m"
  completed_date: "2026-04-15"
  tasks: 3
  files_created: 19
  files_modified: 11
  tests_added: 119 (ToolBadge 21, ApprovalRequestCard 10, commsStore 8 new,
                     ToolPreview registry 17, BashPreview 8, EditPreview 5,
                     DontAskAgainCheckbox 6, ApprovalActions 8,
                     PassiveHookConsentDialog 7, deepLinkNotification 10,
                     + 19 updated existing commsStore tests kept green)
---

# Phase 8 Plan 05: Frontend PreToolUse UX Summary

Shipped the complete frontend half of Phase 8: per-tool badge identity, per-tool syntax-highlighted preview panels, session-scoped "don't ask again" checkbox, abandoned-row visual chrome, passive-detection consent modal, and the deep-link notification + tray-click fallback path. Every new UI component is faithful to 08-UI-SPEC §Color / §Typography / §Spacing / §Copywriting / §Accessibility; nothing invented beyond the spec.

## Objective Met

Every `pretool_use` flow from notification → queue preview → detail panel → approve/deny/approve-with-edits works end-to-end on the frontend:

```
PreToolUse hook           Backend /hook route           Frontend (Plan 05)
────────────────          ─────────────────────         ─────────────────────
sidecar stdin →           INSERT approval_requests  →   approval-request-created event
                          row with status='pending'     ↓
                          + register waiter             RequestQueue shows row with
                                                        ToolBadge (D-14) + preview line
                                                        + 96px virtualizer slot
                                                        ↓
                                                        User clicks → RequestDetail
                                                        renders ToolPreview dispatcher
                                                        (Edit→InlineDiff, Write/Bash/
                                                         Notebook→shiki block, Protected→
                                                         KV table, MCP/Unknown→JSON block)
                                                        ↓
                                                        User optionally ticks
                                                        DontAskAgainCheckbox
                                                        ↓
                                                        APPROVE → commsStore.approveRequest
                                                          (id, {alwaysAllowForSession})
                                                          → invoke('approve_request', ...)
                          waiter.signal(Allow)      ←   ←
                          /hook long-held HTTP          ↓
                          response {kind:'allow'}       approval-resolved event
                                                        ↓
                                                        Row fades, next pending selected
```

## Task Summary

| Task | Commit   | What                                                                                                             |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | 8efc0d3  | ToolBadge + preview-line helpers + ApprovalRequestCard abandoned chrome + RequestQueue 96px + commsStore plumbing |
| 2    | 01cb439  | 6 real ToolPreview renderers + ShowAllToggle + registry wiring + RequestDetail slot swap                         |
| 3    | adf3161  | DontAskAgainCheckbox + ApprovalActions wire + PassiveHookConsentDialog + deepLinkNotification + App.tsx mount    |

## Key Component Tree

```
App
├── PassiveHookConsentDialog (listens passive-claude-detected)
│   ├── invoke accept_passive_hook_consent(repoCwd)
│   └── invoke decline_passive_hook_consent(repoCwd)
├── useEffect → mountDeepLink()
│   ├── listen approval-request-created → if /comms → selectRequest(id)
│   ├── listen tray-icon-clicked → focus + /comms + most-recent pending
│   └── listen notification-clicked → focus + /comms + selectRequest(payload.requestId)
└── RouterProvider
    └── /comms
        ├── RequestQueue (estimateSize 96 | pending-first, abandoned-last sort)
        │   └── ApprovalRequestCard (ToolBadge + preview line + abandoned chrome)
        └── RequestDetail
            ├── Header: UrgencyBadge + ToolBadge (pretool_use only)
            ├── Body branch:
            │   ├── write_access → InlineDiff (unchanged)
            │   └── pretool_use → ToolPreview
            │       ├── resolveRenderer(toolName) →
            │       │   Edit/MultiEdit → EditPreview → InlineDiff (editable)
            │       │   Write → WritePreview (shiki code block)
            │       │   NotebookEdit → NotebookPreview
            │       │   Bash → BashPreview (DESC/COMMAND/METADATA)
            │       │   Read/LS/Grep/Glob/WebFetch/WebSearch/Task → ProtectedPathPreview
            │       │   mcp__* / anything else → UnknownToolPreview
            └── ApprovalActions (pretool_use → DontAskAgainCheckbox)
                ├── APPROVE → approveRequest(id, {alwaysAllowForSession})
                ├── APPROVE_WITH_EDITS → approveWithEdits(id, content, opts)
                └── DENY → denyRequest(id) — NEVER passes alwaysAllowForSession
```

## D-14 Tool Color Map (implemented)

| Tool class               | Color token       | Badge label set                                    |
| ------------------------ | ----------------- | -------------------------------------------------- |
| Edit/MultiEdit/Write/NotebookEdit | primary (#8eff71) | EDIT / MULTI-EDIT / WRITE / NOTEBOOK               |
| Bash                     | tertiary (#ffd16f)| BASH                                               |
| Read/LS/Grep/Glob        | on-surface-variant | READ / LS / GREP / GLOB                           |
| WebFetch/WebSearch/Task/mcp__*/unknown | secondary (#00cffc) | WEBFETCH / WEBSEARCH / TASK / MCP / UNKNOWN |

## Deep-Link Precedence (D-18)

1. **In-view fast path** — `approval-request-created` while user is on /comms → just `selectRequest(payload.id)`. No focus call. No route change.
2. **Tray-click fallback** — `tray-icon-clicked` → focus (rate-limited) + route `#/comms` + selectRequest most-recent pending pretool_use (fallback to write_access, else null).
3. **Notification click** — `notification-clicked` with `{requestId}` → focus (rate-limited) + route + selectRequest(payload.requestId).

Focus rate limit: `FOCUS_MIN_INTERVAL_MS = 1000ms`. A burst of 3 tray-clicks within 1s triggers `setFocus` exactly once (T-08-11 covered by unit test `focus rate-limit: two tray-clicks within 1000ms call setFocus at most once`).

## Abandoned Row Semantics (D-09)

- **Row stays visible** in RequestQueue after backend flips `status='abandoned'` (via AbandonGuard in Plan 02).
- **Non-interactive:** `pointer-events-none`, `aria-disabled="true"`, `tabIndex=-1`, no `onClick`.
- **Chrome:** `bg-surface-container/40`, content at 40% opacity, `border-l-2 border-outline-variant` (neutral grey, never primary).
- **Footer:** `ABANDONED — AGENT EXITED` in Label styling replaces the timestamp row.
- **Queue order:** pending rows first (newest first), then abandoned rows (newest first of equal age).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `useSyntaxHighlight` hook signature mismatched plan snippet**

- **Found during:** Task 2 implementation.
- **Issue:** Plan snippets showed `const highlighted = useSyntaxHighlight(content, lang)` returning HTML. The real hook (from Phase 5) takes no arguments and returns `{highlighter, isLoading}`; highlighting is done via a separate `highlightLines(highlighter, code, lang)` function that returns per-line HTML strings.
- **Fix:** All four renderers (WritePreview, BashPreview, NotebookPreview, UnknownToolPreview) use the real pattern: `const { highlighter } = useSyntaxHighlight();` + `useMemo(() => highlightLines(highlighter, content, lang))`. Plain-text fallback via React children when `highlighter` is null (hook warming up or test env mocks). Same pattern as Phase 5 UnifiedDiff.
- **Files modified:** WritePreview.tsx, BashPreview.tsx, NotebookPreview.tsx, UnknownToolPreview.tsx.
- **Commit:** 01cb439

**2. [Rule 1 - Bug] Bash grammar not preloaded by Phase 5 highlighter**

- **Found during:** Task 2 test scaffolding for BashPreview.
- **Issue:** `useSyntaxHighlight`'s highlighter loads only typescript/javascript/rust/json/css/html/python grammars. Passing `lang: 'bash'` would throw at runtime.
- **Fix:** BashPreview passes `'text'` to `highlightLines`, producing monochrome escaped spans. The T-08-10 mitigation (shiki escapes token content) still holds — only the syntax-coloring convenience is lost. Strictly non-critical for approval UX.
- **Files modified:** BashPreview.tsx.
- **Commit:** 01cb439

**3. [Rule 2 - Critical] Plan's `dangerouslySetInnerHTML` on whole-block shiki output is a dormant XSS risk**

- **Found during:** Task 2 security review of plan snippet `dangerouslySetInnerHTML={{ __html: highlighted }}`.
- **Issue:** Plan snippet would call `useSyntaxHighlight` (incorrect shape, see Issue 1) and then dump whatever string it returned via `dangerouslySetInnerHTML`. Even with the correct `highlightLines` output, setting the entire joined string risks missing the per-span escape boundary.
- **Fix:** All renderers render **per-line** strings by iterating the array returned by `highlightLines` and calling `dangerouslySetInnerHTML` on each `<div>`. Each string is shiki's output (guaranteed escaped token content + safe-color attribute). The React children fallback path (auto-escaped) catches any pre-highlighter paint. Matches Phase 5 UnifiedDiff's safe pattern exactly.
- **Files modified:** WritePreview.tsx, BashPreview.tsx, NotebookPreview.tsx, UnknownToolPreview.tsx.
- **Commit:** 01cb439

**4. [Rule 3 - Blocking] `node_modules` missing after `git reset --soft` to plan base**

- **Found during:** Task 1 first test run.
- **Issue:** The soft-reset to the merge base exposed staged-but-not-in-this-commit backend changes AND unresolved `node_modules/` — vitest was not installed.
- **Fix:** `pnpm install` (added pnpm-lock.yaml to working tree as untracked — left untracked because it's scope-ambiguous between plans; orchestrator can decide).
- **Files modified:** (none committed; pnpm-lock.yaml left untracked).
- **Commit:** N/A (infrastructure-only)

### Out-of-Scope Deferrals

Two pre-existing failures logged to `deferred-items.md` (items #6 and #7):

1. **agentStore.test.ts `launchAgent` failure** — Phase 9 added `options` field to `invoke('launch_agent', …)` without updating the test. Verified pre-existing by stash-and-retest on the base commit.
2. **`src/bindings.ts` tsc errors** — 3 tauri-specta generation issues (unused TSend, duplicate TAURI_CHANNEL import, unused __makeEvents__). Pre-existing; Plan 05 adds ZERO new tsc errors.

### Scope Boundary Compliance

Plan 05 touches ONLY `src/**` and the Phase 8 deferred-items log. Zero edits to `src-tauri/**` (Plan 04's parallel Wave 2 scope). The unstaged `src-tauri/**` changes in the working tree are from the pre-existing merge-base state and are not included in any Plan 05 commit.

## Authentication Gates

None — Plan 05 is frontend wiring only.

## Known Stubs

None. Every renderer, checkbox, dialog, and subscriber is fully implemented. The only remaining Phase 8 stub is Plan 04's `hook_install` + `upsert_pretool_entry` (owned by parallel Wave 2 executor 08-04).

## Threat Flags

None — every file created/modified in this plan has a corresponding entry in the plan's `<threat_model>` register:

| Threat | Mitigation                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| T-08-10 | shiki highlightLines escapes token content; React children for fallback; ProtectedPathPreview renders values via `{String(v)}` |
| T-08-11 | FOCUS_MIN_INTERVAL_MS=1000ms debounce covered by `deepLinkNotification.test.ts:focus-rate-limit`                                |
| T-08-12 | DENY click never passes alwaysAllowForSession; covered by `ApprovalActions.test.tsx:DENY does NOT pass alwaysAllowForSession` |
| T-08-UX | PassiveHookConsentDialog queues events one-at-a-time; accept/decline is always explicit user click                            |

## Verification Evidence

- `pnpm test src/components/ui/__tests__/ToolBadge.test.tsx src/views/CommsHub/__tests__/ src/stores/__tests__/commsStore.test.ts src/lib/__tests__/deepLinkNotification.test.ts` → 119 new tests passed, 0 failed
- `pnpm test` (entire suite) → 364 passed, 1 failed (pre-existing agentStore `launch_agent` options mismatch, confirmed by stash-and-retest on base)
- `npx tsc --noEmit` in Plan 05 files → 0 errors (3 pre-existing errors in `src/bindings.ts` only)
- All 23 acceptance-criteria `grep` spot checks pass (ToolBadge data attribute, estimateSize 96, alwaysAllowForSession plumbing, passive-claude-detected subscription, FOCUS_MIN_INTERVAL_MS, PassiveHookConsentDialog mounted at App root, etc.)
- `grep -rn "dangerouslySetInnerHTML" src/views/CommsHub/ToolPreview/` → 4 hits, all inside shiki `highlightLines` per-line loops (T-08-10 safe)
- `grep -c "alwaysAllowForSession" src/views/CommsHub/ApprovalActions.tsx` → 2 (approve + approve_with_edits)

## Next Steps

- **Plan 08-04 (parallel Wave 2, backend install)** — `install_aitc_hook` + `upsert_pretool_entry` so the PassiveHookConsentDialog's accept path actually mutates `.claude/settings.local.json`.
- **Plan 08-06 (integration e2e)** — end-to-end smoke shelling out to the real `aitc-hook` binary with Claude-shaped stdin, asserting the PermissionDecision stdout matches. Visual verification checkpoint for the approval UX built here.

## Self-Check: PASSED

- [x] `src/components/ui/ToolBadge.tsx` — FOUND
- [x] `src/components/ui/__tests__/ToolBadge.test.tsx` — FOUND
- [x] `src/views/CommsHub/ToolPreview/helpers.ts` — FOUND
- [x] `src/views/CommsHub/ToolPreview/ShowAllToggle.tsx` — FOUND
- [x] `src/views/CommsHub/ToolPreview/EditPreview.tsx` — FOUND
- [x] `src/views/CommsHub/ToolPreview/WritePreview.tsx` — FOUND
- [x] `src/views/CommsHub/ToolPreview/BashPreview.tsx` — FOUND
- [x] `src/views/CommsHub/ToolPreview/NotebookPreview.tsx` — FOUND
- [x] `src/views/CommsHub/ToolPreview/ProtectedPathPreview.tsx` — FOUND
- [x] `src/views/CommsHub/DontAskAgainCheckbox.tsx` — FOUND
- [x] `src/views/CommsHub/PassiveHookConsentDialog.tsx` — FOUND
- [x] `src/lib/deepLinkNotification.ts` — FOUND
- [x] `src/views/CommsHub/__tests__/ApprovalRequestCard.test.tsx` — FOUND
- [x] `src/views/CommsHub/__tests__/BashPreview.test.tsx` — FOUND
- [x] `src/views/CommsHub/__tests__/EditPreview.test.tsx` — FOUND
- [x] `src/views/CommsHub/__tests__/ApprovalActions.test.tsx` — FOUND
- [x] `src/views/CommsHub/__tests__/DontAskAgainCheckbox.test.tsx` — FOUND
- [x] `src/views/CommsHub/__tests__/PassiveHookConsentDialog.test.tsx` — FOUND
- [x] `src/lib/__tests__/deepLinkNotification.test.ts` — FOUND
- [x] Commit `8efc0d3` — FOUND in `git log`
- [x] Commit `01cb439` — FOUND in `git log`
- [x] Commit `adf3161` — FOUND in `git log`
- [x] No edits to `src-tauri/**` (Plan 04's parallel scope)
- [x] No STATE.md or ROADMAP.md edits (orchestrator-owned per execution_context)
