# Phase 8: Real Claude Code Hook Integration (PreToolUse approvals) - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Intercept every Claude Code tool call via the official PreToolUse hook contract, surface each gated call as an approval row in AITC's Comms Hub, and block Claude until the user approves/denies from the Requests page. Replaces the `--accept-edits` / `--dangerously-skip-permissions` launcher chip workaround so users can run Claude Code safely without pre-authorizing every tool, while keeping those chips as an explicit opt-out for power users.

This phase delivers:
- A Tauri sidecar binary (`aitc-hook`) that Claude Code invokes per the PreToolUse hook command contract. Reads stdin JSON, POSTs to AITC `/hook`, emits decision JSON on stdout (and/or exit code) back to Claude.
- A new `/hook` route on the existing self-registration HTTP server (`src-tauri/src/agents/self_register.rs`) that long-holds the response until the linked `approval_request` row is resolved.
- Hook config installation: per-launch write to `cwd/.claude/settings.local.json` for AITC-launched Claude sessions, plus a passive-detection prompt that offers to install the same per-repo config when an externally-launched Claude process is observed.
- DB migration extending `approval_requests` with `tool_name` and `tool_input_json` columns and introducing a new `request_type = 'pretool_use'`.
- Comms Hub UI extended with per-tool preview (tool-name badge, smart per-tool detail panel, truncation with expand, Edit/MultiEdit reuses the existing InlineDiff + approve_with_edits path).
- "Always allow for this session" per-tool escape hatch on the approve action.
- Tool scope defaults: write-class tools (Edit, MultiEdit, Write, NotebookEdit, Bash) gate by default; Read/LS/Grep/Glob/WebFetch/WebSearch/Task/MCP pass through. `protected_paths` additionally gate any tool touching a matching path (OR semantics).
- Deep-linked OS notification: click focuses AITC window, navigates to /comms, selects the originating request row.

**Not in scope (per ROADMAP.md Phase 8):**
- PostToolUse hooks, Codex/OpenCode adapters (no hook surface yet), multi-user auth on `/hook`, a full settings UI for allowlist tuning (stored in app_settings, edited via DB for v1), persistent "always allow for this path" beyond session scope.

</domain>

<decisions>
## Implementation Decisions

