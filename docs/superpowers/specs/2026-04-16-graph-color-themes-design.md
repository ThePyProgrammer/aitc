# Graph Radar — Color Theme System

**Date:** 2026-04-16
**Status:** Draft — ready for another agent to pick up and implement.
**Context:** Phase 7 (graph-based codebase map) currently hardcodes a single phosphor-green palette in `src/views/Radar/GraphRenderer.ts`. User wants to pick from multiple themes via a live picker UI and have the selection persist across sessions.

---

## Problem

Every graph color is hardcoded in two places in `GraphRenderer.ts`:

1. The `COLORS` object (lines ~37–52) with named tokens (surfaceContainer, outline, onSurface, primary, etc.)
2. Inline `rgba(42, 77, 36, ...)` literals at lines 183, 184, 242, 281, 349 (the green hull / edge stroke color)
3. `heatColor()` function at lines ~70–82 interpolates from the hardcoded surface-container hex to error.

Switching palettes requires editing code + rebuilding. User wants runtime switching from an in-app picker with live preview.

## Goals

1. Factor all graph colors into a **named theme object** with a well-defined contract.
2. Ship **8 themes** (listed below in full) selectable from a picker UI in the ForceConfigPanel area.
3. Persist selection in `localStorage` so the choice survives restarts.
4. Live-apply — selecting a theme immediately repaints the graph (no rebuild, no reload).

## Non-Goals

- User-created custom themes (YAGNI — ship the 8 curated ones).
- Exporting / importing themes.
- Per-file or per-agent theme overrides.
- Animated theme transitions (instant swap is fine).

---

## Architecture

### 1. Theme contract

Create `src/views/Radar/themes.ts`:

```typescript
export interface GraphTheme {
  id: string;               // stable identifier for persistence
  name: string;             // display name
  // Canvas backdrop (used by the app shell behind the radar)
  canvasBackground: string; // used to paint the canvas fill in RadarCanvas step 1 clear
  // Node fills (3 tiers for default / hover / highest)
  nodeFill: string;
  nodeFillHover: string;
  nodeFillHighest: string;
  // Node stroke (border around each node circle)
  nodeStroke: string;       // rgba() string so alpha bakes in
  nodeGlow?: string;        // optional — when set, drawNodes adds a shadowBlur glow
  // Edge (import arrow) stroke
  edgeStroke: string;       // rgba() string
  edgeGlow?: string;        // optional shadow for synthwave/plasma themes
  // Arrow head fill (typically matches edge but brighter)
  arrowFill: string;        // rgba() string
  // Folder hull stroke + fill
  hullStroke: string;       // rgba() string
  hullFill: string;         // rgba() string
  // Folder labels
  folderLabelColor: string; // rgba() string (alpha baked in)
  // File labels (visible at zoom >= 4)
  fileLabelColor: string;
  // Heat-map ramp start (end is always error red)
  heatRampStart: string;    // hex — used by heatColor() interpolation
  // Per-cluster accent hues (optional — if present, GraphRenderer cycles
  // through these to color each cluster differently instead of using a
  // single accent). Max 8 entries.
  clusterAccents?: string[];
}
```

### 2. Theme catalog

Every theme ships with the hex values below. The existing phosphor green is preserved as `phosphor-vivid` (the user has said the current version feels dull; the vivid version is brighter).

#### A. `phosphor-classic` (current default — keep as fallback)
```
canvasBackground:    '#000000'
nodeFill:            '#0f1a0e'
nodeFillHover:       '#162015'
nodeFillHighest:     '#1e281c'
nodeStroke:          'rgba(42, 77, 36, 0.6)'
edgeStroke:          'rgba(42, 77, 36, 0.55)'
arrowFill:           'rgba(42, 77, 36, 0.7)'
hullStroke:          'rgba(42, 77, 36, 0.4)'
hullFill:            'rgba(42, 77, 36, 0.05)'
folderLabelColor:    'rgba(173, 170, 170, 0.6)'
fileLabelColor:      '#adaaaa'
heatRampStart:       '#0f1a0e'
```

