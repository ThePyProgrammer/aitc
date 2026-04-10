# Phase 4: Core UI Views - Research

**Researched:** 2026-04-10
**Domain:** Interactive UI views (Communications Hub, Airspace Radar), Canvas 2D spatial visualization, approval workflow, native OS notifications
**Confidence:** HIGH

## Summary

Phase 4 transforms the AITC application from a monitoring dashboard into an interactive command center by delivering two major views -- the Communications Hub (approval queue + agent chat) and the Airspace Radar (treemap-based spatial codebase visualization) -- plus native OS notification integration. This is the most UI-intensive phase in the project, requiring a code diff viewer, a Canvas 2D treemap renderer with zoom/pan, real-time approval workflow state management, and chat message persistence.

The codebase already has strong foundations: Zustand stores per domain, Tauri command patterns with specta type-safety, Channel-based IPC streaming, OS notification infrastructure, and a file tree index in Rust that provides the data source for the radar treemap. The frontend uses React 19.2, Tailwind CSS v4, Motion v12, and Lucide icons with established Command Horizon design system patterns.

**Primary recommendation:** Build Communications Hub first (it exercises the approval workflow backend that the radar also consumes), then Airspace Radar. Use `squarify` (1.1.0) for treemap layout math, `diff` (8.0.4) for computing unified diffs client-side, and raw Canvas 2D with `requestAnimationFrame` for the radar render loop. Add a new `get_tree_index` Tauri command to expose Phase 2's file tree to the frontend for the radar.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** 3-panel layout matching the wireframe -- request queue (left), request detail with code diff (center), telemetry + mini agent chats (right)
- **D-02:** Right panel contains system load metrics (CPU, memory), telemetry feed (connected agents, recent file events), and mini expandable chat cards for each active agent
- **D-03:** Request queue uses color-coded status badges (green/amber/red) indicating urgency, sorted chronologically with most recent at top. Reuses Phase 3 StatusBadge component patterns
- **D-04:** Code diffs shown as inline diff with syntax highlighting -- green/red highlighted lines in a monospace code block (JetBrains Mono per design system). Matches COMM-03 requirement
- **D-05:** "Approve with edit" (COMM-06) uses inline editing in the diff view -- user clicks a line to make it editable, modifies code directly in the approval detail panel, then confirms with "Approve with edits" button
- **D-06:** "Ask for more info" (COMM-02) reveals an inline text input in the detail panel -- user types their question, sends it, request stays in pending state
- **D-07:** Approval request sources: Claude Code generates real requests via its hooks system (pre_tool_use interception). Other agents (Codex, OpenCode, generic) get synthetic approval requests when they write to user-configured "protected" paths
- **D-08:** Approval response delivery: Claude Code receives approve/deny response via hook system (blocks agent until user decides). Other agents: decision is logged in database, OS notification shown, but agent cannot be blocked -- approval becomes an audit trail + alert
- **D-09:** Treemap layout algorithm -- directories become nested rectangles, files become cells within directory regions. Agent dots positioned on the cells they're actively touching
- **D-10:** Agent dots are colored per-agent with subtle pulse animation. Lead lines connect dots to recently-touched files with timestamps (VIZN-02 trajectory)
- **D-11:** Full zoom + pan navigation -- mouse wheel to zoom, click-drag to pan. Progressive detail: 1x shows directory labels + agent dots, 3x shows file names + lead lines, 8x shows individual file details + full trajectory
- **D-12:** Right-side collapsible agent manifest panel matching wireframe -- lists all agents with status (mini Tower Control). Click agent to highlight on radar
- **D-13:** Dual chat structure -- inline message input at bottom of detail panel for the selected agent/request, plus mini chat cards in the right sidebar
- **D-14:** Message delivery: Claude Code via hooks system (bidirectional). Other agents: messages queued in AITC database, adapter polls if capable. Show delivery status indicator
- **D-15:** Threaded conversations -- full chat thread per agent showing message history in a scrollable timeline. Messages persist in SQLite
- **D-16:** Implements Phase 3's configurable per-state notification settings (D-09). Fires native OS notifications + system tray alerts when agent requires user action

