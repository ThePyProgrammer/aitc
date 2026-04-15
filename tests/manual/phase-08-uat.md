# Phase 8 — Manual UAT + Visual Verification Checklist

Scope: cover the Manual-Only Verifications from
`.planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/08-VALIDATION.md`
plus the visual conformance pass against `08-UI-SPEC.md`. Every section A-M
must be signed off on Linux + Windows (or platform-specific skips documented
with justification) before Phase 8 is marked complete.

## Prerequisites

- [ ] `claude --version` returns >= 2.0.10 (per 08-RESEARCH Pitfall 2). If
      older, `approve_with_edits` silently no-ops — note it and continue with
      other paths.
- [ ] `cargo build -p aitc-hook` has been run successfully.
- [ ] `cargo tauri dev` (or `pnpm tauri dev`) is running against this branch.
- [ ] A throwaway git repo exists at `~/tmp/phase8-uat-repo` containing at
      least one `.ts` file, one `.py` file, and one `.md` file.
- [ ] SQLite CLI is available for row inspection
      (`sqlite3 ~/.config/aitc/aitc.db` on Linux;
      `sqlite3 %APPDATA%\aitc\aitc.db` on Windows).

---

## A. End-to-end hook integration (COMM-01 / COMM-02 / COMM-06 / AGNT-03)

- [ ] **A1.** Open AITC and open `~/tmp/phase8-uat-repo` as the active repo.
- [ ] **A2.** Tower Control → Launch → select ClaudeCodeAdapter with
      **neither** `--accept-edits` **nor** `--dangerously-skip-permissions`
      chip ticked. Enter intent "Edit README to add a hello line". Launch.
- [ ] **A3.** `cat ~/tmp/phase8-uat-repo/.claude/settings.local.json` contains
      a `PreToolUse` entry with `matcher="*"` and `command=<absolute path to
      aitc-hook binary>`. The path resolves to an existing executable file.
- [ ] **A4.** Claude attempts to `Edit` `README.md` → AITC Comms queue shows a
      new `pretool_use` row with EDIT tool badge (phosphor green), file path,
      preview line "+ ..." of the first changed line, and timestamp.
- [ ] **A5.** Click the row → RequestDetail shows ToolBadge in the header,
      `InlineDiff` rendering of the proposed edit.
- [ ] **A6.** Click APPROVE → Claude proceeds and applies the edit. Verify
      `README.md` contents on disk match what Claude proposed.
- [ ] **A7.** Launch a second Claude agent in the same repo. Trigger a Bash
      tool call (ask Claude to run `ls -la`). Verify BASH badge (tertiary
      amber), command preview `$ ls -la`, and a `BashPreview` panel with
      DESCRIPTION (if provided), COMMAND code block, METADATA (cwd + timeout
      if Claude included them).
- [ ] **A8.** Click APPROVE → Claude runs the bash command; stdout is visible
      in the Claude session terminal.

## B. Deny path

- [ ] **B1.** Launch Claude with intent "Rewrite src/app.ts from scratch".
- [ ] **B2.** When Claude proposes `Write` (or `Edit` with a huge diff), click
      DENY. Confirm the two-step DENY → CONFIRM_DENY flow fires.
- [ ] **B3.** Claude's stderr receives the deny reason (e.g. "denied by
      user"). Claude decides its own next step (retry or exit). The AITC row
      transitions to `denied` status.

## C. approve_with_edits (COMM-03 / D-22)

- [ ] **C1.** Trigger an Edit request against a real file in the UAT repo.
- [ ] **C2.** In RequestDetail, click into the diff viewer and edit one line
      of Claude's proposed `new_string`.
- [ ] **C3.** The primary APPROVE button label changes to
      `APPROVE_WITH_EDITS`.
- [ ] **C4.** Click `APPROVE_WITH_EDITS` → Claude receives the
      `updatedInput` envelope; the file on disk ends with the **user-edited**
      content, not Claude's original `new_string`.

## D. Don't ask again this session (D-22)

- [ ] **D1.** Trigger a Bash tool call. Check
      `DON'T_ASK_AGAIN_THIS_SESSION_FOR_BASH` **before** clicking APPROVE.
