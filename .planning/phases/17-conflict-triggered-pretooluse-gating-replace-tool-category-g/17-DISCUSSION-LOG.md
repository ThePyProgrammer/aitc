# Phase 17: Conflict-triggered PreToolUse gating — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `17-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 17 — Conflict-triggered PreToolUse gating (replace tool-category gating)
**Mode:** `/gsd-discuss-phase 17 --auto` — every question was auto-resolved by selecting the recommended option. No interactive user input. Areas were identified from the Phase 17 pitch (prior `17-CONTEXT.md`) + targeted codebase scout of `src-tauri/src/agents/self_register.rs`, `src-tauri/src/conflict/engine.rs`, `src-tauri/src/pipeline/commands.rs`, `src-tauri/src/comms/app_settings.rs`, Phase 8 CONTEXT.md, and Phase 3 CONTEXT.md.

**Areas discussed:** Conflict scope, Time window, Bash parse-failure fallback, Conflict-index data path, Canonicalization, Read-vs-write scope, Approval row enrichment, Legacy tool-category layer, Bash safelist, Bash parser targets.

---

## Conflict scope

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical path only | Tightest, matches existing `ConflictEngine.recent_writes` key; zero new index; no Phase 16 dependency. | ✓ |
| Same directory | Catches coupled siblings (`auth.rs` ↔ `auth_test.rs`) but over-prompts on unrelated files. | |
| Module / import-graph cluster | Semantically correct but depends on Phase 16 Louvain output which has not landed. | |

**Chosen:** Canonical path only.
**Notes:** Auto-mode recommended default. Map → D-01 in `17-CONTEXT.md`.

---

## Time window (when does "touch" expire?)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `ConflictState.window_ms` + liveness gate on `AgentRegistry.state` | Single knob already drives CNFL-02 alerts (default 5000ms, user-configurable). Matches existing semantics exactly. | ✓ |
| Only while agent running (heartbeat fresh) | Leaky — freshly-idle agent's recent Edit leaves no residue. | |
| Until explicit terminate/commit | Needs new commit tracking; intent-heavy; out of scope. | |

**Chosen:** Sliding window + liveness gate.
**Notes:** D-03 + D-04. Same window_ms atomic read as CNFL-02.

---

## Bash parse-failure fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Allow | Phase thesis is "conflict-triggered, not category-triggered"; parse failure = no known conflict surface. Escape hatches: protected_paths, --dangerously-skip-permissions, always-allow cache. | ✓ |
| Gate (current behavior preserved) | Partially re-introduces the noise Phase 17 is replacing — every `make test`/`cargo check` would still prompt. | |
| Extended "probably-safe" prefix list, else gate | Halfway house; adds heuristic surface without fixing the core noise problem. | |

**Chosen:** Allow on parse-failure, with `tracing::debug` audit trail.
**Notes:** D-10 + D-13. Acknowledged deliberate gap; revisit if UAT surfaces destructive slip-throughs.

---

## Conflict-index data path

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `ConflictEngine` + wrap in `Arc<Mutex<_>>` + expose `could_conflict_with()` query | Single source of truth; reuses existing sliding window; ~15 lines of read-only traversal over existing `recent_writes` map. | ✓ |
| New `ActiveFileIndex` parallel to `ConflictEngine` | Duplicates state (same semantics, two stores); divergence risk over time. | |
| Query past `ConflictState.alerts` | Wrong data — these are *past detected* conflicts, not "who is live on this path". | |

**Chosen:** Extend the engine; share via `Arc<tokio::sync::Mutex<_>>`.
**Notes:** D-14 + D-15 + D-16.

---

## Canonicalization

| Option | Description | Selected |
|--------|-------------|----------|
| `fs::canonicalize` where path exists + lexical normalize fallback for new files; no case folding on any platform | Handles Write/NotebookEdit on a new path; matches radar-renders-paths-verbatim convention. | ✓ |
| Always `fs::canonicalize` | Fails on non-existent paths (every Write of a new file). | |
| Case-fold on macOS (HFS+/APFS defaults) | Ambiguous when repo deliberately uses case-sensitive naming; radar already treats case-variant paths as distinct nodes. | |

**Chosen:** `fs::canonicalize` + lexical fallback, no case folding.
**Notes:** D-02. Planner picks the lexical helper (`path-clean` crate vs. hand-rolled).

---

## Read-vs-write scope

| Option | Description | Selected |
|--------|-------------|----------|
| Write-class tools only (Edit/MultiEdit/Write/NotebookEdit/Bash-with-target) | Tight v1 scope; matches Phase 8 D-19 write-class shape; Reads still gate via protected_paths. | ✓ |
| Also gate Reads against an actively-written file | Real failure class (stale reads) but scope-exploding; users can add globs to protected_paths for files they want strict on. | |
| Gate every tool (back to tool-category) | Defeats the whole phase. | |

