# AI Traffic Controller (AITC)

> A single-operator cockpit for running multiple coding AI agents on one codebase — like air traffic control for aircraft in an airspace.

AITC watches agents work, visualises them on a spatial map of the codebase, flags it when two of them reach for the same file, and is the one place you approve or deny everything they want to do. Built for the solo developer who runs Claude Code, Codex, OpenCode, and a handful of other coding agents in parallel and needs to stay ahead of them without juggling five terminals.

## Core capabilities

- **Live agent manifest** — every active coding agent (launched by AITC or externally) with ID, protocol, current file, and state (Running / Idle / Waiting / Conflict / Error).
- **Force-directed codebase graph** — nodes are source files, edges are `import` / `dependency` relationships extracted with `tree-sitter`, filesystem proximity acts as gravity, and agents trail 10s fading comets along the edges as they work.
- **Real-time conflict detection** — two agents writing the same file inside the conflict window triggers a visual alert, an OS notification, and a row in the Requests queue.
- **3-way merge UI** — resolve overlapping edits hunk-by-hunk with agent intent shown alongside each diff. Backed by a backup manager so a bad merge is always reversible.
- **Claude Code PreToolUse hook integration** — every gated Claude Code tool call blocks on an AITC approval row until you approve, deny, or approve-with-edits. `--dangerously-skip-permissions` agents bypass AITC and move freely (commit `06fbf1e`). Fail-safe deny on AITC outage.
- **Communications Hub** — approval queue with file paths and diff previews, per-agent chat driven by a long-lived `claude --input-format stream-json` process, OS notifications deep-linked to the specific request.
- **Arsenal** — single pane over `~/.claude/` and `<cwd>/.claude/` showing installed skills, agents, plugins, hooks, commands, and MCP servers. Inline editor for the two `CLAUDE.md` files.
- **Session history** — virtualized tables for past agent sessions, resolved conflicts, and approval decisions.
- **File heat map** — cross-agent contention overlay on the codebase graph.

## Architecture (one minute version)

```
┌─ React frontend (Vite + Tailwind v4 + Zustand) ─────────────────┐
│  Views: Radar · TowerControl · Comms · Conflicts · History ·    │
│         Arsenal                                                 │
│  IPC: tauri-specta-generated TypeScript bindings                │
└──────────┬──────────────────────────────────────────────────────┘
           │ invoke() / Channel<T> (streamed events)
┌──────────▼─────────────────────────────── Rust backend ────────┐
│  pipeline/    notify 8 + notify-debouncer-full 0.7              │
│               file events → debounce → PID attribution → batch  │
│  agents/      AgentRegistry, AgentAdapter trait,                │
│               adapters: claude_code · codex · opencode · generic│
│               self_register axum server (/register, /hook)      │
│               aitc-hook sidecar (Claude Code PreToolUse)        │
│  conflicts/   sliding window per-file conflict detection        │
│  comms/       approval rows, protected paths, chat runtime,     │
│               MCP server (/mcp on the same axum port)           │
│  claude_resources/  scanner + parser for ~/.claude & .claude/   │
│  db/          sqlx + SQLite (schema migrations 001..006)        │
└─────────────────────────────────────────────────────────────────┘
```

Tech choices and their rationale live in [`CLAUDE.md`](CLAUDE.md).

## Getting started

```bash
# 1. Prereqs: Rust (stable), Node 20+, and the Tauri v2 system deps for your OS
#    https://v2.tauri.app/start/prerequisites/

npm install

# 2. Dev (launches Vite + Tauri with HMR on both sides)
npm run tauri dev

# 3. Production build
npm run tauri build

# 4. Run the test suites
npm test                                # Vitest frontend
cargo test --manifest-path src-tauri/Cargo.toml   # Rust backend
cargo test --manifest-path src-tauri/Cargo.toml -p aitc-hook   # hook sidecar
```

The dev build writes its backend HTTP port to `~/.aitc/port` on startup; the `aitc-hook` sidecar and any external integrations read from there.

## Project layout

```
src/                     React frontend
  views/                   Radar, TowerControl, CommsHub, Conflicts, History, Arsenal
  stores/                  Zustand stores (agentStore, conflictStore, radarStore, …)
  components/ui/           StatusBadge, Button, and other design-system primitives
  styles/                  Tailwind v4 theme, fonts, animations
src-tauri/
  src/
    pipeline/              File watcher + process snapshot + event batching
    agents/                AgentRegistry, adapters, self-register axum server
    conflicts/             Conflict detection engine
    comms/                 Approval workflow, chat runtime, MCP server
    claude_resources/      Arsenal scanner/parser
    db/migrations/         SQLite schema (001..006)
  aitc-hook/               Claude Code PreToolUse sidecar binary (separate crate)
.planning/                 GSD workflow artifacts (ROADMAP, phase plans, state)
wireframes/                Command Horizon design-system source
```

