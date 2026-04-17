---
phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s
plan: 03
subsystem: backend-mcp
tags: [mcp, streamable-http, json-rpc, axum, uuid-v4, tempfile-persist, 2025-03-26]

requires:
  - phase: 10
    plan: 01
    provides: mcp module tree (types, streamable_http, tools, session_config) scaffolded with todo!("Plan 03"), McpState + McpSession scaffold, JsonRpcRequest/Response envelopes, MCP_SESSION_HEADER + MCP_PROTOCOL_VERSION constants
  - phase: 10
    plan: 02
    provides: LiveSessionRegistry (full impl), db::events CRUD (insert_agent_event for system_note insert path), chat_runtime::notifications::dispatch_chat_notification (no-op body safe to call)

provides:
  - Spec-compliant MCP Streamable HTTP transport on the existing self_register axum router (D-11 — same port as /register and /hook)
  - Fresh UUIDv4 Mcp-Session-Id header on every `initialize`; 404 on unknown session id per MCP 2025-03-26 mandate
  - Two-tool surface via `tools/list`: `get_pending_user_messages` (v1 empty drain — D-08 fallback) + `request_user_input` (fires OS notification + inserts system_note transcript row — D-23)
  - write_session_mcp_config atomic JSON writer for `.claude/aitc-mcp-<agent_id>.json` (consumed by Plan 04's `claude --mcp-config` argv)
  - delete_session_mcp_config idempotent cleanup helper
  - Extension<Arc<LiveSessionRegistry>> + Extension<Arc<McpState>> layers wired through start_registration_server to build_router
  - 34 new backend tests (31 mcp:: + 3 self_register:: integration)

affects:
  - Plan 04 (claude_code adapter calls write_session_mcp_config + injects --mcp-config on argv)
  - Plan 05 (chat transcript renders system_note `kind: awaiting_user` payload emitted by request_user_input)
  - Plan 06 (no direct coupling — MCP is backend-only surface)

tech-stack:
  added:
    - "uuid = \"1\" with v4 feature (direct-import access; already a transitive dep via tauri-utils)"
  patterns:
    - "UUIDv4 session-id mint via uuid::Uuid::new_v4().to_string() (canonical 8-4-4-4-12, 36 chars)"
    - "spec-driven 404-on-unknown-session forces re-initialize (MCP 2025-03-26 V3 Session Management)"
    - "agent_id regex ^[A-Za-z0-9_-]{1,128}$ at session_config write boundary (T-10-19 path traversal mitigation)"
    - "Atomic JSON write via tempfile::NamedTempFile::new_in(parent) + persist — same-filesystem rename, never partial read"
    - "JSON-RPC application error codes -32001 (unknown agent) / -32002 (too many sessions) in the reserved server-error range per JSON-RPC 2.0"
    - "Idempotent re-init: same Mcp-Session-Id on initialize returns the existing session state rather than minting a new one"

key-files:
  created: []
  modified:
    - src-tauri/src/mcp/mod.rs (MAX_MCP_SESSIONS const, AITC_SESSION_HEADER const, McpSession.created_at_ms field, clarifying docs)
    - src-tauri/src/mcp/types.rs (6 JSON-RPC error-code constants + JsonRpcResponse::success / ::error constructors)
    - src-tauri/src/mcp/streamable_http.rs (full dispatcher replacing Plan 01's 501-returning stubs; 12 integration tests with spawn_mcp_server helper)
    - src-tauri/src/mcp/tools.rs (tool_list_v1 + call_get_pending_user_messages + call_request_user_input; 6 tests)
    - src-tauri/src/mcp/session_config.rs (write_session_mcp_config + delete_session_mcp_config with regex validation + tempfile persist; 8 tests)
    - src-tauri/src/agents/self_register.rs (build_router signature +2 args; /mcp POST/GET/DELETE routes; spawn_hook_server updated; agent_events table seeded in make_hook_pool; 3 new MCP integration tests)
    - src-tauri/src/lib.rs (start_registration_server receives Arc<LiveSessionRegistry> + Arc<McpState> from Tauri managed state)
    - src-tauri/Cargo.toml (uuid = { version = "1", features = ["v4"] } under [dependencies])
    - src-tauri/Cargo.lock (regenerated after uuid dep)

key-decisions:
  - "UUIDv4 via the `uuid` crate (v4 feature) rather than hand-rolled getrandom. uuid 1.23 was already a transitive dep through tauri-utils; adding it to [dependencies] gives direct-import access with zero new C deps. Hand-rolled random source was an option but adds maintenance for no benefit."
  - "agent_id regex ^[A-Za-z0-9_-]{1,128}$ matches the threat-model spec verbatim (T-10-19). The narrow ASCII allowlist (no dots, no slashes, no unicode) means the filename splice in write_session_mcp_config is provably safe — rejecting `../etc/passwd`, `a/b`, `a.b`, and 200-char strings."
  - "call_get_pending_user_messages returns `{messages: []}` (empty) in v1. The primary user→agent transport is the stdin JSONL writer (Plan 02 spawn_outbound_writer). This MCP tool is Claude's fallback catch-all per D-08 — if the stdin pipe is ever unavailable, Claude calls this tool, and future plans may wire it into a real OutboundFrame drain. Documented so Plan 04/05 don't mistakenly expect messages here."
  - "call_request_user_input is fire-and-forget v1 — NOT long-held. It inserts a system_note transcript row (`kind: awaiting_user`) + fires the OS notification via dispatch_chat_notification, then returns an ack immediately. The user types back through ChatInput and the reply flows through send_chat_message_to_agent normally. Long-hold is Phase 11+ polish."
  - "GET /mcp returns HTTP 405 (not implemented). The MCP 2025-03-26 spec makes SSE upgrade optional — if the client doesn't see a 2xx on GET, it polls via POST. Claude Code 2.x handles this gracefully. Full SSE upgrade is a Phase 11+ candidate."
  - "spawn_hook_server constructs FRESH LiveSessionRegistry + McpState per test invocation (not shared across the module). Prevents cross-test session-id leakage and matches the existing per-test isolation of registry / waiters / pool."
  - "make_hook_pool seeds the agent_events schema (via inline CREATE TABLE IF NOT EXISTS, not via migration 006) so the request_user_input integration test can verify the system_note row end-to-end without pulling in the full migration runner."
  - "Idempotent re-init with the same Mcp-Session-Id reuses the existing session (preserving the agent_id binding unless a new X-AITC-Session was forwarded). Consistent with the MCP spec 'session is opaque identifier' model and prevents a Claude reconnect from silently dropping the agent binding."

patterns-established:
  - "Add-a-route-to-build_router pattern: when extending self_register with new routes, append `.route(path, verb(handler::<R>))` alongside the existing routes, then push the new Arc<T> state via `.layer(Extension(t))` at the end. Never rearrange the existing layers — body cap stays FIRST so it applies to every route."
  - "Fresh per-test state in spawn_hook_server: every new Arc<T> the router needs gets constructed inline (not pulled from a module-level OnceLock), guaranteeing test isolation and matching the existing AgentRegistry / WaiterRegistry pattern."
  - "Integration-test seed schema: when a new handler writes to a new table, extend make_hook_pool's inline DDL with `CREATE TABLE IF NOT EXISTS <table>` rather than pulling the real migration runner into tests. Keeps tests hermetic and fast (<1s per test)."

requirements-completed: []

duration: 10 min
completed: 2026-04-17
---

# Phase 10 Plan 03: MCP Streamable HTTP Server Summary

**Spec-compliant MCP 2025-03-26 server on the existing self_register axum router: POST /mcp dispatches initialize/tools/list/tools/call, unknown session returns 404, delete tears down, per-session .claude/aitc-mcp-<agent_id>.json writes atomically**

## Performance

- **Duration:** ~10 minutes
- **Started:** 2026-04-17T10:22:27Z
- **Completed:** 2026-04-17T10:32:17Z
- **Tasks:** 2
- **Files modified:** 9 (5 mcp/, 1 self_register, 1 lib.rs, Cargo.toml, Cargo.lock)
- **Tests added:** 34 (31 mcp:: unit + 3 self_register integration)

## Accomplishments

- MCP Streamable HTTP transport (2025-03-26) running on the same axum port as /register and /hook (D-11 locked — single port, single process, single cleanup path).
- `POST /mcp initialize` → HTTP 200 + fresh UUIDv4 `Mcp-Session-Id` header + `{protocolVersion:"2025-03-26", capabilities:{tools:{}}, serverInfo:{name:"aitc-chat", version:"0.1"}}` body.
- `POST /mcp tools/list` → two-tool surface: `get_pending_user_messages` (no args) + `request_user_input` (required `prompt`, optional `default`).
- `POST /mcp tools/call request_user_input` → inserts `agent_events` row `event_type='system_note'` with `payload_json = {text, kind:"awaiting_user", prompt, default}`, fires OS notification via `dispatch_chat_notification` (Plan 04 body), returns `{content:[{type:"text",text:"Notification sent..."}], isError:false}` ack.
- `POST /mcp tools/call get_pending_user_messages` → v1 returns `{content:[{type:"text",text:"{\"messages\":[]}"}], isError:false}` (empty — stdin is primary transport per D-08).
- `POST /mcp` with unknown `Mcp-Session-Id` → HTTP 404 per MCP spec (forces Claude to re-initialize).
- `POST /mcp notifications/initialized` → HTTP 202 Accepted with empty body.
- `POST /mcp` with unknown method → JSON-RPC error code -32601 (Method not found).
- `POST /mcp` when sessions map is full (>=64) → JSON-RPC error code -32002 (T-10-20 DoS mitigation).
- `POST /mcp tools/call` without bound agent_id → JSON-RPC error code -32001 (T-10-17 typed error, never panics).
- `GET /mcp` → HTTP 405 (SSE upgrade is v1-deferred polish).
- `DELETE /mcp` with valid `Mcp-Session-Id` → HTTP 204 + session removed. Without header → 404. Already-deleted → 404.
- `write_session_mcp_config(cwd, agent_id, port)` produces `.claude/aitc-mcp-<agent_id>.json` atomically via `tempfile::NamedTempFile::new_in` + `persist`. agent_id regex-validated `^[A-Za-z0-9_-]{1,128}$` before any filesystem access (T-10-19).
- `delete_session_mcp_config` idempotent best-effort cleanup (swallows NotFound).
- 34 new tests all green: 12 streamable_http integration tests (via `spawn_mcp_server` helper), 6 tools tests (tool_list shape + request_user_input row/ack semantics + truncate helpers), 8 session_config tests (valid-id accept/reject + atomicity + idempotent delete + dir creation), 3 self_register integration tests running against the full `build_router` stack (initialize headers, 404 without session, end-to-end tools/call).
- **Zero regression** on the existing 13 self_register `/hook` + `/register` tests.
- `cargo build` clean; `cargo test --lib mcp::` = 31 passed; `cargo test --lib self_register` = 16 passed (13 existing + 3 new); `cargo test --lib chat_runtime::` = 41 passed (Plan 02 baseline); `cargo test --lib db::events::` = 8 passed.

## Task Commits

1. **Task 1: mcp/* full implementation (streamable_http + tools + session_config + uuid dep)** — `3ee34e4` (feat)
2. **Task 2: wire /mcp routes into self_register build_router + 3 integration tests + lib.rs threading** — `f9a180f` (feat)

## JSON-RPC Error-Code Table

| Code | Constant | Meaning | Emitted on |
|------|----------|---------|------------|
| -32700 | JSONRPC_PARSE_ERROR | Parse error | Malformed JSON body (handled by axum's `Json<T>` extractor) |
| -32600 | JSONRPC_INVALID_REQUEST | Invalid Request | Reserved; not currently emitted by v1 dispatcher |
| -32601 | JSONRPC_METHOD_NOT_FOUND | Method not found | Unknown top-level method OR unknown tool name in `tools/call` |
| -32602 | JSONRPC_INVALID_PARAMS | Invalid params | Reserved; `request_user_input` missing prompt uses -32603 today |
| -32603 | JSONRPC_INTERNAL_ERROR | Internal error | Tool call returned Err (e.g. DB insert failed, missing prompt) |
| -32001 | JSONRPC_UNKNOWN_AGENT | Unknown agent | `tools/call` on a session with no `agent_id` binding (no X-AITC-Session was forwarded on initialize) |
| -32002 | JSONRPC_TOO_MANY_SESSIONS | Too many sessions | `initialize` when `McpState.sessions.len() >= 64` (T-10-20) |

## MCP Config File Shape (verbatim for Plan 04)

`write_session_mcp_config(cwd, agent_id, aitc_port)` produces exactly this JSON at `{cwd}/.claude/aitc-mcp-{agent_id}.json`:

```json
{
  "mcpServers": {
    "aitc-chat": {
      "type": "http",
      "url": "http://127.0.0.1:<aitc_port>/mcp",
      "headers": {
        "X-AITC-Session": "<agent_id>"
      }
    }
  }
}
```

Plan 04 injects this path via `--mcp-config <abs-path> --strict-mcp-config` on the `claude` argv. The `X-AITC-Session` header is Claude's mechanism for carrying the agent_id into every subsequent MCP request — the server reads it on `initialize` and binds the MCP session to that agent.

## Current behavior of `call_get_pending_user_messages` (v1)

Returns `{"content": [{"type":"text","text":"{\"messages\":[]}"}], "isError": false}` — **empty message list**. The stdin JSONL writer (Plan 02 `spawn_outbound_writer`) is the primary user→agent transport per D-08; this MCP tool is Claude's fallback. Plan 04 / 05 should NOT rely on this tool for primary message delivery.

If a future plan wants to wire a real drain, the hook point is: extend `LiveSessionRegistry` with a `drain_pending_for_agent(agent_id) -> Vec<(i64, String)>` method that pulls unfulfilled OutboundFrames out of a per-agent parking lot, then change `call_get_pending_user_messages` to call it + return them as `[{id, content, createdAt}, ...]` in the text block.

## Tauri Emit Events (request_user_input path)

`call_request_user_input` triggers two side effects when invoked via `tools/call`:

1. **agent_events row insert** with `event_type='system_note'`, `payload_json.kind='awaiting_user'`, `payload_json.prompt=<prompt>`, `payload_json.default=<default-or-empty>`. Emits `agent-event-appended` is NOT fired directly by Plan 03 — Plan 04's aggregator owns that emission once it picks up Plan 03 as a precondition. (Plan 03 just writes the DB row.)
2. **OS notification via `dispatch_chat_notification`** with body `"AWAITING_USER — <first-80-chars>"` and `deeplink_agent = Some(agent_id)`. Plan 04 provides the real notification body; Plan 03 calls the existing no-op stub (safe).

## Integration-test Coverage (so Plan 06's e2e plan can avoid duplicating)

Plan 03 tests already cover these paths — Plan 06's e2e plan does not need to re-assert them:

- `initialize` without and with `Mcp-Session-Id` (fresh vs reuse).
- 404 on unknown / missing session for every non-initialize method.
- `tools/list` returns exactly the two-tool surface with required `inputSchema` fields.
- `tools/call get_pending_user_messages` returns empty message list wrapped in the MCP `content[].text` envelope.
- `tools/call request_user_input` writes the system_note row AND returns the ack content block.
- `tools/call` without agent binding returns JSON-RPC -32001.
- `tools/call` unknown tool → -32601.
- `notifications/initialized` → 202.
- Unknown method → -32601.
- `GET /mcp` → 405.
- `DELETE /mcp` round-trip: 204 once, 404 on repeat, 404 without session header.
- `MAX_MCP_SESSIONS=64` cap enforced.
- Re-init with existing session id is idempotent.
- 3 full-stack integration tests against `build_router` (not a minimal mcp-only router) verifying Extension layer composition with /hook and /register.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Added `agent_events` schema to `make_hook_pool` test helper**
- **Found during:** Task 2 (writing `mcp_tools_call_request_user_input_after_initialize_succeeds` integration test)
- **Issue:** The plan wires `call_request_user_input` to insert a `system_note` row into `agent_events`. The test assertion reads that row back via `list_events_for_agent`. But `make_hook_pool` (the Phase 8 test pool) only seeds `approval_requests` + `protected_paths` — no `agent_events` table. Without the schema the insert would fail silently (we swallow the error in `call_request_user_input`), and the read assertion would find zero rows, failing the test.
- **Fix:** Added `CREATE TABLE IF NOT EXISTS agent_events ( ... )` inline to `make_hook_pool` mirroring the 006 migration shape. No migration runner pulled in.
- **Files modified:** `src-tauri/src/agents/self_register.rs` (make_hook_pool)
- **Verification:** 3 new MCP integration tests all pass; 13 existing /hook + /register tests still pass (no regression).
- **Committed in:** `f9a180f` (Task 2 commit).

**2. [Rule 3 - Blocker] `uuid` added to `[dependencies]` in Cargo.toml**
- **Found during:** Task 1 (writing `new_session_id` helper in streamable_http.rs)
- **Issue:** Plan's action block lists `getrandom::getrandom(&mut bytes)` as one option and allows `uuid::Uuid::new_v4().to_string()` if the crate is available. Neither uuid nor getrandom were in `[dependencies]` directly, though both are transitive deps (uuid 1.23 via tauri-utils, getrandom via multiple paths).
- **Fix:** Added `uuid = { version = "1", features = ["v4"] }` to `[dependencies]`. Zero new C libs pulled in (uuid is pure-Rust); direct-import access enables the one-line `Uuid::new_v4().to_string()` which is safer than a hand-rolled getrandom + RFC 4122 bit-fixup (5 lines + getrandom error handling).
- **Files modified:** `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
- **Verification:** `cargo build` clean; the UUIDv4 output is 36-char canonical form; `initialize_sets_mcp_session_id_header_and_returns_protocol_version` asserts `sid.len() == 36`.
- **Committed in:** `3ee34e4` (Task 1 commit).

---

**Total deviations:** 2 auto-fixed (both Rule 3 compile/test-environment blockers)
**Impact on plan:** Both fixes are surface-level plumbing (dev-dep addition + test-only schema seeding). No behavior change, no scope creep, no downstream API break. Plan 04 consumes `write_session_mcp_config` + `McpState` + `LiveSessionRegistry` exactly as the plan specifies.

## Authentication Gates

None.

## Known Stubs

- `call_get_pending_user_messages` returns `{messages: []}` deliberately (v1 behavior per plan — documented above under "Current behavior"). Not a stub in the rotten-code sense; it's a valid fallback that simply has no pending frames to drain in v1.
- `GET /mcp` returns 405 (SSE upgrade deferred to Phase 11+; MCP spec makes this optional).

## Issues Encountered

None unresolved. Both deviations were caught by the compile/test cycle in the same session they occurred in.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 04 (claude_code adapter):** Unblocked. Plan 04 calls `write_session_mcp_config(cwd, agent_id, aitc_port)` to produce the per-session config file, then injects `--mcp-config <abs-path> --strict-mcp-config` into the `claude` argv (Plan 02's `build_argv` has the extension point). Plan 04 also fills the `dispatch_chat_notification` body (currently a no-op); the `call_request_user_input` side-effect wiring in Plan 03 compiles against the no-op stub and will automatically gain OS-notification behavior once Plan 04 lands.
- **Plan 05 (frontend polish):** Unblocked. The frontend EventCard dispatcher will render the new `system_note` event_type with `payload_json.kind = 'awaiting_user'` as a centered prompt card with the prompt text. No bindings.ts regen needed — Plan 03 doesn't touch the Tauri command surface.
- **Plan 06 (URL routing + Phase 4 chat deletion):** Unblocked. MCP is purely backend surface; Plan 06 doesn't consume it directly. The OS notification deep-link (fired on `request_user_input`) will be wired end-to-end in Plan 06 once the frontend URL router + deep-link handler lands.

No blockers or concerns carried forward.

## Self-Check: PASSED

Verified items:

- **File existence (created/modified):**
  - `src-tauri/src/mcp/mod.rs` — FOUND (finalized with MAX_MCP_SESSIONS, AITC_SESSION_HEADER, McpSession.created_at_ms)
  - `src-tauri/src/mcp/types.rs` — FOUND (6 error-code constants + success/error constructors)
  - `src-tauri/src/mcp/streamable_http.rs` — FOUND (650+ lines, full dispatcher)
  - `src-tauri/src/mcp/tools.rs` — FOUND (290 lines, tool_list_v1 + two tool calls)
  - `src-tauri/src/mcp/session_config.rs` — FOUND (180+ lines, atomic writer + delete helper)
  - `src-tauri/src/agents/self_register.rs` — FOUND (modified: +2 args on build_router; 3 new tests; make_hook_pool seeds agent_events)
  - `src-tauri/src/lib.rs` — FOUND (retrieves Arc<LiveSessionRegistry> + Arc<McpState> from managed state)
  - `src-tauri/Cargo.toml` — FOUND (uuid added)
- **Commits in git log:**
  - `3ee34e4` (Task 1) — FOUND: `git log --oneline | grep 3ee34e4`
  - `f9a180f` (Task 2) — FOUND: `git log --oneline | grep f9a180f`
- **Acceptance-criteria greps:**
  - `grep -c 'todo!' src/mcp/streamable_http.rs` → 0
  - `grep -c 'todo!' src/mcp/tools.rs` → 0
  - `grep -c 'todo!' src/mcp/session_config.rs` → 0
  - `grep -c 'todo!("Plan 03")' src/` → 0 (zero Plan 03 markers remain anywhere)
  - `grep -n 'MCP_PROTOCOL_VERSION' src/mcp/mod.rs` → defined as "2025-03-26"
  - `grep -n 'MAX_MCP_SESSIONS' src/mcp/mod.rs` → defined as 64
  - `grep -n 'NamedTempFile::new_in' src/mcp/session_config.rs` → 1 match
  - `grep -n '"aitc-chat"' src/mcp/session_config.rs` → 1 match inside write_session_mcp_config body
  - `grep -n '"X-AITC-Session"' src/mcp/session_config.rs` → 1 match inside write_session_mcp_config body
  - `grep -n 'post(crate::mcp::streamable_http::mcp_post_handler' src/agents/self_register.rs` → 1 match inside build_router
  - `grep -n 'get(crate::mcp::streamable_http::mcp_get_handler' src/agents/self_register.rs` → 1 match
  - `grep -n 'delete(crate::mcp::streamable_http::mcp_delete_handler' src/agents/self_register.rs` → 1 match
  - `grep -n 'Extension(chat_sessions)' src/agents/self_register.rs` → 1 match
  - `grep -n 'Extension(mcp_state)' src/agents/self_register.rs` → 1 match
- **Final verification:**
  - `cargo build` → clean (8 pre-existing warnings unrelated to Phase 10)
  - `cargo test --lib mcp::` → 31 passed, 0 failed
  - `cargo test --lib self_register` → 16 passed, 0 failed (13 existing /hook + /register + 3 new MCP integration)
  - `cargo test --lib chat_runtime::` → 41 passed, 0 failed (Plan 02 baseline still green)
  - `cargo test --lib db::events::` → 8 passed, 0 failed
  - `cargo test --test chat_runtime_smoke` → 1 passed, 0 failed

---

*Phase: 10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s*
*Completed: 2026-04-17*
