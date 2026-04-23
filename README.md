# 🛩️ AI Traffic Controller (AITC)

> You have four coding agents running in four different terminals and last Tuesday two of them deleted the same file at the same time and now you're here.

So there's this joke where you're a developer in 2026 and your whole job is opening multiple agents of Claude Code, Codex, OpenCode and more in different tabs and pretending you know what any of them are doing. This is the tool for that.

AITC is **air traffic control for coding agents**. They're the little planes, your repo is the airspace, you're the fella in the control room staring at the radar scope. When two agents start circling the same runway (read: file), a big red thing happens and you press a button.

## what does it actually do

- **👀 Tower Control**: a live manifest of every agent that's currently doing a crime to your codebase. ID, protocol, current file, state (`RUNNING` / `IDLE` / `WAITING` / `CONFLICT` / `ERROR` / `vibing`). Launch new ones, reap old ones, watch them work.
- **🛰️ Airspace Radar**: a force-directed graph of your source files with `import` edges pulled by tree-sitter and filesystem proximity acting as gravity. Agents leave 10-second fading comet trails behind them as they scurry between files. Yes it looks cool. That's the whole point. Why else would I build this.
- **💥 Conflict detection**: two agents write the same file inside the conflict window? instant visual, OS notification, new row in the queue. "Why are you both in `auth.rs`" energy.
- **🧩 3-way merge UI**: the merge editor you wish you had at work. Agent A's change on the left, Agent B's on the right, the base in the middle, each agent's *intent* shown next to the hunk so you remember why these crimes were committed. BackupManager has your back if you merge badly.
- **🛂 Claude Code PreToolUse hooks**: every gated tool call from a Claude Code agent freezes until you approve it in the Requests queue. (Or deny. Or approve-with-edits. You have options.) `--dangerously-skip-permissions` agents get a free pass and move around unbothered (see commit `06fbf1e`, the angry-developer hotfix). If AITC crashes, the hook fails closed so nothing can ship behind your back.
- **💬 Comms Hub**: an approval queue with diffs + a per-agent chat tab backed by a long-lived `claude --input-format stream-json` process. Finally, a way to yell at the agent that doesn't involve the system logs.
- **🎒 Arsenal**: a single pane over `~/.claude/` and `<cwd>/.claude/` so you know exactly which Skills, Agents, Plugins, Hooks, Commands, and MCP servers Claude currently has access to. Inline editor for both `CLAUDE.md` files because you know you're going to edit them.
- **🔥 File heat map**: a contention overlay showing which files have been the main character this week.
- **🗂️ Session history**: virtualized tables of past sessions, conflicts, approvals. Git blame, but for vibes.

## architecture, such as it is

Tauri v2 shell + React frontend + a frankly too-ambitious Rust backend, because "I just wanted a little tray app" and then Rust happened.

```
┌─ React frontend (Vite + Tailwind v4 + Zustand) ─────────────────┐
│  Views: Radar · TowerControl · Comms · Conflicts · History ·    │
│         Arsenal                                                 │
│  IPC: tauri-specta TS bindings (we do not manually sync types.  │
│       we tried. it was bad.)                                    │
└──────────┬──────────────────────────────────────────────────────┘
           │ invoke() / Channel<T>
┌──────────▼─────────────────────────────── Rust backend ─────────┐
│  pipeline/    notify 8 + notify-debouncer-full 0.7              │
│               file events → debounce → PID attribution → batch  │
│  agents/      AgentRegistry + AgentAdapter trait;               │
│               adapters: claude_code · codex · opencode · generic│
│               self_register axum server (/register, /hook)      │
│               aitc-hook sidecar (Claude Code PreToolUse)        │
│  conflicts/   sliding window per-file conflict detection        │
│  comms/       approval rows, protected paths, chat runtime,     │
│               MCP server bolted onto the same axum port because │
│               it was there                                      │
│  claude_resources/  scanner + parser for ~/.claude & .claude/   │
│  db/          sqlx + SQLite (migrations 001..006)               │
└─────────────────────────────────────────────────────────────────┘
```

Why each of those: see [`CLAUDE.md`](CLAUDE.md). Short version: it's Tauri because Electron is 30x bigger, it's Rust because I wanted `notify` and `sysinfo`, it's Zustand because Redux is old and Claude Code recommended Zustand.

## running it locally

You'll need Rust (stable), Node 20+, and whatever [Tauri v2 tells you to install](https://v2.tauri.app/start/prerequisites/) for your OS. Then:

```bash
npm install

# dev: HMR on both the React side AND the Rust side
npm run tauri dev

# prod build, for when you want to hand someone a scary-looking binary
npm run tauri build

# tests
npm test                                                             # frontend
cargo test --manifest-path src-tauri/Cargo.toml                      # backend
cargo test --manifest-path src-tauri/Cargo.toml -p aitc-hook         # hook sidecar
```

