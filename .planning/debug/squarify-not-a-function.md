---
status: awaiting_human_verify
trigger: "squarify is not a function TypeError thrown in src/hooks/useTreemapLayout.ts:85 (function layoutChildren) when user navigates Radar view → Tower view → Radar view in the AITC Tauri app. First Radar visit works; second Radar visit crashes."
created: 2026-04-11T00:00:00Z
updated: 2026-04-11T22:30:00Z
---

## Current Focus

hypothesis: |
  The interop wrapper at the top of useTreemapLayout.ts resolves `squarify` to a non-callable value.
  squarify's Vite-optimized bundle (needsInterop: true) exposes `squarifyMod.default` as the CJS
  exports OBJECT (not the function) because the first fall-through of the interop code selects
  `squarifyMod.default`. First Radar visit worked only because treeData was still empty (length===0
  guard in useTreemapLayout returns []), so squarify() was never actually called. After nav to
  Tower and back, the pipeline has populated treeData via installRadarPipelineBridge, so the
  layoutChildren code path runs and hits the unreachable object-not-function.
test: |
  Read node_modules/.vite/deps/squarify.js to confirm Vite's optimized shape is
  `export default require_lib()` where require_lib() returns the exports object.
  Verify that `exports.default` is the 2-arg `index` function, and that there is
  no named `default` export from Vite's wrapper — only `export default <exportsObj>`.
expecting: |
  Confirmed the wrapper exports a single default (the exports object). Because squarify's CJS
  module sets `__esModule: true`, Vite's __toESM helper copies properties through so
  `squarifyMod.default === index` (the 2-arg layout fn) at the import site — but only if
  the namespace import is being interop-wrapped. If the compiled importer uses raw ESM
  `import * as` without interop, `squarifyMod.default` is the exports object (not the fn).
next_action: |
  Verify the current fix theory with targeted test. The likely correct fix is to import directly:
  `import squarify from 'squarify';` — Vite interop will unwrap `exports.default` for default
  imports reliably. Remove the homebrew namespace+fallback interop.

## Symptoms

expected: |
  App navigation between Radar and other views works reliably. The treemap layout computation in
  useTreemapLayout succeeds on every render, not just the first.

actual: |
  On first Radar visit: layout renders correctly.
  On re-visiting Radar after navigating elsewhere (e.g. Radar -> Tower -> Radar): React Router's
  error boundary catches "Unexpected Application Error! squarify is not a function".

