---
phase: 05-conflict-resolution-history
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/ui/Button.tsx
  - src/components/ui/StatusBadge.tsx
  - src/stores/conflictStore.ts
  - src/stores/radarStore.ts
  - src/views/Conflicts/HunkNavigator.tsx
  - src/views/Conflicts/HunkResolutionControls.tsx
  - src/views/Conflicts/IntentPanel.tsx
  - src/views/Conflicts/MergeView.tsx
  - src/views/Conflicts/ResolutionToolbar.tsx
  - src/views/Conflicts/UnifiedDiff.tsx
  - src/views/ConflictsView.tsx
  - src/views/History/ApprovalsTab.tsx
  - src/views/History/ConflictsTab.tsx
  - src/views/History/SessionsTab.tsx
  - src/views/HistoryView.tsx
  - src/views/Radar/HeatMapOverlay.ts
  - src/views/Radar/RadarCanvas.tsx
  - src/views/RadarView.tsx
  - src-tauri/src/conflict/backup.rs
  - src-tauri/src/conflict/resolution.rs
  - src-tauri/src/db/migrations/004_phase5_resolution.sql
findings:
  critical: 2
  warning: 6
  info: 5
  total: 13
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Phase 5 introduces conflict resolution (merge view, hunk navigation, resolution application) and history views (Sessions, Conflicts, Approvals tabs). The overall code quality is good: the Rust backend has proper path traversal defenses, the Shiki pipeline double-escapes HTML (intentionally safe), and the store state machine is well-structured.

Two critical issues were found: a CSS injection vector through unsanitized token color values written directly into `style` attributes in `useSyntaxHighlight.ts`, and an unguarded `git show` invocation that uses a user-controlled file path without working-directory anchoring. Six warnings cover logic bugs (stale closure in virtualizer, wrong data used for both agent versions, potential `NaN` from date parsing, misfire on `resolvedCount` function reference, `setTimeout` leak, and missing `await` error surfacing). Five info-level items cover dead code, magic numbers, and minor clarity issues.

## Critical Issues

### CR-01: CSS injection via unsanitized Shiki token color values

**File:** `src/hooks/useSyntaxHighlight.ts:93`
**Issue:** Token color values from Shiki (e.g. `token.color`) are interpolated directly into an inline `style` attribute string without any validation or sanitization:
```ts
return `<span style="color: ${color}">${escaped}</span>`;
```
While `token.content` is HTML-escaped on lines 89-92, `token.color` is not. A malicious or malformed theme/grammar could produce a color value containing `">` to break out of the attribute and inject arbitrary HTML. Even within the `style` attribute, values like `red; background: url(javascript:...)` or `expression(...)` can be exploited in certain browser contexts. The result string is consumed via `dangerouslySetInnerHTML` in `UnifiedDiff.tsx`, making this a real injection path.

**Fix:** Validate that the color value is a safe CSS color before using it:
```ts
// Allow only hex colors (#rrggbb / #rgb) and named colors; reject anything else.
function safeCssColor(value: string): string {
  // Strip surrounding whitespace
  const v = value.trim();
  // Accept hex colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  // Accept basic named colors (optional: expand allowlist as needed)
  if (/^[a-zA-Z]{2,30}$/.test(v)) return v;
  // Accept rgb() / rgba() with numeric args only
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*[\d.]+)?\s*\)$/.test(v)) return v;
  return '#d4d4d4'; // fallback
}

// In highlightLines:
const color = safeCssColor(token.color ?? '#d4d4d4');
return `<span style="color: ${color}">${escaped}</span>`;
```

---

### CR-02: Unanchored `git show` command allows path escape via file path content

**File:** `src-tauri/src/conflict/resolution.rs:146-150`
**Issue:** The `get_git_base_content` function runs `git show HEAD:<path>` where `<path>` is derived from the stored conflict alert's file path. The `validate_file_path` check (line 115) only blocks literal `..` substrings. A path like `HEAD:../secret` would be blocked, but git refspec syntax allows more exotic escapes. More critically, no `--work-tree` or `--git-dir` argument is passed and no working directory is set, so `git` runs in the Tauri process's working directory (which may be arbitrary on Windows). If the working directory is not the repository root, `git show HEAD:<relpath>` will fail or silently return wrong content.