**Chosen:** Write-class only in v1.
**Notes:** D-06. Read-vs-write gating → deferred (see `<deferred>` in CONTEXT.md).

---

## Approval row enrichment

| Option | Description | Selected |
|--------|-------------|----------|
| Add `conflict_with_agent_id` + `gate_reason` columns; render conflict line on `ApprovalRequestCard` | Makes the "why am I being asked?" immediate and glanceable; matches Command Horizon one-click-resolve flow. | ✓ |
| Stuff conflict metadata into existing `response_note` / `tool_input_json` | Opaque to the UI; requires parsing at render time; fragile. | |
| No UI change — users just trust the gate | Defeats the "so users know why" half of the pitch. | |

**Chosen:** Schema extension + card rendering.
**Notes:** D-20..D-23. Migration `007_conflict_gating.sql`.

---

## Legacy tool-category gating layer

| Option | Description | Selected |
|--------|-------------|----------|
| Remove from `/hook` path; default-empty the `pretool_gated_tools` setting; **keep** the storage helpers for future revival | Matches roadmap "replace" framing; clean semantics; power-user escape preserved (~80 LOC dead-but-ready). | ✓ |
| Keep as a secondary layer behind the conflict check | Dilutes the "replace" message; two gating predicates stacked confuses UX. | |
| Rip out `pretool_gated_tools` storage + helpers entirely | Loses the clean revival path for a settings UI later. | |

**Chosen:** Remove from hook path, keep plumbing.
**Notes:** D-18 + D-19.

---

## Bash safelist (read-only commands that instant-allow)

| Option | Description | Selected |
|--------|-------------|----------|
| Narrow list: `ls/pwd/cat/head/tail/echo/wc/which/whoami/date/uname/env/test/[`; `git status/diff/log/show/branch/remote -v/stash list`; `find` only when `-exec/-execdir/-delete/-ok` all absent; never safelist when any redirect operator (`>`, `>>`, `2>`, `&>`, `tee`) appears | Covers ~90% of common read-only agent bash traffic without opening footguns. | ✓ |
| No safelist — parse everything | Parser runs on trivially safe commands; minor CPU waste; no harm but no benefit either. Chose safelist for latency posture. | |
| Broad safelist (anything in a curated allowlist of tools) | Easy to slip a mutating option into a "safe" tool (`git worktree add`, `git reset --hard`, `find -delete`); risky. | |

**Chosen:** Narrow, redirect-aware safelist.
**Notes:** D-11.

---

## Bash parser target verbs

| Option | Description | Selected |
|--------|-------------|----------|
| Redirects + explicit-path POSIX utils (cp/mv/rm/touch/mkdir/tee/patch/sed -i/awk -i inplace/dd of=/install); shell-operator-aware segment splitting; **no** compiler/build-output inference | Narrow, explicit, auditable. Covers direct-mutation cases; punts guesswork. | ✓ |
| Add compiler/build heuristics (`cargo build → target/`, `rustc -o PATH`, `npm install → node_modules/`) | Guess-heavy; cross-tool drift over time; build-output paths rarely conflict anyway (per-tool isolated). | |
| Minimal — only redirects | Misses the obvious `rm -rf`/`mv` destructive classes; too narrow. | |

**Chosen:** Narrow POSIX-util + redirect parser; no compiler inference.
**Notes:** D-12.

---

## Claude's Discretion

Items deferred to planner judgement (captured verbatim in `17-CONTEXT.md` `<decisions>` § Claude's Discretion):

- Exact crate for Bash argv splitting (`shell-words` vs. hand-rolled).
- Exact lexical-normalization helper (`path-clean` vs. hand-rolled).
- Internal shape of `could_conflict_with` — method on `ConflictEngine` directly, or behind a thin `ActiveFiles` view struct. Contract is locked, placement is not.
- Whether `gate_reason` is a typed `GateReason` enum across the stack or a plain string at the DB/IPC boundary.
- Whether the approval-card conflict line lives inside `ApprovalRequestCard` or in a new `ConflictChip` component.
- Tracing key names and log levels for the Bash-parser audit trail.
- Optional dev-only `dump_conflict_index` Tauri command for multi-agent test debugging.

---

## Deferred Ideas

Ideas raised during analysis that belong outside Phase 17 (captured in `17-CONTEXT.md` `<deferred>`):

- Read-vs-write gating (Reads against actively-written files).
- Import-graph / module-cluster conflict scope (Q1 option c) — blocked on Phase 16.
- Directory-widening conflict scope (Q1 option b).
- Predictive / intent-based conflict avoidance (agents announce intent pre-write).
- Cross-worktree / cross-repo conflict tracking.
- Pending-hook-row claims — D-17 race mitigation. Add if UAT surfaces the pathological case.
- Bash compiler/build-output inference.
- Destructive-pattern highlighting on Bash previews.
- Settings UI for `pretool_gated_tools` revival.
- `GateReason` typed enum across the whole stack.
- Dev-only `dump_conflict_index` Tauri command.
