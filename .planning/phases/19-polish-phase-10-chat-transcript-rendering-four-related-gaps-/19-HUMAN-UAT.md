---
status: partial
phase: 19-polish-phase-10-chat-transcript-rendering-four-related-gaps
source: [19-VERIFICATION.md, 19-VALIDATION.md §Manual-Only Verifications]
started: 2026-04-21T08:56:34Z
updated: 2026-04-21T08:56:34Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Codey-matching visual polish on tool-use cards

- **Decision:** D-02.4
- **Expected:** Collapsed tool-use rows use `py-1.5` vertical rhythm, 8px status dot before `TOOL` small-caps label (green / red / grey), expanded body uses `bg-surface-container/10` tint (lighter than the previous `/20`). Feel should match codey's `PlaygroundPage.MessageRow` collapsed details-summary aesthetic.
- **Instructions:** `npm run tauri dev` → open CommsHub → trigger a few tool calls (Edit, Bash, MultiEdit). Compare to codey reference (from Phase 10 context). Confirm: (a) vertical density feels tighter than Phase 10 baseline, (b) status dots are readable at 8px, (c) expand tint is subtle but visible.
- **Result:** [pending]

### 2. SessionStart hook noise absence in transcript at agent boot

- **Decision:** D-04.1, D-04.2
- **Expected:** On a fresh Claude Code session launch with hooks configured (`SessionStart:startup`), the ChatTranscript shows ZERO `[HOOK_STARTED] SessionStart:startup` or `[HOOK_RESPONSE] SessionStart:startup` system-note rows. Other hook lifecycle events (e.g. `PreToolUse:Edit`) continue to surface normally.
- **Instructions:** Launch a new Claude Code agent via the AITC "deploy agent" flow (must have `.claude/settings.json` with a SessionStart hook configured — any will do). Inspect the ChatTranscript during and after boot. Confirm: (a) no `SessionStart:*` system-note rows appear, (b) a Claude prompt triggering an Edit hook still shows `[HOOK_STARTED] PreToolUse:Edit` as a SystemNote (regression guard). `raw_stdout` events (toggle via view option) still show the full hook lifecycle for debugging — that's expected.
- **Result:** [pending]

### 3. Markdown rendering with real streamed assistant text

- **Decision:** D-03.1, D-03.2, D-03.6
- **Expected:** A streamed assistant reply containing `**bold**`, `*italic*`, `- lists`, numbered lists, and fenced code blocks (`\`\`\`typescript`, `\`\`\`rust`, etc.) renders as formatted HTML in real time. Code fences gain shiki syntax highlighting. Partial/mid-stream broken fences don't cause crashes — any transient render glitches resolve at `TurnComplete`. Typography matches Command Horizon dark theme (no white flash, no bleeding into surrounding UI).
- **Instructions:** Launch CommsHub, prompt Claude Code with a request that will produce a long multi-section markdown reply with at least one fenced code block (example: "explain the parser.rs coalescing change with a TypeScript analogy and a Rust snippet"). Observe: (a) markdown renders progressively, (b) code fences get highlighted (try at least one typescript and one rust), (c) lists and emphasis render correctly, (d) no visual glitches during streaming that persist past `TurnComplete`.
- **Result:** [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

[awaiting user testing — report any visual or behavioral regressions here]
