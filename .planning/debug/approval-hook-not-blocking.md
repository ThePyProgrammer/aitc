---
slug: approval-hook-not-blocking
status: resolved-no-fix
trigger: |
  New Claude Code shells opened after installing the AITC hook don't prompt
  for approvals despite the user having 0 permissions configured — tool
  calls run without any approval request reaching the CommsHub Requests tab.
created: 2026-04-22T02:44:25Z
updated: 2026-04-22T03:12:00Z
related_phase: "NOT a regression — current Phase 17 design (D-06/D-18/D-19)"
---

# Approval hook not blocking new Claude Code shells

## Symptoms

**Expected behavior:**
- AITC UI installs a PreToolUse hook into a project's `.claude/settings.json` via `hook_install.rs::upsert_pretool_entry`.
- User opens a new Claude Code shell in that project with zero permissions granted.
- User asks Claude to do something that requires permission (Edit a file, run a Bash command, etc.).
- Claude Code sends the PreToolUse event to the AITC-registered hook endpoint (HTTP POST to `http://localhost:<aitc-port>/hook` or equivalent).
- AITC creates a pending approval row and returns a block-until-decision response.
- The pending row surfaces in CommsHub → Requests tab.
- Claude Code remains blocked until the user approves or denies in the AITC UI.

**Actual behavior:**
- Claude Code proceeds immediately. No approval row appears in the Requests tab. No block. Tool executes with full effect as if no hook were wired.

**Error messages:** None observed by the user. No visible error in Claude Code's output, no visible error in the AITC UI, no toast/notification.

**Timeline:**
- Unclear if the hook EVER worked in this session. The user opened the shell "after the hook was installed" via AITC, i.e. this is the first-observed shell opened post-install.
- No explicit regression event — may be that approvals never worked for freshly-launched shells, OR the install itself is broken, OR a recent unrelated change broke it.

**Reproduction:**
1. In AITC, use the plugin/hook manager UI to install the PreToolUse hook into a test project's `.claude/settings.json`.
2. Open a NEW Claude Code shell in that same project directory.
3. Prompt Claude to do a permission-gated action — e.g. "edit a file in src/" or "run `ls` in the terminal".
4. Observe: Claude proceeds without any approval prompt; no pending approval row appears in the AITC CommsHub Requests tab.

## Context

**Phase 19 ruled out as cause (evidence):**
- Phase 19's D-04 SessionStart filter is narrow — `hook_name.starts_with("SessionStart:")` only. Does NOT match `PreToolUse:*`.
- Phase 19 didn't modify `src-tauri/src/agents/hook_install.rs`, `hook_waiters.rs`, the Tauri `/hook` HTTP endpoint, or `commsStore`.
- `git diff --name-only <phase19-start>..HEAD` for Phase 19 covers only parser.rs + frontend chat/store files.

**Candidate root-cause surfaces to investigate (from prior analysis):**

1. **Stale / wrong `.claude/settings.json`**
   - Hook install may have targeted the wrong path (global vs cwd vs project root).
   - Existing hook entries may have been clobbered or merged incorrectly by `upsert_pretool_entry`.
   - Check: read the project's `.claude/settings.json` after hook install — does it contain the AITC PreToolUse entry?

2. **`hook_install::upsert_pretool_entry` persistence bug**
   - JSON merge may produce malformed structure (e.g. replacing array with object, nested shape mismatch).
   - Check: unit tests exist at `src-tauri/src/agents/hook_install.rs` (~lines 173, 183, 201). Review what they cover.
   - Check: Claude Code expects a specific hook entry schema — does our entry match?

3. **`/hook` endpoint in the Tauri backend returning allow-by-default**
   - If the endpoint exists but returns 200 with allow/no-block on every POST, Claude Code never pauses.
   - Check: find the HTTP handler — `grep -rn "hook\|PreToolUse\|approval" src-tauri/src/`. Likely under `src-tauri/src/server/` or `src-tauri/src/approvals/`.

4. **Port / URL mismatch**
   - Hook install writes the AITC hook command (e.g. `curl http://localhost:PORT/hook`). If the runtime port differs from the installed-at-time port, Claude Code posts into the void — silent failure.
   - Check: what port does AITC bind? Is it stable across restarts? Does the install script capture it correctly?

5. **Claude Code hook lifecycle not firing on fresh shell**
   - Claude Code may only fire PreToolUse hooks under specific conditions — e.g. requires a valid API key, specific model, or particular tool type. First-shell-launch may have some bootstrapping gap.
   - Check: Claude Code docs — is PreToolUse universal or tool-type-gated?

