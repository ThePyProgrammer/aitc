---
phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
plan: 05
checkpoint: human-verify
gate: blocking
decision: D-34
status: approved
created: 2026-04-21
approved: 2026-04-22
---

# Phase 12 Plan 05 — Human-Verify Checkpoint (D-34)

## ✓ APPROVED 2026-04-22 — "phase 12 approved, polish tracked in Phase 22"

User smoke confirmed the Phase 12 deliverable:

- ✓ Bridge diamonds visible on the boundary line
- ✓ BOUNDARY slider responsive (note: "relatively responsive, could have been better" — deferred-items candidate for Phase 22 if still feels off)
- ✓ No layout shift when `BridgeDetailPanel` appears on selection
- ✓ FRONTEND/BACKEND anchor labels scale correctly with zoom

Four **visual-polish findings** surfaced during smoke that **do not invalidate the Phase 12 deliverable** and have been filed as Phase 22 instead of blocking closure here:

1. **Aura bug** — `RadarCanvas:726` passes `liveNodes` unfiltered to `drawNodes`, so every bridge gets drawn as a file-node circle underneath the diamond; aura inverts across zoom due to different scaling math between `drawNodes` (fixed world-space radius) and `drawBridgeNodes` (BRIDGE_HALF_DIAG/zoom). Fix: filter `liveNodes.filter(n => n.kind !== 'bridge')` before passing to `drawNodes` + `drawFileLabels`.
2. **Folder hulls envelop bridges** — `hullCache.ts:86` groups by `dirKey` without a `kind` filter, so bridges carrying their handler file's dirKey pull folder hull centroids toward y=0. Fix: skip `n.kind === 'bridge'` in the group-by-dirKey loop.
3. **FE/BE label contrast too low** — currently drawn with `theme.onSurfaceVariant` (same token as folder labels); reads as chrome, not axis markers. Fix: swap to `theme.onSurface` at full opacity + add a `theme.surface/80` padded backdrop pill.
4. **Dangling vs populated bridge distinction too subtle** — 1px `[4, 3]` dashed stroke on an 8-unit diamond is hard to see. Fix: change dangling from "cyan fill + dashed stroke" to "transparent/grey fill + solid stroke" (color as primary signal).

All four are scoped to Phase 22 per 2026-04-22 roadmap entry. Phase 12 closes on current code state. Post-ship follow-up `260422-dqu` (commits `6b9f1bb` / `e7fe5b8`) already shipped the runtime no-bridges guard so non-Tauri repos cleanly hide the boundary layer (structural polyglot generalization tracked as Phase 21).

---

## What Was Built

The complete Phase 12 IPC bridge visualization is now in place. All six plans
(waves 0-4) have landed:

- **Wave 0 (12-01):** 4 test-file skeletons + scaffold imports on the frontend.
- **Wave 1 (12-02):** Rust `pipeline::ipc_bridges` — parses `src/bindings.ts`,
  grep-scans `src-tauri/**/*.rs` for `#[tauri::command]` handlers, tree-sitter
  scans `src/**/*.ts(x)` for `invoke(...)` call-sites. Yields
  `Vec<IpcBridgeDto>` with command name, rust name, handler file/line,
  aggregated callers, signature summary, hasChannelArg.
- **Wave 2 (12-03):** `get_ipc_bridges` Tauri command + bindings regen.
  Frontend now imports `getIpcBridges` + 3 DTO types + `EdgeKind.invokes` /
  `handles`.
- **Wave 3 (12-04):** `radarStore` widened — `GraphNode.kind='file'|'bridge'`
  + `GraphNode.language='ts'|'rust'` + 8 bridge metadata fields +
  `selectedBridgeId` + `lastBridgeSetHash` + `ForceConfig.boundaryStrength`
  (default 0.15). `fetchGraph` now resolves a 3rd `get_ipc_bridges` leg and
  merges bridges as nodes with fy=0 (pinned on boundary). `forceBoundary`
  custom d3-force pushes TS files up (target y=-300), Rust files down
  (target y=+300), bridges pinned at y=0. Worker protocol widened to carry
  kind+language through init+topology messages.