### Claude's Discretion
- Treemap algorithm specifics (squarified treemap vs strip treemap vs slice-and-dice)
- Canvas 2D render loop optimization (requestAnimationFrame, dirty region tracking, offscreen buffering)
- Protected path configuration UI (simple list editor vs glob pattern builder)
- Chat message persistence schema (new migration for messages table)
- Mini chat card expand/collapse animation treatment
- Telemetry feed data sources and refresh interval
- Color assignment strategy for agent dots (fixed palette vs hash-based)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMM-01 | User sees a queue of pending approval requests from agents in the Communications Hub | commsStore with approval queue state, request queue panel component, real-time event subscription |
| COMM-02 | User can approve, deny, or ask for more info on each agent request | Approval workflow Tauri commands (approve, deny, ask_more), inline text input for ask-more-info |
| COMM-03 | Approval requests show the target file path and a preview of the proposed changes (code diff) | `diff` library for computing diffs, custom InlineDiff component with green/red highlighting |
| COMM-04 | User can send freeform text messages to an agent via the Communications Hub chat interface | Chat message Tauri commands, chat_messages DB table, message delivery status indicators |
| COMM-05 | System shows native OS notifications and system tray alerts when agent requires user action | Existing `tauri-plugin-notification` + `dispatch_state_notification` pattern, extend for approval events |
| COMM-06 | User can approve a request with inline edits | Inline contentEditable line editing in diff view, "approve with edits" action variant |
| VIZN-01 | User can view a 2D spatial radar plotting agents as dots on a file-tree-based codebase map | Canvas 2D treemap rendering, `squarify` for layout, `get_tree_index` command for data |
| VIZN-02 | Radar shows agent trajectories (lead lines indicating which files an agent is approaching/recently touched) | Canvas line rendering with gradient opacity, file event history from pipelineStore |
| VIZN-04 | Radar renders performantly via Canvas 2D for codebases with 10k+ files | Squarified treemap computed once on data change, cached layout, progressive detail by zoom level |
| VIZN-05 | Codebase map uses file tree structure (directories = regions, files = points) as spatial layout | Treemap algorithm maps directory hierarchy to nested rectangles |
</phase_requirements>

## Standard Stack

### Core (New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| squarify | 1.1.0 | Squarified treemap layout computation | TypeScript implementation of Bruls et al. algorithm. Clean API: takes flat array of values, returns positioned rectangles. Used by Atlas of Economic Complexity (15k users/month). 98% test coverage. No rendering -- pure math, feed results into Canvas 2D. | [VERIFIED: npm registry] |
| diff | 8.0.4 | Compute unified text diffs for approval request previews | Standard JS diff library (jsdiff). Produces structured diff output with added/removed/unchanged hunks. 50M+ weekly downloads. Used by virtually every JS diff viewer. | [VERIFIED: npm registry] |
| @tanstack/react-virtual | 3.13.23 | Virtualized approval queue list and chat history | Already in CLAUDE.md stack. Headless virtualization for 10K+ item lists at 60fps. | [VERIFIED: npm registry] |

### Already Installed (Use As-Is)

| Library | Version | Purpose |
|---------|---------|---------|
| react | 19.2.4 | UI framework |
| zustand | 5.0.12 | State management (new commsStore, radarStore) |
| motion | 12.38.0 | Animations (phosphor transitions, pulse effects, panel expand/collapse) |
| lucide-react | 1.7.0 | Icons (Send, Check, X, MessageSquare, Radar, etc.) |
| @tauri-apps/api | 2.10.1 | Tauri IPC (invoke, listen, Channel) |
| @tauri-apps/plugin-sql | 2.4.0 | Frontend read queries for chat history |
| tailwindcss | 4.2.2 | Styling |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| squarify | d3-hierarchy treemap | d3-hierarchy is 45KB+ and pulls in d3-array; squarify is 3KB, pure TypeScript, does exactly one thing |
| diff (jsdiff) | react-diff-viewer-continued | react-diff-viewer-continued is a full rendered component (4.2.0) but forces its own styling. AITC needs Command Horizon-styled inline diffs with editable lines -- building a thin custom renderer over `diff` output is cleaner |
| Custom Canvas 2D | React-Konva for treemap | Konva adds scene graph overhead for 10k+ rectangles. Raw Canvas 2D with dirty-region tracking is faster for the treemap. Konva could still be used for interactive overlays (tooltips, agent cards) if needed later |
| Custom Canvas 2D | @visx/hierarchy treemap | visx treemap outputs SVG, not Canvas. SVG bogs down at 10k+ nodes. Use visx math (scales) but not its treemap renderer |

