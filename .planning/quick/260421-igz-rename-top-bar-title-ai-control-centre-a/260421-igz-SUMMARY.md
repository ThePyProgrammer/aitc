---
task_id: 260421-igz
title: Rename top bar title AI_CONTROL_CENTRE → AI_CMD_CENTRE
status: complete
completed: 2026-04-21
commits:
  - 236b46e
files_changed:
  - src/components/layout/TopBar.tsx
requirements: [QUICK-260421-igz]
---

# Quick Task 260421-igz: Rename Top Bar Title to AI_CMD_CENTRE

**One-liner:** Revert the top bar app title from `AI_CONTROL_CENTRE` back to `AI_CMD_CENTRE` (undoes 260421-i21).

## Change

Single-line string literal swap in `src/components/layout/TopBar.tsx` at line 18, inside the existing `<h1>` element. No other lines, files, imports, or identifiers touched.

```diff
         <h1 className="text-primary font-headline text-xl font-bold tracking-tighter select-none">
-          AI_CONTROL_CENTRE
+          AI_CMD_CENTRE
         </h1>
```

## Verification

- `grep -c 'AI_CMD_CENTRE' src/components/layout/TopBar.tsx` → `1`
- `grep -c 'AI_CONTROL_CENTRE' src/components/layout/TopBar.tsx` → `0`
- `grep -rn 'AI_CONTROL_CENTRE' src/` → no matches
- `git diff --stat HEAD~1 HEAD -- src/components/layout/TopBar.tsx` → `1 file changed, 1 insertion(+), 1 deletion(-)`

All automated checks pass per plan success criteria.

## Commit

| Hash    | Message                                                       |
| ------- | ------------------------------------------------------------- |
| 236b46e | chore(ui): rename top bar title AI_CONTROL_CENTRE → AI_CMD_CENTRE |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- File `src/components/layout/TopBar.tsx` exists and contains `AI_CMD_CENTRE` at line 18.
- Commit `236b46e` found in `git log`.
- Diff stat exactly 1 insertion + 1 deletion.
