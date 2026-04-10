---
phase: 04
slug: core-ui-views
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (already configured in project) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | COMM-01 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | COMM-02 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | COMM-03 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | COMM-04 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | COMM-05 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | COMM-06 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | VIZN-01 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | VIZN-02 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 2 | VIZN-04 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 04-03-04 | 03 | 2 | VIZN-05 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for COMM-01 through COMM-06
- [ ] Test stubs for VIZN-01, VIZN-02, VIZN-04, VIZN-05
- [ ] Canvas 2D mock utilities for radar tests

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native OS notifications fire | COMM-05 | Requires OS notification API, cannot verify in headless test | Launch app, trigger approval request, verify OS notification appears |
| Canvas 2D radar rendering at 60fps | VIZN-04 | Performance testing requires visual inspection and profiling | Open radar with 10k+ file repo, verify smooth rendering via DevTools performance tab |
| Zoom/pan interaction | VIZN-01 | Interactive canvas requires manual mouse input | Mouse wheel zoom in/out, click-drag to pan, verify correct viewport transformation |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
