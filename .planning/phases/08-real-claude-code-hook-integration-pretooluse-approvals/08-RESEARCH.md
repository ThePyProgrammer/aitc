# Phase 8: Real Claude Code Hook Integration (PreToolUse approvals) - Research

**Researched:** 2026-04-15
**Domain:** External-process IPC (Claude Code hook contract) + long-held HTTP (axum) + Tauri v2 sidecar bundling
**Confidence:** HIGH on the locked decisions; MEDIUM on a few discretion-area details called out in the tables.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Hook Install + Shape
- **D-01:** Hook config is written to `cwd/.claude/settings.local.json` for every AITC-launched Claude Code agent. File is merged (not overwritten) — if it already exists with user hook entries, AITC inserts the PreToolUse entry without disturbing the rest. `.local.json` is git-ignored by Claude Code's conventions so the repo stays clean.
- **D-02:** Hook command points at a Rust sidecar binary (`aitc-hook`) shipped via Tauri v2's sidecar bundling. Absolute path is resolved at install time via `tauri::path::BaseDirectory::Resource` (or equivalent) and written into the settings.local.json `command` field. No curl/jq/node dependency on the user's machine; consistent cross-OS behavior; small single-purpose binary.
- **D-03:** Sidecar contract:
  - Reads Claude's PreToolUse JSON from stdin (includes `tool_name`, `tool_input`, Claude's session/PID context).
  - Resolves AITC port: checks `AITC_PORT` env var first, then reads `~/.aitc/port` (a text file AITC writes on every startup). Missing both → fail-safe deny + stderr "AITC not running".
  - Captures its own parent PID (= Claude's PID) and forwards it in the POST body so `/hook` can correlate to an AgentRegistry row.
  - POSTs to `http://127.0.0.1:{port}/hook` with `{pid, tool_name, tool_input, cwd}`.
  - Blocks on the response (long-held HTTP). On `{decision: "approve"}` exits 0 with Claude's approval JSON on stdout; on `{decision: "approve_with_edits", modified_input}` emits the modified_input JSON; on `{decision: "deny", reason}` exits 2 with the reason on stderr per Claude Code's hook contract.
- **D-04:** Passive-detected Claude coverage: when `passive_bridge::bridge_tick` observes a claude process AITC did not launch, the user is shown a one-time Tauri dialog prompt ("install AITC hook into {repo}/.claude/settings.local.json?"). On accept, AITC writes settings.local.json into that repo's cwd only. No global `~/.claude/settings.json` install in v1. Prompts are deduplicated per-repo (remembered via app_settings).
- **D-05:** On agent terminate, AITC does NOT clean up settings.local.json — it stays in place. Sidecar fails-safe deny if AITC is not running.
- **D-06:** `~/.aitc/port` file is written by AITC on every startup after `start_registration_server` returns the actual bound port. Plain text containing just the decimal port number. Located via `dirs::home_dir()`. Cleaned up on graceful shutdown via a `Drop` impl on a `PortFileGuard` helper.

#### Blocking Transport + Timeout
- **D-07:** `/hook` blocks via long-held HTTP response. Tokio `oneshot::channel` registered in a global `HashMap<approval_request_id, oneshot::Sender<HookDecision>>` held as `Arc<Mutex<..>>`. Approve/deny commands fire the sender by row id.
- **D-08:** No timeout. /hook waits indefinitely.
- **D-09:** Orphan cleanup via client-disconnect detection. `tokio::select!` between the oneshot and the connection-closed signal. On disconnect, mark row `status = 'abandoned'` (new value).
- **D-10:** Force-deny on user-initiated terminate. `terminate_process` extended: iterates the waiter HashMap for matching agent_id and fires `deny` before kill.
- **D-11:** Fail-safe deny when AITC unreachable. Sidecar exit 2 + reason "AITC unreachable" on any failure (port resolution, TCP connect, HTTP, non-2xx).
- **D-12:** Agent correlation: sidecar includes `pid` (its parent, Claude's PID) in POST. `/hook` looks up `KAGENT-{pid}` then `PASSIVE-{pid}`. If neither exists, creates a `PASSIVE-{pid}` stub on the fly (Phase 6 D-06 reuse).
- **D-13:** Waiter registry lives on a new shared struct accessible from both axum Extension and Tauri State. Suggested `Arc<Mutex<HashMap<i64, oneshot::Sender<HookDecision>>>>` on a new `hook_waiters.rs` module.

#### Tool Input Preview UI
- **D-14:** ApprovalRequestCard adds tool-name badge + single-line preview per tool (Edit/MultiEdit → first changed line, Write → first 50 chars, Bash → `$ command`, NotebookEdit → first 50 chars of new_source, Read/LS/etc on protected path → em-dash).
- **D-15:** Detail panel routes per tool via `ToolPreview` registry: Edit/MultiEdit reuse InlineDiff + approve_with_edits; Write/NotebookEdit syntax-highlighted via shiki; Bash command + description + cwd + timeout; Read/LS/Grep/Glob/WebFetch/WebSearch as key-value table; Unknown/MCP as pretty-printed JSON.
- **D-16:** Truncate >40 lines or >2 KB with `Show all` toggle. No external-editor fallback.
- **D-17:** `approve_with_edits` supported for Edit/MultiEdit only in v1. Modified content serialized as `modified_input` (Claude Code's PreToolUse contract).
- **D-18:** Deep-linked OS notification: `dispatch_approval_notification` includes `approval_request.id` payload. Click → focus window → navigate /comms → `selectRequest(id)`. Tray-icon click is fallback if platform notification onClick is unsupported.

#### Tool Scope + Noise Filtering
- **D-19:** Default gated tools: `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `Bash`. Read/LS/Grep/Glob/WebFetch/WebSearch/Task/MCP pass through.
- **D-20:** Tool allowlist stored in `app_settings` under key `pretool_gated_tools` as JSON array. No v1 UI for editing.
- **D-21:** OR semantics with protected_paths: gate if tool in allowlist OR file_path matches a protected_paths glob.
- **D-22:** "Always allow this session" per-tool checkbox on approve. In-memory `HashSet<(agent_id, tool_name)>` on the waiter registry. Cleared on agent terminate or AITC restart. Per-agent scoped. Not persisted.
- **D-23:** `--accept-edits` / `--dangerously-skip-permissions` chips bypass the per-launch settings.local.json install for that session.

### Claude's Discretion
- Exact merge logic for settings.local.json when file pre-exists (preserve user hooks, idempotent upsert).
- Sidecar binary name, bundling path, Tauri sidecar registration details.
- Exact shape of `HookDecision` and hook POST payload types (decision-level contract is locked; field names/casing are planner territory).
- Module name for waiter registry (`src-tauri/src/agents/hook_waiters.rs` or `src-tauri/src/comms/hook_bridge.rs`).
- Whether pretool_use rows live alongside write_access rows in RequestQueue or in a dedicated tab.
- How to detect client disconnect in axum (several patterns exist).
- Exact glob-match library for protected_paths in /hook context (reuse Phase 4's existing engine).
- Whether `~/.aitc/port` includes additional metadata (pid, version) or just the port number.
- UI placement for "Don't ask again this session" checkbox.

### Deferred Ideas (OUT OF SCOPE)
- Global `~/.claude/settings.json` install — rejected for v1.
- PostToolUse hook gating — explicitly out of scope per ROADMAP.md.
- Codex / OpenCode hook gating — no hook surface yet in those tools.
- Multi-user auth on `/hook` — single-user + localhost-bound.
- Full settings UI for `pretool_gated_tools` — deferred.
- Persisted "always allow for this path" across sessions.
- Per-tool timeout customization.
- Destructive-pattern highlighting on Bash previews — deferred to Phase 9+.
- Tool call history audit log (separate telemetry stream).
- External-editor fallback for very large tool inputs.
- `~/.aitc/port` format extensions (pid, version, features).
- Settings screen for bypass chips.
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 8 carries forward the Phase 4 Comms Hub flow. No new milestone requirement IDs.

| ID | Description | Research Support |
|----|-------------|------------------|
| COMM-01 (extend) | Approval queue surfaces `pretool_use` rows alongside `write_access` rows. | DB migration (§Standard Stack), `create_approval_request_internal` reuse. |
| COMM-02 (extend) | Approve/deny/approve-with-edits resolves the pending `/hook` waiter, not just the DB row. | Waiter registry + signaling pattern (§Architecture Patterns Pattern 3). |
| COMM-03 (extend) | Per-tool preview replaces the generic InlineDiff for non-edit tools. | ToolPreview routing per D-15; tool_input shapes verified against Anthropic docs. |
| COMM-05 (extend) | OS notification deep-links to the originating request row. | tauri-plugin-notification limits + tray-icon fallback (§Pitfalls). |
| COMM-06 (extend) | "Approve with edits" returns `updatedInput` to Claude via the hookSpecificOutput envelope. | Verified contract (§Standard Stack — Claude Code hook contract). |
| AGNT-03 (extend) | Passive-detected Claude can be retro-fitted with a hook config via the consent prompt. | passive_bridge integration point (D-04). |
| SHELL-04 (extend) | Tray-icon click is the fallback notification path when platform onClick is unavailable. | Verified Windows toast onClick limitation (§Pitfalls). |
</phase_requirements>

## Summary

Phase 8 is not exotic. It is **three well-known patterns glued together**:

1. **External-process IPC over a Claude-defined contract** (PreToolUse hook). The contract is documented and stable as of Claude Code v2.0.10+. There is one critical correctness fact every plan must respect: the **modern PreToolUse contract uses `hookSpecificOutput.permissionDecision` with values `allow|deny|ask`, NOT the deprecated top-level `decision: "approve"|"block"`**. Returning `permissionDecision: "allow"` together with `updatedInput` is exactly the "approve with edits" semantic.
2. **A long-held HTTP request** in axum. Standard pattern: handler creates a `oneshot::channel`, registers the sender in a shared `Arc<Mutex<HashMap<i64, oneshot::Sender<_>>>>`, and `tokio::select!`s the receiver against a drop-detection guard. Hyper drops the handler future when the TCP socket closes — Drop on a guard inside the handler scope is the disconnect signal.
3. **A Tauri v2 sidecar binary** (`aitc-hook`) bundled via `bundle.externalBin` with target-triple-suffixed names. The sidecar is a small, single-purpose blocking-IO binary using `ureq` (smaller binary than `reqwest`).

The remaining work is mechanical: a 4th DB migration adding `tool_name`, `tool_input_json`, and the `'abandoned'` status; a tiny port-file writer + Drop guard; per-launch settings.local.json merge using `serde_json::Value` (hand-rolled deep merge — `json-patch`'s RFC 7396 has the wrong semantics for arrays, see Pitfall 4); and a per-tool `ToolPreview` React component registry that reuses the existing InlineDiff and shiki hooks from Phases 4 and 5.

**Primary recommendation:** Plan around the **modern hookSpecificOutput envelope from day one** — never emit the deprecated top-level `decision`/`reason` fields, and never accept the legacy approve/block strings from the UI side. Lock that decision in the type system: a single `enum HookDecision { Allow, AllowWithEdits(serde_json::Value), Deny(String) }` translates 1:1 to the canonical stdout JSON.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `axum` | 0.8 (already pinned) | Add `/hook` route alongside `/register` | Already in use; hyper-based; handler future is dropped on TCP close which is the foundation for D-09. [VERIFIED: src-tauri/Cargo.toml] |
| `tokio` `sync::oneshot` | 1.x (already pinned) | Per-request signal channel between `/hook` handler and approve/deny commands | Standard idiom for one-shot async response correlation. [CITED: docs.rs/tokio sync::oneshot] |
| `serde_json` | 1.0.149 (verified current) | Stdin/stdout JSON parsing in sidecar; settings.local.json merge | Already pinned. `serde_json::Value` deep merge is ~30 lines hand-rolled and avoids the RFC 7396 array-replacement footgun. [VERIFIED: cargo search 2026-04-15] |
| `tauri-plugin-shell` | 2.3.5 | Resolve sidecar absolute path at runtime via `app.shell().sidecar("aitc-hook")` | Required for sidecar lookup in Tauri v2; not currently a dependency — must be added. [VERIFIED: cargo search 2026-04-15; CITED: v2.tauri.app/develop/sidecar] |

### Sidecar (new `src-tauri/aitc-hook/` crate)
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `serde` + `serde_json` | 1.x | Stdin parse + stdout emit | Mandatory for the contract. |
| `ureq` | 3.3.0 | Blocking HTTP POST to AITC `/hook` | Synchronous, ~2 MB stripped binary, minimal deps. The sidecar runs once per tool call, exits, and never needs async. [VERIFIED: cargo search; CITED: github.com/algesten/ureq] |
| `anyhow` | 1.0.102 | Error plumbing in main() | Standard for binary-style error reporting. [VERIFIED: cargo search] |
| `dirs` | 6.0.0 | Cross-platform `~/.aitc/port` resolution (Windows: `C:\Users\X\.aitc\port`) | The de facto standard for home-dir resolution. [VERIFIED: cargo search] |
| `tracing` | 0.1 (workspace) | Optional structured stderr logging from the sidecar | Already used in main crate; consistent. [VERIFIED: src-tauri/Cargo.toml] |

**Reqwest is NOT recommended for the sidecar** — it pulls tokio + hyper + native-tls and inflates the binary by ~50%. The sidecar has no need for async; it runs once and exits. [CITED: medium.com/os-systems benchmark]

### Backend additions to `src-tauri/Cargo.toml`
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `dirs` | 6.0.0 | Same `~/.aitc/port` resolution from the main app side | Symmetric with sidecar. [VERIFIED] |
| `tauri-plugin-shell` | 2.3.5 | `app.shell().sidecar("aitc-hook")` to resolve the absolute path that gets baked into settings.local.json | Required to know what to write. Already a transitive dep of Tauri but must be added explicitly with permissions. [CITED: v2.tauri.app/develop/sidecar] |

### Frontend (no new deps required)
| Library | Reuse from Phase | Purpose |
|---------|------------------|---------|
| `motion` | Phase 1 | Tool-name badge entry animation (parity with UrgencyBadge). |
| `shiki` (via `useSyntaxHighlight`) | Phase 5 | Code preview for Write/Bash/NotebookEdit/MCP-JSON. |
| Existing `InlineDiff` | Phase 4 | Edit/MultiEdit detail panel — reused as-is per D-15. |
| `lucide-react` | Phase 1 | Tool-type icons in the badge (Bash → Terminal, Write → FilePlus, Edit → Edit3, etc.). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ureq` in sidecar | `reqwest` (blocking feature) | Bigger binary (~+1 MB), drags tokio+hyper. No benefit for one-shot exec. |
| Hand-rolled JSON merge | `json-patch` (RFC 7396) / `json_value_merge` | RFC 7396 **replaces** arrays wholesale, which would clobber the user's existing `hooks.PreToolUse` list. Hand-rolled `Value` recursion with array-concat-with-dedup matches Claude Code's documented merge semantics. [CITED: code.claude.com/docs/en/settings] |
| Polling for hook decisions | Long-held HTTP (D-07) | Polling wastes CPU and adds latency. Localhost long-held HTTP is exactly the right transport. |
| Top-level `{decision, reason}` JSON | `hookSpecificOutput.permissionDecision` envelope | The top-level form is **deprecated for PreToolUse**. Modern form is mandatory. [CITED: claude.com/blog/how-to-configure-hooks] |
| Custom Windows toast crate (`windows-toast`) | `tauri-plugin-notification` v2 + tray-icon fallback | tauri-plugin-notification has no desktop onClick (Pitfall 9). Bringing the window to focus from the tray icon is sufficient for "click to open AITC and see the request." |

**Installation:**

```toml
# src-tauri/Cargo.toml — additions
[dependencies]
dirs = "6"
tauri-plugin-shell = "2"

[workspace]
members = ["aitc-hook"]
```

```toml
# src-tauri/aitc-hook/Cargo.toml — new file
[package]
name = "aitc-hook"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
ureq = "3"
anyhow = "1"
dirs = "6"

[profile.release]
opt-level = "z"
lto = true
strip = true
panic = "abort"
```

**Version verification (2026-04-15):**
- `axum` 0.8.9 — already pinned at "0.8" (range OK)
- `tokio` 1.52.0 — already pinned at "1"
- `serde_json` 1.0.149
- `tauri-plugin-shell` 2.3.5
- `dirs` 6.0.0
- `ureq` 3.3.0
- `anyhow` 1.0.102
- `tauri-plugin-notification` (npm side `@tauri-apps/plugin-notification`) 2.3.3 — already at v2

## Architecture Patterns

### Recommended Project Structure

```
src-tauri/
├── aitc-hook/                          # New: sidecar crate
│   ├── Cargo.toml
│   └── src/
│       └── main.rs                     # stdin parse → POST /hook → stdout/exit
├── src/
│   ├── agents/
│   │   ├── self_register.rs            # Add /hook route + extension layer
│   │   ├── hook_waiters.rs             # NEW: WaiterRegistry + AlwaysAllowSet
│   │   ├── hook_install.rs             # NEW: settings.local.json merge writer
│   │   ├── port_file.rs                # NEW: ~/.aitc/port writer + Drop guard
│   │   ├── claude_code.rs              # Call hook_install on launch (unless bypass)
│   │   └── launcher.rs                 # Force-deny waiters in terminate_process
│   ├── comms/
│   │   ├── commands.rs                 # approve/deny/approve_with_edits signal waiters
│   │   └── types.rs                    # ApprovalRequest gains tool_name, tool_input_json
│   ├── pipeline/
│   │   └── passive_bridge.rs           # Emit "passive-claude-detected" for D-04 prompt
│   └── db/migrations/
│       └── 005_pretool_use_hooks.sql   # NEW: columns + 'abandoned' status
└── tauri.conf.json                     # bundle.externalBin += aitc-hook

src/
├── views/CommsHub/
│   ├── ApprovalRequestCard.tsx         # + tool-name badge + preview line
│   ├── ToolPreview/                    # NEW: per-tool renderer registry
│   │   ├── index.tsx                   # routing by tool_name
│   │   ├── EditPreview.tsx             # reuses InlineDiff
│   │   ├── WritePreview.tsx
│   │   ├── BashPreview.tsx
│   │   ├── NotebookPreview.tsx
│   │   ├── ProtectedPathPreview.tsx    # for Read/LS/Grep/Glob on protected paths
│   │   └── UnknownToolPreview.tsx      # MCP + fallback
│   └── ApprovalActions.tsx             # + "Don't ask again this session" checkbox
├── components/ui/
│   └── ToolBadge.tsx                   # NEW: Command Horizon phosphor accent badge
└── stores/commsStore.ts                # ApprovalRequest gains toolName, toolInputJson; sessionAlwaysAllow Map
```

### Pattern 1: Long-held HTTP with disconnect detection (D-07, D-09)

**What:** axum handler awaits a oneshot receiver while also racing against a drop-detection guard so a TCP close cancels the wait.

**When to use:** /hook route — every PreToolUse intercept.

**Example (canonical for this phase):**

```rust
// src-tauri/src/agents/hook_waiters.rs
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

#[derive(Clone, Debug)]
pub enum HookDecision {
    Allow,
    AllowWithEdits(serde_json::Value), // updatedInput payload
    Deny(String),                      // reason
}

#[derive(Default)]
pub struct WaiterRegistry {
    waiters: Mutex<HashMap<i64, oneshot::Sender<HookDecision>>>,
    always_allow: Mutex<HashSet<(String, String)>>, // (agent_id, tool_name)
}

impl WaiterRegistry {
    pub async fn register(&self, id: i64, tx: oneshot::Sender<HookDecision>) {
        self.waiters.lock().await.insert(id, tx);
    }
    pub async fn signal(&self, id: i64, d: HookDecision) -> bool {
        if let Some(tx) = self.waiters.lock().await.remove(&id) {
            tx.send(d).is_ok()
        } else { false }
    }
    pub async fn signal_for_agent(&self, agent_id: &str, d: HookDecision)
        -> Vec<i64>
    {
        // Used by terminate_process (D-10). Caller looks up row IDs by agent_id
        // from the DB, then calls signal() for each. Or iterate here if we
        // store agent_id alongside the sender. Planner picks.
        unimplemented!("planner: pick storage shape for agent->id lookup")
    }
}
```

```rust
// src-tauri/src/agents/self_register.rs (new handler)
use axum::extract::Extension;

async fn hook_handler(
    Extension(reg): Extension<Arc<WaiterRegistry>>,
    Extension(pool): Extension<sqlx::SqlitePool>,
    Extension(app): Extension<tauri::AppHandle>,
    Extension(agents): Extension<Arc<AgentRegistry>>,
    Json(body): Json<HookRequest>,
) -> impl IntoResponse {
    // 1. Resolve / auto-create agent row (PASSIVE-{pid} stub if needed) (D-12)
    let agent_id = resolve_or_create_agent(&agents, body.pid, &body.cwd, &pool).await;

    // 2. Pass-through fast paths
    if !is_gated(&body.tool_name, &body.tool_input, &pool).await {
        return Json(HookDecision::Allow).into_response();
    }
    if reg.is_always_allowed(&agent_id, &body.tool_name).await {
        return Json(HookDecision::Allow).into_response();
    }

    // 3. Insert pretool_use row, get id
    let req = create_approval_request_internal(
        &agent_id, "pretool_use",
        body.tool_input.get("file_path").and_then(|v| v.as_str()),
        /* diff_content */ None,
        "high", &pool, &app,
        Some(&body.tool_name), Some(&body.tool_input),  // new params
    ).await.unwrap();

    // 4. Register oneshot
    let (tx, rx) = oneshot::channel();
    reg.register(req.id, tx).await;

    // 5. Drop guard — when handler future is dropped (client disconnect),
    //    we mark the row 'abandoned' and clean the registry entry.
    struct AbandonGuard {
        id: i64,
        reg: Arc<WaiterRegistry>,
        pool: sqlx::SqlitePool,
        triggered: bool,
    }
    impl Drop for AbandonGuard {
        fn drop(&mut self) {
            if !self.triggered {
                let id = self.id;
                let reg = self.reg.clone();
                let pool = self.pool.clone();
                tokio::spawn(async move {
                    reg.signal(id, HookDecision::Deny("client disconnected".into())).await;
                    let _ = sqlx::query(
                        "UPDATE approval_requests SET status='abandoned', \
                         resolved_at=datetime('now') WHERE id=? AND status='pending'"
                    ).bind(id).execute(&pool).await;
                });
            }
        }
    }
    let mut guard = AbandonGuard { id: req.id, reg: reg.clone(), pool: pool.clone(), triggered: false };

    // 6. Await — if the client disconnects, hyper drops this future and the
    //    guard fires. If the user resolves, the oneshot fires first.
    let decision = match rx.await {
        Ok(d) => { guard.triggered = true; d }
        Err(_) => HookDecision::Deny("waiter channel closed".into()),
    };

    Json(decision).into_response()
}
```

**Source for the disconnect-via-drop pattern:** [github.com/tokio-rs/axum/discussions/1094] — "If the client closes the connection before the server sends a response, hyper will stop calling poll and drop the response future."

### Pattern 2: Sidecar binary lifecycle (D-02, D-03, D-11)

**What:** A 100-line `main.rs` that does parse → resolve port → POST → translate.

```rust
// src-tauri/aitc-hook/src/main.rs
use std::io::{self, Read, Write};
use std::process::ExitCode;
use serde_json::Value;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::from(0),
        Err(reason) => {
            eprintln!("{reason}");
            ExitCode::from(2) // Claude Code: 2 = block with stderr as reason
        }
    }
}

fn run() -> Result<(), String> {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).map_err(|e| format!("stdin read: {e}"))?;
    let claude_event: Value = serde_json::from_str(&buf).map_err(|e| format!("stdin parse: {e}"))?;

    let port = resolve_port().ok_or("AITC unreachable: no port")?;
    let pid = std::process::id(); // sidecar PID — but parent PID is what we want
    let parent_pid = parent_pid().unwrap_or(pid);

    let body = serde_json::json!({
        "pid": parent_pid,
        "tool_name": claude_event.get("tool_name"),
        "tool_input": claude_event.get("tool_input"),
        "cwd": claude_event.get("cwd"),
        "session_id": claude_event.get("session_id"),
    });

    let resp = ureq::post(&format!("http://127.0.0.1:{port}/hook"))
        .send_json(body)
        .map_err(|e| format!("AITC unreachable: {e}"))?;

    let decision: AitcDecision = resp.into_body().read_json()
        .map_err(|e| format!("AITC bad response: {e}"))?;

    match decision {
        AitcDecision::Allow => {
            // Modern envelope. NEVER emit deprecated top-level decision.
            let out = serde_json::json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow"
                }
            });
            writeln!(io::stdout(), "{}", out).ok();
            Ok(())
        }
        AitcDecision::AllowWithEdits { updated_input } => {
            let out = serde_json::json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "updatedInput": updated_input
                }
            });
            writeln!(io::stdout(), "{}", out).ok();
            Ok(())
        }
        AitcDecision::Deny { reason } => Err(reason),
    }
}

fn resolve_port() -> Option<u16> {
    if let Ok(s) = std::env::var("AITC_PORT") {
        if let Ok(p) = s.parse() { return Some(p); }
    }
    let path = dirs::home_dir()?.join(".aitc").join("port");
    let s = std::fs::read_to_string(path).ok()?;
    s.trim().parse().ok()
}
```

### Pattern 3: Cross-DI shared state (D-13)

**What:** A single `Arc<WaiterRegistry>` registered both as axum `Extension` (for /hook handler) and as Tauri managed state (for approve/deny commands).

```rust
// In lib.rs setup
let waiter_registry = Arc::new(WaiterRegistry::default());

// Tauri side
.manage(waiter_registry.clone())

// axum side — pass into start_registration_server
start_registration_server(registry, pool, port, waiter_registry.clone()).await?;
// inside, layer it as Extension(waiter_registry)
```

```rust
// In comms/commands.rs (approve_request etc.)
#[tauri::command]
pub async fn approve_request(
    id: i64,
    pool: tauri::State<'_, Pool<Sqlite>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    sqlx::query("UPDATE approval_requests SET status='approved', resolved_at=datetime('now') WHERE id=?")
        .bind(id).execute(pool.inner()).await
        .map_err(|e| format!("approve_request: {e}"))?;
    waiters.signal(id, HookDecision::Allow).await; // fire the /hook waiter
    let _ = app.emit("approval-resolved", id);
    Ok(())
}
```

### Pattern 4: settings.local.json merge

**What:** Read existing JSON, deep-merge AITC's PreToolUse entry, write atomically.

```rust
// src-tauri/src/agents/hook_install.rs
pub fn install_aitc_hook(cwd: &Path, sidecar_abs_path: &str) -> Result<()> {
    let path = cwd.join(".claude").join("settings.local.json");
    std::fs::create_dir_all(path.parent().unwrap())?;

    let mut existing: serde_json::Value = if path.exists() {
        serde_json::from_str(&std::fs::read_to_string(&path)?)?
    } else {
        serde_json::json!({})
    };

    let aitc_entry = serde_json::json!({
        "matcher": "*",  // gate all tools; AITC filters server-side
        "hooks": [{
            "type": "command",
            "command": sidecar_abs_path,
            // No timeout — we want long-held responses.
        }]
    });

    upsert_pretool_entry(&mut existing, aitc_entry);  // see Pitfall 4

    // Atomic write: tmp + rename
    let tmp = path.with_extension("local.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&existing)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}
```

### Anti-Patterns to Avoid

- **Emitting the deprecated top-level `{"decision": "approve"}` JSON.** It works on older Claude Code but is the wrong target — modern Claude Code v2.x expects `hookSpecificOutput.permissionDecision`. Mixed fleets will silently misbehave.
- **Polling /hook from the sidecar.** Long-held HTTP is the right transport; polling wastes wakeups and misses fast-path responses.
- **Storing the sidecar's own PID instead of parent PID in the POST body.** The sidecar is invoked per-tool-call by Claude as a child process. AITC needs Claude's PID, not the sidecar's. Use `getppid()` (Unix) / `GetCurrentProcessId` then walk parent (Windows via `windows` crate or shell out to `wmic`). Simpler: pass it in from settings.local.json with `${CLAUDE_PROCESS_ID}` if Claude exposes it — **but verify, this is unconfirmed** (see Open Questions).
- **Using `json-patch`'s RFC 7396 merge for settings.local.json.** RFC 7396 replaces arrays wholesale, clobbering user's existing `PreToolUse` list. Hand-roll the merge.
- **Writing the port file before the server actually binds.** Always write *after* `start_registration_server` returns the actual bound port.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform home dir | OS-specific path code | `dirs` crate | Standard Rust answer; handles Windows roaming profile, macOS HOME-vs-NSHomeDirectory, XDG fallback. |
| HTTP client in sidecar | Raw TCP + manual HTTP | `ureq` | Saves binary size vs reqwest, keeps complexity low. |
| One-shot async response coordination | Channels + manual state machines | `tokio::sync::oneshot` | Designed exactly for this. |
| Cross-platform sidecar bundling | Custom installer | `tauri.conf.json` `bundle.externalBin` | Tauri v2 handles target-triple naming and platform resolution automatically. |
| Settings.local.json file write | `fs::write` directly | tmp-file-then-rename | Atomic; survives crash mid-write; standard "atomic write" idiom. |
| Notification onClick deep-link on Windows | Custom WinRT toast crate | tauri-plugin-notification + tray-icon click fallback | WinRT toast onClick is unsupported in tauri-plugin-notification v2; tray-icon click is "good enough" for solo-user UX. (See Pitfall 9.) |
| Glob matching for protected_paths in /hook | New glob library | Reuse `glob = "0.3"` from Phase 4 | Already pinned, already used by protected_path_trigger. |

**Key insight:** This phase is small *because* the right libraries cover the hard parts. The single biggest "don't hand-roll" is **the deep-merge logic for settings.local.json** — but the standard merge crates are wrong for our shape, so this is the one place we *do* hand-roll, deliberately, ~30 lines.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) `approval_requests` table needs new columns + new status value `'abandoned'`; existing rows are unaffected. (2) `app_settings` gains the `pretool_gated_tools` key + `passive_hook_consent_repos` key for D-04 dedup. | Migration `005_pretool_use_hooks.sql`. Backfill: none (existing rows are write_access, not pretool_use; no defaults needed). |
| Live service config | `cwd/.claude/settings.local.json` for every repo where Claude is launched or detected. **AITC modifies user files** — first-run-in-repo state is "no AITC entry"; after launch it has one. Write must be merge-preserving (Pitfall 4). | Implement merge writer; do NOT cleanup on terminate (D-05). |
| OS-registered state | None — sidecar is invoked transiently by Claude per tool call; no service registration, no scheduled task, no launchd entry. The `~/.aitc/port` file is application-managed, not OS-registered. | None. |
| Secrets/env vars | `AITC_PORT` env var is already injected by `launch_detached` (Phase 3). Sidecar reads it via `std::env::var("AITC_PORT")` first; no rename needed. | None. Verify the env survives Claude's child-spawn of the sidecar (it does — Claude spawns the hook in its own env, which inherits AITC's via the launch chain). |
| Build artifacts | (1) New `aitc-hook` binary for each target triple (`aitc-hook-x86_64-pc-windows-msvc.exe`, `aitc-hook-x86_64-unknown-linux-gnu`, `aitc-hook-aarch64-apple-darwin`, `aitc-hook-x86_64-apple-darwin`). (2) Cargo workspace addition for the new crate. (3) `tauri-plugin-shell` permissions in `capabilities/default.json`. | CI must build all targets; absence of a target-triple binary will fail bundle. Document in plan. |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — Not applicable; this is a feature add, not a rename. But the mirror question for *this* phase is: *what user-machine state does AITC create that persists after AITC exits?* Answer: `~/.aitc/port` (cleaned by Drop guard), and per-repo `cwd/.claude/settings.local.json` AITC entries (intentionally NOT cleaned per D-05 — sidecar fail-safe-denies if AITC isn't running).

## Common Pitfalls

### Pitfall 1: Deprecated top-level `decision` field [HIGH severity]

**What goes wrong:** Sidecar emits `{"decision": "approve"}` (the format mentioned in the original CONTEXT.md D-03 wording). Newer Claude Code versions tolerate it for backward compat but the canonical, future-proof envelope is `hookSpecificOutput.permissionDecision`.

**Why it happens:** Pre-v2 Claude Code docs and many third-party tutorials still show the deprecated format. Easy to lift sample code that's wrong.

**How to avoid:** Lock the type system on emit — only ever construct the modern envelope. Plan PLAN should specify:
- `permissionDecision: "allow"` for approve
- `permissionDecision: "allow"` + `updatedInput: <obj>` for approve_with_edits
- `permissionDecision: "deny"` + `permissionDecisionReason: <str>` for deny *via stdout JSON*, OR exit code 2 + stderr (both are accepted; pick one — recommend exit code 2 for hard deny since it doesn't even attempt JSON parsing on Claude side)

**Warning signs:** Claude Code prints "Hook returned legacy format, please update" warning, or `updatedInput` is silently ignored.

[CITED: code.claude.com/docs/en/hooks — "PreToolUse previously used top-level decision and reason fields, but these are deprecated for this event. Use hookSpecificOutput.permissionDecision and hookSpecificOutput.permissionDecisionReason instead."]

### Pitfall 2: `updatedInput` requires Claude Code v2.0.10+ [MEDIUM severity]

**What goes wrong:** `approve_with_edits` is supported on the AITC side but the user's installed Claude Code is older — the modified input is ignored, Claude proceeds with the original.

**Why it happens:** Feature shipped in v2.0.10. Older Claude Code installations (pre-2025-Q1) don't honor `updatedInput`.

**How to avoid:** On AITC startup, run `claude --version`, parse the version, log a warning if < 2.0.10. Surface in TopBar status chip.

**Warning signs:** Edit/MultiEdit approve_with_edits silently produces unedited content in the file.

[CITED: claude.com/blog/how-to-configure-hooks — "Starting in v2.0.10, PreToolUse hooks can modify tool inputs before execution."]

### Pitfall 3: TCP-disconnect detection timing [MEDIUM severity]

**What goes wrong:** Hyper does NOT proactively poll the socket for closure. The handler future is dropped only when the runtime next attempts to poll the response future *and* the connection state has been observed as closed. Long-held responses without intermediate body writes can stall up to the OS TCP keepalive (often 2 hours) before disconnect is noticed.

**Why it happens:** Hyper's design — it relies on attempts to write to detect dead sockets.

**How to avoid:** Two options (planner picks):
1. **Body-keepalive heartbeat:** Send periodic empty whitespace bytes in the response body. axum response can be a stream; emit a `\n` every 5s so any close is detected within seconds.
2. **`hyper::body::Incoming::poll_frame` racing:** Spawn a parallel task that reads from the request body (which Claude has already finished sending). If `read_to_end` completes/errors, the connection is dead. Use that as a cancellation trigger via a `tokio::sync::watch` channel.

For Phase 8, **option 2 is recommended** because Claude doesn't expect any body content from us until decision is final, and option 1 risks corrupting the response JSON.

**Warning signs:** Killed Claude processes leave `pending` rows in the DB indefinitely; abandoned status never fires.

[CITED: tokio-rs/axum#1094 — "If the client closes the connection before the server sends a response, hyper will stop calling poll and drop the response future" — but the *triggering* of that polling is the catch.]

### Pitfall 4: Settings.local.json merge — array semantics [HIGH severity]

**What goes wrong:** Using `json-patch` (RFC 7396) to merge replaces the entire `hooks.PreToolUse` array, deleting the user's prior entries.

**Why it happens:** RFC 7396 specifies "to remove an array element, set it to null; to replace an array, provide the full new array." There is no in-place "append/upsert" semantic.

**How to avoid:** Hand-roll a tiny merger that:
1. Ensures `hooks` object exists.
2. Ensures `hooks.PreToolUse` array exists.
3. Walks the array looking for an entry whose `hooks[].command` equals our sidecar path → replace in place.
4. Otherwise, append our entry.

Idempotent: re-running install does not duplicate the entry.

**Warning signs:** User reports their custom hooks vanished after launching Claude through AITC.

[CITED: code.claude.com/docs/en/settings — "arrays are concatenated and de-duplicated; objects are deep-merged" — Claude Code's *runtime* merge of settings.json + settings.local.json works this way, but our *file write* must respect the same semantic.]

### Pitfall 5: PID width and the integer-truncation lesson [HIGH severity]

**What goes wrong:** Truncating PIDs (`pid % 10000`) for use in agent IDs causes collisions and breaks PASSIVE↔KAGENT reconciliation.

**Why it happens:** Old assumption that PIDs fit in 4 digits. Modern OSes have PIDs up to 4,194,304 (Linux `pid_max`) or 2^32 (Windows).

**How to avoid:** Use the **full PID** in `KAGENT-{pid}` and `PASSIVE-{pid}` ID format. This is the lesson from CR-01 (already fixed in `self_register.rs:111-114`). Phase 8 must not regress: the `/hook` handler's auto-create of `PASSIVE-{pid}` (D-12) MUST use the full PID.

**Warning signs:** Two unrelated agents collide on the same agent_id; approve fires the wrong waiter.

[VERIFIED: src-tauri/src/agents/self_register.rs:111-114 with explicit comment.]

### Pitfall 6: Sidecar binary path baked into settings.local.json becomes stale on AITC update [MEDIUM severity]

**What goes wrong:** AITC writes `/Applications/AITC.app/.../aitc-hook` into settings.local.json. AITC is updated; new install path differs (or version subdirectory rotates). Now the sidecar path is dead — Claude's hook fails to spawn, Claude proceeds unblocked (security regression).

**Why it happens:** Tauri Resource paths can be stable per-version but not necessarily across reinstalls. Auto-update tools (like Sparkle) sometimes change paths.

**How to avoid:**
- **Recommended:** Re-write settings.local.json on every Claude launch (not just first time). Idempotent merge means this is cheap.
- **Mitigation:** Have the sidecar's "command" entry be a wrapper that calls into a stable launcher script — adds complexity, not worth it for v1.
- **Detection:** On AITC startup, scan `app_settings.passive_hook_consent_repos` and re-install the hook in each known repo with the current sidecar path. Stale entries auto-heal next time the user opens AITC.

**Warning signs:** After updating AITC, Claude tool calls proceed without showing in Comms Hub.

### Pitfall 7: Sidecar parent PID detection is platform-specific [MEDIUM severity]

**What goes wrong:** The sidecar needs Claude's PID, not its own. `std::process::id()` returns the sidecar's PID. There is no stable cross-platform stdlib for parent PID.

**Why it happens:** Unix has `getppid()`; Windows requires `Toolhelp32Snapshot` or PowerShell.

**How to avoid:** Three options:
1. **Use `sysinfo` in the sidecar** — but it adds ~500 KB to the binary. Acceptable but not ideal.
2. **Set an env var on settings.local.json** — Claude Code might expose `${CLAUDE_PROCESS_ID}` or similar in the hook command env. **Unverified**, see Open Questions.
3. **Use `nix::unistd::getppid()` on Unix and Windows-specific code via the `windows` crate** — most reliable, ~50 lines of `#[cfg]` code.

Recommendation: **Option 3** — small, reliable, no extra runtime dep beyond `windows` crate (which is huge but feature-gated to specific calls and ends up small).

Actually, since the sidecar is a separate process tree, a better recommendation:

4. **Don't trust parent PID — use Claude's `session_id` from stdin.** Claude provides a stable session_id in the PreToolUse JSON (verified in the contract). Use `session_id` as the correlation key instead of pid. AITC tracks (session_id ↔ agent_id) via the first /hook call — first time we see a session_id, look up the *most recently launched* claude in that cwd, bind the session_id to that agent_id, store in WaiterRegistry. Subsequent calls with the same session_id resolve directly.

**Recommend option 4** — uses Claude's own contract instead of OS plumbing. Simpler, more robust.

**Warning signs:** Approval rows attached to wrong agent_id; force-deny on terminate doesn't deny the right session.

[VERIFIED: code.claude.com/docs/en/hooks lists `session_id` as a stdin field.]

### Pitfall 8: Race between approve and disconnect [LOW severity]

**What goes wrong:** User clicks approve at the same moment Claude's process dies. Drop guard fires, marks row 'abandoned'. Approve command fires `signal(id, Allow)` but `waiters` HashMap is empty (already removed by drop guard). Row status is 'abandoned' but UI reflects 'approved' optimistically.

**Why it happens:** Two concurrent paths into the same waiter slot.

**How to avoid:**
- Approve command performs UPDATE with WHERE clause on status: `UPDATE approval_requests SET status='approved' WHERE id=? AND status='pending'`. If 0 rows affected, the row was already abandoned/denied — log and emit a `approval-resolved` event with the actual status so UI re-syncs.
- Drop guard's UPDATE has the same WHERE clause to avoid clobbering an already-resolved row.

**Warning signs:** UI shows `approved` but DB is `abandoned`.

### Pitfall 9: Notification onClick is not supported on desktop in tauri-plugin-notification v2 [MEDIUM severity]

**What goes wrong:** D-18 expects clicking the OS notification to deep-link to the request. `tauri-plugin-notification` v2 has Actions only on mobile platforms — desktop notifications fire-and-forget with no onClick payload.

**Why it happens:** Underlying platform plumbing (especially Windows toast) requires AppUserModelID, COM activation handlers, and an installed-app context that the plugin doesn't expose in v2.

**How to avoid:** Two-tier fallback (already mentioned in D-18):
1. **Primary:** Backend emits a Tauri event `pending-approval-deep-link` with `{request_id}` *immediately when the notification is dispatched*. Frontend is already listening; if the AITC window is focused, it routes to /comms and selects the row.
2. **Fallback:** When AITC window is *not* focused, we can't auto-route on click (no callback). Instead: when user clicks the tray icon (which is supported per `tauri::tray::on_tray_icon_event`), focus + route to /comms. The pending row will be at the top of the queue.

This is "good enough" for solo-user UX. A future phase could integrate `windows-toast` directly for true onClick.

**Warning signs:** Clicking a Windows toast does nothing visible. (Expected.)

[CITED: github.com/tauri-apps/plugins-workspace/issues/2150 — "Notification onclick event" still open as feature request; v2.tauri.app/plugin/notification/ — "Actions API is only available on mobile platforms."]

### Pitfall 10: Multiple AITC instances on the same machine racing on `~/.aitc/port` [LOW severity]

**What goes wrong:** Two AITC instances start. Both write the port file. Sidecar reads whichever was written last. The first instance's Claude sessions now POST to the second instance's `/hook` — wrong UI, wrong waiters.

**Why it happens:** Last-writer-wins on a shared file.

**How to avoid:** v1 acceptable: assume single-instance. Add a one-shot single-instance check via `tauri-plugin-single-instance` (already documented for Tauri v2). If user starts a second AITC, it gets focus on the existing window instead of launching new.

**Warning signs:** Approval rows appear in the "wrong" AITC window.

[Recommend in plan: install `tauri-plugin-single-instance` v2 as a Wave 0 task, even though it's adjacent to Phase 8 scope. Costs nothing.]

## Code Examples

### Tauri v2 sidecar configuration

```json
// src-tauri/tauri.conf.json — bundle additions
{
  "bundle": {
    "externalBin": ["binaries/aitc-hook"]
  }
}
```

```json
// src-tauri/capabilities/default.json — add permissions
{
  "permissions": [
    "shell:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [{"name": "binaries/aitc-hook", "sidecar": true}]
    }
  ]
}
```

```rust
// Resolve sidecar absolute path at runtime (for writing into settings.local.json)
use tauri_plugin_shell::ShellExt;
let sidecar_cmd = app.shell().sidecar("aitc-hook")
    .map_err(|e| format!("sidecar lookup: {e}"))?;
// sidecar_cmd.into_command() gives a tokio::process::Command — but for the
// settings.local.json write we need the absolute path, not a Command.
// Tauri v2 resolves the binary into the resource dir at install time:
let resource_dir = app.path().resource_dir()?;
// Platform-specific filename per target triple:
let bin_name = if cfg!(target_os = "windows") {
    "aitc-hook.exe"
} else { "aitc-hook" };
let abs = resource_dir.join("binaries").join(bin_name);
```

[Source: v2.tauri.app/develop/sidecar — verified 2026-04-15]

### Settings.local.json idempotent merge

```rust
fn upsert_pretool_entry(root: &mut serde_json::Value, our_entry: serde_json::Value) {
    let our_command = our_entry["hooks"][0]["command"].as_str().unwrap_or("").to_string();

    // Ensure { "hooks": { "PreToolUse": [...] } } exists.
    let hooks = root.as_object_mut()
        .expect("root must be object")
        .entry("hooks").or_insert_with(|| serde_json::json!({}));
    let pretool = hooks.as_object_mut()
        .expect("hooks must be object")
        .entry("PreToolUse").or_insert_with(|| serde_json::json!([]));
    let arr = pretool.as_array_mut().expect("PreToolUse must be array");

    // Walk: if any existing entry has hooks[].command == our_command, replace it.
    for entry in arr.iter_mut() {
        if entry["hooks"].as_array()
            .map(|hs| hs.iter().any(|h| h["command"].as_str() == Some(&our_command)))
            .unwrap_or(false)
        {
            *entry = our_entry;
            return;
        }
    }

    // Otherwise append.
    arr.push(our_entry);
}
```

### DB migration shape

```sql
-- src-tauri/src/db/migrations/005_pretool_use_hooks.sql
ALTER TABLE approval_requests ADD COLUMN tool_name TEXT;
ALTER TABLE approval_requests ADD COLUMN tool_input_json TEXT;
-- 'abandoned' is a new status value. SQLite has no enum; existing CHECK
-- constraints on status would need to be relaxed if any exist (verify
-- against migration 003 — there's an INDEX on status but no CHECK).
CREATE INDEX IF NOT EXISTS idx_approval_requests_tool ON approval_requests(tool_name);
```

[VERIFIED against existing migrations: 003_comms_chat.sql adds INDEX on status but does not constrain values — `'abandoned'` can be inserted directly without a migration to drop a CHECK.]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Top-level `{"decision": "approve"\|"block", "reason": "..."}` JSON | `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"\|"deny"\|"ask", "permissionDecisionReason": "..."}}` | Claude Code v2.x rollout (early 2025) | All new hook integrations must use the modern envelope. The old form still parses for backward compat but emits a deprecation warning in newer versions. |
| PreToolUse cannot modify tool inputs | `updatedInput` field allows hooks to rewrite tool args before execution | Claude Code v2.0.10 (early 2025) | Enables the "approve with edits" UX. Older Claude Code installations silently ignore the field. |
| `notify-debouncer-full ^0.4` (CLAUDE.md tech stack table) | `notify-debouncer-full ^0.7` | Phase 2 RESEARCH | Already corrected in `Cargo.toml` — Phase 8 doesn't touch this but worth knowing context. |
| Tauri v1 sidecar bundling via `tauri.conf.json > tauri > bundle > externalBin` | Tauri v2: `bundle.externalBin` (top-level), runtime resolution via `tauri-plugin-shell` `sidecar()` | Tauri v2 release | All examples in this RESEARCH use v2 syntax. |

**Deprecated/outdated:**
- Curl + jq hook scripts: AITC's sidecar approach replaces these. Many community Claude hook examples still use bash + curl; ignore them.
- Polling-based long-poll (`/hook?wait=true&since=N`): superseded by long-held HTTP — simpler, lower latency.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude Code propagates `AITC_PORT` env from its own env into the hook subprocess | Pattern 2 — sidecar resolves `AITC_PORT` first | Sidecar falls back to `~/.aitc/port`. As long as the file is up-to-date this is fine; A1 is an optimization, not correctness. |
| A2 | The hook subprocess can read `~/.aitc/port` (filesystem permissions OK) | D-06 + Pattern 2 | Sidecar fails-safe deny. Hook never works for that user. Fix: write the file with 0644 explicitly. |
| A3 | `session_id` from PreToolUse stdin is stable across multiple tool calls within one Claude run | Pitfall 7 option 4 | If session_id changes per tool call, the (session_id ↔ agent_id) cache is invalidated each call. Need to fall back to parent PID detection. **Verify in plan-check.** |
| A4 | Claude Code v2.x is what users have installed | Pitfall 1 + 2 | If user has v1.x: no `updatedInput`, may need legacy envelope. AITC startup version check (Pitfall 2 mitigation) catches this. |
| A5 | `tauri-plugin-shell` is already a transitive dep of Tauri v2 and adding it as an explicit dep doesn't create version conflicts | Standard Stack | `cargo build` will fail loudly. Easy to fix. |
| A6 | Tauri v2's `app.path().resource_dir()` returns a path that contains `binaries/aitc-hook` (matching `bundle.externalBin: ["binaries/aitc-hook"]`) | Code Examples — Tauri v2 sidecar | Path may be different on macOS app bundles. Plan should `tracing::info!` the resolved path on first install for diagnostic. |
| A7 | The default Phase 4 `protected_paths` glob engine (likely `glob = "0.3"`) handles the kinds of patterns users will write for D-21 | D-21 | If user writes `**` recursive globs and crate doesn't support them, gating breaks for those paths. Phase 4 already handles this for filesystem-watch path; should reuse same engine here. |

## Open Questions (RESOLVED)

1. **Does Claude Code expose Claude's PID in the hook subprocess env?**
   - What we know: PreToolUse stdin includes `session_id`, `cwd`, `transcript_path`. PID is not in the documented stdin schema.
   - What's unclear: Whether Claude sets an env var like `CLAUDE_PROCESS_ID` for hook subprocesses.
   - RESOLVED: **Don't depend on it.** Use `session_id` for correlation per Pitfall 7 option 4. If PID is needed for force-deny on terminate (D-10), the WaiterRegistry stores `(session_id → agent_id)` and `terminate_process` looks up the agent_id, then iterates the registry to find session_ids bound to that agent_id, then signals their waiters. Slight indirection but doesn't depend on PID plumbing.

2. **What is the exact response Content-Type Claude Code expects from the long-held `/hook` response?**
   - Sidecar reads it via `ureq::Response::into_json()` so it's JSON, but Claude itself reads from the sidecar's stdout. Claude doesn't see the AITC response directly.
   - RESOLVED: **AITC's /hook response is private between AITC and the sidecar.** Use `application/json` and a custom `HookDecision` shape; no Claude-imposed constraint. No action required.

3. **Does writing to `cwd/.claude/settings.local.json` trigger Claude Code's hot-reload of its config, or does it require a session restart?**
   - What we know: Claude reads settings on session start. settings.local.json is documented as session-scoped.
   - What's unclear: Whether modifying settings.local.json mid-session reloads it.
   - RESOLVED: Write the file *before* `launch_detached` spawns Claude (D-01 already implies this — install during launch flow, before child spawn). Avoids the question entirely. For passive-detected agents (D-04), the user is told the new install applies to *new* Claude sessions only; the currently running session is unaffected. Document in the consent prompt copy.

4. **For passive-detected agents: how do we know Claude's `cwd` to install settings.local.json into?**
   - What we know: `bridge_tick` populates `cand.cwd` from `sysinfo`. ProcessSnapshot already attaches cwd to candidates.
   - What's unclear: How reliable cwd attribution is when Claude is launched by a wrapper (e.g., `sh -c "cd /repo && claude"`).
   - RESOLVED: Trust `sysinfo`'s cwd. If it points outside the watched repo or to `/`, skip the consent prompt for that PID and log.

5. **Does `--dangerously-skip-permissions` actually skip hooks too, or only the built-in permission prompts?**
   - What we know: D-23 says skipping the hook install is the right user-intent semantic if either bypass chip is set.
   - What's unclear: Whether `--dangerously-skip-permissions` would *also* bypass any hook config in settings.local.json. If it does, then installing the hook anyway would be harmless (the bypass wins). If it doesn't, our D-23 behavior is still correct.
   - RESOLVED: Test empirically during Wave 3 e2e. Either way D-23's behavior (skip install when chip set) is the safest and is the behavior planned regardless of Claude's internal semantics.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | Building sidecar binary | ✓ (project requirement) | edition 2021 | — |
| `claude` CLI on PATH | E2E testing of hook integration | Per-machine; `available_adapter_types` already filters to installed | Should be v2.0.10+ for `updatedInput` support | If older: AITC works but `approve_with_edits` silently no-ops. Detect via `claude --version` on AITC startup, surface in TopBar. |
| `cargo` cross-compile targets (msvc, gnu, darwin) | Sidecar bundling for all platforms in CI | Cross-OS CI exists per recent commit `260414-k8p` | — | Skip per-target sidecar build during dev; bundle only matches host triple. |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- Claude Code older than v2.0.10 → `updatedInput` ignored; warn at startup.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (Rust) | `cargo test` with `tokio::test`, `serial_test`, `tempfile`, `sqlx::SqlitePool::connect("sqlite::memory:")` — already in use across `src-tauri/src/agents/*::tests`. |
| Framework (TS) | Vitest (already in use, see `src/stores/__tests__/commsStore.test.ts`). Mocks Tauri `listen()` events. |
| Config files | `Cargo.toml` `[dev-dependencies]`; `vite.config.ts` for vitest. |
| Quick run command | `cd src-tauri && cargo test --lib` (Rust), `npm run test` (TS, project-rooted). |
| Full suite command | `cargo test` (includes integration tests at `src-tauri/tests/`) + `npm run test:run` (vitest non-watch). |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01 | settings.local.json merge preserves existing user PreToolUse entries | unit | `cargo test --lib agents::hook_install::tests::merge_preserves_user_entries` | ❌ Wave 0 |
| D-01 | Re-running install is idempotent (no duplicate AITC entries) | unit | `cargo test --lib agents::hook_install::tests::install_is_idempotent` | ❌ Wave 0 |
| D-03 | Sidecar translates AITC `Allow` decision → modern hookSpecificOutput JSON on stdout, exit 0 | unit | `cargo test -p aitc-hook` | ❌ Wave 0 |
| D-03 | Sidecar translates AITC `Deny(reason)` → exit 2 with reason on stderr | unit | `cargo test -p aitc-hook` | ❌ Wave 0 |
| D-03 | Sidecar translates `AllowWithEdits(updated_input)` → permissionDecision=allow + updatedInput | unit | `cargo test -p aitc-hook` | ❌ Wave 0 |
| D-06 | Port file written on startup, removed on Drop | unit | `cargo test --lib agents::port_file::tests` | ❌ Wave 0 |
| D-07 | /hook handler awaits oneshot; approve fires waiter; response returns to caller | integration | `cargo test --test end_to_end_smoke -- hook_approve_resolves_handler` | ❌ Wave 0 (extend existing smoke) |
| D-09 | Client disconnect marks row 'abandoned' and drops registry entry | integration | `cargo test --test end_to_end_smoke -- hook_disconnect_abandons` | ❌ Wave 0 |
| D-10 | terminate_process force-denies all waiters for the agent | integration | `cargo test --test end_to_end_smoke -- terminate_force_denies_waiters` | ❌ Wave 0 |
| D-11 | Sidecar fail-safe-denies when port unreachable | unit | `cargo test -p aitc-hook -- fail_safe_when_unreachable` | ❌ Wave 0 |
| D-12 | /hook auto-creates PASSIVE-{pid} stub when no agent matches | unit | `cargo test --lib agents::self_register::tests::hook_creates_passive_stub` | ❌ Wave 0 |
| D-19 | Pass-through tools (Read, LS, etc.) return Allow without inserting a row | unit | `cargo test --lib agents::self_register::tests::passthrough_tools_skip_db` | ❌ Wave 0 |
| D-21 | OR semantics: protected path triggers gating even on pass-through tools | unit | `cargo test --lib agents::self_register::tests::protected_path_gates_read` | ❌ Wave 0 |
| D-22 | Always-allow set bypasses subsequent /hook for same (agent, tool) | unit | `cargo test --lib agents::hook_waiters::tests::always_allow_bypass` | ❌ Wave 0 |
| D-14, D-15, D-17 | ToolPreview renderers route per tool_name; Edit reuses InlineDiff | component (vitest + RTL) | `npm run test -- ToolPreview` | ❌ Wave 0 |
| D-18 | Notification → Tauri event → commsStore.selectRequest(id) is called | unit (vitest) | `npm run test -- commsStore.test.ts -- deeplink` | ❌ Wave 0 (extend existing) |
| Full e2e | Install hook → launch claude → see request in queue → approve → claude proceeds | manual UAT | Documented checklist in `tests/manual/phase-08-uat.md` | ❌ Wave 3 |

### Sampling Rate
- **Per task commit:** `cd src-tauri && cargo test --lib hook_install agents::hook_waiters::tests` (under 30s for the targeted module). Frontend: `npm run test -- ToolPreview commsStore`.
- **Per wave merge:** `cargo test` + `cargo test -p aitc-hook` + `npm run test:run` (full suites).
- **Phase gate:** Full suite + `cd src-tauri && cargo test --test end_to_end_smoke` + manual UAT checklist + `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src-tauri/src/agents/hook_waiters.rs` + `mod tests` — covers D-22 always-allow, registry signal/remove
- [ ] `src-tauri/src/agents/hook_install.rs` + `mod tests` — covers D-01 merge semantics, idempotency, atomic write
- [ ] `src-tauri/src/agents/port_file.rs` + `mod tests` — covers D-06 write + Drop cleanup
- [ ] `src-tauri/aitc-hook/src/main.rs` + `tests/` — covers D-03 stdin/stdout translation, D-11 fail-safe paths
- [ ] `src-tauri/tests/end_to_end_smoke.rs` extended — D-07 long-held response, D-09 disconnect, D-10 force-deny
- [ ] `src/views/CommsHub/ToolPreview/__tests__/` — covers D-14/D-15/D-17 routing and InlineDiff reuse
- [ ] Manual UAT checklist `tests/manual/phase-08-uat.md` — covers full e2e

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | localhost-only, single-user. No auth. (`/hook` binds to 127.0.0.1 — same as `/register`.) |
| V3 Session Management | yes (lightweight) | `session_id` from Claude PreToolUse stdin is the correlation token; bound to agent_id at first sight. No cross-session leakage. |
| V4 Access Control | yes | (1) `/hook` is backend-authoritative for row creation (WR-03 pattern). (2) Frontend cannot fabricate pretool_use rows. (3) approve/deny commands only fire waiters for rows owned by the calling instance (ID is per-DB autoincrement). |
| V5 Input Validation | yes | (a) Validate `tool_name` against a known set (built-in Claude tools + `mcp__*` regex). Reject empty. (b) Validate `tool_input` is a JSON object. (c) Validate PID is a live process (existing `sysinfo` check pattern from `/register`). (d) Reject body > 1 MB to prevent memory exhaustion (Bash command + diff content can be large but not pathological). |
| V6 Cryptography | no | No secrets handled in this phase. |
| V8 Data Protection | yes | Tool inputs may contain sensitive data (file contents, API URLs). Stored in `tool_input_json` (TEXT). Already protected by SQLite file permissions (user-only). No remote transmission. |
| V11 Business Logic | yes | (a) Fail-safe deny is mandatory (D-11). (b) Drop guard prevents zombie pending rows on disconnect. (c) Force-deny on terminate prevents stale waiters from approving after user kills agent. |
| V14 Configuration | yes | (a) `~/.aitc/port` is created with 0644 (read by other processes is fine, this is just a port number). (b) settings.local.json is git-ignored by Claude Code conventions; user file modifications are merge-preserving. |

### Known Threat Patterns for AITC Hook Integration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious local process posts to /hook with spoofed pid to inject fake approval rows | Spoofing | Validate PID is live (existing `/register` pattern). Bind 127.0.0.1 only. Single-user host = acceptable trust boundary. |
| User clicks approve, attacker has somehow modified the in-flight tool_input | Tampering | tool_input is captured at /hook insertion; `updatedInput` returned to Claude is what AITC stored + any user edits. No mutation path between insert and signal. |
| Approval row created but waiter never registered (race) → approve fires nothing | Repudiation | Approve UPDATE includes `WHERE status='pending'` and returns rows-affected to caller. UI re-syncs from server state. (Pitfall 8.) |
| Sensitive tool_input (e.g., bash command with secrets) logged in DB | Information Disclosure | `tool_input_json` is local SQLite, user-only file perms. Document in consent prompt that "tool inputs are stored locally". Future phase could add column-level redaction; out of scope v1. |
| Attacker spawns 1000s of concurrent /hook requests to exhaust waiter map | DoS | Existing `RateLimiter` from `self_register.rs` extends to /hook (10 req/sec cap). Body size limit (1 MB). Combined with single-user trust boundary, sufficient for v1. |
| Hook bypass via direct settings.local.json edit | Elevation of Privilege | User can disable hook by editing the file. **Acceptable** — user owns their machine. The hook is a UX safety harness, not a security boundary. Documented in D-23. |
| Sidecar binary tampered with on disk (replace with malicious version) | Tampering / EoP | Tauri's bundle signing is the right control. Out of scope for Phase 8 — relies on Tauri/OS code-signing infrastructure. |

## Sources

### Primary (HIGH confidence)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — Verified PreToolUse stdin schema, stdout decision schema, exit codes, settings.json hooks array shape, all built-in tool_input shapes.
- [Claude Code Settings Reference](https://code.claude.com/docs/en/settings) — Verified settings.local.json git-ignore convention and merge semantics ("arrays are concatenated and de-duplicated; objects are deep-merged").
- [Tauri v2 Sidecar Docs](https://v2.tauri.app/develop/sidecar/) — Verified `bundle.externalBin` shape, target-triple naming, capabilities permission shape, runtime resolution via `app.shell().sidecar()`.
- [Tauri v2 Notification Plugin](https://v2.tauri.app/plugin/notification/) — Verified actions API is mobile-only; no desktop onClick.
- [github.com/tauri-apps/plugins-workspace#2150](https://github.com/tauri-apps/plugins-workspace/issues/2150) — Verified onClick is open feature request, not implemented v2.
- [tokio-rs/axum#1094](https://github.com/tokio-rs/axum/discussions/1094) — Canonical pattern: hyper drops handler future on TCP close; use Drop guard for cleanup.
- [Anthropic blog: How to configure hooks](https://claude.com/blog/how-to-configure-hooks) — Verified `updatedInput` shipped in v2.0.10; verified modern envelope via `hookSpecificOutput.permissionDecision`.
- Existing codebase: `src-tauri/src/agents/self_register.rs`, `claude_code.rs`, `launcher.rs`, `registry.rs`, `pipeline/passive_bridge.rs`, `comms/commands.rs`, all migrations 001–004 — Verified by direct read.

### Secondary (MEDIUM confidence)
- [crates.io npm verifications](https://crates.io) — Versions cross-checked via `cargo search` 2026-04-15: axum 0.8.9, tokio 1.52.0, serde_json 1.0.149, ureq 3.3.0, anyhow 1.0.102, dirs 6.0.0, tauri-plugin-shell 2.3.5, json-patch 4.1.0, json_value_merge 2.0.1.
- [npm @tauri-apps/plugin-notification](https://www.npmjs.com/package/@tauri-apps/plugin-notification) v2.3.3 — Verified.
- [LogRocket Best Rust HTTP Client](https://blog.logrocket.com/best-rust-http-client/) — Cross-referenced ureq vs reqwest tradeoffs.
- [O.S. Systems benchmark](https://medium.com/os-systems/benchmarking-http-client-server-binary-size-in-rust-3f4398f2aa07) — ureq stripped binary ~2 MB vs reqwest 2.9 MB.

### Tertiary (LOW confidence — flagged for plan-check verification)
- Behavior of `--dangerously-skip-permissions` w.r.t. installed PreToolUse hooks: uncertain whether the flag bypasses hooks or only built-in prompts. Plan should verify empirically in Wave 3.
- Whether `session_id` is stable across all tool calls within one Claude session: documented as such, not 100% verified across CLI invocations of `claude --print`. Plan should verify in Wave 1 sidecar test.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all Rust deps verified via `cargo search` 2026-04-15; Tauri sidecar shape verified against official v2 docs.
- Architecture: HIGH on the long-held HTTP + drop guard pattern (community-canonical); MEDIUM on the parent-PID strategy (recommend session_id, not PID, per Pitfall 7 option 4).
- Pitfalls: HIGH — most pitfalls are direct citations of upstream docs, GitHub issues, or existing-codebase comments (e.g., the PID truncation lesson is in code).
- Hook contract: HIGH — directly verified against latest Anthropic docs; the deprecated-vs-modern envelope distinction is the single most important correctness fact.

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 — Claude Code is fast-moving; hook contract revisions plausible within 30 days. Re-verify hook stdin/stdout schemas before any Phase 8.x or Phase 11 work that touches this surface.

## Plan Shape Recommendation

Expect **5 plans** across **4 waves**. Wave 0 is heavier than usual because of the new sidecar crate + DB migration + multiple new modules.

### Wave 0 — Foundation (1 plan)
**Plan 08-01:** DB migration `005_pretool_use_hooks.sql`; add deps to `Cargo.toml` (`dirs`, `tauri-plugin-shell`); add workspace + scaffold `src-tauri/aitc-hook/` crate; create empty `hook_waiters.rs`, `hook_install.rs`, `port_file.rs` modules with module-level doc comments and stub types; create test files for each (red); install `tauri-plugin-single-instance` (Pitfall 10 mitigation); regenerate tauri-specta bindings; update `tauri.conf.json` with `bundle.externalBin`.

**Validates:** Migration applies cleanly; cargo workspace builds; bindings regenerate.

### Wave 1 — Backend (2 plans, parallel)

**Plan 08-02:** axum `/hook` route on `self_register.rs` with the full long-held pattern: WaiterRegistry registration, oneshot await, drop-guard for disconnect → 'abandoned', tokio::select! + body-poll cancellation (Pitfall 3 option 2). `create_approval_request_internal` extension to accept `tool_name` + `tool_input_json`. Auto-create `PASSIVE-{pid}` stub on first /hook (D-12). Pass-through fast paths for non-gated tools (D-19/D-20). always-allow set check (D-22). Approve/deny/approve_with_edits in `comms/commands.rs` signal the waiters. Force-deny in `launcher.rs::terminate_process` (D-10). `~/.aitc/port` writer + Drop guard (D-06). app_settings bootstrap of `pretool_gated_tools` to D-19 default if unset.

**Validates:** All Rust unit + integration tests for D-01, D-06, D-07, D-09, D-10, D-12, D-19, D-22.

**Plan 08-03 (parallel with 08-02):** `aitc-hook` sidecar `main.rs`: stdin parse → resolve port (env first, then file) → POST → translate `HookDecision` to modern hookSpecificOutput envelope → exit 0/2. Use `session_id` (not PID) for correlation per Pitfall 7. Fail-safe deny on every error path (D-11). Tests for each branch.

**Validates:** All tests for D-03, D-11. Sidecar binary builds for host triple.

### Wave 2 — Hook install + Frontend (2 plans, parallel)

**Plan 08-04:** `hook_install.rs` merge writer with the hand-rolled idempotent upsert (Pitfall 4); atomic tmp+rename; resolve sidecar abs path via `app.shell().sidecar()`. Wire into `claude_code.rs::launch` (skip if `--accept-edits` or `--dangerously-skip-permissions` chip per D-23). Passive-detection consent prompt: emit `passive-claude-detected` event from `passive_bridge.rs::bridge_tick` with cwd; new Tauri commands `accept_passive_hook_consent(repo)` / `decline_passive_hook_consent(repo)` that store decision in app_settings (`passive_hook_consent_repos` key, dedup) and on accept call `install_aitc_hook`. On AITC startup, scan `passive_hook_consent_repos` and re-install (Pitfall 6 — auto-heal stale paths).

**Validates:** D-04 consent flow; D-23 chip bypass; merge semantics from 08-02 tests.

**Plan 08-05 (parallel with 08-04):** Frontend. Extend `commsStore.ts` `ApprovalRequest` type with `toolName?`, `toolInputJson?`. Add session-scoped always-allow tracking. New `ToolBadge` component. Extend `ApprovalRequestCard.tsx` with badge + per-tool preview line (D-14). New `ToolPreview/` component registry with per-tool renderers (D-15): EditPreview reuses existing InlineDiff + approve_with_edits → modified_input bridge through `approveWithEdits`; WritePreview/NotebookPreview use shiki (`useSyntaxHighlight`); BashPreview shows command + description + cwd; ProtectedPathPreview for Read/LS/Grep/Glob/WebFetch/WebSearch on protected paths; UnknownToolPreview as JSON fallback for MCP. Truncation toggle (D-16). "Don't ask again this session" checkbox in ApprovalActions (D-22). Deep-link wiring: subscribe to `pending-approval-deep-link` event → `selectRequest(id)` + route to /comms (D-18). Tray-icon click fallback. Vitest tests for ToolPreview routing, approveWithEdits → updatedInput payload, deep-link routing.

**Validates:** D-14, D-15, D-16, D-17, D-18, D-22 (frontend half).

### Wave 3 — Integration + e2e + visual checkpoint (1 plan)
**Plan 08-06:** End-to-end Rust integration test that spins up axum + spawns sidecar + simulates a Claude PreToolUse JSON → asserts row insert, response blocking, approve fires with correct envelope. Manual UAT checklist `tests/manual/phase-08-uat.md`: install hook in real repo, launch claude, see request, approve, watch claude proceed; deny path; approve_with_edits modifies the file; passive-detected agent gets consent prompt; --accept-edits chip skips install; abandoned status appears when claude is killed mid-prompt; tray-icon fallback works. Visual-verification checkpoint per Phase 1/4/5 pattern. tauri-specta regeneration final-check.

**Validates:** Full e2e; ROADMAP Phase 8 success criteria.

### Suggested wave-to-task mapping (for planner)
- **Wave 0:** 1 plan, ~3 tasks.
- **Wave 1:** 2 plans, parallel; 08-02 has ~6 tasks (route, create-row, registry, drop-guard, terminate-force-deny, port-file), 08-03 has ~4 tasks (parse, resolve port, POST, translate).
- **Wave 2:** 2 plans, parallel; 08-04 has ~4 tasks (merge writer, claude_code wiring, passive consent, app_settings), 08-05 has ~6 tasks (store extension, badge, preview registry, per-tool renderers, deep-link, tests).
- **Wave 3:** 1 plan, ~3 tasks (integration test, UAT, visual checkpoint).

Total: ~26 tasks across 6 plans across 4 waves. Aligns with Phase 6's 5-plan / 4-wave shape.

## RESEARCH COMPLETE
