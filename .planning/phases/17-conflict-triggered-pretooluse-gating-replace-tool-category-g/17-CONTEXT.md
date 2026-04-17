# Phase 17 — Conflict-triggered PreToolUse gating

## Pitch

Today, AITC gates every `Edit`, `Write`, `NotebookEdit`, and `Bash` call by category — every mutation prompts the user for approval. In a multi-agent dev session this is noisy to the point of being unusable, and it's architecturally wrong: AITC's stated core value (CLAUDE.md) is "detect conflicts when agents touch the same files," not "approve every mutation."

Swap the trigger. Only hold an approval when the tool call would overlap with another active agent's active file. Otherwise, instant allow.

## Why now

- Phase 08 shipped the hook pipeline and gave us the primitives (agent registry, session binding, hook_handler, file watcher). The plumbing exists; only the gating predicate needs to change.
- Right now users have two workarounds — `--dangerously-skip-permissions` (which Phase 08's sidecar just learned to honor) or manually approving everything. Neither is the intended UX.
- The current model scales poorly with agent count: N agents × every tool = N × approval prompts per second.

## Scope

### Edit / Write / NotebookEdit (easy case)
- `tool_input.file_path` is always present. Canonicalize (resolve `..`, symlinks) and check against the active-agent → active-file map. If no other live agent is on that path, Allow. Otherwise, create an approval row tagged with the conflicting agent.

### Bash (hard case)
- Commands don't have a structured `file_path`. Best-effort parse target paths from the command string:
  - Stdout/stderr redirects: `> path`, `>> path`, `2> path`, `&> path`
  - Common mutating verbs' positional args: `cp SRC DST`, `mv SRC DST`, `rm PATH…`, `touch PATH…`, `mkdir PATH`, `tee PATH`, `patch PATH`, `sed -i … PATH`, `awk -i inplace … PATH`
  - Writes from compilers/tooling: `rustc -o PATH`, `cargo build` (target/), `npm install` (node_modules/)
- Read-only safelist — instant allow, no parse: `ls`, `pwd`, `cat`, `head`, `tail`, `echo`, `wc`, `which`, `whoami`, `date`, `uname`, `git status`, `git diff`, `git log`, `git show`
- Open question: what to do when parse fails (unknown binary, pipeline, shell function). See Design Q3.

### Unchanged
- Protected-paths (`D-21` / `protected_path_matches`) still force gating regardless of conflict.
- Rate limiter, PID validation, session binding, approval UI, always-allow cache.
- `bypassPermissions` sidecar short-circuit (Phase 08.5 equivalent — shipped 2026-04-17) still wins.

## Design questions for /gsd-discuss-phase

**Q1. Conflict scope.** What counts as "same file"?
- (a) Literal canonical path only — tightest, most quiet, may miss "agent A edits `auth.rs`, agent B edits `auth_test.rs`" coupled-file conflicts.
- (b) Same directory — catches the above but also prompts on unrelated siblings.
- (c) Same module / import-graph cluster (would lean on Phase 16's Louvain community output) — semantically correct but depends on Phase 16 landing first.

**Q2. Time window.** When does agent A's "touch" expire?
- (a) Only while A is actively running (process alive / heartbeat fresh).
- (b) While A is running, OR within last N seconds of its last write (tune N — 30s? 5min?).
- (c) Until A explicitly terminates or commits (tracks intent more than presence).

**Q3. Bash fallback.** What happens when path parsing returns nothing?
- (a) Gate (treat as potentially-conflicting — current behavior, slightly less noisy because no other agents = pass).
- (b) Allow (parse failure = "we don't know, trust the bypass-permissions posture").
- (c) Allow only if command is in an extended "probably safe" prefix list; else gate.

## Files likely touched

- `src-tauri/src/agents/self_register.rs` — `hook_handler`: replace the `gated_tools` + `protected_path_matches` branch with conflict-resolution.
- `src-tauri/src/conflicts/` (check if exists — may need creation) — the "who is touching what right now" index. Likely backed by the existing file-watcher + agent-registry.
- `src-tauri/src/agents/bash_paths.rs` (new) — regex parser for Bash target paths + safelist.
- Tests: new `conflict_gate_roundtrip` integration tests, Bash parser unit tests.

## Out of scope (defer to later phases)

- Conflict resolution UI beyond the existing approval card.
- Predictive conflict avoidance (agent A announces intent before starting).
- Cross-worktree / cross-repo conflict tracking.

## Rationale summary

The current implementation is a safe default that has become a usability bug. This phase moves AITC from "approval firewall" to "conflict firewall" — which is what the tagline has always promised.