The dev build writes its backend HTTP port to `~/.aitc/port`. The `aitc-hook` sidecar reads it from there. If that file is missing or stale, the hook fails closed and your agent will look at you like 🤨.

## where everything lives

```
src/                     frontend
  views/                   Radar · TowerControl · CommsHub · Conflicts · History · Arsenal
  stores/                  Zustand stores, one per domain
  components/ui/           design-system primitives (StatusBadge, Button, ...)
  styles/                  Tailwind v4 + Command Horizon theme + phosphor animations
src-tauri/
  src/
    pipeline/              the file watcher + process snapshot machinery
    agents/                registry, adapters, self-register server
    conflicts/             the sliding-window conflict engine
    comms/                 approvals, chat runtime, MCP server
    claude_resources/      Arsenal scanner/parser
    db/migrations/         SQLite schema (001..006)
  aitc-hook/               the Claude Code PreToolUse sidecar (its own crate)
.planning/                 GSD artifacts: this is where the spec actually lives
wireframes/                Command Horizon design-system source
```

## the build plan, featuring scope creep

Built phase-by-phase through [GSD](.planning/). Started as "oh I'll ship six phases, a cute little tower + radar + merge UI app." Now there are twenty-two, plus a decimal (11.1), and the count keeps going up every time I actually run the thing. Phases 11-17 were added *after* v1.0 shipped because once you have a functional ATC radar you cannot stop asking what if the radar was cooler. Phase 18 was added because running four agents at once filled the registry in about ten seconds. Phase 19 was added because the chat UI showed hook noise, duplicated text blocks, and literal triple-backticks where code blocks should go. Phase 20 was added because an inefficiency audit caught `fetchAgents()` re-rendering every subscriber on every 2-second poll even when nothing about the agents actually changed. Phase 21 was added because Phase 12's cross-language boundary visualization quietly assumed a Tauri layout, and it turns out not everything is a Tauri app. Phase 22 was added because Phase 12's UAT also caught a phantom aura circle under the bridge diamonds (wrong render pass), folder hulls enveloping bridges (wrong filter in the hull cache), and anchor labels you can barely see (same color token as the folder labels). Classic.

Each phase has a `.planning/phases/NN-*/` folder with research · context · plan(s) · verification artefacts. The arrow after each phase name lists its **real dependencies** — not execution order. GSD happens to run one phase at a time, but Wave 3's phases fan out sideways from the main chain: each one was filed after something surfaced while actually running the tower.

```
Wave 0 — "ok let's actually ship v1"
  1    Foundation + App Shell              ← (none)    ✅ shipped
  2    Real-Time Data Pipeline             ← 1         ✅ shipped (2026-04-10)
  3    Agents + Conflict Detection         ← 2         ✅ shipped
  4    Core UI Views                       ← 3         ✅ shipped
  5    Conflict Resolution + History       ← 4         ✅ shipped
  6    Pipeline Activation (gap closure)   ← 5         ✅ shipped

Wave 1 — "wait, I want more surfaces"
  7    Graph-based Codebase Map            ← 4, 6      ✅ shipped (RIP treemap)
  8    Claude Code PreToolUse Hooks        ← 3, 4      ✅ shipped
  9    Arsenal (skills/agents/config)      ← 2, 4      ✅ shipped
  10   First-class Chat UI                 ← 3, 8, 9   ✅ shipped (2026-04-21)

Wave 2 — "the radar should be sicker"
  11   d3-force in a WebWorker             ← 7         ✅ shipped (2026-04-21)
  11.1 Fix zoom-scroll lag                 ← 7         ✅ shipped (2026-04-21)
  12   IPC bridge nodes + boundary viz     ← 7, 11     ✅ shipped (2026-04-22)
  13   4-level semantic zoom               ← 7, 11     ⏳ planning
  14   Multi-layer offscreen canvas        ← 7, 11     ⏳ planning
  15   Enhanced ATC overlay (TCAS)         ← 7, 14     ⏳ planning
  16   Typed edges + Louvain communities   ← 7, 12     ⏳ planning

Wave 3 — "things you only find out by actually running this"
  17   Conflict-triggered gate             ← 3, 8      🟡 6/6 coded — UAT pending on 17-06 checkpoint  ← next up
  18   Fix passive-scan registry flooding  ← 3, 6      ✅ shipped (2026-04-21)
  19   Polish chat transcript rendering    ← 5, 10     🟡 4/4 coded — UAT pending on 19-HUMAN-UAT
  20   Diff-aware agent polling            ← 3, 10     ⏳ planning
  21   Polyglot IPC bridge extractor       ← 12        ⏳ planning
  22   Bridge layer visual polish          ← 12        ⏳ planning
```

**Status (as of 2026-04-22):**

