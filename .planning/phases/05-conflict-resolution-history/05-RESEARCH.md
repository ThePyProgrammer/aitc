# Phase 5: Conflict Resolution + History - Research

**Researched:** 2026-04-10
**Domain:** 3-way merge UI, diff computation, syntax highlighting, heat map visualization, history/audit persistence
**Confidence:** HIGH

## Summary

Phase 5 transforms AITC from conflict detection into conflict resolution. It has three major domains: (1) a unified diff merge UI that lets users resolve per-hunk conflicts between two agents with agent intent context, (2) a heat map overlay on the Phase 4 treemap radar showing file contention intensity, and (3) a History view with tabbed tables for browsing past sessions, conflicts, and approval decisions.

The existing codebase provides strong foundations: `ConflictAlert` types with hunk hints, the `ConflictEngine` sliding-window detector, `conflictStore` Zustand store, Canvas 2D treemap rendering in `RadarCanvas`, and SQLite schema with `agent_sessions`, `conflict_events`, and `approval_requests` tables. The `diff` npm package (v8.0.4) is already installed and provides `structuredPatch` for two-file diffing. For 3-way merge, `node-diff3` (v3.2.0) is the standard JS library. Syntax highlighting should use Shiki with fine-grained imports to keep bundle size manageable. On the Rust side, the `similar` crate (v3.0.0) can handle diff computation if any processing needs to happen in the backend (e.g., backup comparison).

**Primary recommendation:** Use `node-diff3` for 3-way merge computation in the frontend, `diff` (already installed) for generating structured patches for the unified diff display, and Shiki with `@shikijs/engine-javascript` for syntax highlighting. Keep diff computation in the frontend since file content is already loaded there for display -- the Rust backend handles file I/O, backups, and persistence only.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Unified diff view with sidebar hunk navigator -- NOT the 3-panel side-by-side from the wireframe. Single unified diff showing the conflicting file, with a sidebar listing all conflict hunks for quick navigation
- **D-02:** Inline per-hunk resolution controls -- each conflicting hunk shows colored markers for Agent A and Agent B changes, with Accept A | Accept B | Edit buttons rendered directly inline in the diff
- **D-03:** Bottom panel for agent intent -- fixed panel below the diff showing Agent A and Agent B intent cards side by side. Always visible while scrolling through hunks
- **D-04:** Combined contention score -- weighted formula using conflict count (heavy weight) + multi-agent write frequency (lighter weight)
- **D-05:** Cell background color rendering -- treemap cells shift from default dark surface to warm colors (green -> amber -> red) based on contention score
- **D-06:** Toggle-able overlay -- heat map is a toggle button on the radar toolbar. Off by default
- **D-07:** Dedicated History view -- 5th view in the sidebar (Radar, Tower, Comms, Conflicts, History)
- **D-08:** Tabbed tables layout -- three tabs: Sessions | Conflicts | Approvals. Each tab shows a filterable, sortable table with TanStack Virtual
- **D-09:** File count + top files per session -- store total file count on session record, plus per-file write counts in `session_files` junction table
- **D-10:** Explicit commit button -- user resolves hunks individually, then clicks "Apply Resolution" to write merged file to disk
- **D-11:** Pre-resolution backup -- save backup of both agent versions and base file before writing merged file. Conflict history record links to snapshots
- **D-12:** Notify agents if capable -- use Phase 4 message delivery infrastructure for resolution notifications

