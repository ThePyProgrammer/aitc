---
phase: 7
slug: replace-current-blocked-codebase-map-with-a-graph-based-code
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-15
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 07-RESEARCH.md `## Validation Architecture` section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | vitest (frontend), `cargo test` (Rust backend) |
| **Config file** | `vitest.config.ts`, `src-tauri/Cargo.toml` |
| **Quick run command** | `npm run test -- --run <pattern>` (frontend) / `cargo test -p aitc-tauri <module>` (Rust) |
| **Full suite command** | `npm run test -- --run && cargo test --manifest-path src-tauri/Cargo.toml` |
| **Estimated runtime** | ~30s frontend + ~45s Rust = ~75s |

---

## Sampling Rate

- **After every task commit:** Run the targeted quick command for the file's framework
- **After every plan wave:** Run the full suite for the wave's affected layer (frontend OR Rust OR both)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds (full suite)

---

## Per-Task Verification Map

This map will be filled by the planner as plans land. The pattern below is required for each task; the gsd-plan-checker will block plans that omit it.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-T1 | 01 | 1 | EMON-01 | unit | `cargo test -p aitc_lib pipeline::deps::tests::build_dependency_graph_stub_returns_empty` | ✅ Plan 01 creates | ⬜ pending |
| 07-01-T2 | 01 | 1 | EMON-01 | unit | `npm test -- --run src/stores/__tests__/radarStore.test.ts` | ✅ exists | ⬜ pending |
| 07-01-T3 | 01 | 1 | EMON-01 | scaffold | `npm test -- --run src/views/Radar/__tests__/ src/hooks/__tests__/useGraphLayout.test.ts` | ✅ Plan 01 creates 7 files | ⬜ pending |
| 07-02-T1 | 02 | 2 | EMON-01 | unit (per-language) | `cargo test -p aitc_lib pipeline::deps::extract::tests pipeline::deps::resolve::tests` | ❌ W0 → Plan 01 created stubs; Plan 02 fills | ⬜ pending |
| 07-02-T2 | 02 | 2 | EMON-01 / VIZN-04 (D-24) | integration + bench | `cargo test -p aitc_lib pipeline::deps::tests && cargo test --test dep_graph_bench -- --ignored bench_dep_graph_10k` | ❌ Plan 02 creates bench file | ⬜ pending |
| 07-03-T1 | 03 | 2 | VIZN-05 / D-11 | unit (forceCluster + radarStore) | `npm test -- --run src/views/Radar/__tests__/forceCluster.test.ts src/stores/__tests__/radarStore.test.ts` | ✅ Plan 01 scaffolds | ⬜ pending |
| 07-03-T2 | 03 | 2 | VIZN-01 / VIZN-05 / D-03 | unit (useGraphLayout) | `npm test -- --run src/hooks/__tests__/useGraphLayout.test.ts` | ✅ Plan 01 scaffold | ⬜ pending |
| 07-04-T1 | 04 | 3 | VIZN-01 / D-12 / D-13 / D-19 | unit (GraphRenderer pure fns) | `npm test -- --run src/views/Radar/__tests__/GraphRenderer.test.ts` | ✅ Plan 01 scaffold | ⬜ pending |
| 07-04-T2 | 04 | 3 | VIZN-01 / VIZN-04 / D-04 | unit + build | `npm test -- --run src/views/Radar/__tests__/RadarCanvas.test.tsx && npm run build` | ✅ Plan 01 scaffold | ⬜ pending |
| 07-05-T1 | 05 | 4 | VIZN-02 / D-14..D-18 | unit (CometTrail + radarStore) | `npm test -- --run src/views/Radar/__tests__/CometTrail.test.ts src/stores/__tests__/radarStore.test.ts` | ✅ Plan 01 scaffold | ⬜ pending |
| 07-05-T2 | 05 | 4 | VIZN-02 / D-17 | unit (RadarCanvas extension) | `npm test -- --run src/views/Radar/__tests__/RadarCanvas.test.tsx` | ✅ Plan 01 scaffold | ⬜ pending |
| 07-06-T1 | 06 | 5 | FMON-05 / D-19 / D-20 | unit (HeatMapOverlay refactor + RadarMinimap rewrite) | `npm test -- --run src/views/Radar/__tests__/HeatMapOverlay.test.ts src/views/Radar/__tests__/RadarMinimap.test.tsx` | ✅ Plan 01 scaffolds | ⬜ pending |
| 07-06-T2 | 06 | 5 | D-22 + full-suite | unit + checkpoint:human-verify | `npm test -- --run src/ && cd src-tauri && cargo test -p aitc_lib && cargo test --test dep_graph_bench -- --ignored` | ✅ existing + new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 (test-infrastructure setup) is required before any plan executes. The planner must include these as `[BLOCKING]` tasks in the first plan:

- [ ] `src-tauri/src/pipeline/dependency_graph.rs` `mod tests` — fixture-based dep extraction tests (TS, JS, Rust, Python sample files)
- [ ] `src-tauri/tests/dep_graph_bench.rs` (or `#[ignore]` benchmark in `dependency_graph.rs`) — 10k-file walk + parse benchmark for D-24 (<2s target)
- [ ] `src/hooks/__tests__/useGraphLayout.test.ts` — d3-force settle determinism with fixed seed; node-position snapshot
- [ ] `src/views/Radar/__tests__/RadarCanvas.test.tsx` — Canvas rendering smoke test via canvas-mock or jsdom-canvas; render with mock graph at 100/1000 nodes; verify no throw
- [ ] `src/views/Radar/__tests__/trails.test.ts` — comet trail lifecycle (animate, fade, cull at 10s)
- [ ] `src/lib/__tests__/forceCluster.test.ts` — depth-weighted custom force math unit tests
- [ ] No new framework install needed — vitest and cargo test already configured

---

## Manual-Only Verifications

Visual regressions and interaction polish are inherently manual.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Graph readability on real repos | VIZN-01, EMON-01 | Visual judgment | Open the AITC repo itself in dev mode; verify folder islands form, edges are not visually overwhelming, node count 5k visible |
| Comet trail visual quality | VIZN-02 | Animation timing perception | Launch Claude Code agent in repo; touch 5+ files; observe comet animation reads as motion (not stutter), trail fades gracefully over 10s |
| Folder hull aesthetic | D-12 | Subjective | Verify hull outlines recede behind nodes (#494847 low alpha), labels readable at default zoom but not crowded |
| Conflict pulse on graph node | D-22 | Visual rarity | Trigger CNFL-01 conflict; verify affected node pulses red with badge ring |
| Heat map gradient on nodes | D-19, FMON-05 | Color perception | Toggle heat map with multiple agents touching same files; verify contention tint is visible without obscuring node identity |
| Minimap shifts when manifest opens | D-20, commit e62297b | Layout coordination | Open manifest panel; verify minimap repositions left to avoid overlap |
| 60fps pan/zoom at 5k nodes | D-23 | Subjective performance feel | Use Chrome devtools Performance tab; record while panning; verify >55fps sustained |
| Drag-to-pin a node | D-03 | Interaction feel | Drag a node; verify it stays where dropped, simulation re-warms briefly, other nodes settle around it |

---

## Validation Sign-Off

- [ ] All planned tasks have `<automated>` verify entries OR a Wave 0 dependency producing the test
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING test files referenced by tasks
- [ ] No watch-mode flags in test commands (must be one-shot)
- [ ] Feedback latency < 90s for full suite
- [ ] Per-language dep parsing has fixture file per language (TS, TSX, JS, JSX, Rust, Python)
- [ ] Layout determinism test uses fixed RNG seed (d3-force settles non-deterministically without one)
- [ ] `nyquist_compliant: true` set in frontmatter once planner fills the per-task map

**Approval:** approved (planner — 2026-04-15)
