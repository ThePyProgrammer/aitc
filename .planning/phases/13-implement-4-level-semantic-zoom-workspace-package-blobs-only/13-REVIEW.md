---
phase: 13-implement-4-level-semantic-zoom-workspace-package-blobs-only
reviewed: 2026-05-03T03:46:53Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/bindings.ts
  - src/stores/radarStore.ts
  - src-tauri/src/lib.rs
  - src-tauri/src/pipeline/commands.rs
  - src-tauri/src/pipeline/deps/extract.rs
  - src-tauri/src/pipeline/deps/mod.rs
  - src/views/Radar/CodePreviewOverlay.tsx
  - src/views/Radar/GraphRenderer.ts
  - src/views/Radar/hullCache.ts
  - src/views/Radar/PackageBlobRenderer.ts
  - src/views/Radar/packageBlobs.ts
  - src/views/Radar/RadarCanvas.tsx
  - src/views/Radar/semanticZoom.ts
  - src/views/Radar/__tests__/CodePreviewOverlay.test.tsx
  - src/views/Radar/__tests__/GraphRenderer.test.ts
  - src/views/Radar/__tests__/packageBlobs.test.ts
  - src/views/Radar/__tests__/RadarCanvas.test.tsx
  - src/views/Radar/__tests__/semanticZoom.test.ts
findings:
  critical: 0
  warning: 4
  info: 0
  total: 4
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-05-03T03:46:53Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the Phase 13 semantic zoom, package blob, code preview, source signature, snippet, and related test changes at standard depth. The implementation is generally coherent and avoids obvious source-snippet XSS/path-traversal mistakes, but there are correctness and reliability defects that should be fixed before relying on this phase: package activity counts collapse multiple agents on the same file, package labels scale incorrectly at top-level zooms, dependency graph reads hold the active-watch lock during blocking parsing, and one test hardcodes a developer-local absolute worktree path.

## Warnings

### WR-01: Active agent counts collapse multiple agents touching the same file

**File:** `src/views/Radar/packageBlobs.ts:142-151`

**Issue:** `derivePackageBlobs` converts `activeAgentFiles` into a `Set<string>` and `addToGroup` increments `activeAgentCount` at most once per file. In `RadarCanvas`, `activeAgentFiles` is derived from `lastAgentFileRef.current.values()`, so two different agents currently working on the same file are represented by duplicate file paths. The Set removes those duplicates, causing package/workspace blobs to undercount active agents, understate importance, and suppress the intended activity signal for multi-agent contention on one file.

**Fix:** Preserve multiplicity or pass agent identities through the aggregation. For example, pass `[agentId, filePath]` pairs and count distinct agent ids per group:

```ts
export interface PackageBlobInputs {
  nodes: GraphNode[];
  contentionScores?: Map<string, number>;
  activeConflictPaths?: Iterable<string>;
  activeAgentFiles?: Iterable<string>;
  activeAgentFileEntries?: Iterable<[agentId: string, filePath: string]>;
}

// In each GroupAccumulator, track activeAgentIds: Set<string>.
// Then set activeAgentCount = group.activeAgentIds.size in groupToBlob().
```

If the string-only API is kept, use a `Map<string, number>` of file path to active-agent count instead of `Set<string>` and add the count for each member file.

### WR-02: Top-level package labels scale with zoom instead of staying screen-constant

**File:** `src/views/Radar/PackageBlobRenderer.ts:112`

**Issue:** The canvas context is already transformed by `viewport.zoom` before `drawPackageBlobs` runs. For depth `<= 1`, the font expression uses `14` rather than `14 / zoom`, so top-level labels become 28px at 2x, 56px at 4x, etc. Non-top-level labels correctly divide by zoom. This makes workspace/package labels visually explode during semantic zoom transitions and can obscure nodes and blobs.

**Fix:** Divide top-level label size by zoom as well:

```ts
const labelPx = blob.depth <= 1 ? 14 : 10;
ctx.font = `${labelPx / zoom}px "Space Grotesk", sans-serif`;
```

### WR-03: Dependency graph command holds PipelineState lock during blocking parse

**File:** `src-tauri/src/pipeline/commands.rs:449-464`

**Issue:** `get_dependency_graph` keeps `state.inner.lock().await` alive while awaiting `spawn_blocking`. Dependency graph extraction can parse the full watched tree, so concurrent `start_watch`, `stop_watch`, `get_tree_index`, or signature/snippet commands that need the active watch state can be blocked until parsing completes. Phase 13's `get_source_signatures` already clones the needed fields and explicitly `drop(guard)` before its blocking work; `get_dependency_graph` should follow the same pattern. Otherwise a stale or expensive graph refresh can delay watch stop/restart and leave the UI observing old active-watch state longer than necessary.

**Fix:** Clone `repo_root` and `files`, then release the mutex before awaiting the blocking task:

```rust
let guard = state.inner.lock().await;
let Some(active) = guard.as_ref() else {
    return Ok(Vec::new());
};
let repo_root = active.repo_root.clone();
let files: Vec<std::path::PathBuf> = active
    .tree_index
    .iter()
    .filter(|(_, node)| !node.is_dir)
    .map(|(path, _)| path.clone())
    .collect();
drop(guard);

let repo_root_for_build = repo_root.clone();
let result = tauri::async_runtime::spawn_blocking(move || {
    build_dependency_graph(&repo_root_for_build, &files)
})
.await
.map_err(|e| format!("spawn_blocking join: {e}"))?;
```

### WR-04: Test hardcodes a developer-local absolute worktree path

**File:** `src/views/Radar/__tests__/RadarCanvas.test.tsx:520-528`

**Issue:** The test reads `/home/prannayag/pragnition/htx/aitc/.claude/worktrees/agent-a0a83d2d8da1d7853/src/views/Radar/RadarCanvas.tsx` directly. That path is specific to one local machine/worktree and will fail in CI, on another developer's checkout, or after the worktree directory is cleaned. This is a test reliability defect, and it also makes the test inspect a different copy of `RadarCanvas.tsx` than the one under test.

**Fix:** Avoid filesystem source introspection for this behavior. Export and unit-test the relevant helper(s), or derive the path relative to the current test file. Prefer behavior assertions over source string checks. For example:

```ts
// RadarCanvas.tsx
export const PACKAGE_FANOUT_RING_PX = 8;
export function interpolatePointForTest(...) { ... }

// RadarCanvas.test.tsx
expect(PACKAGE_FANOUT_RING_PX).toBe(8);
```

Better yet, assert the rendered/drawn agent-dot positions for package fan-out and interpolation without reading source files.

---

_Reviewed: 2026-05-03T03:46:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