### Claude's Discretion
- Syntax highlighting library for the unified diff view
- Backup storage strategy (SQLite BLOB, filesystem snapshots, or temp files)
- Hunk detection algorithm for producing the unified diff from two agent versions + base
- Heat map color gradient specifics (exact hex values within Command Horizon palette)
- Heat map score weighting formula
- History table column specifics and default sort order
- Session file tracking implementation (event-driven accumulation vs query-time aggregation)
- Sidebar navigation icon for the new History view

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CNFL-03 | User can view a 3-way merge UI showing Agent A changes, base file, and Agent B changes side by side | node-diff3 for 3-way merge, diff for structured patches, Shiki for highlighting, unified diff layout per D-01 |
| CNFL-04 | User can accept changes per-hunk from either agent or manually edit the resolution | Structured patch hunks from diff package provide per-hunk data, inline resolution controls per D-02 |
| CNFL-05 | System shows agent intent alongside code changes in conflict resolution view | Agent intent from `AgentInfo.intent` via agentStore, bottom panel per D-03 |
| FMON-05 | System generates a file heat map showing which files/regions are touched by multiple agents | Canvas 2D overlay on treemap, contention score from conflict + write frequency data |
| VIZN-03 | File heat map overlay on radar shows contention intensity | Toggle-able Canvas overlay rendering colored cell backgrounds per D-05/D-06 |
| HIST-01 | System stores agent session records | Existing `agent_sessions` table + new `session_files` junction table per D-09 |
| HIST-02 | System stores conflict resolution records | New `conflict_resolutions` table with backup references per D-11 |
| HIST-03 | System stores approval decision audit log | Existing `approval_requests` table already has resolution data |
| HIST-04 | User can browse past sessions and event history | New History view (D-07) with tabbed tables (D-08), TanStack Virtual |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-diff3 | 3.2.0 | 3-way merge computation | The standard JS library for diff3 merge algorithm. Produces conflict regions from base + two modified versions. ESM/CJS dual. [VERIFIED: npm registry] |
| diff | 8.0.4 | 2-way structured patches | Already installed. `structuredPatch()` produces hunk arrays with line-level changes. Used to generate the unified diff display from merge output. [VERIFIED: package.json] |
| shiki | 4.0.2 | Syntax highlighting in diff view | VS Code's syntax engine. Use fine-grained imports (`shiki/core`, `@shikijs/engine-javascript`) for ~200KB with one language+theme. Supports dark themes natively. [VERIFIED: npm registry] |
| @tanstack/react-virtual | 3.13.23 | Virtualized tables in History view | Already installed. Headless virtualization for 10K+ row tables. [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| similar | 3.0.0 | Rust-side diff computation | Only if backend needs to compare file versions for backup validation. Not needed for primary merge flow. [VERIFIED: crates.io search] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-diff3 | Custom 3-way merge on `diff` | node-diff3 handles conflict region detection natively; building from `diff` alone requires implementing the merge algorithm manually |
| Shiki | Prism.js | Prism is lighter but has weaker TypeScript/Rust grammar support and no VS Code theme compatibility |
| Shiki | Manual tokenization | Only viable for simple languages; would need grammar maintenance per language |
| Filesystem backups | SQLite BLOBs | BLOBs bloat the database and complicate backup/restore; filesystem is simpler for variable-size file content |

**Installation:**
```bash
npm install node-diff3 shiki
```

No additional Cargo dependencies required -- `similar` is optional and only needed if Rust-side diffing is desired.

## Architecture Patterns

### Recommended Project Structure
```
src/
  views/
    ConflictsView.tsx              # Replace placeholder with merge UI router
    Conflicts/
      MergeView.tsx                # Main merge UI layout (diff + sidebar + intent)
      UnifiedDiff.tsx              # Unified diff renderer with syntax highlighting
      HunkNavigator.tsx            # Sidebar listing conflict hunks
      HunkResolutionControls.tsx   # Inline Accept A | Accept B | Edit per hunk
      IntentPanel.tsx              # Bottom panel with agent intent cards
      ResolutionToolbar.tsx        # Apply Resolution button + status
    HistoryView.tsx                # 5th view: tabbed tables
    History/
      SessionsTab.tsx              # Sessions table with expandable rows
      ConflictsTab.tsx             # Conflict resolution history table
      ApprovalsTab.tsx             # Approval decision audit table
    Radar/
      HeatMapOverlay.ts            # Heat map Canvas 2D render function
  stores/
    conflictStore.ts               # Extend with resolution state
    historyStore.ts                # New: history data fetching + filters
    radarStore.ts                  # Extend with heatMapEnabled toggle
  hooks/
    useMergeState.ts               # Hook managing 3-way merge state machine
    useSyntaxHighlight.ts          # Shiki highlighter initialization + caching
  lib/
    merge.ts                       # node-diff3 wrapper: base + A + B -> merged hunks
    contention.ts                  # Heat map score calculation
src-tauri/src/
  conflict/
    resolution.rs                  # New: resolve_conflict, read file versions, write merged
    backup.rs                      # New: backup management (save/restore file snapshots)
  db/migrations/
    004_phase5_resolution.sql      # New migration: conflict_resolutions, session_files tables
```

### Pattern 1: 3-Way Merge State Machine
**What:** A state machine managing the merge workflow: Loading -> Diffing -> Resolving -> Committing -> Done
**When to use:** ConflictsView when user selects a conflict to resolve
**Example:**
```typescript
// Source: Architecture pattern from merge tool design [ASSUMED]
interface MergeState {
  status: 'loading' | 'diffing' | 'resolving' | 'committing' | 'done' | 'error';
  baseContent: string;
  agentAContent: string;
  agentBContent: string;
  hunks: MergeHunk[];
  resolutions: Map<number, 'a' | 'b' | 'custom'>;
  customEdits: Map<number, string>;
  mergedPreview: string;
}

interface MergeHunk {
  index: number;
  type: 'conflict' | 'clean';
  baseLines: string[];
  aLines: string[];
  bLines: string[];
  startLine: number;
  endLine: number;
}
```

### Pattern 2: Heat Map Overlay as Composable Canvas Layer
**What:** Heat map rendering as a separate function called in the existing RadarCanvas render loop
**When to use:** When heatMapEnabled is toggled on in radarStore
**Example:**
```typescript
// Added to RadarCanvas render loop after drawTreemap()
// Source: Extending existing RadarCanvas pattern [VERIFIED: src/views/Radar/RadarCanvas.tsx]
function drawHeatMap(
  ctx: CanvasRenderingContext2D,
  rects: TreemapRect[],
  scores: Map<string, number>, // path -> contention score 0-1
  zoom: number,
) {
  for (const rect of rects) {
    if (!rect.isFile) continue;
    const score = scores.get(rect.path);
    if (!score || score <= 0) continue;

    const w = rect.x1 - rect.x0;
    const h = rect.y1 - rect.y0;

    // Blend: green(0.0-0.3) -> amber(0.3-0.7) -> red(0.7-1.0)
    const color = contentionToColor(score);
    ctx.fillStyle = color;
    ctx.fillRect(rect.x0, rect.y0, w, h);
  }
}
```

### Pattern 3: History Table with Virtual Rows
**What:** TanStack Virtual-powered table with inline row expansion for details
**When to use:** Sessions, Conflicts, and Approvals tabs in History view
**Example:**
```typescript
// Source: Existing TanStack Virtual usage pattern [VERIFIED: package.json deps]
// Follow same headless pattern as other virtualized lists in the app
import { useVirtualizer } from '@tanstack/react-virtual';

function SessionsTab({ sessions }: { sessions: SessionRecord[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // row height
    overscan: 10,
  });
  // ... render virtual rows with expand-on-click for file details
}
```

### Anti-Patterns to Avoid
- **Loading full file content into Zustand global store:** Keep file content in local component state within MergeView. Only resolution metadata (which hunks resolved, status) goes in the store.
- **Running diff computation on every keystroke in manual edit mode:** Debounce manual edits (300ms) before recomputing merged preview.
- **Storing backup files as SQLite BLOBs:** Files can be large; use filesystem storage in the app data directory with DB references to paths.
- **Re-rendering entire treemap for heat map toggle:** Heat map is an additive Canvas layer, not a treemap recomputation. Just set dirty flag.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 3-way merge algorithm | Custom diff3 from scratch | `node-diff3` | Merge algorithms have subtle edge cases (overlapping edits, identical changes, empty hunks). node-diff3 implements GNU diff3 correctly. |
| Syntax highlighting | Regex-based tokenizer | `shiki` with fine-grained imports | Language grammars are enormously complex. Shiki uses TextMate grammars (same as VS Code). |
| Diff patch generation | Manual line comparison | `diff.structuredPatch()` | Already installed, handles whitespace normalization, context lines, edit distance. |
| Virtualized scrolling | Custom virtual list | `@tanstack/react-virtual` | Already in deps, handles variable row heights, overscan, scroll restoration. |

**Key insight:** The merge UI is not a text editor -- it is a structured data display with per-hunk interaction. The diff libraries produce the structure; the UI renders it with resolution controls.

## Common Pitfalls

### Pitfall 1: File Content Staleness
**What goes wrong:** Between conflict detection and user opening the merge UI, agents may have written more changes to the file.
**Why it happens:** Conflict detection is async; the file on disk may not match what triggered the alert.
**How to avoid:** Read file content at merge-open time, not at detection time. Store the content snapshots in the merge state. The backup (D-11) saves these snapshots before any resolution.
**Warning signs:** Hunk hints from ConflictAlert don't align with current file content.

### Pitfall 2: Shiki Highlighter Initialization Cost
**What goes wrong:** Shiki needs to load grammar and theme WASM/JS on first use, causing a visible delay when opening the merge UI.
**Why it happens:** Language grammars are loaded async on first highlight call.
**How to avoid:** Initialize a singleton Shiki highlighter on app startup (or first Conflicts view mount) and cache it. Use `@shikijs/engine-javascript` (smaller than Oniguruma WASM). Pre-load only commonly needed languages (TypeScript, JavaScript, Rust, JSON, CSS, HTML).
**Warning signs:** First merge open takes 500ms+ to show syntax colors.

### Pitfall 3: Heat Map Score Calculation Bottleneck
**What goes wrong:** Recalculating contention scores for every file on every event floods the render loop.
**Why it happens:** The score depends on conflict history + recent write frequency across all files.
**How to avoid:** Compute scores on a timer (every 5s) or on conflict/event batch changes, not per-frame. Store as a `Map<string, number>` in radarStore and read from the render loop.
**Warning signs:** Frame rate drops below 30fps with heat map enabled.

### Pitfall 4: Missing Base File for 3-Way Merge
**What goes wrong:** The 3-way merge requires a "base" version (the file before either agent modified it), but AITC doesn't currently track file snapshots before agent writes.
**Why it happens:** The conflict engine tracks write timestamps and byte ranges, not file content.
**How to avoid:** Use git to obtain the base version: `git show HEAD:<path>` gives the last committed version. If not in a git repo or the file is untracked, use the older agent's version as a best-effort base. This is the most critical design decision for merge correctness.
**Warning signs:** Merge shows nonsensical conflicts because base is wrong.

### Pitfall 5: Large File Performance in Diff View
**What goes wrong:** Files with thousands of lines make the unified diff view sluggish.
**Why it happens:** Rendering all lines with syntax highlighting at once overwhelms the DOM.
**How to avoid:** Virtualize the diff view lines using TanStack Virtual, only rendering visible lines. Apply syntax highlighting lazily per visible chunk.
**Warning signs:** Scrolling becomes janky for files >2000 lines.

## Code Examples

### 3-Way Merge with node-diff3
```typescript
// Source: node-diff3 README [CITED: https://github.com/bhousel/node-diff3]
import { diff3Merge } from 'node-diff3';

function computeMerge(base: string, agentA: string, agentB: string): MergeHunk[] {
  const baseLines = base.split('\n');
  const aLines = agentA.split('\n');
  const bLines = agentB.split('\n');

  const result = diff3Merge(aLines, baseLines, bLines);
  const hunks: MergeHunk[] = [];
  let lineIndex = 0;

  for (const region of result) {
    if ('ok' in region) {
      // Clean region -- both agents agree
      hunks.push({
        index: hunks.length,
        type: 'clean',
        baseLines: region.ok,
        aLines: region.ok,
        bLines: region.ok,
        startLine: lineIndex,
        endLine: lineIndex + region.ok.length,
      });
      lineIndex += region.ok.length;
    } else if ('conflict' in region) {
      // Conflict region -- agents differ
      hunks.push({
        index: hunks.length,
        type: 'conflict',
        baseLines: region.conflict.o,  // original/base
        aLines: region.conflict.a,     // agent A version
        bLines: region.conflict.b,     // agent B version
        startLine: lineIndex,
        endLine: lineIndex + Math.max(
          region.conflict.a.length,
          region.conflict.b.length,
          region.conflict.o.length,
        ),
      });
      lineIndex += Math.max(
        region.conflict.a.length,
        region.conflict.b.length,
      );
    }
  }

  return hunks;
}
```

### Shiki Highlighter Singleton
```typescript
// Source: Shiki docs fine-grained bundle [CITED: https://shiki.style/guide/best-performance]
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegExpEngine } from '@shikijs/engine-javascript';

let highlighterPromise: Promise<any> | null = null;

export function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegExpEngine(),
      themes: [import('shiki/themes/github-dark.mjs')],
      langs: [
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/rust.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/python.mjs'),
      ],
    });
  }
  return highlighterPromise;
}
```

### Heat Map Contention Score
```typescript
// Source: Custom algorithm per D-04 [ASSUMED]
// Weighted: 70% conflict count, 30% multi-agent write frequency
function computeContentionScore(
  filePath: string,
  conflictCount: number,
  writeAgentCount: number,
  maxConflicts: number,
  maxAgents: number,
): number {
  const conflictNorm = maxConflicts > 0 ? conflictCount / maxConflicts : 0;
  const writeNorm = maxAgents > 1 ? (writeAgentCount - 1) / (maxAgents - 1) : 0;
  return Math.min(1.0, conflictNorm * 0.7 + writeNorm * 0.3);
}

// Color mapping using Command Horizon status colors
function contentionToColor(score: number): string {
  if (score <= 0.3) {
    // Green range: healthy but multi-agent
    const alpha = score / 0.3 * 0.25;
    return `rgba(142, 255, 113, ${alpha})`; // primary #8eff71
  } else if (score <= 0.7) {
    // Amber range: warning
    const t = (score - 0.3) / 0.4;
    const alpha = 0.15 + t * 0.2;
    return `rgba(255, 209, 111, ${alpha})`; // amber #ffd16f
  } else {
    // Red range: critical contention
    const t = (score - 0.7) / 0.3;
    const alpha = 0.2 + t * 0.25;
    return `rgba(255, 115, 81, ${alpha})`; // error #ff7351
  }
}
```

### SQLite Migration for Phase 5
```sql
-- Source: Extending existing schema pattern [VERIFIED: src-tauri/src/db/migrations/]

-- Conflict resolution records (HIST-02, D-11)
CREATE TABLE IF NOT EXISTS conflict_resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conflict_event_id INTEGER REFERENCES conflict_events(id),
    file_path TEXT NOT NULL,
    agent_a_id TEXT NOT NULL,
    agent_b_id TEXT NOT NULL,
    resolution_type TEXT NOT NULL CHECK(resolution_type IN ('accept_a', 'accept_b', 'manual', 'mixed')),
    -- Backup file paths (relative to app data dir)
    backup_base_path TEXT,
    backup_a_path TEXT,
    backup_b_path TEXT,
    backup_merged_path TEXT,
    -- Hunk resolution details as JSON array
    hunk_resolutions TEXT, -- JSON: [{hunkIndex, choice: 'a'|'b'|'custom', customContent?}]
    notification_status TEXT DEFAULT 'pending',
    resolved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session file tracking junction table (D-09, HIST-01)
CREATE TABLE IF NOT EXISTS session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
    file_path TEXT NOT NULL,
    write_count INTEGER NOT NULL DEFAULT 1,
    last_written_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, file_path)
);

CREATE INDEX idx_session_files_session ON session_files(session_id);
CREATE INDEX idx_session_files_path ON session_files(file_path);
CREATE INDEX idx_conflict_resolutions_event ON conflict_resolutions(conflict_event_id);

-- Add file_count to agent_sessions for quick access (D-09)
ALTER TABLE agent_sessions ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0;

-- Add resolution_id to conflict_events for linking
ALTER TABLE conflict_events ADD COLUMN resolution_id INTEGER REFERENCES conflict_resolutions(id);
```

### Rust Backup Management
```rust
// Source: Standard filesystem backup pattern [ASSUMED]
use std::path::{Path, PathBuf};
use tokio::fs;

pub struct BackupManager {
    backup_dir: PathBuf,
}

impl BackupManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            backup_dir: app_data_dir.join("conflict_backups"),
        }
    }

    /// Save file content as a backup, returning the relative path.
    pub async fn save_backup(
        &self,
        conflict_id: &str,
        label: &str, // "base", "agent_a", "agent_b", "merged"
        content: &str,
    ) -> Result<String, String> {
        let dir = self.backup_dir.join(conflict_id);
        fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

        let filename = format!("{label}.bak");
        let path = dir.join(&filename);
        fs::write(&path, content).await.map_err(|e| e.to_string())?;

        Ok(format!("conflict_backups/{conflict_id}/{filename}"))
    }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Prism.js for highlighting | Shiki with JS engine | 2024-2025 | Shiki uses VS Code grammars for exact fidelity, JS engine avoids WASM overhead |
| 3-panel side-by-side diff | Unified diff (VS Code merge editor style) | 2023+ | More compact, better for reviewing many hunks sequentially |
| `diff` only for merge | `node-diff3` dedicated library | Ongoing | node-diff3 implements proper GNU diff3 algorithm with conflict region detection |

**Deprecated/outdated:**
- `three-way-merge` npm package: last published 8 years ago, unmaintained
- Prism.js: still works but lacks modern language grammar updates; Shiki is the successor

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Filesystem backup strategy is better than SQLite BLOBs for file snapshots | Architecture Patterns | Medium -- if files are very small, BLOBs would be simpler. But files can be arbitrarily large. |
| A2 | Heat map contention formula (70% conflict, 30% write frequency) is appropriate | Code Examples | Low -- formula is tunable; exact weights can be adjusted without architectural changes |
| A3 | Git base version via `git show HEAD:<path>` is the correct base for 3-way merge | Pitfalls | HIGH -- if agents work on git worktrees with different HEADs, the base may differ. Needs validation. |
| A4 | Shiki `github-dark` theme is appropriate for Command Horizon aesthetic | Code Examples | Low -- theme can be swapped; may need a custom theme to match the exact dark room palette |
| A5 | node-diff3's `diff3Merge` output structure has `ok` and `conflict` keys | Code Examples | Medium -- API shape based on docs review, should verify at implementation time |

## Open Questions

1. **Base File Acquisition Strategy**
   - What we know: 3-way merge needs a "base" version. Git is the most reliable source (`git show HEAD:<path>`).
   - What's unclear: What happens for untracked files, or when agents use different worktrees with different branches? The ConflictEngine detects overlapping writes but doesn't capture the pre-write file state.
   - Recommendation: Use `git show HEAD:<path>` as primary strategy. Fall back to the earliest captured version from the conflict window. For untracked files, treat the empty string as base.

2. **Shiki Theme Customization**
   - What we know: Command Horizon uses a very specific dark palette (#0e0e0e background, #adaaaa text, #8eff71 green).
   - What's unclear: Whether `github-dark` or another built-in Shiki theme closely matches, or if a custom theme JSON is needed.
   - Recommendation: Start with `github-dark` (darkest built-in), customize CSS wrapper backgrounds to match Command Horizon. If syntax colors clash, create a minimal custom Shiki theme.

3. **Session File Tracking: Event-Driven vs Query-Time**
   - What we know: D-09 requires per-file write counts per session.
   - What's unclear: Whether to accumulate `session_files` rows as events arrive (event-driven) or query the event/write log at display time.
   - Recommendation: Event-driven accumulation using `INSERT ... ON CONFLICT DO UPDATE` (upsert) on the `session_files` table. This keeps History queries fast without scanning raw event data.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x + jsdom (frontend), Rust built-in test framework (backend) |
| Config file | `vitest.config.ts` (frontend), `Cargo.toml` (backend) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run && cd src-tauri && cargo test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CNFL-03 | 3-way merge produces correct hunks from base+A+B | unit | `npx vitest run src/lib/__tests__/merge.test.ts -t "merge"` | Wave 0 |
| CNFL-04 | Per-hunk resolution updates merged preview | unit | `npx vitest run src/hooks/__tests__/useMergeState.test.ts` | Wave 0 |
| CNFL-05 | Intent panel renders agent intent from store | unit | `npx vitest run src/views/Conflicts/__tests__/IntentPanel.test.tsx` | Wave 0 |
| FMON-05 | Contention score calculation is correct | unit | `npx vitest run src/lib/__tests__/contention.test.ts` | Wave 0 |
| VIZN-03 | Heat map toggle updates radarStore | unit | `npx vitest run src/stores/__tests__/radarStore.test.ts` | Existing (extend) |
| HIST-01 | Session records with file counts stored/retrieved | unit (Rust) | `cd src-tauri && cargo test resolution` | Wave 0 |
| HIST-02 | Conflict resolution records stored with backup refs | unit (Rust) | `cd src-tauri && cargo test resolution` | Wave 0 |
| HIST-03 | Approval audit log queryable by date/agent | unit (Rust) | `cd src-tauri && cargo test history` | Wave 0 |
| HIST-04 | History store fetches and filters data | unit | `npx vitest run src/stores/__tests__/historyStore.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run && cd src-tauri && cargo test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/merge.test.ts` -- covers CNFL-03 (merge computation)
- [ ] `src/lib/__tests__/contention.test.ts` -- covers FMON-05 (heat map scores)
- [ ] `src/hooks/__tests__/useMergeState.test.ts` -- covers CNFL-04 (resolution state)
- [ ] `src/views/Conflicts/__tests__/IntentPanel.test.tsx` -- covers CNFL-05
- [ ] `src/stores/__tests__/historyStore.test.ts` -- covers HIST-04
- [ ] Shiki + node-diff3 installed: `npm install node-diff3 shiki`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A (local desktop app) |
| V3 Session Management | No | N/A |
| V4 Access Control | No | Single-user desktop app |
| V5 Input Validation | Yes | Validate file paths from conflict alerts before reading. Sanitize file content before rendering in DOM (Shiki handles HTML escaping). |
| V6 Cryptography | No | N/A |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via conflict file_path | Tampering | Validate resolved paths are within watched directory. Reject paths with `..` segments. |
| XSS via file content in diff view | Tampering | Shiki HTML-escapes content by default. Do not use `dangerouslySetInnerHTML` with raw file content. |
| Backup directory traversal | Tampering | Backup paths are generated server-side (Rust), not user-supplied. Validate paths resolve within app data dir. |
| Large file denial of service | Denial of Service | Cap file size for merge UI display (e.g., 1MB). Show "file too large for inline merge" with external editor link. |

## Sources

### Primary (HIGH confidence)
- `src-tauri/src/conflict/types.rs` -- ConflictAlert, ConflictState, FileWriteRecord types
- `src-tauri/src/conflict/engine.rs` -- ConflictEngine sliding-window detection
- `src-tauri/src/conflict/commands.rs` -- Existing Tauri commands for conflicts
- `src-tauri/src/db/migrations/001_initial_schema.sql` -- Base schema
- `src-tauri/src/db/migrations/002_phase3_enrichment.sql` -- Phase 3 enrichments
- `src-tauri/src/db/migrations/003_comms_chat.sql` -- Phase 4 chat/approval enrichments
- `src/views/Radar/RadarCanvas.tsx` -- Canvas 2D treemap render loop
- `src/stores/conflictStore.ts` -- Existing conflict store
- `src/stores/radarStore.ts` -- Radar store with viewport
- `src/App.tsx` -- Router configuration
- `src/components/layout/Sidebar.tsx` -- Navigation structure
- `package.json` -- Current dependency versions

### Secondary (MEDIUM confidence)
- [node-diff3 GitHub](https://github.com/bhousel/node-diff3) -- 3-way merge library docs
- [Shiki docs](https://shiki.style/guide/best-performance) -- Bundle optimization guide
- [npm diff package](https://www.npmjs.com/package/diff) -- structuredPatch API
- [similar crate](https://docs.rs/similar) -- Rust diff library

### Tertiary (LOW confidence)
- Heat map color values derived from wireframe design system review -- exact values may need tuning

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified against npm/crates registries, `diff` already installed
- Architecture: HIGH -- patterns extend existing codebase patterns (Canvas layers, Zustand stores, Tauri commands, SQLite migrations)
- Pitfalls: HIGH -- based on analysis of existing conflict engine data flow and common merge UI challenges
- Heat map formula: MEDIUM -- weighting is reasonable but tunable, per Claude's Discretion

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable domain, low churn)
