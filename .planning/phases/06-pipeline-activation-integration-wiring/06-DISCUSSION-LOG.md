# Phase 6: Pipeline Activation + Integration Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 06-pipeline-activation-integration-wiring
**Areas discussed:** Repo open flow, Pipeline activation, PID-to-Agent bridging, Live data refresh

---

## Repo Open Flow

### How should the user select which repository to watch?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect CWD | App launched from terminal inherits CWD, auto-detect git repo root on startup | |
| File picker dialog | Show native folder picker on first launch or when no repo is set | |
| Both — CWD + picker fallback | Auto-detect CWD if git repo, otherwise show folder picker | ✓ |

**User's choice:** Both — CWD + picker fallback
**Notes:** None

### Should the app remember the last-opened repo across launches?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, persist last repo | Store last repo path in SQLite or local config. Auto-open on next launch unless CWD differs | ✓ |
| No, always fresh | Each launch starts with no repo | |
| You decide | Claude picks approach | |

**User's choice:** Yes, persist last repo
**Notes:** None

### Should there be a way to switch repos without restarting?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, menu/button to switch | Add 'Change repo' in sidebar/title bar. Stops watch, opens picker, starts new watch | ✓ |
| No, one repo per session | Restart app to change repos | |
| You decide | Claude picks approach | |

**User's choice:** Yes, menu/button to switch
**Notes:** None

---

## Pipeline Activation

### When should the file watcher pipeline start?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-start on repo open | Immediately call start_watch when repo selected. Zero manual steps | |
| Manual 'Start Watch' button | User explicitly clicks to begin monitoring | |
| Auto-start + pause toggle | Auto-starts but user can pause/resume watching | ✓ |

**User's choice:** Auto-start + pause toggle
**Notes:** None

### Where should usePipelineChannel be wired in?

| Option | Description | Selected |
|--------|-------------|----------|
| App-level (root component) | Mount at App/Shell level, persists across view navigation | |
| Per-view (each tab) | Each view manages own subscription | |
| You decide | Claude picks mount point | ✓ |

**User's choice:** You decide
**Notes:** None

---

## PID-to-Agent Bridging

### How should passively-detected PIDs become named agents?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-register from process name | Auto-create agent entry from PID match on allowlist | |
| Show as 'unidentified' until self-registration | Passive PIDs appear as unnamed dots, only self-registered get names | ✓ |
| You decide | Claude picks strategy | |

**User's choice:** Show as 'unidentified' until self-registration
**Notes:** None

### When a passively-detected agent later self-registers, should entries merge?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, merge by PID match | Self-registration with matching PID merges into one entry | ✓ |
| Keep separate | Passive and self-registered stay distinct | |
| You decide | Claude picks strategy | |

**User's choice:** Yes, merge by PID match
**Notes:** None

---

## Live Data Refresh

### How should the radar treemap stay current with live file activity?

| Option | Description | Selected |
|--------|-------------|----------|
| Event-driven from pipeline | pipelineStore events trigger radarStore updates via subscribe(). No polling | ✓ |
| Periodic polling | Re-fetch get_tree_index every N seconds | |
| Hybrid — events + periodic sync | Incremental events + full re-fetch every 30s | |
| You decide | Claude picks strategy | |

**User's choice:** Event-driven from pipeline
**Notes:** None

### How should session file tracking work?

| Option | Description | Selected |
|--------|-------------|----------|
| Backend-driven | Rust pipeline calls record_session_file internally during event processing | ✓ |
| Frontend-driven | Frontend calls record_session_file via IPC on event receipt | |
| You decide | Claude picks approach | |

**User's choice:** Backend-driven
**Notes:** None

---

## Claude's Discretion

- usePipelineChannel mount point (D-05)

## Deferred Ideas

None