**Installation:**
```bash
npm install squarify diff @tanstack/react-virtual
npm install -D @types/diff
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── views/
│   ├── CommsView.tsx              # 3-panel Communications Hub (replaces placeholder)
│   ├── CommsHub/
│   │   ├── RequestQueue.tsx       # Left panel: pending approval queue list
│   │   ├── RequestDetail.tsx      # Center panel: selected request with diff + actions
│   │   ├── InlineDiff.tsx         # Code diff renderer with editable lines
│   │   ├── ApprovalActions.tsx    # Approve/Deny/AskMore/ApproveWithEdit buttons
│   │   ├── ChatThread.tsx         # Chat message thread for selected agent
│   │   ├── TelemetryPanel.tsx     # Right panel: system load + telemetry + mini chats
│   │   └── MiniChatCard.tsx       # Expandable mini chat card per agent
│   ├── RadarView.tsx              # Airspace Radar main view (replaces placeholder)
│   └── Radar/
│       ├── RadarCanvas.tsx        # Canvas 2D treemap renderer (the core)
│       ├── RadarManifest.tsx      # Right-side agent manifest panel
│       ├── RadarMinimap.tsx       # Bottom-right mini overview map
│       ├── AgentDot.tsx           # Agent dot rendering logic (positions, pulse, lead lines)
│       └── useTreemapLayout.ts    # Hook: squarify computation + memoization
├── stores/
│   ├── commsStore.ts              # Approval queue, chat messages, selected request
│   └── radarStore.ts              # Viewport (zoom, pan), selected agent, layout cache
├── hooks/
│   ├── useApprovalChannel.ts      # Channel-based streaming for approval events
│   └── useCanvasZoomPan.ts        # Mouse wheel zoom + drag pan for canvas
└── components/ui/
    └── DeliveryStatus.tsx          # Delivery status indicator (delivered/queued/unsupported)
```

### Pattern 1: Zustand Store Per Domain
**What:** Each major feature gets its own Zustand store -- follows existing pattern with agentStore, conflictStore, pipelineStore.
**When to use:** Always for new state domains.
**Example:**
```typescript
// commsStore.ts -- follows existing store patterns
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ApprovalRequest {
  id: string;
  agentId: string;
  requestType: string;  // 'write_access' | 'execute' | 'modify'
  filePath: string;
  diffContent: string | null;  // unified diff string
  status: 'pending' | 'approved' | 'denied' | 'info_requested';
  urgency: 'low' | 'medium' | 'high';
  createdAt: string;
  resolvedAt: string | null;
}

export interface ChatMessage {
  id: string;
  agentId: string;
  direction: 'inbound' | 'outbound';  // agent->user or user->agent
  content: string;
  deliveryStatus: 'delivered' | 'queued' | 'unsupported';
  createdAt: string;
}

interface CommsStore {
  requests: ApprovalRequest[];
  selectedRequestId: string | null;
  messages: Record<string, ChatMessage[]>;  // keyed by agentId
  fetchRequests: () => Promise<void>;
  approveRequest: (id: string, edits?: string) => Promise<void>;
  denyRequest: (id: string) => Promise<void>;
  askMoreInfo: (id: string, question: string) => Promise<void>;
  sendMessage: (agentId: string, content: string) => Promise<void>;
  subscribeToApprovals: () => Promise<UnlistenFn>;
  selectRequest: (id: string | null) => void;
}
```
[ASSUMED]