- **Wave 4 (this plan, 12-05):** Canvas rendering + interaction layer —
  `BridgeRenderer.ts` with `drawBoundaryLine` + `drawBridgeNodes` +
  `drawBridgeLabels` + `drawBoundaryAnchorLabels`. `GraphRenderer.drawEdges`
  boosts alpha for `invokes`/`handles` edge kinds. `BridgeTooltip` on hover +
  `BridgeDetailPanel` on select. `ForceConfigPanel` gains a BOUNDARY slider.
  Keyboard Escape deselects bridge.

## How to Verify (D-34)

### 1. Start the Tauri prod-dev build

```bash
cd /home/prannayag/pragnition/htx/aitc
npm run tauri dev
```

Wait for the app to boot (~10-30s depending on hardware). The pipeline will
attach to a repo automatically — use this aitc repo itself as the workspace
(default when launched from the repo root).

### 2. Visual — boundary line + bridges

- Open the **Airspace Radar** view (default view on launch).
- **Confirm** a thin horizontal line visible across the graph at world y=0.
- **Confirm** ~50 cyan diamond-shaped nodes strung along the line (real
  command count is ~51 per Phase 12 Plan 02 V-12-10).
- **Confirm** screen-space labels at the left edge of the canvas:
  - `FRONTEND` / `TypeScript` above the line
  - `BACKEND` / `Rust` below the line

### 3. Visual — FE/BE bifurcation

- Wait 2-3 seconds after load for the force simulation to settle.
- **Confirm** TypeScript file nodes (from `src/`) have migrated toward the
  upper half-plane (above the line).
- **Confirm** Rust file nodes (from `src-tauri/`) have migrated toward the
  lower half-plane (below the line).
- Files with unrecognized extensions (docs, configs, etc.) should float near
  the center / mixed.

### 4. Interaction — BOUNDARY slider

- Click the **FORCES** button (top-right of radar canvas) to open the force
  configuration panel.
- Locate the **BOUNDARY** slider (below CENTER, above RESET DEFAULTS).
- Drag from 0 to 0.5 — **confirm** the FE/BE halves visibly separate further
  within ~1 second of each drag release.