#### B. `phosphor-vivid` (brighter CRT green)
```
canvasBackground:    '#050d04'
nodeFill:            '#0a200a'
nodeFillHover:       '#133313'
nodeFillHighest:     '#1b4a1b'
nodeStroke:          'rgba(60, 180, 50, 0.55)'
edgeStroke:          'rgba(60, 180, 50, 0.55)'
arrowFill:           'rgba(90, 220, 70, 0.7)'
hullStroke:          'rgba(60, 180, 50, 0.4)'
hullFill:            'rgba(60, 180, 50, 0.06)'
folderLabelColor:    'rgba(90, 200, 70, 0.6)'
fileLabelColor:      '#5ecc4a'
heatRampStart:       '#0a200a'
```

#### C. `phosphor-cyan`
```
canvasBackground:    '#040d12'
nodeFill:            '#0a1a1f'
nodeFillHover:       '#102830'
nodeFillHighest:     '#183848'
nodeStroke:          'rgba(0, 180, 220, 0.5)'
edgeStroke:          'rgba(0, 180, 220, 0.5)'
arrowFill:           'rgba(0, 210, 240, 0.7)'
hullStroke:          'rgba(0, 180, 220, 0.35)'
hullFill:            'rgba(0, 180, 220, 0.05)'
folderLabelColor:    'rgba(0, 200, 240, 0.55)'
fileLabelColor:      '#4db8cc'
heatRampStart:       '#0a1a1f'
```

#### D. `amber-terminal`
```
canvasBackground:    '#0a0804'
nodeFill:            '#1a1408'
nodeFillHover:       '#252010'
nodeFillHighest:     '#3a3018'
nodeStroke:          'rgba(200, 160, 50, 0.5)'
edgeStroke:          'rgba(200, 160, 50, 0.5)'
arrowFill:           'rgba(220, 180, 70, 0.7)'
hullStroke:          'rgba(200, 160, 50, 0.35)'
hullFill:            'rgba(200, 160, 50, 0.05)'
folderLabelColor:    'rgba(220, 180, 60, 0.55)'
fileLabelColor:      '#b8943a'
heatRampStart:       '#1a1408'
```

#### E. `cool-slate`
```
canvasBackground:    '#080a10'
nodeFill:            '#141820'
nodeFillHover:       '#1c2230'
nodeFillHighest:     '#242c40'
nodeStroke:          'rgba(120, 140, 180, 0.45)'
edgeStroke:          'rgba(120, 140, 180, 0.45)'
arrowFill:           'rgba(150, 170, 210, 0.7)'
hullStroke:          'rgba(120, 140, 180, 0.35)'
hullFill:            'rgba(120, 140, 180, 0.05)'
folderLabelColor:    'rgba(140, 160, 200, 0.55)'
fileLabelColor:      '#7888a8'
heatRampStart:       '#141820'
```

#### F. `synthwave-nebula` (bright — uses clusterAccents)
```
canvasBackground:    'radial-gradient ellipse at 25% 30%, #1a0920 0%, #0a0515 40%, #020008 100%' /* NOTE: Canvas fillStyle can't be a gradient string; see Implementation Notes below */
nodeFill:            '#1a0f28'                     /* fallback when no cluster accent */
nodeFillHover:       '#2a1a3c'
nodeFillHighest:     '#3a2550'
nodeStroke:          'rgba(255, 255, 255, 0.6)'
nodeGlow:            'rgba(255, 107, 184, 0.5)'
edgeStroke:          'rgba(255, 120, 220, 0.5)'
edgeGlow:            'rgba(255, 120, 220, 0.4)'
arrowFill:           'rgba(255, 140, 230, 0.8)'
hullStroke:          'rgba(255, 80, 200, 0.55)'
hullFill:            'rgba(255, 80, 200, 0.08)'
folderLabelColor:    'rgba(255, 128, 204, 0.7)'
fileLabelColor:      '#ffb0dd'
heatRampStart:       '#1a0f28'
clusterAccents:      ['#ff6bb8', '#6bd8ff', '#c099ff', '#ffb84d', '#80ffd0', '#ff8080', '#b0ff88', '#ffd85a']
```