### Pattern 2: Canvas 2D Render Loop with Dirty Tracking
**What:** A single `requestAnimationFrame` loop that only redraws when state changes (dirty flag). Treemap layout is precomputed and cached; only viewport transforms trigger redraws.
**When to use:** For the radar treemap with 10k+ rectangles.
**Example:**
```typescript
// RadarCanvas.tsx render loop pattern
function RadarCanvas({ treeData, agents, viewport }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<TreemapRect[]>([]);
  const dirtyRef = useRef(true);

  // Recompute layout only when tree data changes
  useEffect(() => {
    layoutRef.current = computeSquarifiedLayout(treeData, width, height);
    dirtyRef.current = true;
  }, [treeData, width, height]);

  // Mark dirty when viewport changes
  useEffect(() => {
    dirtyRef.current = true;
  }, [viewport.zoom, viewport.panX, viewport.panY]);

  // Render loop
  useEffect(() => {
    let rafId: number;
    const render = () => {
      if (dirtyRef.current && canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d')!;
        drawTreemap(ctx, layoutRef.current, viewport);
        drawAgentDots(ctx, agents, layoutRef.current, viewport);
        dirtyRef.current = false;
      }
      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [agents, viewport]);
}
```
[ASSUMED]

### Pattern 3: Progressive Detail by Zoom Level
**What:** At zoom 1x, only render directory rectangles + labels + agent dots. At 3x+, render file-level rectangles + labels + lead lines. At 8x+, render full file details + trajectories. This keeps 10k-file treemaps performant at overview zoom.
**When to use:** Essential for VIZN-04 performance requirement.
**Example:**
```typescript
function drawTreemap(ctx: CanvasRenderingContext2D, rects: TreemapRect[], viewport: Viewport) {
  const zoom = viewport.zoom;
  for (const rect of rects) {
    // Skip tiny rectangles that would be sub-pixel at current zoom
    const screenWidth = rect.w * zoom;
    const screenHeight = rect.h * zoom;
    if (screenWidth < 1 || screenHeight < 1) continue;

    // Level 1 (zoom < 3): directories only
    if (rect.depth <= 2 || zoom >= 3) {
      drawRect(ctx, rect, viewport);
    }
    // Level 2 (zoom >= 3): file labels
    if (zoom >= 3 && screenWidth > 40) {
      drawLabel(ctx, rect.name, rect, viewport);
    }
    // Level 3 (zoom >= 8): file details
    if (zoom >= 8 && rect.isFile) {
      drawFileDetail(ctx, rect, viewport);
    }
  }
}
```
[ASSUMED]

### Pattern 4: Approval Channel Streaming (follows usePipelineChannel)
**What:** A new `useApprovalChannel` hook that mirrors the existing `usePipelineChannel` pattern -- creates a Tauri event listener for approval-request events from the backend and pumps them into the commsStore.
**When to use:** For real-time approval request push from Rust to React.
**Example:**
```typescript
// useApprovalChannel.ts -- mirrors usePipelineChannel pattern
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useCommsStore } from '../stores/commsStore';

export function useApprovalChannel() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<ApprovalRequest>('approval-request', (event) => {
      useCommsStore.getState().addRequest(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, []);
}
```
[VERIFIED: codebase pattern from conflictStore.ts and usePipelineChannel.ts]

### Anti-Patterns to Avoid
- **SVG for 10k+ treemap nodes:** SVG DOM nodes become unbearable above 1k elements. Use Canvas 2D exclusively for the radar treemap.
- **Re-computing treemap layout on every frame:** The squarify algorithm is O(n log n). Cache the layout and only recompute when file tree data changes (watch start, major FS events), not on viewport changes.
- **Storing diff HTML in the database:** Store raw diff text (or before/after content). Compute the visual diff client-side with the `diff` library. This keeps the DB schema clean and allows re-rendering with different styles.
- **Polling for approval requests:** Use Tauri event-based push (like conflict-detected events), not polling intervals. The conflictStore pattern already demonstrates this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Treemap layout math | Custom squarified algorithm | `squarify` (1.1.0) | Bruls et al. algorithm has subtle edge cases with aspect ratio optimization. The library handles degenerate inputs (zero-size items, single items, deeply nested). |
| Text diffing | Custom string comparison | `diff` (8.0.4) | Myers diff algorithm handles edge cases (binary files, whitespace, moved blocks). Character-level, word-level, and line-level diff modes. |
| List virtualization | Custom virtual scroll | `@tanstack/react-virtual` (3.13.23) | Window resizing, dynamic row heights, scroll-to-index, overscan. Already in the CLAUDE.md stack. |
| OS notifications | Custom notification API | `tauri-plugin-notification` (already installed) | Already integrated in Phase 3 notifications.rs. Cross-platform, permission handling built in. |

