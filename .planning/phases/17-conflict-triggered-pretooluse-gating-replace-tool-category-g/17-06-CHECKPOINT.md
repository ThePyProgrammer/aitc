# Phase 17 — Wave 4 Human-Verify UAT Checkpoint

**Plan:** `17-06`
**Checkpoint type:** `checkpoint:human-verify` (gate=blocking, autonomous: false)
**Status:** ⏳ AWAITING DEVELOPER SIGN-OFF
**Created:** 2026-04-21

---

## What was built (Plans 01-06)

**Backend (Plans 01-05 — already shipped to main at `bdcca20`):**

- Shared `Arc<tokio::sync::Mutex<ConflictEngine>>` registered at Tauri setup,
  wired into both the pipeline `conflict_task` (writer) and the axum `/hook`
  handler (reader).
- Rewritten `/hook` gate predicate (D-18): every request consults
  `could_conflict_with(canonical_path, self_agent_id, now_ms, window_ms)` with
  the D-04 liveness filter via `registry.get_agent(&id).is_some()`. Tool-category
  allowlist is GONE.
- Bash commands parsed by `bash_paths::extract_target_paths` with read-only
  safelist + verb dispatch; `ParseFailed` or empty-targets → `Allow`.
- Migration 007 applied: `approval_requests.conflict_with_agent_id` +
  `approval_requests.gate_reason` columns exist; `pretool_gated_tools`
  disarmed to `'[]'`.
- `update_pid_mapping` wired into `resolve_or_create_agent` so engine records
  carry canonical `KAGENT-*` / `PASSIVE-*` ids (D-15b).
- `⚠ CONFLICT: ` prefix on OS notification body when gate reason is
  `file_conflict` (D-23).
- Tracing contract: `kind="hook_gate"` (info), `kind="hook_allow"` (debug),
  `kind="hook_lock_wait"` (debug with `elapsed_us`).

**Frontend (Plan 06 — just landed on this worktree):**

- `src/bindings.ts` regenerated. `ApprovalRequest` TS type now carries
  `conflictWithAgentId?: string | null` and `gateReason?: string | null`.
  `GateReason` union added: `"file_conflict" | "protected_path" | "unknown"`.
- `src/stores/commsStore.ts` `ApprovalRequest` interface extended in lockstep
  (with a defensive `| string | null` fallback for forward-compat).
- `src/views/CommsHub/ApprovalRequestCard.tsx` conditionally renders:
  - `⚠ CONFLICT with {agentId}` in `text-error` when `gateReason === 'file_conflict'`
  - `🔒 PROTECTED path` in `text-[#ffd16f]` when `gateReason === 'protected_path'`
  - Nothing on legacy rows or unrecognized gateReasons (defensive)
- 5 new vitest cases in `src/views/CommsHub/__tests__/ApprovalRequestCard.test.tsx`
  locking the exact D-22 strings + color tokens. All 15 tests in that file pass.

---

## Why this gate exists

Phase 17 closes on the two-Claude-Code-session end-to-end flow that only a
human with two live agents can exercise. Automated tests mock pieces
(the engine, the registry, the notification layer) but cannot reproduce the
real-world loop: (a) Claude Code A edits a file → (b) Claude Code B gates on
the same file within 5s → (c) approval card shows the conflict line → (d)
approve/deny behaves as expected → (e) OS notification click deep-links.

Per `17-VALIDATION.md §Manual-Only Verifications`, three scenarios require
manual verification:

1. **Real-world two-session UAT** (phase-gate)
2. **Solo-session noise regression** (performance)
3. **Deep-link OS notification still works** (D-23)

The PLAN adds three additional scenarios (solo-protected-path, bash-safelist,
bash-actual-conflict) because the hook rewrite touches those paths too.

---

## Prerequisites

Run these once before starting the UAT session. All should complete cleanly.

```bash
# 1. Build release binary (takes ~2-3 min on the first run)
cd <repo>/src-tauri
cargo build --release --bin aitc

# 2. Confirm the sidecar hook binary is in place
ls src-tauri/binaries/aitc-hook-x86_64-unknown-linux-gnu

# 3. Confirm two fresh Claude Code sessions are configured to use aitc-hook
#    (check `~/.claude.json` or wherever the hooks config is stored)

# 4. (optional) Enable debug logging for notifications
export AITC_NOTIFICATION_DEBUG=1
export RUST_LOG=debug,aitc=trace
```

Launch AITC via:

```bash
./target/release/aitc
```

---

## UAT Scenarios — Developer Sign-Off Checklist

For each scenario, replace `[ ]` with `[x]` when it passes, `[FAIL]` when it
fails. Add notes below each box. A single FAIL blocks phase close-out.

### Scenario 1 — Two-agent conflict gate (D-14/D-15 happy path)

- [ ] **PASS** / [FAIL] Session B's PreToolUse surfaces an approval row with the
      file path matching what both agents touched, agent ID `KAGENT-{B-id}`,
      tool `Edit`, and a `⚠ CONFLICT with KAGENT-{A-id}` line beneath the
      file path in amber (`text-error` color token)
- [ ] Approving lets Session B's Edit complete
- [ ] Denying produces fail-safe deny in Session B (hook returns 403 / deny)

**Steps:**
1. Launch Session A in AITC's current working repo. Ask: "Open
   `src/views/CommsHub/ApprovalRequestCard.tsx`, then edit line 1 comment to
   read `// HELLO FROM A`."