- [ ] **D2.** Click APPROVE.
- [ ] **D3.** Trigger another Bash call from the **same** agent. Verify no
      approval row is created; Claude proceeds without UI prompt.
- [ ] **D4.** Trigger a Bash call from a **different** Claude agent (new
      launch). Verify it DOES create an approval row (per-agent scoping).
- [ ] **D5.** Terminate the first agent from Tower Control. Relaunch it.
      Trigger Bash → a new approval row is created (session scope cleared
      on terminate).

## E. Bypass chips (D-23)

- [ ] **E1.** Launch Claude with `--dangerously-skip-permissions` chip ticked.
      Verify `.claude/settings.local.json` is NOT created (or AITC entry not
      added) in that repo.
- [ ] **E2.** Launch Claude with `--accept-edits` chip ticked. Same: no
      install.
- [ ] **E3.** Re-launch without chips → settings.local.json IS installed
      (proves the chip is an opt-out, not a sticky setting).

## F. Passive detection consent (D-04)

- [ ] **F1.** Without AITC having launched it, run `claude --print "say hi"`
      in another terminal, cwd = `~/tmp/phase8-uat-repo`.
- [ ] **F2.** Within ~2s of AITC's `passive_bridge` tick, the "Install AITC
      Hook" dialog appears with the correct cwd.
- [ ] **F3.** Click ACCEPT → `.claude/settings.local.json` is written in that
      repo.
- [ ] **F4.** Launch another passive Claude in the **same** repo. Verify the
      dialog does NOT re-appear (dedup sentinel in `app_settings`).
- [ ] **F5.** Launch passive Claude in a **different** repo → dialog appears
      for the new repo.
- [ ] **F6.** On the new repo, click DECLINE → `.claude/settings.local.json`
      is NOT created and the dialog does not re-appear on subsequent
      launches.

## G. Client-disconnect → abandoned (D-09)

- [ ] **G1.** Launch Claude, trigger an Edit. While AITC is showing the
      pending row, `kill -9 <claude_pid>` externally (or Ctrl+C the terminal
      hosting Claude).
- [ ] **G2.** Within ~2s the queue row transitions to the abandoned visual
      state (40% opacity, "ABANDONED — AGENT EXITED" footer, non-clickable
      card).
- [ ] **G3.** `sqlite3 ... "SELECT status FROM approval_requests ORDER BY id
      DESC LIMIT 1"` returns `abandoned` (no lingering `pending` rows).

## H. Terminate force-deny (D-10)

- [ ] **H1.** Launch Claude, trigger an Edit (do not approve).
- [ ] **H2.** Click Terminate on that agent in Tower Control.
- [ ] **H3.** Within ~1s the approval row resolves to `denied` with
      `response_note = "agent terminated by user"`; Claude receives the deny
      envelope on stdout (**not** an EPIPE — the force-deny waiter signal
      fires BEFORE the OS process kill).

## I. Deep-link notification (D-18)