- Drag back to 0 — nodes should relax toward y=0 (or stay near wherever they
  landed; either is OK since there's no restoring force).
- Drag back to 0.15 (default) — **confirm** no jank, flicker, or crash.

### 5. Interaction — hover tooltip

- Hover the mouse over a bridge diamond.
- **Confirm** a glassmorphism tooltip appears (same chrome as agent tooltip):
  - Command name in JetBrains Mono bold
  - Rust name in UPPERCASE below
  - `HANDLER src-tauri/src/.../file.rs:N`
  - `M_CALLERS`
  - Signature summary (if present)
- Hover over a **channel-bearing** command (e.g. `startWatch`, `start_bash_watch`):
  - **Confirm** a cyan `CHANNEL-BEARING` pill appears.
- Hover over a **dangling** bridge (dashed diamond — may be rare in this repo;
  skip if none visible):
  - **Confirm** `DANGLING — NO CALLERS` or `DANGLING — NO HANDLER` row shows.
- Move the mouse away — **confirm** tooltip auto-dismisses.

### 6. Interaction — click selection

- Click a bridge diamond.
- **Confirm** a white outer ring appears around the bridge.
- **Confirm** the right-side `AGENT_MANIFEST` panel now shows a
  `BRIDGE_DETAIL` section with:
  - `COMMAND` (command name)
  - `HANDLER` (file:line)
  - `SIGNATURE` (if available)
  - `CALLERS (N)` with a clickable list of caller paths
  - `[ CHANNEL-BEARING ]` footer (if applicable)
- Click a caller path row — **confirm** the viewport pans + zooms to that
  file on the graph (3x zoom, file centered).
- Click the `CLOSE [X]` button — **confirm** `BRIDGE_DETAIL` disappears and
  the white selection ring is removed.
- Click a **different** bridge. Press **Escape** — **confirm** deselection
  works (white ring + detail panel both disappear).

### 7. Interaction — dangling indicator

- Scan the bridge diamonds for any with a **dashed** outline.
- If found: **confirm** dashed stroke visible.
- If none visible (likely in this repo, which has ~0 dangling commands):
  skip this check and note in post-UAT SUMMARY.

### 8. Pan / zoom

- Pan viewport by click-dragging the canvas background.
- **Confirm** bridge diamonds travel with the world (pinned at y=0).
- **Confirm** the horizontal boundary line stays horizontal and its length
  adjusts to span the new viewport.
- **Confirm** `FRONTEND`/`BACKEND` anchor labels stick to the left edge and
  follow the projected boundary y (clamped to top when boundary is scrolled
  above viewport, bottom when below).
- Zoom in beyond 4x (scroll wheel) — **confirm** bridge command-name labels
  appear above each diamond in JetBrains Mono.
- Zoom out below 0.5x — **confirm** bridges remain visible (skeleton
  behavior per D-19), even as file nodes shrink.

### 9. Theme cycling

- Open the Theme picker (top of the FORCES panel).
- Cycle through all 9 themes.
- **Confirm** bridge diamonds remain visible and readable on each theme
  (fill should pick up `edgeGlow` when present, else `arrowFill`, else
  cyan fallback).
- **Confirm** `FRONTEND`/`BACKEND` anchor labels switch to each theme's
  `folderLabelColor`.

### 10. Regression smoke

- **Confirm** existing Phase 7 graph rendering (folder hulls, file edges,
  heat map) still works.
- **Confirm** agent dots still render and track if any agents are active
  (launch a test agent if needed).
- **Confirm** zoom/pan still responds smoothly (no regression on the
  Phase 11.1 blanking-on-focus fix).
- **Confirm** no console errors in the Tauri dev tools during any of the
  above steps.

### Expected outcomes

- All 10 visual/interaction checks pass.
- Subjective feel: the "bridges on a line" visual reads immediately as the
  codebase's cross-language spine. TS files are clearly above, Rust below,
  bridges string along the boundary.

## Resume Signal

Type **"approved"** if all 10 checks pass.

If any check fails, describe the failure (which step, expected vs actual).
For partial issues (e.g. theme X has unreadable tooltip, dangling bridge
with wrong dash width), note them and decide whether to:

- Log to `.planning/phases/12-.../deferred-items.md` as a Phase 12 polish
  item, OR
- Block Phase 12 closure and write an inline gap-closure plan.

Blocking failures require either a quick Rule-1 fix (if bug caused by Wave
4 code) or a `12-06-PLAN.md` gap-closure plan (if architectural).

## Automated Witness Status (prior to UAT)

| Witness   | File                                     | Count | Status |
|-----------|------------------------------------------|------:|--------|
| V-12-21   | `src/views/Radar/__tests__/BridgeRender.test.ts`     | 11/11 | PASS  |
| V-12-22   | `src/views/Radar/__tests__/BoundaryLine.test.ts`     |  9/9  | PASS  |
| V-12-23   | `src/views/Radar/__tests__/BridgeSelection.test.tsx` |  8/8  | PASS  |
| V-12-24   | `src/views/Radar/__tests__/BridgeTooltip.test.tsx`   |  8/8  | PASS  |
| **Total** |                                          | **36/36** | **PASS** |

- `npm run build` — exits 0 cleanly (TS + Vite bundle green).
- `cargo test --lib` — 438 passed, 2 pre-existing `conflict::engine`
  failures (D-02 — unchanged by this plan).
- Pre-existing frontend failures (HeatMapOverlay, MasterDetailShell,
  useGraphLayout flake) — D-01 — unchanged.

D-34 is the final gate on Phase 12 closure. Once approved, Phase 12 is
ready for archive and Phase 13 (semantic zoom) can begin.
