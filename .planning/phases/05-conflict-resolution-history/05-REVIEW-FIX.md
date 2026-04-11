---
phase: 05-conflict-resolution-history
fixed_at: 2026-04-10T00:00:00Z
review_path: .planning/phases/05-conflict-resolution-history/05-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 7
skipped: 1
status: partial
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-04-10T00:00:00Z
**Source review:** .planning/phases/05-conflict-resolution-history/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8
- Fixed: 7
- Skipped: 1

## Fixed Issues

### CR-01: CSS injection via unsanitized Shiki token color values

**Files modified:** `src/hooks/useSyntaxHighlight.ts`
**Commit:** 9eea932
**Applied fix:** Added `safeCssColor()` validation function that accepts only hex colors, named CSS colors, and numeric rgb()/rgba() values. Falls back to `#d4d4d4` for any unrecognized input. Applied to `token.color` before interpolation into the `style` attribute in `highlightLines()`.

### CR-02: Unanchored `git show` command allows path escape via file path content

**Files modified:** `src-tauri/src/conflict/resolution.rs`
**Commit:** e0e1212
**Applied fix:** Updated `get_git_base_content` to accept a `repo_root` parameter and call `.current_dir(repo_root)` on the git command. Added `--` to terminate option parsing before the refspec argument. Both call sites (`read_conflict_files` and `apply_resolution`) now derive `repo_dir` from `alert.file_path.parent()`.

### WR-02: Stale closure in virtualizer `estimateSize` causes incorrect row heights

**Files modified:** `src/views/History/ApprovalsTab.tsx`, `src/views/History/ConflictsTab.tsx`, `src/views/History/SessionsTab.tsx`
**Commit:** 69474da
**Applied fix:** Added `expandedRowIdRef` (useRef) synced via useEffect in all three history tabs. `estimateSize` now reads from the ref instead of the closure-captured state. `handleRowClick` calls `rowVirtualizer.measure()` via setTimeout(0) after toggling expansion to force re-measurement.

### WR-03: `resolvedCount` called as function reference, not invoked, in ResolutionToolbar

**Files modified:** `src/views/Conflicts/MergeView.tsx`
**Commit:** 7c2a9e4
**Applied fix:** Changed selector from `(s) => s.resolvedCount` (returns function) to `(s) => s.resolvedCount()` (returns number). Updated JSX prop from `resolvedCount={resolvedCount()}` to `resolvedCount={resolvedCount}` since the value is now a number directly.

### WR-04: `new Date(undefined)` produces `NaN` in sorting, silently corrupts sort order

**Files modified:** `src/views/History/ApprovalsTab.tsx`
**Commit:** 5ad208b
**Applied fix:** Replaced `new Date(a.resolvedAt ?? 0).getTime()` with a truthiness check and explicit `isNaN` guard. Null/undefined/empty timestamps now safely fall back to 0 instead of producing NaN.

### WR-05: `setTimeout` in `applyResolution` is not cancelled on component unmount

**Files modified:** `src/stores/conflictStore.ts`
**Commit:** e77e447
**Applied fix:** Added `_resolveTimeoutId` to store state. The 2-second resolve timeout now stores its ID and is cleared when a new merge is opened (`openMerge`), when the user discards (`discardAll`), or when a new resolution completes. Prevents stale `activeMerge: null` writes from overwriting a newly opened merge.

### WR-06: `handleRowClick` in `SessionsTab` captures `expandedRowId` in stale closure

**Files modified:** `src/views/History/SessionsTab.tsx`
**Commit:** 249a114
**Applied fix:** Replaced direct `expandedRowId` reference with functional `setExpandedRowId` update. Added `shouldFetch` flag to avoid unnecessary invoke calls on collapse. Guarded `setExpandedFiles` calls with a check that the session is still expanded (prevents wrong files from appearing after rapid clicks). Removed `expandedRowId` from useCallback dependencies.

## Skipped Issues

### WR-01: Both agent content versions are identical (same disk read for A and B)

**File:** `src-tauri/src/conflict/resolution.rs:125-136`
**Reason:** This is an architectural issue requiring per-agent file snapshots to be captured at conflict detection time, not at resolution time. The BackupManager is only initialized during `apply_resolution` and no per-agent backups exist when `read_conflict_files` is called. Fixing this requires changes to the conflict detection pipeline (likely in the filesystem watcher or conflict detection module) to snapshot file content for each agent before overwrite, and new database columns or backup paths to store them. This is beyond a simple code fix and should be addressed as a feature enhancement.
**Original issue:** `read_conflict_files` reads the current disk content once and assigns it to both `agent_a_content` and `agent_b_content`, making the merge diff always show zero differences.

---

_Fixed: 2026-04-10T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
