# Phase 2: Real-Time Data Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-09
**Phase:** 02-real-time-data-pipeline
**Areas discussed:** Event delivery to frontend, PID correlation strategy, Worktree detection, Watch scope & filtering

---

## Event Delivery to Frontend

| Option | Description | Selected |
|--------|-------------|----------|
| Tauri event emission | Rust emits via app.emit(), frontend listens with listen(). Built-in, fire-and-forget, natural fit for streaming data. | ✓ |
| Tauri commands (pull-based) | Frontend polls Rust via invoke() on an interval to fetch queued events. | |
| Tauri event + dedicated channel | Use Tauri's Channel API for high-throughput streaming with backpressure support. | |
| You decide | Claude picks the best approach. | |

**User's choice:** Tauri event emission
**Notes:** Natural fit for real-time streaming data to Zustand stores.

| Option | Description | Selected |
|--------|-------------|----------|
| Rust-side batching only | Debounce and batch in Rust before emitting. Frontend trusts manageable rate. | |
| Both Rust and frontend | Rust debounces raw FS events, frontend additionally throttles store updates. | |
| You decide | Claude picks based on performance requirements. | ✓ |

**User's choice:** You decide (Claude's discretion)
**Notes:** Throttling strategy deferred to Claude based on empirical testing.

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory only | Events live in Rust structs during session. No DB writes per event. | |
| Stream to SQLite | Every batched event written to file_events table in real time. | |
| You decide | Claude picks based on performance vs audit trail tradeoffs. | ✓ |

**User's choice:** You decide (Claude's discretion)
**Notes:** Persistence strategy deferred to Claude.

---

## PID Correlation Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Process polling + heuristics | Poll known agent PIDs periodically for open file handles. | |
| ETW (Event Tracing for Windows) | Windows kernel-level file I/O events with PID. Most accurate but Windows-only. | |
| Agent self-reporting | Agents report own file activity via hooks/adapters. | |
| Hybrid: polling + self-report | Process polling baseline, agent adapters supplement with self-reported activity. | ✓ |

**User's choice:** Hybrid: polling + self-report
**Notes:** Best of both worlds, built incrementally across Phase 2 and Phase 3.

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort | Attribute when confident, mark as 'unattributed' otherwise. | ✓ |
| Must be accurate | Every file event must be attributed to a specific process. | |
| You decide | Claude picks the precision level. | |

**User's choice:** Best-effort
**Notes:** Phase 3 agent adapters will improve accuracy incrementally.

| Option | Description | Selected |
|--------|-------------|----------|
| Scan by process name | Look for known process names in system process list. | |
| User registers watched PIDs | User manually provides PIDs or process paths. | |
| Watch codebase directory only | Don't discover processes in Phase 2. | |
| You decide | Claude picks the discovery approach. | ✓ |

**User's choice:** You decide (Claude's discretion)
**Notes:** Process discovery method deferred to Claude.

---

## Worktree Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Git inspection | Run 'git worktree list' and inspect .git files/dirs. Automated. | ✓ |
| Path-based heuristic | Compare agent working directories. Same root = shared. | |
| User declares topology | User configures shared vs isolated via config/UI. | |

**User's choice:** Git inspection
**Notes:** Automated detection, no user config needed.

| Option | Description | Selected |
|--------|-------------|----------|
| On watch start | Detect once when file watcher initializes. Re-detect on refresh/new agent. | ✓ |
| Continuously | Re-check periodically during session. | |
| You decide | Claude picks the timing. | |

**User's choice:** On watch start
**Notes:** One-time detection with manual refresh trigger.

---

## Watch Scope & Filtering

| Option | Description | Selected |
|--------|-------------|----------|
| Gitignore + hardcoded defaults | Respect .gitignore plus hardcode .git/, node_modules/, target/, build/. | ✓ |
| User-configurable ignore list | Config file or UI for additional ignore patterns. | |
| Gitignore only | Strictly follow .gitignore, nothing else. | |
| You decide | Claude picks the filtering strategy. | |

**User's choice:** Gitignore + hardcoded defaults
**Notes:** No user-configurable patterns in Phase 2. Covers 95% of cases.

| Option | Description | Selected |
|--------|-------------|----------|
| Writes only | Track create, modify, delete, rename. No read events. | ✓ |
| Reads and writes | Track all file access including reads. | |
| You decide | Claude picks based on tradeoffs. | |

**User's choice:** Writes only
**Notes:** Reads are too noisy (10-100x volume) and not actionable for conflict detection.

| Option | Description | Selected |
|--------|-------------|----------|
| Build file tree index | Walk directory on start for baseline state and codebase map. | ✓ |
| No initial scan | Just start watching for new events. | |
| You decide | Claude picks the initialization approach. | |

**User's choice:** Build file tree index
**Notes:** Powers Phase 4 Radar codebase map and provides baseline state.

---

## Claude's Discretion

- Throttling strategy (Rust-side batching only vs dual Rust+frontend throttling)
- Event persistence approach (in-memory vs SQLite streaming)
- Initial process discovery method before Phase 3 adapters exist

## Deferred Ideas

None — discussion stayed within phase scope.
