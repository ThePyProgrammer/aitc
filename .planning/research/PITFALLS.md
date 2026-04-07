# Domain Pitfalls

**Domain:** AI Agent Traffic Controller (Tauri v2 desktop app with real-time filesystem monitoring, multi-process management, conflict detection, and complex visualization)
**Researched:** 2026-04-07

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or fundamental architecture failures.

---

### Pitfall 1: Windows File Watcher Buffer Overflow Causes Silent Event Loss

**What goes wrong:** On Windows, `ReadDirectoryChangesW` (used by notify-rs under the hood) maintains a fixed-size buffer (max 64KB). When AI agents perform bulk file operations -- writing dozens of files in rapid succession, which coding agents routinely do -- the buffer overflows and ALL pending notifications are silently discarded. You get zero indication that events were lost except a zero-byte return value that many wrappers do not surface.

**Why it happens:** Coding AI agents like Claude Code and Codex often write 10-50 files in a single burst. Each file write generates multiple events (create, write, close). At 50 files with 3 events each, that is 150 events in under a second. The 64KB buffer fills and the OS drops everything.

**Consequences:** The app shows stale data. Agents appear idle when they are actively writing. Conflicts go undetected because the watcher missed one agent's writes entirely. This is the single most dangerous failure mode because it is silent -- no error, no crash, just missing data.

**Prevention:**
- Use notify-rs in Rust (not chokidar in JS) to process events as close to the OS as possible with minimal overhead
- Implement a dedicated watcher thread that does nothing but drain the OS buffer into an internal queue -- separate reception from processing
- Set the largest buffer size possible (64KB on Windows)
- Implement periodic filesystem snapshots (every 5-10 seconds) as a reconciliation layer -- compare actual file mtimes against last-known state to catch any missed events
- Surface a "sync confidence" indicator in the UI so the user knows when the watcher may have gaps

**Detection:** Compare event-derived file state against periodic `fs::metadata` checks. If files have newer mtimes than your last recorded event, you missed events.

**Phase impact:** Must be addressed in the filesystem watcher foundation phase (Phase 1-2). Retrofitting reconciliation is painful.

