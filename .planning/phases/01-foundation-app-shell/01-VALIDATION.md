---
phase: 1
slug: foundation-app-shell
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (frontend), cargo test (Rust backend) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run && cd src-tauri && cargo test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run && cd src-tauri && cargo test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 1 | SHELL-01 | — | N/A | smoke | `cd src-tauri && cargo build` | N/A (build) | ⬜ pending |
| TBD | TBD | 1 | SHELL-02 | — | N/A | unit | `npx vitest run src/__tests__/navigation.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | SHELL-03 | — | Command palette input sanitized | unit | `npx vitest run src/__tests__/command-palette.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | SHELL-04 | — | N/A | manual-only | Manual: right-click tray icon, verify Show and Quit | — | ⬜ pending |
| TBD | TBD | 1 | DSGN-01 | — | N/A | unit | `npx vitest run src/__tests__/theme.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | DSGN-02 | — | N/A | manual-only | Manual: visual inspection of typography | — | ⬜ pending |
| TBD | TBD | 2 | DSGN-03 | — | N/A | unit | `npx vitest run src/__tests__/radar-pulse.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | DSGN-04 | — | N/A | manual-only | Manual: visual inspection of glanceability | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — test framework config
- [ ] `src/__tests__/navigation.test.tsx` — stubs for SHELL-02
- [ ] `src/__tests__/command-palette.test.tsx` — stubs for SHELL-03
- [ ] `src/__tests__/theme.test.ts` — stubs for DSGN-01
- [ ] `src/__tests__/radar-pulse.test.tsx` — stubs for DSGN-03
- [ ] Framework install: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| System tray icon with Show/Quit menu | SHELL-04 | Requires native OS tray interaction | 1. Launch app 2. Right-click tray icon 3. Verify "Show" and "Quit" menu items 4. Click "Quit" exits app |
| Fonts load and apply correctly | DSGN-02 | Visual rendering verification | 1. Launch app 2. Inspect headlines for Space Grotesk 3. Inspect data/code for JetBrains Mono |
| Status colors visible from glance | DSGN-04 | Subjective visual assessment | 1. Launch app 2. From 3+ feet away, verify green/amber/red status is distinguishable |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