2. Wait for A to complete (no approval row should appear — A's write is the
   first write, no prior agent wrote this path within the window).
3. Within 5 seconds, launch Session B and ask it to edit the SAME file with
   a different change.
4. Verify the approval card contents per the checklist above.
5. Click approve on one attempt; run a fresh attempt and click deny.

**Notes:** _<record any observed deviations, log excerpts, screenshots>_

---

### Scenario 2 — Solo-session noise regression (Phase 17's success criterion)

- [ ] **PASS** / [FAIL] ZERO approval rows for a 10-edit run across disjoint
      files
- [ ] Every `Edit` / `Write` / `Bash` on non-protected paths passes through
      instantly; the Phase 8 tool-category prompts are GONE
- [ ] Side-by-side comparison: noticeably quieter than Phase 8 baseline (the
      "it got quieter" success criterion)

**Steps:**
1. With only Session A running, ask it to do a 10-edit refactor on disjoint
   files (e.g., rename a helper across 10 files where no two edits touch the
   same path).
2. Observe the Comms Hub for the duration.
3. Count approval rows created. Expected: 0.

**Notes:** _<record row count, time spent, anything unusual>_

---

### Scenario 3 — Protected path still gates (D-07 preservation)

- [ ] **PASS** / [FAIL] Approval row gates with a `🔒 PROTECTED path` line in
      warning-amber (`text-[#ffd16f]` color token)
- [ ] `conflict_with_agent_id` field on the row is null (verify in DB or via
      dev tools if accessible)
- [ ] Approve / deny both behave normally

**Steps:**
1. With only Session A running, configure `protected_paths` to include
   `**/.env`.
2. Ask Session A to edit `/tmp/.env`.
3. Verify the `🔒 PROTECTED path` line appears on the approval card.

**Notes:** _<record glob config, observed row structure>_

---

### Scenario 4 — Bash safelist (D-11 noise reduction)

- [ ] **PASS** / [FAIL] Zero approval rows for `ls`, `git status`, `git diff`,
      `git log` run in quick succession

**Steps:**
1. Session A runs: `ls`, `git status`, `git diff`, `git log` (one at a time
   or chained — either way).
2. Observe the Comms Hub. Expected: 0 approval rows for any of these.

**Notes:** _<record whether any unexpected rows appeared>_

---

### Scenario 5 — Bash actual conflict (D-12 verb dispatch + conflict predicate)

- [ ] **PASS** / [FAIL] Session B's Bash call gates with `gateReason=file_conflict`
      and `conflictWithAgentId='KAGENT-A'`
- [ ] The `⚠ CONFLICT with KAGENT-A` line appears on the approval card

**Steps:**
1. Session A writes `/tmp/shared.txt` via Write (or `echo hi > /tmp/shared.txt`
   via Bash).
2. Within the 5s window, Session B runs `echo hello > /tmp/shared.txt` via Bash.
3. Verify the parser extracted `/tmp/shared.txt` as the target, the engine
   returned a hit, the liveness gate confirmed A is live.

**Notes:** _<record log excerpt — `kind="bash_parse"` should show the target>_

---

### Scenario 6 — OS notification deep-link (D-23)

- [ ] **PASS** / [FAIL] OS notification fires on every conflict gate
- [ ] Notification body begins with `⚠ CONFLICT: ` when the gate reason is
      `file_conflict`
- [ ] Clicking the notification focuses the AITC window and navigates to
      `/comms?requestId={id}` with the corresponding row selected

**Steps:**
1. Trigger any conflict gate (re-run Scenario 1 or 5 if needed).
2. Click the OS notification from the tray / notification center.

**Notes:** _<record whether window-focus + deep-link work on this OS>_

---

## Closing Diagnostics

After all scenarios, run the log-scan to confirm the tracing contract fired
on every gate event:

```bash
tail -n 100 ~/.cache/aitc/logs/*.log 2>/dev/null | grep 'kind = "hook_gate"'
```

Expected: one info-level entry per gate event, with `reason`, `agent`,
`file`, `conflict_with` fields populated per VALIDATION contract.

- [ ] **PASS** / [FAIL] Log entries emitted as expected

**Notes:** _<attach log excerpt>_

---

## Sign-Off

**Developer:** ___________________________________________
**Date:** _______________________________________________
**Overall outcome:** [ ] ALL PASS — Phase 17 shipped / [ ] PARTIAL — gaps logged below

### Gaps / Deferred items (if any)

_<If any scenario failed, describe the failure mode in detail — scenario
number, observed vs expected, reproduction steps, log excerpts. Each gap
becomes a Plan 07 task via `/gsd-plan-phase 17 --gaps`.>_

---

## Phase Close-Out

**Phase 17 is NOT closed until this checkpoint is signed off.**

After the developer records `ALL PASS` above, run:

```bash
/gsd-verify-work 17
```

That will (a) confirm all plan SUMMARY.md files exist, (b) update
`.planning/STATE.md` to mark Phase 17 complete, and (c) update
`.planning/ROADMAP.md` Phase 17 line to `[x]`.

If any scenario failed, run instead:

```bash
/gsd-plan-phase 17 --gaps
```

to spin up Plan 07 (gap closure) targeting the specific failure modes.

---

*Phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g*
*Plan: 06 (final wave — frontend D-22 render + UAT gate)*
*References: `17-VALIDATION.md §Manual-Only Verifications`, `17-CONTEXT.md §D-22`, `17-06-PLAN.md §Task 3`*