**Confidence:** HIGH -- documented extensively in [Microsoft docs](https://learn.microsoft.com/en-us/answers/questions/1428660/readdirectorychangesw-stops-working-on-large-amoun), [.NET runtime issues](https://github.com/dotnet/corefx/issues/1880), and [Tresorit engineering blog](https://medium.com/tresorit-engineering/how-to-get-notifications-about-file-system-changes-on-windows-519dd8c4fb01).

---

### Pitfall 2: Tauri IPC Serialization Bottleneck Under High-Frequency Events

**What goes wrong:** Every file event from the Rust backend must cross the IPC boundary to reach the React frontend. Tauri's invoke/event system serializes data to JSON by default. At hundreds of events per second (normal for an active coding agent), the serialization overhead dominates, causing the UI to lag 3-10 seconds behind reality and eventually freeze.

**Why it happens:** Developers build the happy path first (one event at a time), test with manual file saves, then discover the system collapses when a real agent writes 50 files in 2 seconds. Benchmarks show Windows IPC can take ~200ms for 10MB payloads versus ~5ms on macOS, making this especially bad on the primary target platform.

**Consequences:** The "real-time" radar view becomes a delayed replay. Conflict detection fires too late -- by the time the frontend knows about overlapping edits, both agents have already moved on. Users lose trust in the tool's accuracy.

**Prevention:**
- Batch and throttle events in Rust before crossing IPC -- aggregate file events into 100ms windows and send a single batch update
- Use Tauri v2 channels (streaming API) rather than individual invoke calls for continuous data flows
- Use Tauri v2 raw byte transfer for large payloads instead of JSON serialization
- Keep the Rust backend as the source of truth for conflict detection -- do not rely on the frontend receiving every event to detect conflicts
- Profile IPC throughput early with realistic agent workloads (50+ files/second), not just manual testing

**Detection:** Measure the time delta between a file event occurring (Rust side timestamp) and the UI updating. If this exceeds 500ms consistently, you have an IPC bottleneck.

**Phase impact:** Architecture decision needed in Phase 1. The choice of where conflict detection logic runs (Rust vs. JS) must be made before building either.

**Confidence:** HIGH -- documented in [Tauri IPC discussion #7146](https://github.com/tauri-apps/tauri/discussions/7146), [Tauri IPC discussion #11915](https://github.com/orgs/tauri-apps/discussions/11915), and [wry IPC evaluation #767](https://github.com/tauri-apps/wry/issues/767).

---

### Pitfall 3: Orphaned Agent Processes After App Crash or Close

**What goes wrong:** When the traffic controller app spawns agent processes (Claude Code, Codex, OpenCode) and then crashes, is force-quit, or closes unexpectedly, the child agent processes keep running with no parent to manage them. On Windows, there is no automatic orphan cleanup like Unix's init process adoption.

**Why it happens:** Desktop apps crash. Users force-quit with Task Manager. Power outages happen. If you only clean up child processes in a graceful shutdown handler, you will leak processes in every non-graceful scenario.

**Consequences:** Zombie agent processes accumulate, consuming CPU and memory. Worse, they continue modifying files with no oversight -- the exact scenario this tool exists to prevent. On subsequent app launches, the app cannot distinguish between agents it should monitor versus orphaned agents from a previous session. This is documented in real-world tools: [Auto-Claude #1252](https://github.com/AndyMik90/Auto-Claude/issues/1252) and [OpenCode #11959](https://github.com/anomalyco/opencode/issues/11959) both suffer from this exact issue.

**Prevention:**
- On Windows, use Job Objects -- create a Win32 Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag. All child processes in the job are automatically killed when the parent's handle closes, even on crash
- Write a PID file/registry on launch containing all spawned agent PIDs with timestamps
- On startup, check for stale PID entries and offer to kill or adopt orphaned agents
- For externally-launched agents being monitored (not spawned), this is less critical but still track their PIDs to detect when they die
- Implement a heartbeat file that the controller updates every few seconds; agents can check this to self-terminate if the controller disappears

**Detection:** On app startup, scan for processes matching known agent signatures that were started by a previous instance of the controller. The PID file from the previous session makes this straightforward.

**Phase impact:** Must be designed into the agent launcher from day one (Phase 2-3). Retrofitting process group management is a rewrite of the spawn logic.

**Confidence:** HIGH -- well-documented OS behavior, confirmed by real desktop AI tool bug reports.

---

### Pitfall 4: Conflict Detection Races -- Detecting Too Late or Not At All

**What goes wrong:** The detect-and-resolve strategy (chosen over preventive locking) has a fundamental timing problem: by the time the system detects that two agents have edited the same file, both agents may have already built further changes on top of their conflicting edits. Asking Agent B to merge at that point may invalidate 10 subsequent files it wrote.

**Why it happens:** File watcher events arrive asynchronously with variable latency (see Pitfall 1 and 2). Agent A writes `foo.ts` at T=0. The event arrives at T=0.3s. Agent B writes `foo.ts` at T=0.2s. The event arrives at T=0.5s. The conflict is detected at T=0.5s, but both agents have moved on by T=0.3s.

**Consequences:** Merge resolution becomes exponentially harder the more files are built on top of a conflict. A single undetected conflict in a shared utility file can cascade into dozens of incompatible changes across both agents' work.

**Prevention:**
- Run conflict detection in Rust, not in the frontend -- minimize latency between event reception and detection
- Implement a "conflict window" concept: when Agent A touches a file, open a short monitoring window (2-5 seconds) where any other agent touching that file triggers an immediate alert
- Store file content snapshots (or hashes) at each write event so you can always reconstruct what each agent saw when it made its edit
- Consider a lightweight "soft lock" notification: when Agent A starts editing a file, notify the user (not the agent) that the file is "hot" -- this is not preventive locking but gives the human operator awareness
- Track file dependency graphs: if `foo.ts` is edited by Agent A, flag files that import `foo.ts` as elevated-risk zones

**Detection:** Monitor the average time between a file write and conflict detection. If it exceeds 1 second, the detection pipeline is too slow. Track how many files each agent modifies after a conflict is detected but before it is surfaced to the user.

**Phase impact:** Core conflict detection architecture (Phase 2-3). The data model for tracking file ownership over time must be designed early.

**Confidence:** MEDIUM -- this is an architectural reasoning pitfall rather than a documented bug, but it follows directly from the async nature of file watching.

---

## Moderate Pitfalls

---

### Pitfall 5: React DOM Thrashing on the Radar/Spatial View

**What goes wrong:** The "Airspace Radar" view plots agents as dots on a spatial file-tree map. With a 10K+ file codebase, hundreds of visible nodes, and agents generating dozens of events per second, naive React rendering causes the UI to stutter or freeze. SVG-based rendering creates a DOM element per node, and React's reconciliation cannot keep up.

**Prevention:**
- Use HTML5 Canvas or WebGL for the radar view, not SVG or DOM elements -- canvas renders directly to pixels without DOM overhead
- Virtualize the file tree: only render nodes currently visible in the viewport (react-vtree, react-arborist, or a custom solution)
- Throttle UI updates to requestAnimationFrame (16ms intervals) -- batch all state changes from the last frame into a single render
- Separate the radar animation layer (canvas, 60fps) from the data layer (React state, updated on events) -- do not re-render React on every file event
- Use `React.memo` and `useMemo` aggressively on tree node components if using DOM-based rendering for any sub-views

**Detection:** Profile with React DevTools Profiler. If any render cycle exceeds 16ms, the UI will drop frames. Monitor FPS during realistic agent activity.

**Phase impact:** UI architecture decision in Phase 1 (canvas vs DOM). Switching rendering strategies later is effectively a rewrite of the radar component.

**Confidence:** HIGH -- well-documented React performance pattern. See [react-vtree](https://github.com/Lodin/react-vtree) and [Medium article on fast treeview](https://medium.com/@fiffty/things-i-learned-while-trying-to-make-a-fast-treeview-in-react-e3b23cd4ab74).

---

### Pitfall 6: Chokidar Memory Explosion on Large Codebases

**What goes wrong:** If file watching is implemented in the JavaScript/Node layer (via chokidar in the webview or a sidecar), watching 10K+ files consumes 400MB-3GB of RAM and pegs CPU at 50%+ when polling is enabled.

**Prevention:**
- Do NOT use chokidar or any JS-based file watcher. Use Rust's notify-rs crate in the Tauri backend. This uses native OS APIs (ReadDirectoryChangesW on Windows, inotify on Linux, FSEvents on macOS) with minimal overhead
- Implement glob-based ignore patterns in Rust before events reach JS -- exclude `node_modules`, `.git`, `dist`, `build`, and other generated directories
- Watch at the directory level with recursive mode rather than adding individual file watchers
- Set a hard memory budget and monitor RSS -- if the watcher process exceeds 200MB, something is wrong

**Detection:** Monitor process memory over time. A healthy Rust-based watcher for a 10K file codebase should use under 50MB. If memory grows linearly with file count, you are likely storing per-file state that should be aggregated.

**Phase impact:** Technology choice in Phase 1. This is a "choose once" decision.

**Confidence:** HIGH -- extensively documented: [chokidar #1162](https://github.com/paulmillr/chokidar/issues/1162) (100K files = 1GB RAM), [chokidar #849](https://github.com/paulmillr/chokidar/issues/849), [chokidar #922](https://github.com/paulmillr/chokidar/issues/922).

---

### Pitfall 7: SQLite Locking Under Concurrent Reads and Writes

**What goes wrong:** The Rust backend writes session history, file events, and conflict logs to SQLite while the frontend reads the same data for display. Without WAL mode, readers block writers and vice versa, causing the event processing pipeline to stall on database writes.

**Prevention:**
- Enable WAL (Write-Ahead Logging) mode immediately on database creation: `PRAGMA journal_mode=WAL;`
- Set `PRAGMA busy_timeout=5000;` to avoid immediate "database is locked" errors
- Use a single writer connection wrapped in a Mutex in Rust -- do not open multiple write connections
- Allow multiple read connections (WAL mode supports concurrent reads with one writer)
- Batch event inserts -- do not insert one row per file event; buffer 100ms of events and insert in a single transaction
- Implement data retention policies early -- event logs grow fast at hundreds of events per second; prune events older than 24-48 hours or archive them

**Detection:** Log any "database is locked" errors. Monitor write latency -- if single inserts exceed 10ms, you need batching.

**Phase impact:** Database setup in Phase 1-2. WAL mode is a one-line pragma but must be set from the start.

**Confidence:** HIGH -- SQLite concurrency is extremely well-documented. See [SQLite WAL docs](https://www.sqlite.org/wal.html).

---

### Pitfall 8: Agent Adapter Abstraction That Does Not Abstract

**What goes wrong:** The "extensible adapter architecture" is designed around the first three agents (Claude Code, Codex, OpenCode), and the abstraction accidentally encodes assumptions specific to those agents. When a fourth agent is added, it does not fit the adapter interface and requires either a hacky workaround or a refactor.

**Why it happens:** Every agent has different lifecycle patterns. Claude Code uses a hooks system. Codex has a CLI interface. OpenCode has its own patterns. The temptation is to build a union of all three agents' interfaces, but that union is not a true abstraction -- it is just "what these three agents happen to share."

**Prevention:**
- Define the adapter interface from the controller's perspective (what does the controller need from ANY agent?) not the agent's perspective (what does Claude Code expose?)
- The adapter interface should be minimal: spawn/attach, get status, list modified files, send approval/denial. Everything else is adapter-internal
- Do NOT expose agent-specific concepts (hooks, CLI flags, API endpoints) in the shared interface
- Build the fourth agent adapter mentally before shipping the first three -- if you cannot imagine how a generic "shell script that edits files" would fit your adapter interface, it is too specific
- Prefer composition over inheritance: adapters should be collections of capabilities (canSpawn, canObserve, canApprove) rather than a single rigid interface

**Detection:** Code review the adapter interface. If any method signature contains the name of a specific agent or a concept unique to one agent, the abstraction is leaking.

**Phase impact:** Architecture phase (Phase 1-2). The adapter interface shapes everything downstream.

**Confidence:** MEDIUM -- general software engineering principle applied to this specific domain. No direct source, but informed by the project's stated design goal.

---

## Minor Pitfalls

---

### Pitfall 9: Tauri Permission System Blocks Filesystem Access

**What goes wrong:** Tauri v2 introduced a granular permission system. Developers forget to declare filesystem permissions in `tauri.conf.json` and `capabilities`, resulting in runtime errors when the app tries to watch arbitrary directories. This is especially confusing because it works in development mode but fails in production builds.

**Prevention:**
- Configure filesystem permissions in capabilities from the start
- Test with a production build early (not just `tauri dev`)
- Request broad filesystem scope since the app must watch any user-selected codebase directory

**Detection:** Any `PermissionDenied` or capability errors in the console during file operations.

**Phase impact:** Initial project setup (Phase 1).

**Confidence:** HIGH -- documented in [Tauri v2 security docs](https://v2.tauri.app/security/lifecycle/).

---

### Pitfall 10: The "Command Horizon" Dark Theme Hides Information

**What goes wrong:** The phosphor-green-on-black ATC aesthetic looks stunning in wireframes but can cause readability problems in practice. Low-contrast color schemes cause eye strain during extended use. Merge diffs and conflict resolution views need high contrast to be usable. Status indicators using only color (green/amber/red) fail for colorblind users.

**Prevention:**
- Test all text at WCAG AA contrast ratios minimum (4.5:1 for normal text)
- Use brightness/saturation differences, not just hue, for status indicators
- Add shape and icon differentiation alongside color (triangle for warning, circle for OK)
- The conflict resolution / merge UI should use a high-contrast sub-theme -- the radar can be atmospheric, but the merge tool must be utilitarian
- Test with macOS/Windows accessibility audit tools

**Detection:** Use browser dev tools Lighthouse accessibility audit. Run contrast checks on every text element against its background.

**Phase impact:** Design system implementation (Phase 2-3). Easier to fix early than after all components are styled.

**Confidence:** MEDIUM -- general UX principle applied to this specific design system.

---

### Pitfall 11: Trying to Parse Agent Output Instead of Watching Files

**What goes wrong:** Developers try to understand what agents are doing by parsing their stdout/stderr or API responses, creating fragile integrations that break when agents update their output format. Each agent has a different output format, and the formats change between versions.

**Prevention:**
- Rely on filesystem watching as the universal source of truth -- every coding agent, regardless of its interface, ultimately reads and writes files
- Use agent-specific adapters only for lifecycle management (start/stop/status), not for understanding what files changed
- Agent output parsing should be a "nice to have" overlay, not a dependency for core conflict detection

**Detection:** If your conflict detection breaks when an agent updates its version, you are too coupled to agent output.

**Phase impact:** Agent adapter design (Phase 2).

**Confidence:** HIGH -- follows directly from the project's own design decision to use filesystem watchers over agent-specific APIs.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Filesystem watcher setup | Silent event loss on Windows (Pitfall 1) | Build reconciliation layer from day one; use notify-rs not chokidar |
| IPC architecture | Serialization bottleneck (Pitfall 2) | Batch events in Rust; use channels not invoke; profile with realistic load |
| Agent launcher | Orphaned processes (Pitfall 3) | Win32 Job Objects; PID tracking; startup orphan detection |
| Conflict detection | Race condition timing (Pitfall 4) | Detect in Rust, not JS; snapshot file content; conflict windows |
| Radar/spatial view | DOM thrashing (Pitfall 5) | Canvas/WebGL rendering; decouple animation from React state |
| Database layer | Write contention (Pitfall 7) | WAL mode; batched inserts; single writer connection |
| Adapter architecture | Over-specific abstraction (Pitfall 8) | Design interface from controller's needs; test with hypothetical 4th agent |
| Design system | Low-contrast readability (Pitfall 10) | WCAG AA minimum; shape+color indicators; high-contrast merge UI |

## Sources

- [Tauri v2 IPC Concept](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri IPC discussion #7146 - High rate data to frontend](https://github.com/tauri-apps/tauri/discussions/7146)
- [Tauri IPC discussion #11915 - Performance evaluation](https://github.com/orgs/tauri-apps/discussions/11915)
- [Tauri wry IPC improvements #767](https://github.com/tauri-apps/wry/issues/767)
- [Tauri v2 Security Lifecycle](https://v2.tauri.app/security/lifecycle/)
- [notify-rs GitHub](https://github.com/notify-rs/notify)
- [chokidar #1162 - 100K files memory](https://github.com/paulmillr/chokidar/issues/1162)
- [chokidar #849 - v3 memory](https://github.com/paulmillr/chokidar/issues/849)
- [chokidar #922 - High CPU and OOM](https://github.com/paulmillr/chokidar/issues/922)
- [ReadDirectoryChangesW buffer overflow - Tresorit](https://medium.com/tresorit-engineering/how-to-get-notifications-about-file-system-changes-on-windows-519dd8c4fb01)
- [.NET FileSystemWatcher buffering #14645](https://github.com/dotnet/corefx/issues/1880)
- [ReadDirectoryChangesW stops on large files - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1428660/readdirectorychangesw-stops-working-on-large-amoun)
- [SQLite WAL documentation](https://www.sqlite.org/wal.html)
- [Auto-Claude zombie processes #1252](https://github.com/AndyMik90/Auto-Claude/issues/1252)
- [OpenCode orphaned processes #11959](https://github.com/anomalyco/opencode/issues/11959)
- [react-vtree for virtualized trees](https://github.com/Lodin/react-vtree)
- [Fast treeview in React - Medium](https://medium.com/@fiffty/things-i-learned-while-trying-to-make-a-fast-treeview-in-react-e3b23cd4ab74)