## Current Focus

hypothesis: CONFIRMED — "instant allow" is the Phase 17 design for single-agent sessions with no protected_paths configured. Not a bug.

next_action: (none — resolved as expected behavior)

## Evidence

- timestamp: 2026-04-22T03:05:00Z
  source: src-tauri/src/agents/hook_install.rs:26-67
  finding: |
    install_aitc_hook writes to `<cwd>/.claude/settings.local.json` (NOT
    `.claude/settings.json`). Claude Code DOES load settings.local.json —
    it's one of the three canonical hook-source files (~/.claude/settings.json,
    .claude/settings.json, .claude/settings.local.json). Schema written
    matches Claude Code's expected PreToolUse format:
      {"matcher":"*","hooks":[{"type":"command","command":"<sidecar-path>"}]}

- timestamp: 2026-04-22T03:06:00Z
  source: src-tauri/aitc-hook/src/main.rs + lib.rs
  finding: |
    AITC hook uses a SIDECAR BINARY (`aitc-hook`), not an HTTP endpoint
    baked into settings.json. Flow:
      1. Claude Code invokes the sidecar binary on PreToolUse.
      2. Sidecar reads PreToolUse JSON from stdin.
      3. Sidecar resolves port via AITC_PORT env → AITC_PORT_FILE_OVERRIDE → ~/.aitc/port.
      4. Sidecar POSTs HookRequest to http://127.0.0.1:{port}/hook.
      5. Sidecar translates AitcDecision into Claude's hookSpecificOutput envelope.
    Port discovery via ~/.aitc/port file eliminates the "port mismatch" candidate —
    the sidecar always reads the live port written by the currently-running AITC.

- timestamp: 2026-04-22T03:07:00Z
  source: src-tauri/src/lib.rs:287-318 + agents/self_register.rs
  finding: |
    AITC binds port 9417 (default) and writes it to ~/.aitc/port via
    pipeline::port_file::write_port on startup. PortFileGuard managed on
    Tauri state ensures Drop on exit. No port mismatch possible.

- timestamp: 2026-04-22T03:08:00Z
  source: src-tauri/src/agents/self_register.rs:440-456 (hook_handler)
  finding: |
    ROOT CAUSE. The /hook handler's gate decision logic is:

      let (should_gate, gate_reason, conflict_with) =
          match (conflict_other.as_deref(), path_gated) {
              (Some(id), _) => (true, "file_conflict", Some(id)),
              (None, true)  => (true, "protected_path", None),
              _             => (false, "", None),
          };

      if !should_gate {
          // instant allow — return AitcDecisionResponse::Allow
          return (StatusCode::OK, Json(AitcDecisionResponse::Allow)).into_response();
      }

    The handler ONLY creates an approval row when EITHER:
      (a) Another live agent conflicts on the same canonical path within
          ConflictState.window_ms (default 5000ms), OR
      (b) The file_path matches a `protected_paths` glob.
    Otherwise it returns Allow instantly. No approval row. No Requests-tab entry.

- timestamp: 2026-04-22T03:09:00Z
  source: .planning/phases/17-conflict-triggered-pretooluse-gating-replace-tool-category-g/17-CONTEXT.md D-06/D-18
  finding: |
    This is DESIGNED BEHAVIOR per Phase 17. D-18 explicitly removed the
    "tool-category gating" path (Edit/Write/NotebookEdit/Bash used to gate
    unconditionally). D-06 locks in "gate ONLY on file_conflict OR
    protected_path." Reasoning documented in 17-CONTEXT:
      "The phase thesis is 'conflict-triggered, not category-triggered';
      a command we can't locate a write target in is, by definition, not
      a known conflict surface."

- timestamp: 2026-04-22T03:10:00Z
  source: src-tauri/src/db/migrations/003_comms_chat.sql + grep INSERT INTO protected_paths
  finding: |
    The `protected_paths` table ships empty. No default seeding. The only
    INSERT outside of commands.rs is in a test (self_register.rs:1242).
    So a fresh AITC install starts with zero protected globs.

- timestamp: 2026-04-22T03:11:00Z
  source: src/bindings.ts + grep protected_paths in src/
  finding: |
    The frontend exposes `list_protected_paths` + `add_protected_path`
    Tauri commands via bindings.ts, but no production UI view to add or
    manage them appears in `src/views/`. Only `ProtectedPathPreview.tsx`
    (a card renderer for an already-triggered row) exists. The user has
    no obvious affordance to enable strict-path gating.

