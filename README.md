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

Built phase-by-phase through [GSD](.planning/). Started as "oh I'll ship six phases, a cute little tower + radar + merge UI app." Now there are eighteen, plus a decimal (11.1) for urgent bug work, and the count keeps going up every time I actually run the thing. Phases 11-17 were added *after* v1.0 shipped because once you have a functional ATC radar you cannot stop asking what if the radar was cooler. Phase 18 was added because running four agents at once filled the registry in about ten seconds. Classic.

Each phase has a `.planning/phases/NN-*/` folder with research · context · plan(s) · verification artefacts. Phases run strictly in numeric order: each one depends on the one before. No cheating.

```
Wave 0: "ok let's actually ship v1"
  ├── 1  Foundation + App Shell              → (none)     ✅ shipped
  ├── 2  Real-Time Data Pipeline             → 1          ✅ shipped (2026-04-10)
  ├── 3  Agents + Conflict Detection         → 2          ✅ shipped
  ├── 4  Core UI Views                       → 3          ✅ shipped
  ├── 5  Conflict Resolution + History       → 4          ✅ shipped
  └── 6  Pipeline Activation (gap closure)   → 5          ✅ shipped

Wave 1: "wait, I want more surfaces"
  ├── 7  Graph-based Codebase Map            → 6          ✅ shipped (RIP treemap, 2026)
  ├── 8  Claude Code PreToolUse Hooks        → 7          ✅ shipped
  ├── 9  Arsenal (skills / agents / config)  → 8          ✅ shipped
  └── 10 First-class Chat UI                 → 9          🟡 6/6 coded — UAT sign-off pending on 10-06 checkpoint

Wave 2: "the radar should be sicker"
  ├── 11   d3-force in a WebWorker           → 10         ✅ shipped (2026-04-21)
  ├── 11.1 Fix zoom-scroll lag (INSERTED)    → 11         ⏳ planning  ← we are here
  ├── 12 IPC bridge nodes + boundary viz     → 11         ⏳ planning
  ├── 13 4-level semantic zoom               → 12         ⏳ planning
  ├── 14 Multi-layer offscreen canvas        → 13         ⏳ planning
  ├── 15 Enhanced ATC agent overlay (TCAS)   → 14         ⏳ planning
  └── 16 Typed edges + Louvain communities   → 15         ⏳ planning

Wave 3: "things you only find out by actually running this"
  ├── 17 Conflict-triggered gate             → 16         ⏳ drafted (17-CONTEXT.md)
  └── 18 Fix passive-scan registry flooding  → 17         ⏳ planning
```

**Status (2026-04-21):** Waves 0 and 1 are basically done. All of v1.0 shipped. Phase 7 replaced the original squarified-treemap radar with the force-directed graph (RIP, you served us well). Phase 8 shipped the Claude Code hook plumbing. Phase 9 shipped Arsenal. Phase 10 (Chat UI) has **all 6 plans coded** — blocked only on the Plan 06 Task 3 human-verify UAT checkpoint (see `10-06-CHECKPOINT.md`).

Wave 2 is where the scope creep lives and we're in it. **Phase 11** shipped 2026-04-21 — d3-force now runs in a dedicated Worker with transferable `Float32Array` position buffers, prod build passed smoke, force-config sliders are "damn responsive" per the operator. Manual UAT surfaced a zoom-scroll lag on settled graphs, filed as **Phase 11.1** (INSERTED) — the hot-path gate short-circuits correctly when the sim is settled, so the render loop is byte-identical to Phase 7 and this is a pre-existing issue that Phase 11's perf surfacing merely exposed. Suspects: wheel events firing at 120–240Hz on trackpads outrunning rAF, `drawFolderHulls` recomputing convex hulls per frame even on static positions, and the Zustand viewport-writeback cascade. Scope is performance-only; no visual change; no new capability.

Wave 3 collects the reality checks — things that only break once you actually run the app with multiple long-lived agents. **Phase 17** (conflict-triggered gating) exists because the "every Edit/Write/Bash prompts you" model became unusable in a multi-agent session; see [`17-CONTEXT.md`](.planning/phases/17-conflict-triggered-pretooluse-gating-replace-tool-category-g/17-CONTEXT.md) for the three unresolved design questions. **Phase 18** was filed after `AgentRegistry` hit its `MAX_AGENTS=100` cap within seconds of startup — `passive_bridge.bridge_tick` was registering a `PASSIVE-{pid}` for every `claude`/`codex`/`opencode`-named process on the box, including unrelated CLI sessions in other terminals and short-lived subprocesses that Phase 10's long-lived stream-json runtime spawns (MCP handlers, `aitc-hook` fires, node helpers). Pre-existing bug from Phase 3/6, amplified by Phase 10. Fix needs to scope passive registration to self-registered PIDs **or** cwd-in-active-repo with a narrow command-line match, plus raise the ceiling as a safety net.

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

Now it's eighteen phases long (nineteen if you count 11.1) so...
