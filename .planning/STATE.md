---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: ready_to_plan
stopped_at: context exhaustion at 76% (2026-05-03)
last_updated: "2026-05-03T04:00:54.041Z"
last_activity: 2026-05-03 -- Phase 13 planning complete
progress:
  total_phases: 23
  completed_phases: 20
  total_plans: 82
  completed_plans: 82
  percent: 87
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-07)

**Core value:** A developer can see exactly what every AI agent is doing across their codebase in real time, prevent destructive conflicts between concurrent agents, and approve/deny agent actions from a single command center.
**Current focus:** Phase 22 shipped 2026-04-23 (--auto chain end-to-end: discuss → plan → execute → verify). Phase 17 still AWAITING UAT (17-06-CHECKPOINT). Next actionable: complete Phase 17 UAT or plan remaining phases (13-16, 20, 21).

## Current Position

Phase: 14
Plan: Not started
Status: Ready to plan
Last activity: 2026-05-03

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 34
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4 | - | - |
| 2 | 4 | - | - |
| 03 | 4 | - | - |
| 05 | 5 | - | - |
| 13 | 6 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 05 P03 | 13min | 2 tasks | 8 files |
| Phase 05 P04 | 19min | 2 tasks | 10 files |
| Phase 05 P05 | 18min | 2 tasks | 2 files |
| Phase 9 P04 | 383 | 3 tasks | 12 files |
| Phase 09 P03 | 17m | 3 tasks | 8 files |
| Phase 10 P01 | 14 min | 3 tasks | 66 files |
| Phase 10 P02 | 60 min | 3 tasks | 11 files |
| Phase 10 P03 | 10 min | 2 tasks | 9 files |
| Phase 10 P04 | 20m | 3 tasks | 14 files |
| Phase 10 P05 | 13min | 3 tasks | 24 files |
| Phase 10 P06 | 14 min | 3 tasks | 13 files |
| Phase 18 P01 | 8 min | 1 task (7 commits) | 1 file |
| Phase 18 P02 | 8 min | 1 task (6 commits) | 1 file |
| Phase 18 P03 | 7 min | 1 task (2 commits) | 3 files |
| Phase 18 P04 | 3 min | 1 task (1 commit) | 1 file |
| Phase 19 P01 | 9 min | 3 tasks (3 commits) | 7 files |
| Phase 19 P02 | 11 min | 2 tasks (3 commits) | 1 file |
| Phase 19 P03 | 10 min | 3 tasks (3 commits) | 4 files |
| Phase 19 P04 | 15 min | 2 tasks (3 commits) | 4 files |
| Phase 12 P01 | 14 min | 2 tasks (2 commits) | 16 files |
| Phase 12 P02 | 13 min | 3 tasks (3 commits) | 6 files |
| Phase 12 P03 | 12 min | 2 tasks (2 commits) | 4 files |
| Phase 12 P04 | 12 min | 2 tasks (2 commits) | 9 files |
| Phase 12 P05 | 15 min | 3 tasks (3 commits) | 12 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

-