*Waves 0 + 1* shipped in full — six foundation phases closed by 2026-04-10, four surface-expansion phases (graph radar, PreToolUse hooks, Arsenal, Chat UI) closed by 2026-04-21.

*Wave 2* — Phases 11 + 11.1 + 12 shipped. Phase 12's D-34 UAT approved 2026-04-22; during UAT smoke on a "2 TS frontends + Python backend" repo caught the Tauri-only assumption baked into the boundary layer (quick-task `260422-dqu` shipped a runtime guard that cleanly hides the layer on non-Tauri repos), and the same UAT pass surfaced four visual-polish items (phantom aura under diamonds, folder hulls enveloping bridges, anchor-label contrast, dangling-vs-populated subtlety) — the structural polyglot generalization got filed as Phase 21, the four polish items as Phase 22. Phases 13–16 still planning.

*Wave 3* is the reality-check dumping ground. Phase 17 (conflict-triggered gating) was added because the category-based gate shipped in Phase 8 felt wrong — approval should key off a conflict signal, not a tool name; all 6 plans coded, UAT pending. Phase 18 shipped because running four agents at once filled the registry in ten seconds. Phase 19 was added because the chat UI rendered triple-backticks literally, repeated text blocks, and hook-startup noise — all coded, UAT pending. Round-1 UAT on 2026-04-22 caught two gap-closures both landed same day: the first-pass tool-card polish used opacity modifiers faint enough the boxes blended into the chat bg (switched to solid `bg-surface-container-high` + solid `border-outline-variant`), and D-01's aggregator coalesce had no frontend subscription to `agent-assistant-delta` so progressive reveal went dark between turn start and `TurnComplete` (fixed with a per-agent streaming buffer + synthetic streaming row). Phase 20 was added because an inefficiency audit caught `fetchAgents()` re-rendering every subscriber every 2 seconds. Phase 21 was added because Phase 12's polyglot UAT exposed the hardcoded FE/BE labels as a Tauri-specific visualization dressed up as a general one. Phase 22 was added because the same Phase 12 UAT caught a phantom aura ring under the bridge diamonds (wrong render pass), folder hulls enveloping bridges at the boundary line (unfiltered hull cache), and anchor labels too dim against busy graph regions — none invalidate Phase 12's deliverable, all are additive polish.

Totals: 14 of 23 entries shipped (counting 11.1). Two phases (17, 19) are code-complete awaiting UAT. Seven in planning (13, 14, 15, 16, 20, 21, 22).

Ground truth: [`.planning/STATE.md`](.planning/STATE.md) + [`.planning/ROADMAP.md`](.planning/ROADMAP.md). GSD updates them automatically. Please do not hand-edit the checkboxes, you will make me sad.

## agent adapters (the "plug any coding AI into the tower" part)

Adding a new coding agent: implement `AgentAdapter` in `src-tauri/src/agents/`, register it, done. Current lineup:

| Adapter | Launch? | Observe? | PreToolUse hook? | Chat? |
|---|---|---|---|---|
| `claude_code` | ✅ long-lived `stream-json` | ✅ self-register + PID scan | ✅ via `aitc-hook` | ✅ stdin JSONL + MCP |
| `codex` | ✅ | ✅ | — | read-only stdout/stderr capture |
| `opencode` | ✅ | ✅ | — | read-only stdout/stderr capture |
| `generic` | — | ✅ (auto-creates `PASSIVE-{pid}`) | — | — |

The trait exposes `capabilities()` so the frontend can hide UI bits per-agent (Codex doesn't get a chat box, no Generic in the deploy menu, etc).

## further reading

- [`CLAUDE.md`](CLAUDE.md): the actual project brief + why we picked every dep
- [`.planning/PROJECT.md`](.planning/PROJECT.md): original requirements, key decisions, out-of-scope
- [`.planning/ROADMAP.md`](.planning/ROADMAP.md): full phase + plan manifest
- [`wireframes/`](wireframes/): the Command Horizon design system built by Google Stitch, whence all the phosphor green
- [`src-tauri/aitc-hook/`](src-tauri/aitc-hook/): the sidecar binary, in case you want to see a fail-safe-deny contract up close

## is this production ready

Uhhhhhhhhh... probably not?

It runs, though. On my Linux machine at least. Mostly. And apparently on Windows (UNVERIFIED CLAIM, PROCEED WITH CAUTION!). Welcome aboard, controller.

## credits

I had this idea when I read [this LinkedIn post](https://www.linkedin.com/posts/dr-oliver-borchers-043a48b9_cursor-3-just-left-vs-code-completely-rewritten-share-7447171765312786433-3TO3) that suggested the logical progression for an IDE like Cursor was to move from being a "co-pilot" to an "air traffic control system". After discussing with [@Ethan-Chew](https://github.com/Ethan-Chew), it sounded like a pretty cool idea to implement over the weekend.

Now it's twenty-two phases long (twenty-three if you count 11.1) so...
