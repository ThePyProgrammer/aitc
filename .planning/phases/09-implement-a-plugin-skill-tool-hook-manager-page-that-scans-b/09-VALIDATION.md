---
phase: 9
slug: implement-a-plugin-skill-tool-hook-manager-page-that-scans-b
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for ARSENAL feature. Filled in from RESEARCH.md "Validation Architecture" section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Frontend: Vitest (existing, see `vitest.config.ts`). Backend: `cargo test` (Rust, existing) |
| **Config file** | Frontend: `vite.config.ts` + `src/test-setup.ts`. Backend: `src-tauri/Cargo.toml` test targets |
| **Quick run command** | `pnpm test --run src/__tests__/arsenal` (frontend) / `cargo test -p aitc --lib claude_resources` (backend) |
| **Full suite command** | `pnpm test --run && cargo test --workspace` |
| **Estimated runtime** | ~12s (frontend Arsenal scope) + ~6s (backend claude_resources scope) ≈ 18s combined |

---

## Sampling Rate

- **After every task commit:** Run quick scope test for the touched module
- **After every plan wave:** Run full suite (`pnpm test --run && cargo test --workspace`)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~18 seconds

---

## Per-Task Verification Map

To be populated by the planner. Each task in PLAN.md must list either:
- An `<automated>` verify command, OR
- A reference to a Wave 0 fixture/stub created earlier in the wave plan

Coverage targets:
- `claude_resources::watcher` extension (multi-root `.watch()` calls + path routing)
- `claude_resources::parse` (gray_matter frontmatter, serde_json for plugins/settings/MCP, error tolerance)
- `claude_resources::ignore_filter` (subdir allowlist + cache/projects exclusions)
- `claude_resources::write_fence` (suppression registry; no banner on self-write)
- `claudeResourcesStore` reducers (added/removed/changed/externalEdit handling)
- `MasterDetailShell` layout primitive (rail widths, panel responsiveness)
- `ScopeTabs` filter logic (Global / Project / Combined)
- `useClaudeResourcesChannel` hook (Channel<T> wiring + cleanup)
- `ClaudeMdEditor` (dirty state, save → undo flow, external-change banner)

---

## Wave 0 Requirements

- [ ] `src-tauri/src/claude_resources/mod.rs` test module + fixture `~/.claude` mirror under `src-tauri/tests/fixtures/claude/`
- [ ] `src/__tests__/arsenal/` test directory + shared mock for `useClaudeResourcesChannel`
- [ ] Add `gray_matter` to `Cargo.toml` if absent (researcher confirmed not present)
- [ ] Verify `tempfile` available (used by atomic write)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sidebar order shows ARSENAL after TOWER | D-10 | Visual layout | Open app, confirm sidebar order RADAR / TOWER / ARSENAL / COMMS / CONFLICTS / HISTORY |
| External-change banner appears on disk edit while editor open with unsaved changes | D-15 | Requires concurrent IO + UI inspection | Open `<cwd>/CLAUDE.md` in ARSENAL, type unsaved edit, externally `echo X >> CLAUDE.md`, banner appears within 200ms |
| Undo toast restores pre-save content within 10s window | D-14 | Time-sensitive | Edit, Save, click UNDO within 10s, content restored |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (gray_matter add, fixture mirror, test stubs)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