## Build Plan

AITC is built phase-by-phase via [GSD](.planning/) — 17 phases so far, each with its own `.planning/phases/NN-*/` directory (research · context · plan(s) · verification). Phases execute strictly in numeric order; every phase depends on its predecessor. Phases 11-17 were added after the v1.0 foundation shipped to capture radar polish (11-16) and a late-arriving rethink of the gating model (17).

```
Wave 0 — Radar foundation (v1.0)
  ├── 1  Foundation + App Shell              → (none)         ✅ shipped
  ├── 2  Real-Time Data Pipeline             → 1              ✅ shipped (2026-04-10)
  ├── 3  Agent Management + Conflict Detect  → 2              ✅ shipped
  ├── 4  Core UI Views                       → 3              ✅ shipped
  ├── 5  Conflict Resolution + History       → 4              ✅ shipped
  └── 6  Pipeline Activation + Wiring        → 5              ✅ shipped (gap closure)

Wave 1 — Controller surfaces
  ├── 7  Graph-based Codebase Map            → 6              ✅ shipped (replaces treemap)
  ├── 8  Claude Code PreToolUse Hooks        → 7              ✅ shipped
  ├── 9  Arsenal (skills/agents/config)      → 8              ✅ shipped
  └── 10 First-class Chat UI                 → 9              🟡 5/6 plans (10-06 pending)

Wave 2 — Radar performance polish
  ├── 11 d3-force in a WebWorker             → 10             ⏳ planning
  ├── 12 IPC bridge nodes + boundary viz     → 11             ⏳ planning
  ├── 13 4-level semantic zoom               → 12             ⏳ planning
  ├── 14 Multi-layer offscreen canvas        → 13             ⏳ planning
  ├── 15 Enhanced ATC agent overlay          → 14             ⏳ planning
  └── 16 Typed edges + Louvain communities   → 15             ⏳ planning

Wave 3 — Gating model rethink
  └── 17 Conflict-triggered PreToolUse gate  → 16             ⏳ drafted (see 17-CONTEXT.md)
```

**Status (as of 2026-04-21):** Waves 0 and 1 are substantively complete — all of the v1.0 radar foundation (Phases 1-6) shipped, Phase 7's graph map replaced the treemap, Phase 8 shipped Claude Code hook integration, and Phase 9 shipped Arsenal. Phase 10's chat rewrite is in-flight (4 of 6 plans executed; 10-05 just completed, 10-06 Wave 4 frontend + UAT remains). Waves 2 and 3 are planning-stage — next critical-path unlock is Phase 11, which moves d3-force off the main thread so Wave 2's subsequent visual work has headroom.

Source of truth: [`.planning/STATE.md`](.planning/STATE.md) (execution state) + [`.planning/ROADMAP.md`](.planning/ROADMAP.md) (phase narrative + plan manifest). Both files are updated automatically by the GSD workflow; do not hand-edit phase check boxes.

## Agent adapters

Adding a new coding agent is a matter of implementing `AgentAdapter` in `src-tauri/src/agents/` and registering it. Current adapters:

| Adapter | File | Launch | Observe | PreToolUse hook | Chat |
|---|---|---|---|---|---|
| `claude_code` | `agents/claude_code.rs` | yes (long-lived `stream-json`) | yes (self-register + PID scan) | yes (via `aitc-hook`) | yes (stdin JSONL + MCP) |
| `codex` | `agents/codex.rs` | yes | yes | — | read-only stdout/stderr capture |
| `opencode` | `agents/opencode.rs` | yes | yes | — | read-only stdout/stderr capture |
| `generic` | `agents/generic.rs` | — | yes (PASSIVE-{pid}) | — | — |

The `AgentAdapter` trait exposes `capabilities()` so the frontend can gate UI per-agent — `chat_duplex`, `pretool_hook_install`, and so on.

## Links

- [`CLAUDE.md`](CLAUDE.md) — project overview + technology stack rationale
- [`.planning/PROJECT.md`](.planning/PROJECT.md) — original requirements, key decisions, out-of-scope notes
- [`.planning/ROADMAP.md`](.planning/ROADMAP.md) — full phase + plan manifest
- [`wireframes/`](wireframes/) — Command Horizon design system source