- [Phase 05]: Used Map copies for immutable resolution state in conflictStore merge actions
- [Phase 05]: Used Map for contentionScores in radarStore; extended StatusBadge with 8 new variants for history tables
- [Phase 05]: Consolidated immediate + periodic contention score updates into single useEffect; StatusBadge resolved variant reused from Plan 04
- [Phase 9]: Used vi.mock factory internals to avoid hoist-order errors when mocking @tauri-apps/api/core for Channel hooks
- [Phase 9]: ExternalChangeBanner uses single pending union with 3s lapse timer for two-click destructive confirmation pattern
- [Phase 09]: 09-03: Simpler-fallback coordination between pipeline::start_watch and start_claude_resources_watch (each spawns its own Debouncer over disjoint roots) rather than SharedDebouncerRegistry; D-05 spirit preserved, registry deferred.
- [Phase 10]: Enabled specta's serde_json cargo feature so AgentEvent.payload_json can be serde_json::Value (not raw String).
- [Phase 10]: Forward-declared chat_runtime::types::AgentEvent in Task 1 so db::events.rs compiles at commit boundary (Rule 3 blocker auto-fix).
- [Phase 10]: Module-level EMPTY_EVENTS sentinel in ChatTranscript Zustand selector avoids React 19 useSyncExternalStore infinite-loop guard.
- [Phase 10]: Plan 02: adapter_chat_duplex is a local Plan-02 rule (claude-code only); Plan 04 may widen via AgentAdapter capability API
- [Phase 10]: Plan 02: parser uses aggregator-mpsc pattern — reader is pure-logic, downstream aggregator (Plan 04) owns DB writes + Tauri emits
- [Phase 10]: Plan 02: auto_resume validates session_id as hyphenated UUID shape before Command::arg (T-10-11)
- [Phase 10]: UUIDv4 via the uuid crate (v4 feature) rather than hand-rolled getrandom — already a transitive dep via tauri-utils; direct-import gives one-line Uuid::new_v4().to_string() safer than manual RFC 4122 bit fixup
- [Phase 10]: call_get_pending_user_messages v1 returns empty messages list — stdin JSONL writer is the primary user→agent transport per D-08; MCP tool is Claude fallback only. Documented so downstream plans don't rely on it for primary delivery
- [Phase 10]: call_request_user_input is fire-and-forget v1 — inserts system_note transcript row + fires OS notification + returns ack immediately; long-hold is Phase 11+ polish. User replies via ChatInput through normal send_chat_message_to_agent path
- [Phase 10]: GET /mcp returns 405 (SSE upgrade v1-deferred); MCP 2025-03-26 makes SSE optional, Claude Code 2.x polls via POST when it sees non-2xx on GET. Full SSE is Phase 11+ candidate
- [Phase 10]: Plan 04: LaunchOptions.agent_id minted UP FRONT via uuid::Uuid::new_v4().simple()[:4].to_uppercase() so duplex adapters can write per-session MCP config before spawn. Honors explicit agent_id for D-04 relaunch continuity.
- [Phase 10]: Plan 04: AdapterCapabilities flags-struct + trait-method-with-default (chat_duplex: false) widens Plan 02's inline adapter_type match into a typed per-adapter API. ClaudeCodeAdapter overrides to true; Codex/OpenCode/Generic inherit default.
- [Phase 10]: Plan 04: D-21 deletion scope — Phase 4 send_chat_message/list_chat_messages/update_message_delivery_status + ChatMessage type removed from backend. chat_messages DB table kept empty (migration 006) in case rollback needed; Plan 06 catches lingering frontend callers via TS errors.
- [Phase 10]: Plan 06: Task 3 is a blocking human-verify UAT checkpoint — Plan 06 automation is complete but Phase 10 is NOT closed until developer signs off against 10-UI-SPEC.md via 10-06-CHECKPOINT.md
- [Phase 10]: Plan 06: ?tab=chat / ?agent=<id> URL schema finalized; CommsTabBar prop shape (unreadChat + onTabChange) confirmed; setSearchParams uses replace mode to avoid history pollution from tab/selection churn
- [Phase 10]: Plan 06: D-21 Phase 4 frontend chat artifacts DELETED — ChatThread.tsx, MiniChatCard.tsx, Phase-4-era ChatInput.tsx (new Phase 10 version at src/components/chat/ChatInput.tsx); commsStore scrubbed of ChatMessage/messages/sendMessage/fetchMessages; TelemetryPanel AGENT_CHANNELS section gone
- [Phase 18]: Plan 01: D-02 parent-PID filter lives inside bridge_tick after cwd-scope, before reap/upsert — candidate_pids HashSet built from post-cwd in_scope; filter reads ProcessInfo.parent_pid (NOT CandidateProc.parent, which is the seed type). None-branch retention preserves AGNT-03 (shell/PID-1 parents).
- [Phase 18]: Plan 01: cand_with_parent test helper takes parent_pid: u32 positionally and wraps in Some(); existing cand (parent=None default) preserved for 6+ legacy tests. Flood regression test uses all_agents().len()==1 as the authoritative invariant — 51 candidates fit under MAX_AGENTS=1000 so "no capacity hit" is not a meaningful witness.
- [Phase 18]: Plan 02: capacity_hits_since_start counter lives on AgentRegistry (not passive_bridge) — registry-level framing matches the existing 'Registry at capacity' error message and counts ALL upsert failures, not just PASSIVE churn. Relaxed ordering; no happens-before with other memory.
- [Phase 18]: Plan 02: snapshot_stats loads the atomic BEFORE acquiring the read lock (Pitfall 7 / T-18-02) — gives monotonic-lagging semantics, never 'from the future'. No write-lock acquisition, so diagnostic polling does not contend with upsert_agent's write path.
- [Phase 18]: Plan 02: RegistryStats fields are u32/u64 (not usize) per the authoritative PLAN.md signature — specta/TS-cross-boundary-friendly, avoids platform-dependent usize width. 10,000x MAX_AGENTS headroom for u32 count fields.
- [Phase 18]: Plan 03: get_registry_stats uses fully-qualified `crate::agents::registry::RegistryStats` return type (no new `use` import in commands.rs) — single-use, matches existing commands.rs pattern for single-use external types.
- [Phase 18]: Plan 03: Binding regen via `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc` — the specta `.export(...)` is gated inside `pub fn run()`, so `cargo test --lib` does NOT regenerate bindings despite both paths having debug_assertions. This is the canonical regen command for future Tauri command additions in this repo.
- [Phase 18]: Plan 04: MAX_AGENTS = 1000 doc comment formalizes D-03 inline — explains why 1000 (emergency ceiling), why not 100 (Phase 3 value overrun by Phase 10 amplification), why not configurable (emergency-only, wrong surface for settings); cites hotfix 62612b3 + D-01/D-02; forward-references `capacity_hits_since_start` (18-02) and `get_registry_stats` Tauri command (18-03) so the ceiling has first-class observability. Single atomic commit `8571af0`, pure doc edit, zero code-path impact. Phase 18 now 4/4 plans complete.
- [Phase 19]: Plan 01: Tailwind v4 `@plugin "@tailwindcss/typography";` directive placed on line 2 of src/styles/theme.css (immediately after `@import "tailwindcss";`, before app CSS imports). First-try success — resolves RESEARCH.md Open Question #3 with zero syntax adjustment. `npm run build` compiles in 6.42s and `.prose` utilities land in the production bundle.
- [Phase 19]: Plan 01: Vitest scaffold pattern established — `.todo` placeholders with `V-19-XX` comment anchors + `vi.mock` wired up front so Plan 03/04 implementers flip `.todo` → real `it(…)` bodies without structural edits. `mkToolUse` / `mkToolResult` factories committed in Wave 0 (NOT Plan 04) + `void mkToolUse; void mkToolResult;` markers satisfy noUnusedLocals until Plan 04 consumes them.
- [Phase 19]: Plan 01: Pre-existing failures (end_to_end_smoke.rs LaunchOptions shape drift; HeatMapOverlay tint default; MasterDetailShell rail/detail width classes) surfaced during verification but logged to Phase 19 deferred-items.md rather than fixed — "only fix own bugs" memory rule. Two-layer reproduction evidence (HEAD vs pre-Task-1 commit 2c5b54d) rules out any Plan 19-01 cause.
- [Phase 19]: Plan 02: TurnBuffer is a LOCAL variable inside `run_event_aggregator`, not a `HashMap<AgentId, _>`. Exploits the one-aggregator-per-agent invariant (single caller in `agents/commands.rs`). Zero cross-agent contamination surface — T-19-02-06 satisfied structurally, no runtime check needed.
- [Phase 19]: Plan 02: Reader-side EOF-flush of `accumulated_text` added as Rule 3 blocker fix. V-19-02 requires the content `"Partial"` to reach the aggregator's StdoutClosed arm end-to-end, but the existing reader emitted `StdoutClosed` directly on EOF — discarding mid-idle-flush text. Fix mirrors the existing `dispatch_result` pre-TurnComplete flush pattern so clean-exit and interrupted-exit paths are symmetric.
- [Phase 19]: Plan 02: V-19-04 (D-23 regression guard) asserted via observable proxy — zero DB rows after an AssistantText with @user and no TurnComplete. Direct `dispatch_chat_notification` capture would need a testing seam (feature flag / callback probe); the notification helper uses `catch_unwind` + OS-level dispatch, not easily mockable. Zero-row + V-19-01 (turn completes with one row) + V-19-02 (interrupted flushes one row) triangulate the Pitfall 1 surface.
- [Phase 19]: Plan 02: Model-merge precedence `model.or_else(|| prior_buffer.model)` — envelope's `Some` wins; idle-flush's `None` preserves prior. Pitfall 7 (model-lost across idle flushes) covered by V-19-03 assertion that the envelope's model survives.
- [Phase 19]: Plan 02: Pre-existing `conflict::engine::tests` failures (`test_conflict_detected_different_pids_within_window`, `test_custom_window_duration`) discovered during full `cargo test --lib` run. Two-layer pre-existence evidence (HEAD vs commit 339549d before test additions) reproduces identical failures. Logged to `deferred-items.md` as D-03 (Phase 03 module scope; unrelated to chat_runtime).
- [Phase 19]: Plan 03: MarkdownBody uses Pattern 4 (imperative shiki OUTSIDE the rehype-sanitize tree) — CodeBlock renders shiki HTML via dangerouslySetInnerHTML; the sanitizer never traverses that subtree, so inline `style="color:…"` spans survive (T-05-07 HTML-escape + safeCssColor validator in useSyntaxHighlight already make shiki output pre-sanitized upstream). Rest of the markdown AST is sanitized normally — `<script>` never reaches DOM (V-19-17).
- [Phase 19]: Plan 03: Path A test strategy — `vi.mock('../MarkdownBody', …)` stub inside AssistantTextCard.test.tsx keeps the shell test suite decoupled from the markdown pipeline. @user test migrated from AssistantTextCard.test.tsx to MarkdownBody.test.tsx V-19-18 (single-owner). New shell-invariant tests: `isContinuation=true` suppresses CLAUDE label + border-t; positive delegation assertion confirms MarkdownBody receives content.
- [Phase 19]: Plan 03: V-19-17 input pattern adjusted from inline `<script>...legitimate text` to separate-block `<script>...\n\nlegitimate paragraph` — react-markdown's default `allowDangerousHtml: false` + CommonMark HTML-block grammar consumes the entire line beginning with raw HTML; blank-line separator promotes legitimate content to its own paragraph so both security (no script) and preservation (content survives) assertions hold.
- [Phase 19]: Plan 03: Pre-existing flake `useGraphLayout.test.ts > posts pin/unpin` surfaces only under full-suite load (65-file concurrent vitest pool). Passes 13/13 in isolation with + without Plan 19-03 changes. Logged as D-04 in deferred-items.md (Phase 11 Radar worker scope; no Plan-19-03 causation).
- [Phase 19]: Plan 04: `selectToolUseWithResult(events, toolUseId)` exported from chatStore.ts as a pure linear-scan function (NOT a store method — two inputs don't fit the totalUnread zero-arg shape). Placed after the useChatStore block; consumed via `useChatStore((s) => s.eventsByAgent[agentId] ?? EMPTY_EVENTS)` + `useMemo` wrapper.
- [Phase 19]: Plan 04: ToolUseCard selector consumption uses stable-slice + useMemo to avoid an infinite-render loop — returning a fresh `{toolUse, toolResult}` object inside `useChatStore(selector)` breaks useSyncExternalStore's Object.is equality (caught by `EventCard.test.tsx > dispatches tool_use` failing with Maximum update depth exceeded). Module-level `EMPTY_EVENTS = Object.freeze([])` sentinel preserves stable ref for agents with no events yet — same pattern Phase 10 ChatTranscript already applies.
- [Phase 19]: Plan 04: Status dot uses `bg-primary` (green #8eff71) + `bg-error` (red #ff7351) + `bg-on-surface-variant/30` (grey/pending) — NOT the RESEARCH sketch's `bg-status-success`/`bg-status-error` (those tokens don't exist in theme.css). Matches Command Horizon vocabulary already in StatusBadge / RadarPulse / ConflictNavBadge / PendingCountBadge.
- [Phase 19]: Plan 04: `{primary, secondary?}` summary structure preserves D-02.5 single-line truncation — primary is raw text, secondary is a nested `<span>` with a `·` separator, both inside the same `flex-1 truncate` container. Test assertions use `container.textContent.toContain(primary)` (raw text node) + `getByText(secondary)` (nested span).
- [Phase 12]: Plan 01: forceBoundary placement locked to `src/workers/forces/forceBoundary.ts` (resolves D-37 open question). Aligns with Phase 11 D-30 deferred cleanup; keeps custom forces discoverable from graphSimCore import path. BoundaryForce contract + 3 tuning constants (BOUNDARY_TARGET_Y_MAGNITUDE=300, BOUNDARY_DEADBAND=5, FORCE_BOUNDARY_BASE_STRENGTH=0.15) shipped with no-op tick body for Wave 2 to fill.
- [Phase 12]: Plan 01: Type-only imports (`type BoundaryForce, type BoundaryNode`) cannot sit behind `void marker;` guards — TS6196 trips on type-only imports AND on `type _Alias = T;` aliases. Wave-0 workaround: drop the type imports entirely from forceBoundary.test.ts; re-add in Wave 2 when mkBoundaryNode() signature-bearing helpers consume the types naturally. Inline comment anchors the next-wave action.
- [Phase 12]: Plan 01: 13 Rust `#[test] panic!("pending: V-12-XX")` stubs in pipeline/ipc_bridges/mod.rs + 44 frontend `.todo` entries across 7 files establish the Wave-0 RED-stage contract. Observable invariant: `cargo test --lib pipeline::ipc_bridges 2>&1 | grep 'pending: V-12-' | wc -l == 13`. Waves 1-3 flip these without structural file edits.
- [Phase 12]: Plan 01: HandlerHit / BindingCommand / CalleeHit scanner structs get `#[allow(dead_code)]` — Wave 1 consumes them but Wave 0 cannot without breaking cargo lib warnings. Minimum-surface-area annotation; preferred over gating the full module behind `#[cfg(test)]` (would hide the types from Wave 1 non-test consumers).
- [Phase 12]: Plan 02: OnceLock<Regex> (std lib only) across all 4 regex caches — signature/invoke/channel in bindings_parser + handler in rust_handler_scanner. No once_cell / lazy_static!; regex 1.12 already in Cargo.toml. Rust 1.70+ idiom.
- [Phase 12]: Plan 02: Offset-based header→TAURI_INVOKE pairing via `invoke_re().captures_at(src, header_end)` (Pitfall 3). Does NOT zip signature_iter() with invoke_iter() — a header with no following invoke is skipped defensively (continue) rather than mis-paired with a later command's invoke.
- [Phase 12]: Plan 02: Thread-local tree-sitter [Option<Parser>; 2] + [Option<Query>; 2] slot cache in frontend_callsite_scanner (TS=0, TSX=1). Uses `tree_sitter::StreamingIterator` (trait re-exported from the tree_sitter crate directly) — matches deps/extract.rs:24 idiom. No separate streaming-iterator crate dep.
- [Phase 12]: Plan 02: IPC_CALLSITE_QUERY compound S-expression with @invoke_literal (pattern 0) + @commands_typed (pattern 1). pattern_index discriminates CallShape; `@command` capture lookup by name (snake for Literal, camel for Typed). Variable-callee invokes rejected by grammar's `(arguments . (string …))` anchor. Aliased typed imports rejected by `(#eq? @_obj "commands")`.
- [Phase 12]: Plan 02: Dangling detection via empty-string / zero-line sentinels rather than Option<T> — handler-absent → `handler_file=""` + `handler_line=0` + `tracing::warn!`; caller-absent → `caller_files=[]` + `tracing::info!`. Frontend-friendly DTO shape; serde default works; avoids nullable wire types.
- [Phase 12]: Plan 02: Ping caller-count assertion corrected from plan's 4 (3 literal + 1 typed) to actual 3 (2 literal + 1 typed) after reading sample_caller_literal.ts — the fixture has 2 valid ping invokes on lines 7+9 plus 1 variable-callee skip on line 12. Plan author's bookkeeping error; fixture is source of truth.
- [Phase 12]: Plan 02: Pre-existing `conflict::engine::tests` failures (`test_conflict_detected_different_pids_within_window`, `test_custom_window_duration`) reproduced on clean tip via stash + `cargo test --lib conflict::engine`. Logged as D-02 in 12-deferred-items.md. Phase 03 module scope; out of Phase 12 per "only fix own bugs" memory rule.
- [Phase 12]: Plan 03: `get_ipc_bridges` async Tauri command mirrors `get_dependency_graph` shape exactly — `state.inner.lock().await` → `match guard.as_ref()` → Some-branch wraps `build_ipc_bridges(&active.repo_root.clone())` in `tauri::async_runtime::spawn_blocking` with `JoinError → String` mapping; None-branch returns `Ok(Vec::new())`. Lives immediately after `get_dependency_graph` in `pipeline/commands.rs` for discoverability.
- [Phase 12]: Plan 03: `EdgeKind` widened via *append-only* variant addition (Invokes + Handles at the end) — no renumbering, no `#[non_exhaustive]` attribute. Exhaustive-match consumers would break at compile time if any exist (none did on main today; Plan 04 will add `drawEdges` arms). Preserves serde/specta binding stability for all prior variants.
- [Phase 12]: Plan 03: V-12-13 witness placed in `pipeline::commands::tests::get_ipc_bridges_smoke_v_12_13` exercising the None-branch via direct guard inspection (`PipelineState::default()` → `guard.as_ref().is_none()`) rather than constructing a real `tauri::State<'_, PipelineState>` (only available in a running Tauri app). The Some-branch is already covered by Plan 02's `build_ipc_bridges_empty_root_returns_empty`.
- [Phase 12]: Plan 03: Bindings regen uses canonical Phase 18 D-03 recipe (`cd src-tauri && cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc`). The `./target/debug/aitc` path is relative to `src-tauri/` — the binary boots, runs the debug_assertions-gated specta `.export(...)` inside `pub fn run()`, and the 8-second timeout with `--preserve-status` forwards the exit status. Verified regen produced `+74 -1` lines including all 6 V-12-14 grep-gate symbols.
- [Phase 12]: Plan 03: D-03 deferred-items entry (bash_paths module missing — RESOLVED by Phase 17 Plan 01 merge `cf9dcff` in absentia between executor sessions) annotated RESOLVED rather than removed. Preserves audit trail of the inverted Wave ordering (Phase 17-03 landed the module index entry before Phase 17-01 created the file) so future planners can see why Wave ordering within a phase matters.
- [Phase 12]: Plan 05: `drawBoundaryAnchorLabels` screen-space pass uses `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` instead of plain identity. On HiDPI displays a plain `setTransform(1,0,0,1,0,0)` would draw the `leftX=12` inset at device pixel 12 (~6 logical px on dpr=2), shrinking both the inset and 10px font. DPR-scaled identity keeps the screen-space labels in logical-pixel coordinates regardless of device-pixel density.
- [Phase 12]: Plan 05: Diamond hit-test uses rectangular-bbox containment (`|dx|<=r && |dy|<=r`) instead of a rotated-square point-in-polygon. At BRIDGE_HIT_RADIUS=10 the visual difference is imperceptible and 3 comparisons beat 6-8 for the polygon test. RESEARCH recommendation.
- [Phase 12]: Plan 05: Bridge hit-test runs BEFORE the file-node quadtree in handleMouseMove/handleClick — bridges are visually foremost in z-order (D-31) so interaction precedence mirrors visual precedence. Prevents accidental file-node latch-on for files near y≈0.
- [Phase 12]: Plan 05: Escape-to-deselect lives on a window-level keydown listener (not canvas-level) so the user can press Escape regardless of focused sub-region. Intentionally does NOT deselect agents — staying within Phase 12's scope for bridge-only selection.
- [Phase 12]: Plan 05: BridgeTooltip accepts `GraphNode | IpcBridgeDto` via shape-agnostic field lookup (camelCase both today; snake_case fallback chain in place for future subsystems that might surface bridges outside the store). Reusable component without rewrapping.
- [Phase 11.1]: Post-ship defensive fix — wheel-triggered extreme zoom-in was blanking canvas + minimap instantly with no recovery (pan/zoom-out/force-edit all inert). Root cause confirmed by user smoke: NaN/Infinity propagation in viewport state — `ctx.setTransform(NaN,…)` silently no-ops, NaN self-perpetuates through min/max/+. Static review found no injection path (WebKitGTK pinch-deltaY candidate, untestable). Shipped Option B (defensive guard without diagnosis): `sanitizeViewport(next, prev)` wrapper on `useCanvasZoomPan.setViewport` falls back per-axis on non-finite input + reapplies [0.05, 20] zoom clamp; store-level `radarStore.setViewport` filters non-finite fields from incoming partial (covers `AgentManifestRow` + `RadarMinimap` call sites that bypass the hook). 7 new tests lock the invariant. Commits: 6878f48 (test restore post-revert) + 7b13735 (hook guard) + 383ca24 (store guard) + 06a8f90 (debug session resolved).

### Roadmap Evolution

- Phase 7 added: Replace current blocked Codebase Map with a graph based codebase map with better spacing, properly sized nodes and traversal through the graph for agents (with ephemereally highlighted movement between nodes for me to track the agent's trail). The links between code should be stuff like imports/dependencies for now, and the files should have an additional gravitational force based on their proximity in the filesystem.
- Phase 8 added: Real Claude Code hook integration (PreToolUse approvals) -- builds /hook endpoint, ships hooks config, blocks Claude on approval rows; replaces the --accept-edits / --dangerously-skip-permissions chip workaround.
- Phase 9 added: Implement a plugin / skill / tool / hook manager page that scans both ~/.claude/ and cwd/.claude/ via the watcher, this should be for me to track what things claude has access to at any one point and also edit the CLAUDE.md files in cwd/CLAUDE.md and cwd/.claude/CLAUDE.md if need be.
- Phase 10 added: Implement a proper chat user interface for agents I deploy, since I can't do this right now at all. instead, I have to inspect the system logs or some shit which isn't good UI design.
- Phase 11 added: Move d3-force simulation to a WebWorker with Transferable Float32Arrays for non-blocking layout computation
- Phase 12 added: Add IPC bridge nodes and cross-language boundary visualization (tauri-specta bindings → bridge nodes on frontend/backend boundary)
- Phase 13 added: Implement 4-level semantic zoom (workspace → package → file → code)
- Phase 14 added: Multi-layer offscreen canvas rendering (static graph cached, only agent layer redraws at 60fps)
- Phase 15 added: Enhanced ATC agent overlay (6-point trails, data blocks, leader lines, 3-tier TCAS conflict escalation, velocity vectors)
- Phase 16 added: Typed edge system + temporal coupling + Louvain community detection
- Phase 17 added: Conflict-triggered PreToolUse gating — replace tool-category gating with file-conflict gating. Full pitch + 3 design questions in 17-CONTEXT.md. Builds on Phase 08.
- Phase 11.1 inserted after Phase 11 (2026-04-21): Fix zoom-scroll lag in RadarCanvas — wheel-event rAF coalescing + investigate folder-hull caching + audit Zustand viewport writeback cascade. URGENT — surfaced during Phase 11 manual smoke. Not a Phase 11 regression; performance-only scope; no visual change.
- Phase 18 added: Fix passive-scan registry flooding. AgentRegistry hits MAX_AGENTS=100 cap within seconds of boot because passive_bridge matches every claude/codex/opencode-named process on the machine (including unrelated CLI sessions + short-lived subprocess children). Surfaced during Phase 10 UAT — new KAGENT launches fail with "Registry at capacity (100)". Scope passive registration to self-registered PIDs or narrow cwd+cmdline matches; raise MAX_AGENTS as a safety net. Pre-existing bug from Phase 3/Phase 6; Phase 10's long-lived sessions amplified it.
- Phase 19 added: Polish Phase 10 chat transcript rendering. Four UAT-surfaced gaps: (1) repeated assistant_text chunks (aggregator emits one row per content_block_delta flush — merge into one row per turn); (2) richer tool-use card summaries + diff/hunk/exit-code previews matching codey's details-summary aesthetic; (3) markdown rendering via react-markdown + remark-gfm + existing shiki highlighter for code fences / emphasis / lists; (4) filter SessionStart hook noise (4×[HOOK_STARTED] + 4×[HOOK_RESPONSE] per boot) in the parser or collapse to a single system_note. All UI/parser polish on the working Phase 10 pipeline; no schema changes.
- Phase 20 added (2026-04-21): Diff-aware agent polling — replace the wholesale `set({ agents })` in `src/stores/agentStore.ts:89–93` `fetchAgents()` (2s poll) with a per-agent diff-emit (upsert changed, remove missing, keep untouched by reference) so Zustand's reference-equality selectors let unchanged subscribers (AgentChannelList, Tower, etc.) skip re-render. Currently 20+ agent sessions cause ~30 full-list re-renders per minute for a single state delta. Perf-only; no behavioral or schema change. Surfaced by 2026-04-21 inefficiency survey as highest-ROI frontend perf fix.
- Phase 21 added (2026-04-22): Polyglot IPC bridge extractor — generalize Phase 12's bridge scaffold (today Tauri-only, parses tauri-specta `src/bindings.ts` + `#[tauri::command]`) to any cross-language API surface. Pluggable per-language extractors in a new `pipeline/ipc_bridges/extractors/` submodule for FastAPI/Flask/Django route decorators, tRPC routers, OpenAPI/Swagger specs, gRPC `.proto`, Express/Fastify route registrations, and Python↔TS message passing. Replaces the hardcoded "FRONTEND · TypeScript / BACKEND · Rust" boundary labels with per-repo auto-detected language groupings (detect the primary frontend/backend axis from file-type distribution + inferred cross-language dependency flow). Reuses Phase 12's IpcBridgeDto shape, get_ipc_bridges Tauri command, forceBoundary mechanic, and bridge diamond rendering — additive, not breaking. Surfaced during Phase 12 UAT on a "2 TS frontends + Python backend" repo where the hardcoded Tauri binary split was misleading. Quick-task 260422-dqu shipped a runtime no-bridges guard as short-term fix; Phase 21 is the structural generalization.
- Phase 22 added (2026-04-22): Bridge layer visual polish — four rendering defects surfaced during Phase 12's D-34 UAT smoke. (1) Aura bug: `RadarCanvas:726` passes `liveNodes` unfiltered to `drawNodes`, so every bridge gets drawn as a 5px file-node circle underneath the diamond — and because drawNodes uses fixed world-space radius while drawBridgeNodes uses BRIDGE_HALF_DIAG/zoom, the aura inverts across zoom (bigger than diamond at low zoom, smaller at high zoom). (2) Convex hull around bridges: `hullCache.ts:86` groups nodes by dirKey without filtering by kind — bridges carrying their handler file's dirKey end up inside folder hulls, pulling centroids toward y=0 and visually tying bridges to the folder cluster they should stand apart from. (3) FRONTEND/BACKEND anchor labels blend into theme: currently `theme.onSurfaceVariant` (same token as folder labels) reads as chrome, not axis markers; needs a brighter token + a small backdrop pill. (4) Dangling-vs-populated bridge distinction too subtle: the locked dashed-stroke signal is hard to see at 8px world-space, replace with a grey fill for dangling (color as primary signal). Plus a fifth deferred-items candidate: BOUNDARY slider "relatively responsive, could have been better" — log if it still feels off during Phase 22 smoke. All fixes are additive to Phase 12; no schema changes, no worker protocol changes, no new dependencies. V-12-15..V-12-24 remain the regression guard.

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2: Windows ReadDirectoryChangesW buffer overflow under agent burst writes needs empirical testing
- Phase 2: PID-to-file-event correlation on Windows may need ETW investigation
- Phase 3: Conflict window data model has no existing reference implementations
- Phase 5: 3-way merge UI complexity -- study GitKraken, VS Code merge editor for patterns

## Quick Tasks Completed

| ID | Description | Date | Commits |
|----|-------------|------|---------|
| 260414-k8p | Cross-OS CI (Linux/Windows/macOS + Arch container) | 2026-04-14 | e29775b, 0346d38, d8678f9 |
| 260415-gke | Modal Change-Repo dialog (replace inline confirm) | 2026-04-15 | ab94b96, c273caa |
| 260414-v9n | Filter binary assets from radar treemap | 2026-04-14 | 3160e03, 3336184 |
| 260415-07f | Repo-relative paths from get_tree_index (radar) | 2026-04-15 | 66181eb, bbafa5a, 4670a23 |
| 260421-igz | Rename top bar title AI_CONTROL_CENTRE → AI_CMD_CENTRE | 2026-04-21 | 236b46e |
| 260421-fast | Rename top bar title AI_CMD_CENTRE → AI_CONTROL_CENTRE | 2026-04-21 | 3cffd8b |
| 260422-dqu | Gate Phase 12 boundary layer on bridges-present (polyglot-repo UAT fix) | 2026-04-22 | 6b9f1bb, e7fe5b8 |

## Session Continuity

Last session: 2026-05-03T04:00:54.030Z
Stopped at: context exhaustion at 76% (2026-05-03)
Resume file: None
Active debug sessions:

  - resolved: .planning/debug/resolved/radar-zoom-blanks-canvas.md (Phase 11.1 NaN/Infinity viewport corruption fixed)
  - awaiting_human_verify: .planning/debug/squarify-not-a-function.md (Phase 6 treemap interop — pending user smoke)
  - investigating (opening next): cold-boot "stuck on building graph" — pause/resume monitoring recovers; suspect fetchGraph timing or pipeline-bridge debounce window on cold boot