#### G. `plasma` (bright — uses clusterAccents)
```
canvasBackground:    '#0a0510'    /* flat dark fuchsia-black; see note on gradients */
nodeFill:            '#201018'
nodeFillHover:       '#30182a'
nodeFillHighest:     '#40223c'
nodeStroke:          'rgba(255, 255, 255, 0.5)'
nodeGlow:            'rgba(255, 120, 140, 0.5)'
edgeStroke:          'rgba(255, 160, 120, 0.5)'
edgeGlow:            'rgba(255, 160, 120, 0.4)'
arrowFill:           'rgba(255, 200, 140, 0.8)'
hullStroke:          'rgba(255, 120, 80, 0.55)'
hullFill:            'rgba(255, 120, 80, 0.08)'
folderLabelColor:    'rgba(255, 180, 140, 0.7)'
fileLabelColor:      '#ffb0c0'
heatRampStart:       '#201018'
clusterAccents:      ['#ff5a80', '#ff9b5a', '#ffd85a', '#ff6bb8', '#ff80a0', '#ffa060', '#ffc080', '#ffe0a0']
```

#### H. `electric-ice` (bright — white-hot nodes with colored halos)
```
canvasBackground:    '#020814'
nodeFill:            '#ffffff'
nodeFillHover:       '#f0f8ff'
nodeFillHighest:     '#e0e8ff'
nodeStroke:          'rgba(128, 232, 255, 0.7)'
nodeGlow:            'rgba(128, 232, 255, 0.6)'
edgeStroke:          'rgba(180, 230, 255, 0.6)'
edgeGlow:            'rgba(180, 230, 255, 0.5)'
arrowFill:           'rgba(220, 245, 255, 0.9)'
hullStroke:          'rgba(100, 220, 255, 0.55)'
hullFill:            'rgba(100, 220, 255, 0.08)'
folderLabelColor:    'rgba(192, 240, 255, 0.75)'
fileLabelColor:      '#c0f0ff'
heatRampStart:       '#020814'
clusterAccents:      ['#80e8ff', '#a8b8ff', '#d0a0ff', '#ff80d0', '#80ffd0', '#ffdd80', '#80c0ff', '#ffffff']
```

#### I. `stellar-forge` (bright — phosphor green cranked up, per-cluster variants)
```
canvasBackground:    '#020600'
nodeFill:            '#0a2010'
nodeFillHover:       '#143820'
nodeFillHighest:     '#205030'
nodeStroke:          'rgba(142, 255, 113, 0.65)'
nodeGlow:            'rgba(142, 255, 113, 0.6)'
edgeStroke:          'rgba(170, 255, 130, 0.6)'
edgeGlow:            'rgba(170, 255, 130, 0.5)'
arrowFill:           'rgba(200, 255, 150, 0.8)'
hullStroke:          'rgba(142, 255, 113, 0.55)'
hullFill:            'rgba(142, 255, 113, 0.08)'
folderLabelColor:    'rgba(176, 255, 136, 0.75)'
fileLabelColor:      '#c0ffa0'
heatRampStart:       '#0a2010'
clusterAccents:      ['#8eff71', '#e0ff5a', '#70ffbc', '#a0ff80', '#c0ff60', '#60ff90', '#80ffa0', '#b0ff70']
```

### 3. Refactoring GraphRenderer

- Replace the `COLORS` export with a `currentTheme: GraphTheme` read from a store.
- Replace every `rgba(42, 77, 36, ...)` literal with `theme.hullStroke` / `theme.edgeStroke` / `theme.arrowFill` — alpha is now baked into each token.
- `heatColor(score, theme)` takes the theme as a second arg and interpolates from `theme.heatRampStart` to `'#ff7351'` (error — unchanged across themes).
- `drawNodes` respects `theme.nodeGlow` — when set, `ctx.shadowColor = theme.nodeGlow; ctx.shadowBlur = 8 / zoom` for each node.
- `drawNodes` respects `theme.clusterAccents` — when set, compute a stable hash of `node.dirKey` → index into the accents array → that color overrides `nodeStroke` + `nodeGlow` for that cluster.
- `drawEdges` respects `theme.edgeGlow` similarly.

### 4. Store + persistence

Add to `radarStore.ts`:

```typescript
themeId: string;                     // default 'phosphor-classic'
setThemeId: (id: string) => void;    // persists to localStorage key 'aitc:graphTheme'
```

On store init, read `localStorage.getItem('aitc:graphTheme')` and use it if present in the theme catalog; otherwise fall back to `phosphor-classic`.

Resolve the active theme in RadarCanvas via:
```typescript
const themeId = useRadarStore(s => s.themeId);
const theme = THEMES[themeId] ?? THEMES['phosphor-classic'];
```