**Fix:** Anchor the git command to the project working directory, and pass `--` to terminate option parsing. The workspace root should be stored in app state and passed here:
```rust
async fn get_git_base_content(relative_path: &str, repo_root: &Path) -> Result<String, String> {
    let git_path = relative_path.replace('\\', "/");

    let output = tokio::process::Command::new("git")
        .current_dir(repo_root)          // anchor to repo root
        .args(["show", "--", &format!("HEAD:{git_path}")])
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;
    // ...
}
```

---

## Warnings

### WR-01: Both agent content versions are identical (same disk read for A and B)

**File:** `src-tauri/src/conflict/resolution.rs:125-136`
**Issue:** `read_conflict_files` reads the current disk content once (`current_content`) and assigns it to both `agent_a_content` and `agent_b_content`. This means the diff computed in `conflictStore.ts` (`computeMerge`) will never see any differences between the two agent versions — the diff will always show zero conflict hunks, making the entire merge UI non-functional. The comment on line 97 acknowledges this ("both agents write to the same file — the latest write is what's on disk") but that reasoning defeats the purpose of a three-way merge.

**Fix:** The backup files saved during a conflict detection event should be read for the per-agent versions, not the current disk state. If backups are available (from a prior `save_backup` call), use them:
```rust
// Read agent_a content from backup if available, else fall back to current
let agent_a_content = backup_manager
    .read_backup(&format!("{conflict_id}/agent_a.bak"))
    .unwrap_or_else(|_| current_content.clone());
let agent_b_content = backup_manager
    .read_backup(&format!("{conflict_id}/agent_b.bak"))
    .unwrap_or_else(|_| current_content.clone());
```
Alternatively, capture per-agent file snapshots at conflict detection time and store them in the `conflict_events` table.

---

### WR-02: Stale closure in virtualizer `estimateSize` causes incorrect row heights

**File:** `src/views/History/ApprovalsTab.tsx:65-68`, `src/views/History/ConflictsTab.tsx:65-68`, `src/views/History/SessionsTab.tsx:90-94`
**Issue:** In all three history tabs, `estimateSize` closes over `expandedRowId` from the enclosing component scope. Because `useVirtualizer` is called unconditionally and `estimateSize` is not wrapped in `useCallback` or a `useMemo` with `[expandedRowId]` as a dependency, the virtualizer's internal size cache will not re-measure rows when `expandedRowId` changes. Expanded rows will be sized as collapsed rows (44px) until the virtualizer independently re-computes, causing the `AnimatePresence` expand animation to overflow the allocated row slot.

Example from `ApprovalsTab.tsx`:
```ts
estimateSize: (index) => {
  const record = sortedRecords[index];
  return record && expandedRowId === record.id ? 44 + 140 : 44;  // stale closure
},
```

**Fix:** Pass `estimateSize` as a stable callback that reads `expandedRowId` properly, and call `rowVirtualizer.measure()` after toggling expansion:
```ts
const handleRowClick = useCallback((record: ApprovalRecord) => {
  setExpandedRowId((prev) => {
    const next = prev === record.id ? null : record.id;
    // Re-measure after state update
    setTimeout(() => rowVirtualizer.measure(), 0);
    return next;
  });
}, [rowVirtualizer]);
```
And use a ref for `expandedRowId` inside `estimateSize` to avoid stale closures:
```ts
const expandedRowIdRef = useRef(expandedRowId);
useEffect(() => { expandedRowIdRef.current = expandedRowId; }, [expandedRowId]);

const rowVirtualizer = useVirtualizer({
  estimateSize: (index) => {
    const record = sortedRecords[index];
    return record && expandedRowIdRef.current === record.id ? 44 + 140 : 44;
  },
  // ...
});
```

---

### WR-03: `resolvedCount` called as function reference, not invoked, in ResolutionToolbar

**File:** `src/views/Conflicts/MergeView.tsx:20`, `src/views/Conflicts/MergeView.tsx:114`
**Issue:** `resolvedCount` is a store selector that itself returns a function (the `resolvedCount: () => number` action). At line 20, it is obtained as:
```ts
const resolvedCount = useConflictStore((s) => s.resolvedCount);
```
This is a function, not a number. At line 114 it is passed as `resolvedCount={resolvedCount()}` — which calls it correctly. However, the value is re-evaluated on every render because `resolvedCount` itself is a new function reference each render (Zustand action functions are stable, but the call happens inside the render body). More importantly, if `resolvedCount` were ever referenced without `()` (easy regression), `ResolutionToolbar` would receive a function instead of a number. The `totalConflicts` count is a `useMemo` but `resolvedCount()` is an inline call.

