# Phase 8: Real Claude Code Hook Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 08-real-claude-code-hook-integration-pretooluse-approvals
**Areas discussed:** Hook install + shape, Blocking transport + timeout, Tool input preview UI, Tool scope + noise filtering

---

## Hook install + shape

### Where does the Claude Code hook config get written on launch?
| Option | Description | Selected |
|--------|-------------|----------|
| cwd/.claude/settings.local.json | Per-launch write to repo cwd; git-ignored; scoped per-session | ✓ |
| ~/.claude/settings.json (global) | Install once at first run; covers passive sessions; gates every Claude invocation |  |
| cwd/.claude/hooks/aitc-pretooluse.json | Separate subfolder; mixes with non-canonical Claude Code location |  |

**User's choice:** cwd/.claude/settings.local.json
**Notes:** Per-launch scoping preferred; avoids touching global Claude config.

### What does the hook command point at?
| Option | Description | Selected |
|--------|-------------|----------|
| Rust sidecar binary shipped with AITC | Tauri v2 sidecar bundling; no curl/jq/node dep | ✓ |
| Shell script (POSIX sh + curl/jq) | Needs curl + jq; Windows variant required |  |
| Node script | Assumes Node on PATH; cross-platform but slight startup cost |  |

**User's choice:** Rust sidecar binary

### How do we cover passively-detected Claude Code sessions?
| Option | Description | Selected |
|--------|-------------|----------|
| First-run global install + fixed port | Installs ~/.claude/settings.json once; sidecar falls back to ~/.aitc/port file |  |
| Skip passive in v1 | Only launched agents get hooked |  |
| Prompt on passive detection | One-time consent prompt per passive session | ✓ |

**User's choice:** Prompt on passive detection

### For the passive-detection prompt — what does 'install hook globally' mean?
| Option | Description | Selected |
|--------|-------------|----------|
| Write ~/.claude/settings.json | Global install with sidecar reading ~/.aitc/port fallback |  |
| Write cwd/.claude/settings.local.json for that repo only | Repo-scoped only; must re-prompt per repo; narrower blast radius | ✓ |
| Ask per prompt which scope | Sub-choice at install time |  |

**User's choice:** Write cwd/.claude/settings.local.json for that repo only

### Cleanup on terminate?
| Option | Description | Selected |
|--------|-------------|----------|
| Leave it in place | Hook persists; sidecar fails-safe deny if AITC not running | ✓ |
| Remove hook entry on terminate | Strip just the AITC entry |  |
| Delete whole file on terminate (if AITC-created) | Remove file if AITC signed it on write |  |

**User's choice:** Leave it in place

### Sidecar AITC_PORT lookup order?
| Option | Description | Selected |
|--------|-------------|----------|
| env AITC_PORT then ~/.aitc/port file | Env for launched, file for passive; fail-safe if both missing | ✓ |
| Hardcoded port 9417 only | Breaks when preferred port busy |  |
| ~/.aitc/port file only | Always file IO |  |

**User's choice:** env AITC_PORT then ~/.aitc/port file

---

## Blocking transport + timeout

### How should the sidecar block Claude?
| Option | Description | Selected |
|--------|-------------|----------|
| Long-held HTTP response | tokio oneshot signaled by approve/deny; single round-trip | ✓ |
| Submit + poll | Sidecar gets id, polls /hook/{id} |  |
| Submit + SSE | Push stream; overkill on localhost |  |

**User's choice:** Long-held HTTP response

### How long should /hook wait before timing out?
| Option | Description | Selected |
|--------|-------------|----------|
| 5 minutes | Balances attention span vs ghost sessions |  |
| 60 seconds | Forces fast decisions |  |
| No timeout | Block forever until resolved | ✓ |
| User-configurable, default 5m | Ship default + settings surface |  |

**User's choice:** No timeout
**Notes:** User prefers explicit control over auto-resolve; orphan cleanup handled via disconnect detection + force-deny on terminate.

### Fail mode when AITC unreachable?
| Option | Description | Selected |
|--------|-------------|----------|
| Fail-safe deny | Emit block JSON with 'AITC unreachable' reason | ✓ |
| Fail-open (allow) | Treat AITC as optional governor |  |
| Configurable per-tool | Read-class allow, write-class deny |  |

**User's choice:** Fail-safe deny

### Orphan cleanup when Claude exits/crashes while blocked?
| Option | Description | Selected |
|--------|-------------|----------|
| Detect via client disconnect | tokio::select! between oneshot and connection-closed; mark row 'abandoned' | ✓ |
| Keep the row pending forever | Waiter dies silently, row stays pending |  |
| Periodic PID liveness check | Every 5s re-check PID |  |

**User's choice:** Detect via client disconnect

### If the user terminates the agent while a /hook call is pending?
| Option | Description | Selected |
|--------|-------------|----------|
| Force-deny the pending request | Resolve waiter with deny before SIGTERM | ✓ |
| Let socket-close drop waiter | Rely on connection-drop detection |  |

**User's choice:** Force-deny the pending request

### Which waiters get unblocked on approve/deny?
| Option | Description | Selected |
|--------|-------------|----------|
| Exactly the one tied to approval_request.id | HashMap<id, oneshot::Sender> lookup | ✓ |
| Broadcast to all waiters for that agent | Simpler but wrong for overlapping calls |  |

**User's choice:** Exactly the one tied to approval_request.id