## Eliminated

- hypothesis: "Phase 19 SessionStart filter over-matched and ate PreToolUse events"
  reason: |
    Phase 19 filter predicate is `hook_name.starts_with("SessionStart:")` (parser.rs line 255).
    This only matches hook_name values like "SessionStart:startup". "PreToolUse:Edit" does NOT
    start with "SessionStart:" so it falls through to the existing SystemNote emit path.
    Additionally, the `/hook` HTTP endpoint is a SEPARATE code path from the stream-json
    parser — PreToolUse events from Claude Code arrive via HTTP POST, not via stream-json
    parsed from Claude's stdout. So parser.rs changes cannot break approvals regardless.

- hypothesis: "Stale / wrong settings.json path"
  reason: |
    hook_install.rs correctly writes to <cwd>/.claude/settings.local.json,
    which is one of Claude Code's canonical hook-source files. Schema
    matches Claude's expected PreToolUse entry shape. Unit tests cover
    preservation of user entries, idempotency, and stale-path healing.

- hypothesis: "upsert_pretool_entry JSON merge bug"
  reason: |
    Hand-rolled merge (NOT json-patch) with explicit guards against:
    non-object top-level (refuses write), non-object hooks subtree
    (replaces), non-array PreToolUse (replaces). Eight unit tests pass.
    Pitfall 6 stale-path healing by basename suffix is covered.

- hypothesis: "/hook endpoint returning allow-by-default on every POST"
  reason: |
    CONFIRMED as the behavior, but it is INTENTIONAL per Phase 17 D-06/D-18.
    Not a bug in the endpoint — this is the locked design.

- hypothesis: "Port / URL mismatch between sidecar and AITC server"
  reason: |
    Sidecar reads ~/.aitc/port (written by AITC on every start via
    pipeline::port_file::write_port). Single source of truth. The file
    is Drop-guarded so a live AITC's port is always current.

- hypothesis: "Claude Code hook lifecycle not firing on fresh shell"
  reason: |
    If the hook weren't firing, the sidecar's fail-safe-deny would kick
    in (exit 2 + stderr reason) and the user would see the tool BLOCKED,
    not auto-allowed. The observed behavior (auto-allow, no block, no
    row) is consistent with the hook firing, the sidecar POSTing /hook,
    and the handler returning AitcDecision::Allow.

## Resolution

**Root cause:** The AITC `/hook` handler is working exactly as designed by
Phase 17 (D-06, D-18). Current gating policy is "conflict-triggered, not
category-triggered":

- Gate ONLY when another live agent has written to the same canonical file
  path within `ConflictState.window_ms` (default 5000ms), OR when the path
  matches a user-configured `protected_paths` glob.
- Otherwise, every PreToolUse returns `Allow` instantly — no approval row,
  no CommsHub entry, no block.

In the reported reproduction the user is running a SINGLE Claude Code
session with an empty `protected_paths` table. Neither gating condition
can fire. The sidecar POSTs `/hook`, the handler returns `Allow`, and
Claude Code proceeds — all correct per current design.

**The user's mental model ("0 permissions granted in Claude Code ⇒ AITC
must prompt for everything") does not match AITC's gating semantics.**
AITC isn't a general-purpose permission broker — it's a conflict-detection
gate.

**Fix:** Not a code bug. No fix applied. Options presented to user:

1. **Configure `protected_paths`** — add globs (e.g. `**/*.ts`, `**/.env`,
   `src/**`) via the `add_protected_path` Tauri command. The handler will
   then gate every write-class tool against those globs. Currently lacks
   a polished UI surface (only bindings + card renderer exist).
2. **Accept the design** — rely on Claude Code's own permissions system
   for per-tool prompting; use AITC for multi-agent conflict detection.
3. **Re-enable tool-category gating (new phase)** — Phase 17 D-19 kept the
   `pretool_gated_tools` storage + helpers intact as "dead-but-ready"
   code for exactly this pivot. Would require a new phase to wire it
   back into `hook_handler` and expose UI.

**Recommendation:** This is a product-design question, not an engineering
bug. Before any code change, the user should decide whether AITC's role
is (a) conflict gate only (current), or (b) general permission broker
(pre-Phase-17). A new GSD phase is the right vehicle to make that pivot
if desired.