**Fix:** Derive `resolvedCount` as a selector value, not a function call result:
```ts
// In MergeView.tsx
const resolvedCount = useConflictStore((s) => {
  if (!s.activeMerge) return 0;
  return s.activeMerge.hunks
    .filter((h) => h.type === 'conflict')
    .filter((h) => s.activeMerge!.resolutions.has(h.index)).length;
});
```
Or use the existing `resolvedCount` action but memoize:
```ts
const resolvedCount = useConflictStore((s) => s.resolvedCount());
```

---

### WR-04: `new Date(undefined)` produces `NaN` in sorting, silently corrupts sort order

**File:** `src/views/History/ApprovalsTab.tsx:54`
**Issue:** When sorting by `decidedAt`, `resolvedAt` is accessed with a fallback of `0`:
```ts
cmp = new Date(a.resolvedAt ?? 0).getTime() - new Date(b.resolvedAt ?? 0).getTime();
```
`new Date(0)` is valid (Unix epoch), but `new Date(null)` (if `resolvedAt` is `null` rather than `undefined`) or `new Date('')` produces `Invalid Date` with `getTime() === NaN`. `NaN` comparisons return `false` for all relational operators, making the sort unstable and producing unpredictable orderings for records with null timestamps.

**Fix:**
```ts
case 'decidedAt': {
  const aTime = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0;
  const bTime = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0;
  cmp = (isNaN(aTime) ? 0 : aTime) - (isNaN(bTime) ? 0 : bTime);
  break;
}
```

---

### WR-05: `setTimeout` in `applyResolution` is not cancelled on component unmount

**File:** `src/stores/conflictStore.ts:236-238`
**Issue:** After a successful resolution, a 2-second `setTimeout` clears `activeMerge`:
```ts
setTimeout(() => {
  set({ activeMerge: null });
}, 2000);
```
The timeout ID is never stored and never cancelled. If the user navigates away from `ConflictsView` within those 2 seconds, the timeout fires against an already-unmounted view context and calls `set()` on a potentially stale store. While Zustand stores persist beyond component unmount, the `activeMerge: null` update could overwrite a newly-opened merge if the user quickly opens a second conflict resolution within 2 seconds.

**Fix:** Store the timeout reference and cancel it if a new merge is opened before it fires:
```ts
// Add to store state
resolveTimeoutId: ReturnType<typeof setTimeout> | null;

// In applyResolution success path:
const timeoutId = setTimeout(() => {
  set({ activeMerge: null, resolveTimeoutId: null });
}, 2000);
set((s) => ({ ...s, resolveTimeoutId: timeoutId }));

// In openMerge, clear any pending timeout:
const { resolveTimeoutId } = get();
if (resolveTimeoutId) {
  clearTimeout(resolveTimeoutId);
}
```

---

### WR-06: `handleRowClick` in `SessionsTab` captures `expandedRowId` in `useCallback` dependency but async race can cause wrong expand state

**File:** `src/views/History/SessionsTab.tsx:97-110`
**Issue:** `handleRowClick` is declared with `[expandedRowId]` as a dependency. The function is async: it calls `invoke` to fetch files and then calls `setExpandedFiles`. If the user clicks two rows in rapid succession before the first `invoke` resolves, the second click will see `expandedRowId` as the first row's ID (stale), causing both the close-check (`expandedRowId === session.id`) and the `setExpandedRowId` call to run with incorrect state:

```ts
const handleRowClick = useCallback(async (session: SessionRecord) => {
  if (expandedRowId === session.id) {  // stale value during rapid clicks
    setExpandedRowId(null);
    setExpandedFiles([]);
    return;
  }
  setExpandedRowId(session.id);
  // ...invoke may take 100-500ms...
  setExpandedFiles(files.slice(0, 10));  // writes to wrong expanded row's files
}, [expandedRowId]);
```