- [ ] **I1.** Minimize AITC. Launch Claude, trigger an Edit.
- [ ] **I2.** OS notification fires ("AITC — Pending approval from
      KAGENT-<pid>" or similar per the notifications module copy).
- [ ] **I3.** Click the AITC tray icon → AITC window focuses, route switches
      to `/comms`, the new `pretool_use` row is selected and visible at the
      top of the queue.
- [ ] **I4.** _(Linux only — best-effort)_ If the toast has a clickable
      region, clicking it routes the same way. Document the distro + desktop
      environment if it fails — Linux notification click handling varies
      between GNOME / KDE / tiling WMs.

## J. Windows-specific (run on Windows)

> Skip on Linux; document "N/A — Linux-only UAT run" if no Windows build is
> available yet.

- [ ] **J1.** Repeat A1-A8 on Windows. Verify `.claude/settings.local.json`
      path uses backslashes; the sidecar `.exe` path resolves correctly; the
      `PreToolUse.hooks[].command` field points at the bundled sidecar exe.
- [ ] **J2.** Repeat H1-H3. Verify `taskkill /PID /T /F` does NOT fire before
      the force-deny waiter signal reaches Claude. (Capture the order from
      `tracing::info!` logs: the `signal_for_agent` line must appear before
      the `terminate` line.)
- [ ] **J3.** Repeat F1-F6. Verify the sidecar path in the installed
      settings.local.json uses absolute Windows pathing (not a POSIX path).

## K. Abandoned row + queue sort order

- [ ] **K1.** Create 2 pending `pretool_use` rows (two Claude agents acting
      in parallel).
- [ ] **K2.** Kill one agent externally. Verify that row becomes `abandoned`
      AND sorts BELOW the remaining pending row in the queue view.
- [ ] **K3.** Click the abandoned row → no selection changes; the card is
      non-interactive (cursor not pointer, no hover state).

## L. Visual verification against 08-UI-SPEC

Open the app with 3 pending rows (one `Edit`, one `Bash`, one `Read` on a
path that matches a user-configured protected glob). Visually confirm:

- [ ] **L1.** Tool badges match the Lucide icon + color mapping from
      `08-UI-SPEC.md §Color`:
      - EDIT → primary phosphor green + Pencil icon
      - BASH → tertiary amber + Terminal icon
      - READ → neutral on-surface-variant + Eye icon
- [ ] **L2.** `ApprovalRequestCard` rows are ~96px tall (virtualizer
      `estimateSize` bump from Plan 05). The preview line is visible between
      the file path and the timestamp.
- [ ] **L3.** RequestDetail header renders StatusBadge + UrgencyBadge +
      ToolBadge in that order, separated by 8px gaps.
- [ ] **L4.** ToolPreview code blocks use `bg-surface-container-lowest`, 16px
      padding, `outline-variant/15` 1px border, and a 400px `max-height` with
      the `SHOW_ALL` / `SHOW_LESS` toggle when content overflows.
- [ ] **L5.** BashPreview stacks DESCRIPTION / COMMAND / METADATA with 24px
      vertical gaps; sections are omitted (not blank-padded) when fields are
      absent.
- [ ] **L6.** `DontAskAgainCheckbox`: 16px square, primary fill when checked,
      label uppercase with underscores
      `DON'T_ASK_AGAIN_THIS_SESSION_FOR_{TOOL_NAME}`.
- [ ] **L7.** Abandoned row: card content fades to ~40% opacity, 2px solid
      `outline-variant` left border, footer reads "ABANDONED — AGENT EXITED".
- [ ] **L8.** Pretool pulse: a new `pretool_use` row arriving while the user
      is in Comms view triggers a 1.2s secondary-outline pulse on the new
      card.
- [ ] **L9.** Reduced motion: set OS "Reduce motion" preference, then verify
      the pulse becomes a 200ms flash and `SHOW_ALL` expansion is instant
      (no 150ms animation).
- [ ] **L10.** Copywriting contract: every label matches
      `08-UI-SPEC §Copywriting Contract` exactly:
      `SHOW_ALL` / `SHOW_LESS` / `CREATE` / `NOTEBOOK_EDIT` /
      `UNVERIFIED_TOOL` / `ABANDONED — AGENT EXITED` / `REQUEST_ABANDONED`
      / `PREIMAGE_LOAD_FAILED`.

## M. Documentation

- [ ] **M1.** `docs/README.md` has a "Phase 8 Hook Testing" section that
      explains how to rebuild the sidecar after source changes.
- [ ] **M2.** `.planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/08-06-SUMMARY.md`
      exists and captures UAT sign-off (this file).

---

## Sign-off

All sections A-M pass on **Linux AND Windows** (or note platform-specific
skips with justification below).

| Field           | Value           |
| --------------- | --------------- |
| Tester          | \_\_\_\_\_\_\_\_ |
| Date            | \_\_\_\_\_\_\_\_ |
| Linux outcome   | PASS / FAIL     |
| Windows outcome | PASS / FAIL / SKIPPED |
| Notes           |                 |

**If any checklist item FAILS:** file a gap-closure row in
`08-VALIDATION.md` §Per-Task Verification Map and run
`/gsd-plan-phase 8 --gaps` to trigger a targeted fix plan. Do not mark Phase
8 complete until all rows pass or are explicitly marked as deferred with an
owner.