**Key insight:** The diff viewer and treemap renderer are the two highest-complexity UI components in this phase. The diff viewer appears simple but has edge cases around syntax highlighting, line wrapping, editable lines, and large diffs. The treemap has edge cases around empty directories, very small files, and deeply nested structures. Using libraries for the math and building thin renderers on top is the right approach.

## Common Pitfalls

### Pitfall 1: Canvas Coordinate System Confusion with Zoom/Pan
**What goes wrong:** Canvas transforms (scale, translate) interact in non-obvious ways. Mouse events report screen coordinates but the treemap uses world coordinates. Hit-testing breaks when zoom/pan is applied incorrectly.
**Why it happens:** Canvas 2D uses a transformation matrix that applies in reverse order. `ctx.scale()` then `ctx.translate()` vs `ctx.translate()` then `ctx.scale()` produce different results.
**How to avoid:** Maintain a viewport object with `{ zoom, panX, panY }`. Convert mouse events to world coordinates with `worldX = (screenX - panX) / zoom`. Apply transforms consistently: `ctx.setTransform(zoom, 0, 0, zoom, panX, panY)` at the start of each frame.
**Warning signs:** Agent dots appear at wrong positions when zoomed, click events select wrong treemap nodes.

### Pitfall 2: Treemap Layout Thrashing
**What goes wrong:** Treemap layout recomputes on every render cycle, causing 60fps drops and visible flickering as rectangles shift positions.
**Why it happens:** The file tree data reference changes on every Zustand state update even when the actual tree hasn't changed.
**How to avoid:** Memoize the squarify computation with `useMemo` keyed on a stable hash of the file tree. Only recompute when `get_tree_index` returns new data. Store the computed layout in a ref, not in state.
**Warning signs:** CPU spikes when idle, rectangles visibly shifting on unrelated state changes.

### Pitfall 3: Inline Diff Editing State Conflicts
**What goes wrong:** User starts editing a line in the diff view, but a new event arrives that updates the approval request, wiping out the edit-in-progress.
**Why it happens:** Real-time event subscription overwrites the request data while the user is mid-edit.
**How to avoid:** Track "editing mode" in the commsStore. When editing, freeze the current request's diff content and suppress incoming updates for that specific request. Show a stale-data indicator. Unfreezing merges any queued updates.
**Warning signs:** User reports losing typed edits, diff view flickers during editing.

### Pitfall 4: Canvas DPI/Scaling on High-DPI Displays
**What goes wrong:** Treemap text and lines appear blurry on Retina/HiDPI displays despite correct logical coordinates.
**Why it happens:** Canvas element needs explicit `width`/`height` attributes set to `devicePixelRatio * CSS size`, with CSS constraining the display size.
**How to avoid:** Set canvas dimensions to `Math.floor(width * devicePixelRatio)` x `Math.floor(height * devicePixelRatio)`, apply `ctx.scale(devicePixelRatio, devicePixelRatio)`, and set CSS `width`/`height` to logical size.
**Warning signs:** Blurry text on macOS, canvas appears at wrong size on Windows with display scaling.

### Pitfall 5: Chat Message Ordering with Async Delivery
**What goes wrong:** Messages appear out of order in the chat thread because delivery status updates arrive before the message itself is rendered.
**Why it happens:** Async message send (to Rust backend) and the delivery status update (from backend event) race against each other.
**How to avoid:** Optimistic insertion: add the message to the chat thread immediately with `deliveryStatus: 'queued'`, then update status when the backend confirms. Sort messages by `createdAt` timestamp, not insertion order.
**Warning signs:** Messages appearing above the message they reply to, duplicate messages.

## Code Examples