### Hook Install + Shape
- **D-01:** Hook config is written to `cwd/.claude/settings.local.json` for every AITC-launched Claude Code agent. File is merged (not overwritten) — if it already exists with user hook entries, AITC inserts the PreToolUse entry without disturbing the rest. `.local.json` is git-ignored by Claude Code's conventions so the repo stays clean.
- **D-02:** Hook command points at a Rust sidecar binary (`aitc-hook`) shipped via Tauri v2's sidecar bundling. Absolute path is resolved at install time via `tauri::path::BaseDirectory::Resource` (or equivalent) and written into the settings.local.json `command` field. No curl/jq/node dependency on the user's machine; consistent cross-OS behavior; small single-purpose binary.
- **D-03:** Sidecar contract:
  - Reads Claude's PreToolUse JSON from stdin (includes `tool_name`, `tool_input`, Claude's session/PID context).
  - Resolves AITC port: checks `AITC_PORT` env var first, then reads `~/.aitc/port` (a text file AITC writes on every startup). Missing both → fail-safe deny + stderr "AITC not running".
  - Captures its own parent PID (= Claude's PID) and forwards it in the POST body so `/hook` can correlate to an AgentRegistry row.
  - POSTs to `http://127.0.0.1:{port}/hook` with `{pid, tool_name, tool_input, cwd}`.
  - Blocks on the response (long-held HTTP). On `{decision: "approve"}` exits 0 with Claude's approval JSON on stdout; on `{decision: "approve_with_edits", modified_input}` emits the modified_input JSON; on `{decision: "deny", reason}` exits 2 with the reason on stderr per Claude Code's hook contract.
- **D-04:** Passive-detected Claude coverage: when `passive_bridge::bridge_tick` observes a claude process AITC did not launch, the user is shown a one-time Tauri dialog prompt ("install AITC hook into {repo}/.claude/settings.local.json?"). On accept, AITC writes settings.local.json into that repo's cwd only. No global `~/.claude/settings.json` install in v1. Prompts are deduplicated per-repo (remembered via app_settings).
- **D-05:** On agent terminate (via Tower Control), AITC does NOT clean up settings.local.json — it stays in place. Rationale: if the user later launches Claude manually in that repo while AITC is running, the hook still works; if AITC is not running, the sidecar fails-safe deny and logs "AITC not running". User removes manually if they want to bypass.
- **D-06:** `~/.aitc/port` file is written by AITC on every startup after `start_registration_server` returns the actual bound port. Format: plain text containing just the decimal port number. Located via `dirs::home_dir()`. Cleaned up on graceful shutdown via a `Drop` impl on a `PortFileGuard` helper.

### Blocking Transport + Timeout
- **D-07:** `/hook` blocks via a **long-held HTTP response**. Handler creates a tokio `oneshot::channel`, registers the sender in a global `HashMap<approval_request_id, oneshot::Sender<HookDecision>>` held as `Arc<Mutex<..>>`, inserts a pretool_use row via `create_approval_request_internal`, then awaits the receiver. When the user clicks approve/deny in the UI, `approve_request` / `deny_request` / `approve_with_edits` look up the sender by row id and fire. Single round-trip on localhost; no polling.
- **D-08:** **No timeout.** The /hook handler waits indefinitely for user resolution. Rationale: users explicitly want control; Claude is non-interactive (`--print`), so blocking is the intended UX. Hung sessions are cleaned up via D-09/D-10 rather than timeouts.
- **D-09:** Orphan cleanup via **client-disconnect detection**. Handler uses `tokio::select!` between the oneshot and `axum`'s connection-closed signal (`axum::extract::connect_info` + `hyper`'s `on_upgrade` equivalent, or simply racing against a drop-detection future on the request body). When Claude dies while blocked, the socket closes → AITC drops the waiter, removes the entry from the HashMap, and marks the approval_request row `status = 'abandoned'` (new status value). UI shows abandoned rows greyed out; they are not actionable.
- **D-10:** Force-deny on user-initiated terminate. `terminate_process` is extended: before killing Claude, it iterates the waiter HashMap for any entries whose agent_id matches the target and fires `deny` on them (reason: "agent terminated by user"). Prevents race between SIGTERM/taskkill and waiter cleanup.
- **D-11:** Fail-safe deny when AITC is unreachable. Sidecar returns exit code 2 with reason "AITC unreachable" if: port resolution fails, TCP connect fails, HTTP request fails, or non-2xx status is returned. Claude receives a deny and skips the tool call. This is the only mode — no fail-open escape.
- **D-12:** Agent correlation: sidecar includes `pid` (its parent, i.e. Claude's PID) in the POST body. `/hook` looks up in AgentRegistry by checking `KAGENT-{pid}` and `PASSIVE-{pid}`. If neither exists, AITC creates a `PASSIVE-{pid}` stub on the fly (reusing the existing PASSIVE reconciliation path from Phase 6 D-06) so the approval row has an `agent_id` to attach to.
- **D-13:** Waiter registry lives on `PipelineState` or a dedicated new shared struct (Claude's Discretion — planner picks). Must be accessible from both the axum `/hook` handler (via axum Extension) and the Tauri command handlers for approve/deny/approve_with_edits (via Tauri State). Suggested shape: `Arc<Mutex<HashMap<i64, oneshot::Sender<HookDecision>>>>` on a new `hook_waiters.rs` module.

### Tool Input Preview UI
- **D-14:** List card (`ApprovalRequestCard.tsx`) adds: tool-name badge adjacent to `UrgencyBadge` (e.g. `EDIT`, `BASH`, `WRITE`, `MULTI-EDIT`) styled with the Command Horizon phosphor accent. Keeps existing rows: agent id, request type label, file path, timestamp. Adds a single-line preview beneath file path:
  - Edit/MultiEdit → first changed line (prefixed `-` removal or `+` addition) truncated to ~50 chars
  - Write → first 50 chars of content (prefixed `+`)
  - Bash → first 60 chars of command (prefixed `$ `)
  - NotebookEdit → first 50 chars of the new_source
  - Read/LS/etc. (when on protected path) → em-dash (`—`)
- **D-15:** Detail panel routes per tool via a `ToolPreview` component with a registry of renderers:
  - **Edit / MultiEdit** → reuse existing `InlineDiff` with editable lines. Pre-image is read from `file_path` at request-open time (via a new command `read_file_snapshot` or inline `tokio::fs::read_to_string`). Reuses `approve_with_edits` flow end-to-end; on approval the modified `new_string` is serialized into a `modified_input` JSON sent back through the /hook decision.
  - **Write** → code block preview with language inferred from `file_path` extension, syntax-highlighted via `useSyntaxHighlight` (shiki, Phase 5 pattern). Shows first ~40 lines with `Show all` expand.
  - **Bash** → command block (shiki with `bash` lang) at the top. Above it: human-readable `description` field (when Claude provides one). Below: `cwd` (if present) and `timeout` field if set. Destructive-pattern highlighting is out of scope for v1.
  - **NotebookEdit** → like Write, syntax-highlighted as the cell's language.
  - **Read / LS / Grep / Glob / WebFetch / WebSearch** → path/query + params key-value table. Only surfaces when `protected_paths` triggered the gate (tool itself is not in default allowlist).
  - **Unknown tool / MCP** → pretty-printed JSON fallback in a shiki `json` code block.
- **D-16:** Truncation policy: all ToolPreview renderers truncate content > 40 lines or > 2 KB by default with a `Show all` toggle that reveals the full content in a scrollable container. Matches Phase 5 InlineDiff truncation style. No external-editor fallback in v1.
- **D-17:** `approve_with_edits` is supported for Edit/MultiEdit tools only in v1. Other tools get approve/deny. Modified content is serialized back into the hook decision as `modified_input` (Claude Code's PreToolUse contract).
- **D-18:** Deep-linked OS notification: `dispatch_approval_notification` is extended to include a payload with the `approval_request.id`. On notification click, Tauri brings the window to focus (`WindowExt::set_focus`), navigates to `/comms` (via a custom Tauri event consumed by the React Router or a hash update), and calls `commsStore.selectRequest(id)`. Fallback if the platform notification doesn't support onClick: clicking AITC's tray icon after a toast still focuses + routes to Comms (cheap default).

### Tool Scope + Noise Filtering
- **D-19:** Default gated tool allowlist (write-class + Bash): `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `Bash`. Read/LS/Grep/Glob/WebFetch/WebSearch/Task/MCP tools pass through — `/hook` returns `approve` immediately without creating a row. The sidecar spends ~1ms on the pass-through path (localhost POST + immediate response) — acceptable.
- **D-20:** Tool allowlist is stored in `app_settings` under key `pretool_gated_tools` as a JSON array. On first launch, AITC writes the default D-19 value if the key is unset. No v1 UI for editing — user edits via SQLite or via a debug-only command. Full settings screen is deferred to a future phase.
- **D-21:** OR semantics with protected_paths: `/hook` evaluates both filters. If **either** (a) `tool_name` is in the allowlist, or (b) `tool_input.file_path` (when present) matches any `protected_paths` glob, the call gates. Even a Read on a protected path raises an approval. Paths without a file_path (Bash, WebFetch) rely solely on the tool allowlist.
- **D-22:** "Always allow for this session" per-tool escape hatch: approval action surface gets a checkbox "Don't ask again this session for {tool_name}". On approve, if checked, the tool+agent_id combo is added to an in-memory `HashSet<(agent_id, tool_name)>` in the waiter registry. Subsequent /hook calls matching the combo auto-approve without creating a row. Cleared when the agent is terminated or AITC restarts. Per-agent scoping prevents cross-agent bleed. Not persisted.
- **D-23:** Explicit bypass is preserved. The launch dialog keeps the `--accept-edits` and `--dangerously-skip-permissions` chips. When **either** chip is ticked, AITC skips the per-launch settings.local.json write for that session — the hook isn't installed, Claude runs unhooked. Aligned with the "escape hatch for power users" framing and prevents the hook from contradicting an explicit bypass flag.

### Claude's Discretion
- Exact merge logic for settings.local.json when the file pre-exists with other hook entries (preserve user hooks, idempotent upsert of the AITC PreToolUse entry).
- Sidecar binary name, bundling path, and Tauri sidecar registration details.
- Exact shape of the `HookDecision` and hook POST payload types (the decision-level contract is locked; field names/casing are planner territory).
- Module name for the waiter registry (suggested `src-tauri/src/agents/hook_waiters.rs` or `src-tauri/src/comms/hook_bridge.rs`).
- Whether pretool_use rows live alongside write_access rows in the existing RequestQueue or in a dedicated tab (UI-SPEC territory).
- How to detect client disconnect in axum — several patterns exist; pick whichever is idiomatic.
- Exact glob-match library for protected_paths in /hook context (should reuse the existing protected_paths glob engine from Phase 4).
- Whether `~/.aitc/port` includes additional metadata (pid, version) or just the port number.
- UI placement for the "Don't ask again this session" checkbox in the approval action bar.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 8" — Scope, OOS, and "replaces the `--accept-edits` workaround" framing
- `.planning/REQUIREMENTS.md` — COMM-01..COMM-06 (approval workflow carries forward), AGNT-03 (passive detection), SHELL-04 (tray/notification)
- `.planning/PROJECT.md` §"Constraints" — Tauri v2 + Rust backend; Windows primary platform

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system (badge styling, phosphor accents, mono type)
- `wireframes/communications_hub/` — Existing Comms Hub wireframes (preview structure for detail panel)

### Phase Context (prior decisions that constrain this phase)
- `.planning/phases/03-agent-management-conflict-detection/03-CONTEXT.md` — Self-register HTTP server (add /hook here), AgentRegistry adapter trait, claude_code adapter D-08 intent detection via hooks
- `.planning/phases/04-core-ui-views/04-CONTEXT.md` — Comms Hub 3-panel layout, ApprovalRequestCard, InlineDiff with editable lines, ApprovalActions, approve_with_edits flow
- `.planning/phases/04-core-ui-views/04-UI-SPEC.md` — Exact visual spec for urgency badge, card layout, detail panel proportions
- `.planning/phases/05-conflict-resolution-history/05-CONTEXT.md` — useSyntaxHighlight hook (shiki), HunkNavigator patterns (reuse for multi-edit)
- `.planning/phases/06-pipeline-activation-integration-wiring/06-CONTEXT.md` — D-06 PASSIVE-{pid} stub pattern (auto-create on /hook if needed), D-07 KAGENT↔PASSIVE reconciliation

### Existing Backend Code
- `src-tauri/src/agents/self_register.rs` — Existing `/register` axum router; add `/hook` route + extension layers
- `src-tauri/src/agents/claude_code.rs` — `launch()`: add per-launch settings.local.json write (unless bypass chip set); `has_hooks_config` logic already present
- `src-tauri/src/agents/launcher.rs` — `launch_detached` injects `AITC_PORT`; keep unchanged, add settings.local.json install step in the claude adapter
- `src-tauri/src/agents/registry.rs` — `find_agent_by_pid`, `upsert_agent` (used for PASSIVE stub auto-create from /hook)
- `src-tauri/src/pipeline/passive_bridge.rs` — `bridge_tick` observes claude processes; hook into D-04 prompt trigger here
- `src-tauri/src/comms/commands.rs` — `create_approval_request_internal`, `approve_request`, `deny_request`, `approve_with_edits` all need to signal the waiter registry
- `src-tauri/src/comms/types.rs` — `ApprovalRequest` struct: add `tool_name`, `tool_input_json` fields
- `src-tauri/src/db/migrations/` — New `005_pretool_use_hooks.sql` adding columns + status value 'abandoned'
- `src-tauri/src/lib.rs` — Register new `/hook` waiter state, new Tauri commands for passive-prompt accept/decline, port-file write on startup

### Existing Frontend Code
- `src/views/CommsHub/ApprovalRequestCard.tsx` — Add tool badge + preview line (D-14)
- `src/views/CommsHub/` — Detail panel area (RequestQueue sibling); add ToolPreview component + per-tool renderers
- `src/views/CommsHub/` — Existing `InlineDiff` with editable lines (reused for Edit/MultiEdit per D-15)
- `src/stores/commsStore.ts` — `selectRequest(id)`, `ApprovalRequest` type: extend with `toolName`, `toolInputJson`; existing event subscriptions (`approval-request-created`, `approval-resolved`, `approval-updated`) carry forward
- `src/components/ui/UrgencyBadge.tsx` — Pattern for tool-name badge component
- `src/hooks/useSyntaxHighlight.ts` — Reuse for Write/Bash/JSON renderers
- `src/bindings.ts` — Auto-regenerated by tauri-specta after new commands + types

### Sidecar Binary (new)
- `src-tauri/aitc-hook/` — New crate for the hook sidecar. Referenced in `src-tauri/tauri.conf.json` under `bundle.externalBin` (or `bundle.resources`).
- Tauri v2 sidecar docs: https://v2.tauri.app/develop/sidecar/

### Claude Code Hook Contract (external)
- Claude Code PreToolUse hook spec — settings.json `hooks.PreToolUse` array with `{matcher, hooks[{type: "command", command, timeout?}]}`; stdin JSON `{session_id, hook_event_name: "PreToolUse", tool_name, tool_input, ...}`; stdout JSON `{continue?: bool, stopReason?, decision?: "approve"|"block", reason?, hookSpecificOutput?: {...}}`; exit code 2 = block with stderr as reason.
- Referenced in existing code: `src-tauri/src/agents/claude_code.rs::extract_intent_from_hooks_output` (Phase 3 hook-output parsing already works against this contract)

### Existing Tests
- `src-tauri/src/agents/self_register.rs` `mod tests` — Pattern for axum route testing (sqlx in-memory pool setup)
- `src/stores/__tests__/commsStore.test.ts` — Pattern for mocking Tauri listen() events
- `src-tauri/tests/end_to_end_smoke.rs` — Cross-module smoke test pattern; add a /hook smoke here

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `axum` router + `Extension` layer pattern in `self_register.rs` — drop-in-ready for `/hook` alongside `/register`.
- `RateLimiter` (self_register.rs) — can extend the same pattern to `/hook` if abuse becomes a concern, though v1 is single-user so not strictly required.
- `create_approval_request_internal` — the canonical way to insert rows + emit `approval-request-created` + fire native notification. Backend-only caller pattern already exists (protected_path_trigger uses it); /hook is the same shape.
- `dispatch_approval_notification` — reuse for pretool_use; extend payload to include `approval_request.id` for deep-link.
- `InlineDiff` with editable lines + `approve_with_edits` — full parity for Edit/MultiEdit via modified_input.
- `useSyntaxHighlight` (Phase 5) — shiki-based; works for bash/ts/py/json.
- `UrgencyBadge` component — template for the new tool-name badge.
- `PASSIVE-{pid}` reconciliation path (Phase 6 D-06/D-07) — `/hook` can reuse the auto-upsert-on-first-contact semantic.
- `AITC_PORT` env injection in `launch_detached` — already wired; sidecar just needs to read it.
- `settings.local.json` detection (Claude adapter `has_hooks_config`) — existing helper, extend for merge-write.

### Established Patterns
- axum + `Extension` for DI of shared state (registry, pool, rate limiter) — extend with waiter registry.
- `tokio::sync::oneshot` + `Mutex<HashMap>` for request/response correlation — standard pattern for long-held HTTP responses.
- Backend-authoritative approval creation (WR-03) — `/hook` is backend-only. Frontend never creates pretool_use rows.
- `#[tauri::command] #[specta::specta]` with managed State — the existing command surface pattern.
- Tauri event emit (`app_handle.emit`) for frontend push — `approval-request-created` already lights up commsStore.
- Migration-per-feature in `src-tauri/src/db/migrations/` with sqlx `ALTER TABLE` for additive schema changes.
- Store-per-domain Zustand pattern (commsStore, agentStore) — extend commsStore's ApprovalRequest type, no new store.
- `tracing` for structured logging; sidecar binary should also use `tracing` or equivalent.

### Integration Points
- `self_register.rs::start_registration_server` — add `/hook` route + waiter extension layer; write `~/.aitc/port` after bind success.
- `lib.rs` — register new Tauri commands (passive-prompt handlers, possibly a debug command to edit `pretool_gated_tools`), register waiter-registry state, wire startup hook for port file.
- `claude_code.rs::launch` — call into a new `hook_install.rs` helper that merges/writes settings.local.json; skip when bypass chips are set.
- `passive_bridge.rs::bridge_tick` — emit a frontend event "passive-claude-detected" with cwd; Tauri-side dialog asks for consent, and on accept calls the same `hook_install` helper.
- `comms/commands.rs` approve/deny/approve_with_edits — after DB update, signal the matching waiter via the waiter registry; also signal on force-deny from terminate.
- `agents/commands.rs` terminate command — fire force-deny on all waiters for that agent before calling `terminate_process`.
- New crate `src-tauri/aitc-hook/` — sidecar binary. Tauri v2 sidecar bundling config in `tauri.conf.json`.
- `src/views/CommsHub/*` — DetailPanel-ish sibling that already renders diff; add ToolPreview routing by `requestType`.
- `commsStore.ts` — extend `ApprovalRequest` type with `toolName?`, `toolInputJson?`; add session-scoped "always allow" tracking map.

</code_context>

<specifics>
## Specific Ideas

- The "always allow for this session" feature is intentionally in-memory + per-agent-instance to mirror Claude Code's own "don't ask again" behavior. Persisting it beyond a session is a footgun we explicitly avoided.
- Fail-safe deny everywhere: unreachable AITC, missing port file, connection refused, non-2xx response — all collapse to "deny with reason". This is the roadmap line and matches the security posture of replacing `--dangerously-skip-permissions`.
- The OR semantics on protected_paths are additive, not a replacement — Phase 4's protected_paths stays as a filesystem-watch-triggered mechanism (write_access rows) and now also gates pretool_use when paths match. Users who want strict "only on protected paths" pre-tool gating can set the `pretool_gated_tools` allowlist to `[]` and rely on path-only gating.
- Deep-link OS notification is a UX multiplier: instead of "AITC wants your attention somewhere", the click lands the user exactly on the request they need to decide. Matches the Command Horizon "glanceable → one click → resolved" flow.
- Keeping the `--dangerously-skip-permissions` / `--accept-edits` chips in place while also shipping hook gating is pragmatic: the chips become "I trust this session fully" and the hook is the default safety harness. Chip flipping explicitly skips the hook install for that launch to avoid contradicting signals.
- The sidecar binary approach sidesteps every "does the user have curl/jq/node" question. Ships alongside AITC, lives in resources, has one job.

</specifics>

<deferred>
## Deferred Ideas

- Global `~/.claude/settings.json` install — rejected for v1 (D-04). Revisit if users want "AITC always gates Claude everywhere" without per-repo prompts.
- PostToolUse hook gating (retroactive review of what Claude did) — explicitly out of scope per ROADMAP.md.
- Codex / OpenCode hook gating — no hook surface yet in those tools; revisit when their equivalents ship.
- Multi-user auth on `/hook` — explicitly out of scope; AITC is single-user + localhost-bound.
- Full settings UI for `pretool_gated_tools` — deferred; v1 stores the allowlist in app_settings and is edited via DB/debug command.
- Persisted "always allow for this path" across sessions — rejected for v1; only session-scoped per-tool.
- Per-tool timeout customization — deferred; v1 is no timeout across the board.
- Destructive-pattern highlighting on Bash previews (flagging rm, sudo, curl piped to bash) — deferred. Planner will note as a strong Phase 9+ candidate.
- Tool call history audit log (every pretool_use event, approved or denied, with tool_input) — the existing approval_requests row captures decided ones; abandoned ones are tracked via the new status. A separate telemetry-style log is deferred.
- External-editor fallback for very large tool inputs — deferred.
- `~/.aitc/port` format extensions (pid, version, features) — v1 is just the port number.
- Settings screen for bypass chips ("always dangerously-skip for this binary") — deferred.

</deferred>

---

*Phase: 08-real-claude-code-hook-integration-pretooluse-approvals*
*Context gathered: 2026-04-15*
