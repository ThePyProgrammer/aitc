# Phase 3: Agent Management + Conflict Detection - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-10
**Phase:** 03-agent-management-conflict-detection
**Areas discussed:** Agent adapter architecture, Agent launch & observe, Agent state & intent, Conflict detection engine

---

## Agent Adapter Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Rust trait object | Define an AgentAdapter trait in Rust. Each agent type gets a struct implementing the trait. Type-safe, compile-time checked. | |
| Config-driven registry | Agent types defined in JSON/TOML config with process name patterns, launch commands, state detection rules. | |
| Hybrid: trait + config | Core adapter is a Rust trait for complex logic, plus a GenericAdapter reads simple agents from config. | ✓ |

**User's choice:** Hybrid: trait + config
**Notes:** Covers both power users who write Rust adapters and casual users who just need process-name matching.

| Option | Description | Selected |
|--------|-------------|----------|
| Compiled-in modules | Adapters compiled into the binary. No ABI concerns. Adding a new agent means code change + rebuild. | ✓ |
| Dynamic plugin system | Adapters loaded as .dll/.so/.dylib at runtime. Maximum extensibility but significant complexity. | |

**User's choice:** Compiled-in modules
**Notes:** Appropriate for v1 with 3 known agents.

| Option | Description | Selected |
|--------|-------------|----------|
| Detect-only | Generic agents can only be detected by process name and monitored. No launch, no intent. | |
| Detect + launch | Generic agents can also be launched via configurable shell command. No intent parsing. | |
| Full feature parity | Generic agents support launch, detect, state, and intent via config rules. | ✓ |

**User's choice:** Full feature parity
**Notes:** GenericAdapter is not a second-class citizen.

---

## Agent Launch & Observe

| Option | Description | Selected |
|--------|-------------|----------|
| Detached subprocess | Spawn agent CLI as detached child process. Track PID, monitor stdout/stderr. Agent survives AITC restart. | ✓ |
| Embedded terminal emulator | Launch agents in embedded terminal panel within AITC. Richer UX but needs terminal emulator library. | |
| External terminal + PID tracking | Open user's default terminal with agent command. AITC only tracks PID after launch. | |

**User's choice:** Detached subprocess
**Notes:** Simple and portable.

| Option | Description | Selected |
|--------|-------------|----------|
| Enhance Phase 2 process scanner | Enrich Phase 2's ProcessSnapshot with adapter-specific metadata extraction. | |
| Agent self-registration | Agents register via local socket/HTTP when they start. Requires agents to know about AITC. | |
| Hybrid: scan + optional self-registration | Process scanning as baseline, plus optional registration endpoint for richer metadata. | ✓ |

**User's choice:** Hybrid: scan + optional self-registration
**Notes:** Always-works baseline with optional enrichment path.

| Option | Description | Selected |
|--------|-------------|----------|
| Local HTTP server | AITC runs lightweight HTTP server on localhost. Agents POST metadata. Discoverable via AITC_PORT env var. | ✓ |
| Named pipe / Unix socket | Platform-specific IPC. Lower overhead but harder to integrate from agent hooks. | |
| File-based sidecar | Agents write .aitc-agent.json in working directory. Zero networking but cleanup problem. | |

**User's choice:** Local HTTP server
**Notes:** Simple, language-agnostic, easy to integrate into Claude Code hooks.

---

## Agent State & Intent

| Option | Description | Selected |
|--------|-------------|----------|
| Adapter-driven | Each adapter implements get_state(). Rich adapters parse agent-specific signals. Generic adapters use configurable rules. | ✓ |
| Process-level only | State derived purely from OS process state. Can't detect Waiting-for-Approval or Error. | |
| Event-stream inference | Infer state from file event patterns. Indirect and can misclassify. | |

**User's choice:** Adapter-driven
**Notes:** Each adapter owns its state logic.

| Option | Description | Selected |
|--------|-------------|----------|
| Adapter hooks | Rich adapters extract intent from agent-specific sources. | |
| User-provided labels | User manually labels each session. Always accurate but adds friction. | |
| Hybrid: adapter + manual fallback | Adapters extract intent automatically; prompt user to label if unavailable. | ✓ |

**User's choice:** Hybrid: adapter + manual fallback
**Notes:** Best of both worlds.

| Option | Description | Selected |
|--------|-------------|----------|
| In-app indicator only | State changes update Tower Control manifest. No OS notifications for routine changes. | |
| In-app + OS notification for all | Every state transition triggers both in-app and OS notification. Could be noisy. | |
| Configurable per-state | User configures which state transitions trigger OS notifications. | ✓ |

**User's choice:** Configurable per-state
**Notes:** Flexible without being noisy by default.

---

## Conflict Detection Engine

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed default, user-configurable | Ship with sensible default (e.g., 5s). User can adjust threshold in settings. | ✓ |
| Adaptive based on agent speed | System learns each agent's write cadence and adjusts per-agent. Complex. | |
| Session-scoped (any overlap) | Any two agents writing same file during session = conflict. Many false positives. | |

**User's choice:** Fixed default, user-configurable
**Notes:** Simple mental model.

| Option | Description | Selected |
|--------|-------------|----------|
| Visual badge + conflict list | Badge on Conflicts nav, row in conflicts panel, status change in Tower Control. No modal. | |
| Modal interruption | Modal dialog pops up immediately. Ensures nothing missed but disrupts workflow. | |
| Badge + optional OS notification | Badge + list + optional native OS notification. Non-intrusive with escalation path. | ✓ |

**User's choice:** Badge + optional OS notification
**Notes:** Ties into configurable per-state notification settings.

| Option | Description | Selected |
|--------|-------------|----------|
| Per-file | Two agents writing same file = conflict. Simple, no content diffing. | |
| Per-hunk (line-range overlap) | Only flag if overlapping line ranges. Fewer false positives but complex. | |
| Per-file with hunk hint | Detect at file level, capture byte ranges/line counts as hints for Phase 5 merge UI. | ✓ |

**User's choice:** Per-file with hunk hint
**Notes:** Phase 3 stays simple, Phase 5 gets the data it needs.

---

## Claude's Discretion

- Conflict window default value
- HTTP server framework for self-registration endpoint
- Config file format for GenericAdapter definitions
- State polling interval
- Stdout/stderr capture strategy for launched subprocesses

## Deferred Ideas

None — discussion stayed within phase scope.