errors: |
  TypeError: squarify is not a function
      at layoutChildren (http://localhost:1420/src/hooks/useTreemapLayout.ts:85:17)
      at computeTreemapLayout (http://localhost:1420/src/hooks/useTreemapLayout.ts:116:2)
      at http://localhost:1420/src/hooks/useTreemapLayout.ts:132:10
      at updateMemo (react-dom_client.js:4948:16)
      ...useTreemapLayout → RadarCanvas

reproduction: |
  1. Run `npm run tauri dev` (cold start)
  2. Navigate to Radar view — works (treeData may be empty initially)
  3. Navigate to Tower view
  4. Navigate back to Radar view — crashes (treeData now populated by pipeline bridge)

started: |
  Surfaced during /gsd-verify-work 6 UAT Test 1 after Phase 6 landed. Phase 6 introduced
  installRadarPipelineBridge (f6080b6) that debounce-fetches tree index on pipeline events,
  and WR-01 populated real is_dir values (8d66b17, 8032471). Either change (esp. pipeline
  bridge) now makes treeData non-empty on re-visit, exposing a latent interop bug.

## Eliminated

## Evidence

- timestamp: 2026-04-11T00:00:00Z
  checked: node_modules/squarify (package shape)
  found: |
    Module exports: `default` = `index(data, container)` (2-arg user-facing layout fn),
    and named `squarify` = 4-arg internal helper `(inputData, currentRow, rect, stack)`.
    CJS (lib/index.js) sets exports.__esModule = NOT set (Rollup CJS output), and sets
    exports.default + exports.squarify + other named exports.
  implication: |
    The user wants exports.default (index), not exports.squarify (which is the 4-arg helper).
    Importing named `{ squarify }` would give the wrong function (wrong arity).

- timestamp: 2026-04-11T00:00:00Z
  checked: node_modules/.vite/deps/squarify.js (Vite pre-bundled optimized dep)
  found: |
    Vite wraps the CJS module. Inside, it sets
      Object.defineProperty(exports, "__esModule", { value: true });
    then assigns exports.default = index, exports.squarify = fn4, etc.
    Final line of the wrapper: `export default require_lib();`
    The default export from Vite's ESM wrapper is the entire exports object.
  implication: |
    Vite's ESM wrapper has ONE top-level export: `default`. That default value is the
    exports object, which has `.default` (the fn we want), `.squarify` (4-arg helper),
    `.calculateMaxAspectRatio`, etc.

- timestamp: 2026-04-11T00:00:00Z
  checked: node_modules/.vite/deps/_metadata.json
  found: '"squarify": { ..., "needsInterop": true }'
  implication: |
    Vite applies interop at import sites. For `import squarify from 'squarify'`, Vite's
    import-analysis plugin rewrites to unwrap default correctly (gives the 2-arg fn).
    For `import * as squarifyMod from 'squarify'`, Vite creates a synthetic namespace
    where properties are copied from the default export object. So:
      - squarifyMod.default === <exports object> (not the function)
      - squarifyMod.squarify  === fn4 (4-arg helper, wrong)
    The current homebrew interop in useTreemapLayout.ts picks squarifyMod.default, which
    is the EXPORTS OBJECT (not callable). Hence "squarify is not a function".

- timestamp: 2026-04-11T00:00:00Z
  checked: useTreemapLayout.ts line 177 (hook entry guard) + line 114 (layout guard)
  found: |
    useTreemapLayout returns [] when treeData.length === 0 (line 177).
    computeTreemapLayout returns [] when root.children.length === 0 (line 114).
    squarify() is only actually invoked when treeData has entries AND the built tree has
    children.
  implication: |
    On first Radar visit, treeData is empty (backend hasn't delivered it yet / bridge not
    fired), so the crashing path is short-circuited. After Radar → Tower → Radar, the
    pipeline bridge has debounced-fetched the tree index between events, treeData is now
    populated, and the crashing call path runs. This explains the "works first time, fails
    second time" symptom without requiring any re-evaluation or HMR weirdness.

- timestamp: 2026-04-11T00:00:00Z
  checked: radarStore.ts installRadarPipelineBridge
  found: |
    installRadarPipelineBridge subscribes to pipelineStore.events and calls
    fetchTreeIndex() debounced 500ms after any event. Phase 6 (f6080b6) installs this
    bridge from RepoSessionProvider, so any pipeline events during the Tower visit
    populate treeData before the user returns to Radar.
  implication: |
    Confirms the mechanism for treeData to transition empty→populated between visits.
    Even without the bridge, a manual or periodic fetchTreeIndex() call would trigger
    the same crash.

## Resolution

root_cause: |
  useTreemapLayout.ts uses a namespace import + homebrew interop:
    import * as squarifyMod from 'squarify';
    const squarify = squarifyMod.default ?? squarifyMod;
  With Vite's CJS interop (squarify is marked needsInterop: true), the namespace import
  `squarifyMod.default` is the CJS exports OBJECT, not the 2-arg layout function (which
  lives at `squarifyMod.default.default` inside that object, via the `exports.default = index`
  assignment in the CJS module). The nullish-coalesce fallback therefore lands on a
  non-callable object. Calling `squarify(inputData, container)` throws
  "squarify is not a function".

  The bug was masked on the first Radar visit because treeData was empty at that point
  and the short-circuit guards in useTreemapLayout/computeTreemapLayout prevented the
  squarify() call. Phase 6's installRadarPipelineBridge then populates treeData while
  the user is on the Tower view, so the second Radar visit hits the real call path
  and crashes. WR-01 (real is_dir values) did not cause the regression — it is
  orthogonal. The bug is pre-existing and was simply latent until treeData became
  reliably populated.

fix: |
  Initially tried a plain default import, but Vite's dev pre-bundle emits
  `export default require_lib()` where the default export IS the CJS exports
  object (not the `index` function). For `needsInterop: true` CJS deps,
  Vite's import-analysis wrapper passes through the raw exports object.
  So neither `import squarify from 'squarify'` nor `import * as squarifyMod`
  reliably unwraps to the function on its own:
    - default import  → squarify = exportsObj           (not callable)
    - namespace import → squarifyMod.default = exportsObj (wrapper sets default: m)
  The real function lives at `exportsObj.default`, which becomes
  `squarifyMod.default.default` after Vite's namespace wrapper runs.

  Final fix: replace the three-line homebrew interop with an explicit
  `resolveSquarify(mod)` helper that tries each candidate shape until it
  finds a callable:
    1. mod.default            (Node ESM / Vitest / prod Rollup interop)
    2. mod.default.default    (Vite dev pre-bundle shape)
    3. mod                    (raw function default-export unwrap)
  Throws a clear error if no candidate is callable, instead of failing
  silently at the call site.

  Confirmed via dev-server transform fetch: `resolveSquarify` returns
  candidate B (`squarifyMod.default.default` = the real 2-arg layout fn).

  Also fixed a TypeScript narrowing issue where the typed rects no longer
  carried `_node` at the type level; cast via `as unknown as { _node: ... }`
  at the use site. `_node` survives at runtime through squarify's
  `normalizeData` which uses `Object.assign({}, datum, { normalizedValue })`,
  copying all custom props.

verification: |
  - tsc --noEmit: clean (after the _node cast fix).
  - Full test suite: 116/116 non-pre-existing tests pass. One failure in
    commsStore.test.ts (subscribeToApprovals unlisten identity) is unrelated
    and predates this fix.
  - Dev-server transform verified: squarify binding resolves via candidate
    B to the 2-arg `index` function.

  Pending user verification in the actual app:
    1. Run `npm run tauri dev`
    2. Radar → Tower → Radar
    3. Confirm no crash, radar renders treemap on both visits.

files_changed:
  - src/hooks/useTreemapLayout.ts