### How does /hook attribute a request to an AITC agent row?
| Option | Description | Selected |
|--------|-------------|----------|
| PID from hook payload + AgentRegistry lookup | Auto-create PASSIVE-{pid} stub if missing | ✓ |
| AITC_AGENT_ID env var only | Works for launched; breaks for passive |  |
| Both: prefer env, fallback to PID lookup | Best-of-both with more code |  |

**User's choice:** PID from hook payload + AgentRegistry lookup

---

## Tool input preview UI

### What does an approval card show in the queue list?
| Option | Description | Selected |
|--------|-------------|----------|
| Tool badge + file path + first-line preview | Edit/Write/Bash previews inline | ✓ |
| Tool badge + file path only | Preview only in detail panel |  |
| Replace requestType line with tool badge | Drop PRETOOL USE label |  |

**User's choice:** Tool badge + file path + first-line preview

### What renders in the right-hand detail panel?
| Option | Description | Selected |
|--------|-------------|----------|
| Smart per-tool view | Edit→InlineDiff, Bash→command, Write→syntax-highlighted, etc. | ✓ |
| Raw JSON only | Pretty-print tool_input_json |  |
| JSON with highlighted key fields | Middle ground |  |

**User's choice:** Smart per-tool view

### How do we handle very long tool inputs?
| Option | Description | Selected |
|--------|-------------|----------|
| Truncate + expandable | First ~40 lines or 2KB with Show all | ✓ |
| No truncation, just scroll | Panel scrolls unbounded |  |
| Truncate with 'Open in external editor' link | New plumbing |  |

**User's choice:** Truncate + expandable

### Reuse InlineDiff with editable lines for Edit/MultiEdit?
| Option | Description | Selected |
|--------|-------------|----------|
| Reuse InlineDiff + approve_with_edits | modified_input sent back in hook response | ✓ |
| Read-only diff, approve/deny only | Defer edit support to later phase |  |
| Raw per-tool view, no diff | Drop syntax parity |  |

**User's choice:** Reuse InlineDiff + approve_with_edits

### Bash detail panel content?
| Option | Description | Selected |
|--------|-------------|----------|
| Command + cwd + description | Syntax-highlighted command, description above, cwd/timeout below | ✓ |
| Command only | Minimal |  |
| Command + dry-run hint | Pattern-matched risk flag |  |

**User's choice:** Command + cwd + description

### Deep-link OS notification behavior?
| Option | Description | Selected |
|--------|-------------|----------|
| Focus window + Comms view + select request | Full click-through | ✓ |
| Focus window + Comms view only | No auto-select |  |
| Focus window only (no routing) | Bring AITC to front |  |

**User's choice:** Focus window + Comms view + select request

---

## Tool scope + noise filtering

### Which tools trigger approval by default on first launch?
| Option | Description | Selected |
|--------|-------------|----------|
| Write-class only | Edit/MultiEdit/Write/Bash/NotebookEdit |  |
| Everything | Every PreToolUse event |  |
| Write-class + Bash only | Write-class + Bash (excludes Task/MCP) | ✓ |
| Write-class + Bash + Task + MCP | Broader default |  |

**User's choice:** Write-class + Bash only

### Where does the user tune which tools trigger approvals?
| Option | Description | Selected |
|--------|-------------|----------|
| app_settings table + settings screen later | JSON blob in app_settings; no v1 UI | ✓ |
| Hardcoded, no tuning | Shipped in Rust source |  |
| Settings screen in v1 | New view + routing |  |

**User's choice:** app_settings table + settings screen later

### Interplay with protected_paths?
| Option | Description | Selected |
|--------|-------------|----------|
| OR: gate if tool OR path matches | Additive; reads on protected paths also gate | ✓ |
| Tool allowlist only | Ignore protected_paths for pretool_use |  |
| AND: gate only when both match | Stricter, bad default |  |

**User's choice:** OR semantics

### Persist approval decisions for similar future calls?
| Option | Description | Selected |
|--------|-------------|----------|
| Per-call only | Every gated tool always prompts |  |
| 'Always allow for this session' per-tool | Per-agent in-memory HashSet<(agent_id, tool_name)> | ✓ |
| 'Always allow for this path' per-file | Session-scoped path allowlist |  |

**User's choice:** 'Always allow for this session' per-tool

### Keep existing --accept-edits / --dangerously-skip-permissions launcher chips?
| Option | Description | Selected |
|--------|-------------|----------|
| Keep as explicit bypass | Chip ticked skips settings.local.json install for that launch | ✓ |
| Remove chips | Fully replaced by hook gating |  |
| Keep chips but warn | Warning on toggle |  |

**User's choice:** Keep as explicit bypass

---

## Claude's Discretion
- settings.local.json merge logic for pre-existing hook entries
- Sidecar binary name + Tauri sidecar registration details
- Exact shape of HookDecision / POST body types
- Module name for waiter registry (suggested hook_waiters.rs / hook_bridge.rs)
- axum client-disconnect detection pattern
- Whether pretool_use rows live with write_access rows or in a dedicated tab (UI-SPEC)
- ~/.aitc/port metadata beyond port number
- UI placement for "Don't ask again this session" checkbox

## Deferred Ideas
- Global ~/.claude/settings.json install
- PostToolUse hooks, Codex/OpenCode hook gating
- Multi-user auth on /hook
- Full settings UI for pretool_gated_tools
- Persisted "always allow for this path" across sessions
- Per-tool timeout customization
- Destructive-pattern highlighting on Bash previews
- Separate tool-call audit log
- External-editor fallback for large inputs
- ~/.aitc/port format extensions