**Fix:** Use a functional state update and a ref to track the current expanded ID, or use a local `isCancelled` guard similar to the highlighter hook:
```ts
const handleRowClick = useCallback(async (session: SessionRecord) => {
  setExpandedRowId((prev) => {
    if (prev === session.id) {
      setExpandedFiles([]);
      return null;
    }
    return session.id;
  });

  let cancelled = false;
  try {
    const files = await invoke<SessionFile[]>('list_session_files', { sessionId: session.id });
    if (!cancelled) setExpandedFiles(files.slice(0, 10));
  } catch {
    if (!cancelled) setExpandedFiles([]);
  }
  return () => { cancelled = true; };
}, []);
```

---

## Info

### IN-01: `_unresolvedCount` variable suppressed with `void` — dead code

**File:** `src/views/Conflicts/MergeView.tsx:22-23`
**Issue:** `_unresolvedCount` is imported and then immediately voided:
```ts
const _unresolvedCount = useConflictStore((s) => s.unresolvedCount);
void _unresolvedCount;
```
This subscribes the component to unnecessary store updates (every time `activeMerge` changes) for a value that is not used. The comment says "available for future use."

**Fix:** Remove both lines until the feature is implemented. Add it back when the keyboard navigation to the next unresolved hunk is built.

---

### IN-02: Magic number `1` in line number display starts from 1 but conflict hunks reset offset

**File:** `src/views/Conflicts/UnifiedDiff.tsx:103`, `src/views/Conflicts/UnifiedDiff.tsx:141`
**Issue:** `globalLine` is a mutable variable declared with `let globalLine = 1` outside the `return` statement but inside the function body. Because this runs during every render, the variable is correctly reset each time. However, for conflict hunks, `globalLine` advances by `Math.max(aLines.length, bLines.length)` (line 141), which is not accurate for either agent's line count — agent A may have 3 lines and agent B 5 lines, so their displayed line numbers are both wrong. Agent A lines starting at `startLine` will be numbered `startLine` to `startLine+2`, and agent B lines starting at the same `startLine` will be numbered `startLine` to `startLine+4`, with `globalLine` advancing by 5.

**Fix:** Track `globalLine` separately for agent A and agent B sections within a conflict hunk, or omit absolute line numbers for conflict sections and use relative hunk-line numbers (e.g. `A+1`, `A+2`).

---

### IN-03: `backup_manager.save_backup` for agent_a and agent_b both use `current_content`

**File:** `src-tauri/src/conflict/resolution.rs:215-220`
**Issue:** (Informational companion to WR-01.) Even if individual agent snapshots were available at resolution time, both `backup_a_path` and `backup_b_path` are backed up from the same `current_content` variable. The backup files therefore don't capture what each agent individually wrote, reducing their forensic value.

**Fix:** See WR-01 — capture per-agent content at conflict detection time. Once that is fixed, pass the correct per-agent content to each `save_backup` call here.

---

### IN-04: `StatusBadge` animates the `color` CSS property but the className already sets it

**File:** `src/components/ui/StatusBadge.tsx:49`
**Issue:** The `motion.span` has `animate={{ color: variantStyles[variant] }}`, but `variantStyles[variant]` is a full Tailwind class string (e.g. `'bg-primary/10 text-primary border border-primary/20'`), not a CSS color value. Motion's `color` property expects a CSS color string like `#8eff71`. As-is, this animation does nothing useful and may produce a console warning from Motion when it tries to parse a class name as a color.

**Fix:** Remove the `animate` and `transition` props from `motion.span` — the status badge color is fully controlled by the `className`. If a color-fade transition is desired on variant change, use `transition-colors duration-300` in the className instead:
```tsx
<motion.span
  className={`inline-flex items-center px-2 py-0.5 text-[8px] font-mono font-bold uppercase relative transition-colors duration-300 ${variantStyles[variant]}`}
  aria-label={`${variant} status`}
>
```

---

### IN-05: `parseHunkResolutions` defined inside component render scope

**File:** `src/views/History/ConflictsTab.tsx:79-85`
**Issue:** `parseHunkResolutions` is a plain function declared inside the `ConflictsTab` component body (not in a `useCallback` or moved to module scope). It is recreated on every render and called inside the virtualizer's `getVirtualItems().map(...)`. This is harmless for correctness but is a code quality issue — it should be a module-level pure function.

**Fix:** Move `parseHunkResolutions` to module scope above the component:
```ts
function parseHunkResolutions(json: string): Array<{ hunkIndex: number; choice: string }> {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export function ConflictsTab() { /* ... */ }
```

---

_Reviewed: 2026-04-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