### Squarify Treemap Layout Computation
```typescript
// Source: squarify npm package API + project tree_index data
import squarify from 'squarify';

interface FileTreeNode {
  path: string;
  size: number;
  isDir: boolean;
  children?: FileTreeNode[];
}

interface TreemapRect {
  x0: number; y0: number;
  x1: number; y1: number;
  path: string;
  depth: number;
  isFile: boolean;
  name: string;
}

function computeTreemapLayout(
  root: FileTreeNode,
  width: number,
  height: number
): TreemapRect[] {
  // squarify expects { value, children? } objects
  const container = { x0: 0, y0: 0, x1: width, y1: height };

  // Flatten for directory-level layout first, then recurse
  const dirData = root.children?.map(child => ({
    value: child.size || 1,  // prevent zero-size
    ...child,
  })) ?? [];

  const layout = squarify(dirData, container);
  // layout returns objects with x0, y0, x1, y1 added
  return layout.map((rect: any) => ({
    x0: rect.x0,
    y0: rect.y0,
    x1: rect.x1,
    y1: rect.y1,
    path: rect.path,
    depth: 1,
    isFile: !rect.isDir,
    name: rect.path.split('/').pop() || rect.path,
  }));
}
```
[ASSUMED -- squarify API needs verification during implementation]

### Custom Inline Diff Renderer
```typescript
// Source: diff npm package + Command Horizon design system
import { diffLines } from 'diff';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: number;
  editable?: boolean;
}

function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText, newText);
  const lines: DiffLine[] = [];
  let lineNum = 1;

  for (const change of changes) {
    const changeLines = change.value.split('\n').filter(Boolean);
    for (const line of changeLines) {
      lines.push({
        type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
        content: line,
        lineNumber: lineNum++,
        editable: change.added, // only added lines are editable for "approve with edit"
      });
    }
  }
  return lines;
}
```
[VERIFIED: diff npm package API - diffLines is the standard line-level diff function]

### Canvas Zoom/Pan Hook
```typescript
// Source: standard Canvas 2D zoom/pan pattern
import { useCallback, useRef, useState } from 'react';

interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export function useCanvasZoomPan(minZoom = 0.5, maxZoom = 20) {
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setViewport(prev => {
      const newZoom = Math.max(minZoom, Math.min(maxZoom, prev.zoom * zoomFactor));
      // Zoom toward cursor position
      const mouseX = e.offsetX;
      const mouseY = e.offsetY;
      const scale = newZoom / prev.zoom;
      return {
        zoom: newZoom,
        panX: mouseX - (mouseX - prev.panX) * scale,
        panY: mouseY - (mouseY - prev.panY) * scale,
      };
    });
  }, [minZoom, maxZoom]);

  const onMouseDown = useCallback((e: MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setViewport(prev => ({
      ...prev,
      panX: prev.panX + dx,
      panY: prev.panY + dy,
    }));
  }, []);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return { viewport, onWheel, onMouseDown, onMouseMove, onMouseUp };
}
```
[ASSUMED -- standard Canvas 2D zoom/pan implementation]

