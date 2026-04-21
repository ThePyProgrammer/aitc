---
phase: 260421-igz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [src/components/layout/TopBar.tsx]
autonomous: true
requirements: [QUICK-260421-igz]
must_haves:
  truths:
    - "Top bar displays AI_CMD_CENTRE as the app title"
    - "AI_CONTROL_CENTRE no longer appears anywhere in src/"
  artifacts:
    - path: "src/components/layout/TopBar.tsx"
      provides: "TopBar header with updated title string"
      contains: "AI_CMD_CENTRE"
  key_links:
    - from: "src/components/layout/TopBar.tsx:18"
      to: "rendered <h1> title"
      via: "string literal"
      pattern: "AI_CMD_CENTRE"
---

<objective>
Rename the top bar title string literal from `AI_CONTROL_CENTRE` back to `AI_CMD_CENTRE`.

Purpose: Reverse the rename performed in quick task 260421-i21 (commit b8963eb). User has decided to revert to the shorter form.
Output: Single-line string change in `src/components/layout/TopBar.tsx` at line 18.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@./CLAUDE.md
@src/components/layout/TopBar.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Replace AI_CONTROL_CENTRE with AI_CMD_CENTRE in TopBar.tsx</name>
  <files>src/components/layout/TopBar.tsx</files>
  <action>
    Open `src/components/layout/TopBar.tsx` and change line 18 ONLY.

    Current content (line 18, inside the `<h1>` element):
    ```
              AI_CONTROL_CENTRE
    ```

    New content (line 18):
    ```
              AI_CMD_CENTRE
    ```

    Rules:
    - Do NOT modify any other line.
    - Do NOT change indentation, className, surrounding JSX, imports, or component structure.
    - Do NOT rename any variables, files, or identifiers elsewhere.
    - Pure string literal swap on line 18.

    Use the Edit tool with a narrow old_string/new_string pair anchored to the `<h1>` contents to avoid ambiguity.
  </action>
  <verify>
    <automated>
    test "$(grep -c 'AI_CMD_CENTRE' src/components/layout/TopBar.tsx)" = "1" \
      && test "$(grep -c 'AI_CONTROL_CENTRE' src/components/layout/TopBar.tsx)" = "0" \
      && ! grep -r 'AI_CONTROL_CENTRE' src/ \
      && echo OK
    </automated>
  </verify>
  <done>
    - `AI_CMD_CENTRE` appears exactly once in `src/components/layout/TopBar.tsx`.
    - `AI_CONTROL_CENTRE` no longer appears in `src/components/layout/TopBar.tsx` or anywhere under `src/`.
    - No other files or lines changed.
  </done>
</task>

</tasks>

<verification>
Run from repo root:

```bash
# Exactly one occurrence of the new string in TopBar.tsx
grep -c 'AI_CMD_CENTRE' src/components/layout/TopBar.tsx   # → 1

# Old string fully removed from TopBar.tsx
grep -c 'AI_CONTROL_CENTRE' src/components/layout/TopBar.tsx   # → 0

# Old string fully removed from src/ (excludes .planning, .claude/worktrees, outputs by virtue of path)
grep -r 'AI_CONTROL_CENTRE' src/   # → no output, exit 1
```

Optional visual check: run `npm run dev` (or existing Tauri dev command) and confirm the top-left header shows `AI_CMD_CENTRE`.
</verification>

<success_criteria>
- TopBar.tsx line 18 reads `AI_CMD_CENTRE` (inside the existing `<h1>`).
- No other changes in TopBar.tsx (diff is a single-line modification).
- `grep -r 'AI_CONTROL_CENTRE' src/` returns no matches.
- `grep -r 'AI_CMD_CENTRE' src/` returns exactly the TopBar.tsx occurrence.
</success_criteria>

<output>
After completion, create `.planning/quick/260421-igz-rename-top-bar-title-ai-control-centre-a/260421-igz-SUMMARY.md` summarizing the one-line change and commit hash.
</output>
