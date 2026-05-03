---
phase: 13
slug: implement-4-level-semantic-zoom-workspace-package-blobs-only
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-03
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest with jsdom environment |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test -- src/views/Radar/__tests__/semanticZoom.test.ts src/views/Radar/__tests__/packageBlobs.test.ts src/views/Radar/__tests__/CodePreviewOverlay.test.tsx` |
| **Full suite command** | `npm run test` and `npm run build` |
| **Estimated runtime** | ~60-120 seconds for targeted tests; build runtime depends on Vite/TypeScript cache state |

---

## Sampling Rate

- **After every task commit:** Run the targeted Vitest file(s) for the helper/renderer touched by that task.
- **After every plan wave:** Run `npm run test` and `npm run build`.
- **Before `/gsd-verify-work`:** Full frontend test suite and build must be green.
- **Max feedback latency:** No more than one task may land without a targeted automated verification command.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-W0-01 | Wave 0 | 0 | VIZN-01 | — | N/A | unit | `npm run test -- src/views/Radar/__tests__/semanticZoom.test.ts` | ❌ W0 | ⬜ pending |
| 13-W0-02 | Wave 0 | 0 | VIZN-04/VIZN-05 | T-13-04 | Blob derivation excludes bridges and avoids per-frame hierarchy recomputation | unit | `npm run test -- src/views/Radar/__tests__/packageBlobs.test.ts` | ❌ W0 | ⬜ pending |
| 13-W0-03 | Wave 0 | 0 | DSGN-01/DSGN-04 | T-13-02/T-13-04 | Code preview cards are capped, fallback-safe, and render source as text/highlighter output only | component | `npm run test -- src/views/Radar/__tests__/CodePreviewOverlay.test.tsx` | ❌ W0 | ⬜ pending |
| 13-W0-04 | Wave 0 | 0 | VIZN-01 | — | N/A | unit | `npm run test -- src/views/Radar/__tests__/GraphRenderer.test.ts` | ✅ exists | ⬜ pending |
| 13-FINAL | Final | all | VIZN-01/VIZN-04/VIZN-05/DSGN-01/DSGN-04 | all | Full semantic zoom surface is type-safe and regression-tested | suite/build | `npm run test` and `npm run build` | ✅ existing infra | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/views/Radar/__tests__/semanticZoom.test.ts` — anchors `0.6`, `2`, `4`; crossfade opacities; dominant hit level; higher-detail tie break.
- [ ] `src/views/Radar/__tests__/packageBlobs.test.ts` — file-count scaling, top-level/subpackage selection, heat/conflict aggregation, active-agent aggregation, and bridge exclusion.
- [ ] `src/views/Radar/__tests__/CodePreviewOverlay.test.tsx` — max 6 cards, `PATH_METADATA` / `SIGNATURES_UNAVAILABLE` fallback copy, expand/collapse local state, and viewport bounds clamp.
- [ ] Extend `src/views/Radar/__tests__/GraphRenderer.test.ts` — file labels at semantic file zoom and obsolete hull-gate expectations replaced.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Smooth semantic morph feel across anchors | VIZN-01 / DSGN-01 | Crossfade perception and ATC-style glanceability require visual inspection | Run the app, open Radar, wheel through zoom anchors `0.6`, `2`, and `4`, and verify no hard snap or duplicate hover target is visible. |
| Package-click focus behavior | VIZN-05 | Requires real viewport interaction and hit-target validation | Click a workspace/package blob and verify it focuses the blob/package without changing pan/zoom/minimap semantics beyond the intended viewport transition. |

---

## Threat Model Anchors

| Threat | STRIDE | Mitigation Required in Plans |
|--------|--------|------------------------------|
| T-13-01 Path traversal in raw snippet/signature reads | Tampering / Information Disclosure | If a backend command is added, canonicalize paths under the watched repo root and reject arbitrary absolute paths. |
| T-13-02 XSS through code preview HTML | Tampering | Render raw source as text; if highlighting expanded snippets, use existing highlighter output and do not inject unsanitized strings. |
| T-13-03 Parser denial of service | Denial of Service | Reuse existing tree-sitter file-size and parse-time guards for any signature extraction. |
| T-13-04 UI denial of service through unbounded cards/labels | Denial of Service | Cap signature cards at 6, cull labels by viewport/importance, and keep package derivation out of the rAF loop. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency target recorded
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-03