### DB Migration: Chat Messages + Approval Request Enrichment
```sql
-- Migration 002: Chat messages and approval request enrichment
-- Supports COMM-04 (freeform messages), COMM-06 (approve with edit), HIST-03 (audit)

-- Enrich existing approval_requests with diff content and urgency
ALTER TABLE approval_requests ADD COLUMN diff_content TEXT;
ALTER TABLE approval_requests ADD COLUMN urgency TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE approval_requests ADD COLUMN agent_id TEXT;
ALTER TABLE approval_requests ADD COLUMN response_note TEXT;
ALTER TABLE approval_requests ADD COLUMN edited_content TEXT;

-- Chat messages table for COMM-04 and D-15
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
    content TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'queued'
        CHECK(delivery_status IN ('delivered', 'queued', 'unsupported')),
    approval_request_id INTEGER REFERENCES approval_requests(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chat_messages_agent ON chat_messages(agent_id, created_at);
CREATE INDEX idx_approval_requests_status ON approval_requests(status);

-- Protected paths configuration for D-07 synthetic approvals
CREATE TABLE IF NOT EXISTS protected_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    glob_pattern TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
[ASSUMED -- schema designed based on CONTEXT.md decisions and existing 001_initial_schema.sql patterns]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SVG treemaps | Canvas 2D treemaps | 2022+ | SVG DOMs collapse above 5k nodes; Canvas handles 100k+ rectangles at 60fps |
| react-diff-viewer (unmaintained) | diff + custom renderer OR react-diff-viewer-continued (4.2.0) | 2024 | Original package abandoned 6 years ago; continued fork maintained |
| Electron notifications | Tauri plugin-notification | 2024 | Native OS notification integration without Node.js IPC overhead |
| D3 treemap (full library) | squarify (standalone math) | 2023+ | D3 treemap pulls 45KB+ bundle; squarify is 3KB pure math |

**Deprecated/outdated:**
- `react-diff-viewer` (original, 3.1.1): Last published 6 years ago. Use `diff` library + custom renderer or `react-diff-viewer-continued` (4.2.0) instead. [VERIFIED: npm registry]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | squarify's API accepts `{ value, children? }` objects and returns `{ x0, y0, x1, y1 }` | Code Examples | Would need to adapt the treemap computation code; verify during implementation |
| A2 | Canvas 2D with requestAnimationFrame + dirty tracking handles 10k+ treemap rectangles at 60fps | Architecture Patterns | May need offscreen canvas or WebGL fallback if performance is insufficient |
| A3 | Proposed DB migration schema (002) is compatible with existing 001 schema and sqlx compile-time checks | Code Examples | Migration could fail at compile time; verify ALTER TABLE compatibility with SQLite via sqlx |
| A4 | Progressive detail rendering (zoom-level based filtering) is sufficient for VIZN-04 performance | Patterns | May need spatial indexing (quadtree) if culling by rectangle visibility is too slow |
| A5 | Chat message delivery status can be tracked end-to-end for Claude Code hooks | Architecture | Hook system integration details may vary; delivery confirmation depends on Claude Code hook response timing |

## Open Questions (RESOLVED)

1. **get_tree_index command exposure**
   - What we know: Phase 2's `tree_index.rs` builds the file tree index on watch start, but the initial_tree is dropped in `pipeline/commands.rs:169` with a comment "Phase 4's radar can request it via a separate command (get_tree_index) -- not in Phase 2 scope"
   - What's unclear: Should the tree index be stored in PipelineState and exposed via a new command, or rebuilt on-demand?
   - Recommendation: Store the tree index in PipelineState alongside ActiveWatch and expose via `get_tree_index` command. Rebuilding is 187-228ms for 10k files (benchmarked in Phase 2) -- acceptable for on-demand but unnecessary if already computed.

2. **Claude Code hooks integration for approval workflow**
   - What we know: D-07 says Claude Code generates real requests via its hooks system (pre_tool_use interception). D-08 says the hook system blocks the agent until user decides.
   - What's unclear: Exact Claude Code hook API for intercepting tool use and receiving approve/deny responses.
   - Recommendation: Research Claude Code's hooks API during plan implementation. Build the approval workflow backend generically first, then wire the Claude Code adapter specifically.

3. **Color assignment for agent dots on radar**
   - What we know: Agent dots need distinct colors. The design system has primary (green), secondary (blue/cyan), tertiary (amber), and error (red) colors.
   - What's unclear: How to assign colors when there are more than 4 agents.
   - Recommendation: Use a fixed palette of 8 distinct colors (primary, secondary, tertiary, error, plus 4 additional computed from the design system color space). Hash agent ID to palette index for consistency across sessions.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 + @testing-library/react 16.3.2 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run && cd src-tauri && cargo test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMM-01 | Approval queue renders pending requests | unit | `npx vitest run src/__tests__/commsStore.test.ts -t "fetch requests"` | No -- Wave 0 |
| COMM-02 | Approve/deny/ask-more actions update request status | unit | `npx vitest run src/__tests__/commsStore.test.ts -t "approve request"` | No -- Wave 0 |
| COMM-03 | Diff computation produces correct added/removed lines | unit | `npx vitest run src/__tests__/inlineDiff.test.ts` | No -- Wave 0 |
| COMM-04 | Chat message send/receive round-trip | unit | `npx vitest run src/__tests__/commsStore.test.ts -t "send message"` | No -- Wave 0 |
| COMM-05 | Notification dispatch for approval events | unit | `cd src-tauri && cargo test notification` | Partial -- existing tests in notifications.rs |
| COMM-06 | Approve-with-edit modifies diff content | unit | `npx vitest run src/__tests__/commsStore.test.ts -t "approve with edit"` | No -- Wave 0 |
| VIZN-01 | Treemap layout computation from file tree | unit | `npx vitest run src/__tests__/treemapLayout.test.ts` | No -- Wave 0 |
| VIZN-02 | Lead line computation from agent file history | unit | `npx vitest run src/__tests__/radarStore.test.ts -t "lead lines"` | No -- Wave 0 |
| VIZN-04 | Treemap renders 10k rectangles within 16ms frame budget | unit | `npx vitest run src/__tests__/treemapLayout.test.ts -t "performance"` | No -- Wave 0 |
| VIZN-05 | File tree structure maps to nested treemap rectangles | unit | `npx vitest run src/__tests__/treemapLayout.test.ts -t "nested"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run && cd src-tauri && cargo test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/commsStore.test.ts` -- covers COMM-01, COMM-02, COMM-04, COMM-06
- [ ] `src/__tests__/inlineDiff.test.ts` -- covers COMM-03
- [ ] `src/__tests__/treemapLayout.test.ts` -- covers VIZN-01, VIZN-04, VIZN-05
- [ ] `src/__tests__/radarStore.test.ts` -- covers VIZN-02
- [ ] `src-tauri/src/db/migrations/002_chat_messages.sql` -- migration file for chat + approval enrichment
- [ ] Framework install: `npm install squarify diff @tanstack/react-virtual && npm install -D @types/diff`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a (single-user desktop app) |
| V3 Session Management | no | n/a |
| V4 Access Control | yes | Approval workflow: only user can approve/deny. Validate all mutations through Tauri commands (never frontend-only) |
| V5 Input Validation | yes | Chat message content: sanitize before DB insert (sqlx parameterized queries). Diff content: validate before rendering. Protected path globs: validate syntax |
| V6 Cryptography | no | n/a |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Chat message injection (XSS via agent message content) | Tampering | Render agent messages as plain text in monospace blocks, never `dangerouslySetInnerHTML`. React's default JSX escaping handles this |
| Diff content injection (malicious code in diff preview) | Tampering | Diff content rendered as text nodes, never evaluated. contentEditable only on user-initiated edit mode |
| Protected path glob DoS (catastrophic backtracking) | Denial of Service | Validate glob patterns with `regex` crate before storing. Limit glob complexity |
| Approval request spoofing (fake requests from non-agent source) | Spoofing | All approval requests created by Rust backend only (from adapter hooks or protected path detection). Frontend cannot create requests via invoke |

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/stores/agentStore.ts`, `conflictStore.ts`, `pipelineStore.ts` -- established Zustand patterns
- Existing codebase: `src-tauri/src/pipeline/tree_index.rs` -- file tree index data structure
- Existing codebase: `src-tauri/src/agents/notifications.rs` -- OS notification dispatch pattern
- Existing codebase: `src-tauri/src/db/migrations/001_initial_schema.sql` -- existing DB schema
- Wireframes: `wireframes/communications_hub/screen.png` + `code.html` -- Communications Hub layout
- Wireframes: `wireframes/airspace_radar/screen.png` + `code.html` -- Airspace Radar layout
- Design system: `wireframes/vector_terminal/DESIGN.md` -- Command Horizon specification
- npm registry: squarify@1.1.0, diff@8.0.4, @tanstack/react-virtual@3.13.23, react-diff-viewer-continued@4.2.0

### Secondary (MEDIUM confidence)
- [squarify GitHub](https://github.com/huy-nguyen/squarify) -- TypeScript squarified treemap implementation
- [D3 Treemap docs](https://d3js.org/d3-hierarchy/treemap) -- reference algorithm documentation
- [diff npm](https://www.npmjs.com/package/diff) -- jsdiff API reference

### Tertiary (LOW confidence)
- Canvas 2D performance claims for 10k+ rectangles -- based on general WebSearch and training data, not benchmarked in this codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified against npm registry, versions confirmed
- Architecture: HIGH -- patterns directly follow established codebase conventions (Zustand stores, Tauri commands, Channel IPC)
- Pitfalls: MEDIUM -- Canvas 2D pitfalls are well-documented but treemap-specific performance at 10k scale needs empirical validation
- UI implementation: HIGH -- wireframes provide pixel-level reference, existing components (StatusBadge, AgentManifest, RadarPulse) provide reusable patterns

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable domain -- no fast-moving dependencies)