Pass `theme` into `drawNodes`, `drawEdges`, `drawArrowHeads`, `drawFolderHulls`, `drawFileLabels`, and `heatColor`.

### 5. Theme picker UI

Add a **THEME** section to `ForceConfigPanel.tsx` above the existing sliders:

```
┌─────────────────────────────┐
│ THEME                       │
│ ┌─────────────────────────┐ │
│ │ Phosphor Classic      ▾│ │   ← dropdown or radio list
│ └─────────────────────────┘ │
│                             │
│ (swatch preview: 3 small    │
│  colored squares showing    │
│  hull / edge / node colors) │
└─────────────────────────────┘
```

Each theme gets a small swatch preview (3 colored squares: hullStroke, edgeStroke, primary node glow) + its display name. On click → `setThemeId(id)` → RadarCanvas re-renders next frame with the new theme (no simulation rebuild needed).

### 6. Implementation Notes

- **Canvas gradient backgrounds:** Canvas 2D `fillStyle` doesn't accept CSS radial-gradient strings. For themes that specify a gradient, use `ctx.createRadialGradient(...)` in the step-1 clear of the render loop. For themes with a solid `canvasBackground`, just `ctx.fillStyle = theme.canvasBackground`.
- **Star field:** The bright themes (synthwave, plasma, electric-ice, stellar-forge) look best with faint stars in the background. Generate ~30 stable star positions (seeded by a constant) once on theme load; draw in step 1 after the gradient fill, before the world-transform is applied.
- **Performance:** `theme` is read from the store per-frame but the object is stable (swatch changes are reference-level replacements). No perf concern.
- **Per-cluster accent stability:** hash `dirKey` with a simple fnv-1a or the existing `getAgentColor` style hash so a folder's color doesn't shift between sessions.
- **Theme switching alpha reset:** Switching themes should trigger `dirtyRef.current = true` to repaint immediately. No simulation restart needed.

### 7. Tests

- `src/views/Radar/__tests__/themes.test.ts` — every theme in the catalog has all required fields (no undefined tokens).
- `src/views/Radar/__tests__/GraphRenderer.test.ts` — update existing hull/edge/node tests to pass a theme argument and verify the correct color reaches `ctx.fillStyle` / `ctx.strokeStyle`.
- `src/stores/__tests__/radarStore.test.ts` — `setThemeId` writes to localStorage, subsequent store init reads it back.

### 8. Files to touch

- **New:** `src/views/Radar/themes.ts` (theme contract + catalog)
- **New:** `src/views/Radar/ThemePicker.tsx` (dropdown + swatch preview)
- **Modify:** `src/views/Radar/GraphRenderer.ts` (accept theme arg, replace literals)
- **Modify:** `src/views/Radar/CometTrail.ts` (may also need theme-aware colors; check)
- **Modify:** `src/views/Radar/RadarCanvas.tsx` (resolve theme from store, pass to draw fns, apply canvasBackground gradient)
- **Modify:** `src/stores/radarStore.ts` (add themeId + setThemeId + localStorage persistence)
- **Modify:** `src/views/Radar/ForceConfigPanel.tsx` (add THEME section above existing sliders, mount ThemePicker)
- **Modify:** existing tests to pass theme arg

### 9. Acceptance criteria

- [ ] 8 named themes (phosphor-classic, phosphor-vivid, phosphor-cyan, amber-terminal, cool-slate, synthwave-nebula, plasma, electric-ice, stellar-forge — 9 total; phosphor-classic is the baseline)
- [ ] ThemePicker in ForceConfigPanel shows all themes with swatch previews
- [ ] Selecting a theme instantly repaints the graph (no reload, no simulation rebuild)
- [ ] Selection persists across app restarts via localStorage key `aitc:graphTheme`
- [ ] If localStorage value is invalid, falls back to `phosphor-classic` silently
- [ ] All tests pass
- [ ] `cargo test` unaffected (pure frontend change)

### 10. Out of scope for first pass

- Gradient `canvasBackground` (synthwave-nebula's radial gradient) — ship with a solid fallback color for v1; add gradient rendering in a follow-up.
- Star-field rendering — ship without stars in v1; it's cosmetic polish.
- Per-cluster accent hash stability — use a simple `dirKey.length * 31 + charCodeSum` hash; refine if patterns emerge.
- Animated theme transitions — instant swap is the v1 contract.
