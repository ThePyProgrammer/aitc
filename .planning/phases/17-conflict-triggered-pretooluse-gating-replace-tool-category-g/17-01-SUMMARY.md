---
phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g
plan: 01
subsystem: api
tags: [rust, agents, bash-parser, phase17, shlex, tracing]

# Dependency graph
requires:
  - phase: 08-real-claude-code-hook-integration-pretooluse-approvals
    provides: HookRequest shape, tool_input.command field contract, tracing kind=hook_* conventions
provides:
  - src-tauri/src/agents/bash_paths.rs — pure-Rust Bash command → target-path extractor
  - BashParseResult enum with Safelisted / Targets(Vec<PathBuf>) / ParseFailed variants
  - extract_target_paths(command, cwd) public entry point (CONTEXT D-09)
  - D-11 read-only safelist (13 single-word commands + 6 git subcommands + find-without-destructive)
  - D-12 verb dispatch (cp, mv, rm, touch, mkdir, patch, sed -i, awk -i inplace, dd of=, install, tee + stdout/stderr redirects)
  - D-10 parse-failure fallback (ParseFailed => Allow at hook layer)
  - D-13 audit tracing (kind="bash_parse" on every return arm)
  - shlex 1.3.0 promoted from transitive (via cc) to direct dep in src-tauri/Cargo.toml
affects:
  - 17-02 (canonicalize_for_conflict consumer of Targets(...))
  - 17-05 (/hook gating branch that calls extract_target_paths)
  - any future plan that changes the Bash verb table or audit tracing schema

# Tech tracking
tech-stack:
  added:
    - shlex 1.3.0 (direct dep; already transitive via cc — zero-byte promotion)
  patterns:
    - "Single-purpose pure-Rust module with const &[&str] tables (analog: src-tauri/src/pipeline/ignore_filter.rs)"
    - "Operator-split tokenization pattern using shlex::split + post-pass string compares on SHELL_OPERATORS"
    - "Audit tracing key (kind=bash_parse) emitted on every return arm with bounded fields (command_len, tokens, result) — never the raw command string"

key-files:
  created:
    - src-tauri/src/agents/bash_paths.rs
  modified:
    - src-tauri/Cargo.toml  # direct-dep promotion of shlex 1.3.0

key-decisions:
  - "Used shlex 1.3.0 (already transitive via cc) rather than shell-words; Option<Vec<String>> return maps cleanly to BashParseResult::ParseFailed; zero new bytes at build time"
  - "has_redirect pre-check uses a naive command.contains('>') string scan; accepts the rare false-positive (quoted > inside a safelisted command) in exchange for O(1) cost"
  - "Heredoc ParseFailed verified empirically: shlex tokenizes `cat <<EOF\\nfoo\\nEOF` as [cat, <<EOF, foo, EOF]; cat is not in the verb table, <<EOF is not in REDIRECT_TOKENS, so targets is empty → ParseFailed (D-10 escape hatch)"
  - "Verb dispatch for sed -i skips the first non-flag positional as the sed expression, then captures the last remaining non-flag positional as the target path (handles quoted regex like 's/a/b/' correctly after shlex strips quotes)"
  - "cp/mv/install dispatch scans positionals with redirect-token awareness (skipping the token after any redirect operator) so `cp a b > log` yields both /repo/b and /repo/log without double-counting"

patterns-established:
  - "Pure-Rust parser module: hardcoded const tables + single pub fn + #[cfg(test)] mod tests at bottom — matches the established in-repo analog at src-tauri/src/pipeline/ignore_filter.rs"
  - "Tracing contract for parser audit: kind='bash_parse' emitted on every return arm with bounded fields (command_len, tokens, result variant name); NEVER the raw command string"
  - "Dep-ordering defensive pattern: when Wave 1 siblings depend on the same Cargo.toml addition, the consumer plan owns its own shlex line (placed far from other sibling additions to avoid merge conflict surface)"

requirements-completed:
  - CNFL-01
  - CNFL-02
  - CNFL-06

# Metrics
duration: 18min
completed: 2026-04-21
---

# Phase 17 Plan 01: bash_paths module + safelist Summary

**Pure-Rust Bash command → target-path extractor with 13-verb dispatch, 19-entry safelist, operator split, and 25-test coverage — the entire parser surface for Phase 17's conflict-gate predicate, landing shlex 1.3.0 as a direct dep to defuse Wave 1 sibling ordering.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-04-21T12:06:36Z
- **Completed:** 2026-04-21T12:24:15Z
- **Tasks:** 3 (all atomic commits per CLAUDE.md "commit after every change" rule)
- **Files modified:** 2 (`src-tauri/Cargo.toml` additive, `src-tauri/src/agents/bash_paths.rs` new)

## Accomplishments

- **shlex direct-dep promotion.** One-line addition to `[dependencies]` in `src-tauri/Cargo.toml` (Task 0) eliminates the Wave 1 sibling ordering race: any parallel plan that imports shlex now resolves the crate at the top level regardless of which wave member lands first. `cargo tree --package aitc --depth 1 | grep shlex` confirms direct-dep status.
- **bash_paths.rs — full parser surface.** 250+ lines of pure-Rust single-purpose module exposing:
  - `pub enum BashParseResult { Safelisted | Targets(Vec<PathBuf>) | ParseFailed }`
  - `pub fn extract_target_paths(command: &str, cwd: &Path) -> BashParseResult`
  - Private helpers: `split_on_operators`, `resolve`, `parse_one_segment`
  - Four const tables: `SINGLE_WORD_SAFELIST` (13), `GIT_SAFE_SUBCMDS` (6), `DESTRUCTIVE_FIND_FLAGS` (4), `SHELL_OPERATORS` (4), `REDIRECT_TOKENS` (4)
- **25 unit tests, all passing.** 9 from Task 1 (safelist + D-10 base cases) + 16 from Task 2 (verb dispatch + operator split + path resolution + extended ParseFailed). Run via `cargo test --package aitc --lib agents::bash_paths`.
- **T-17-01 mitigation shape locked.** Audit tracing `kind = "bash_parse"` fires on 8 distinct emit sites (every return arm in every branch), and the field set is bounded: `command_len`, `tokens`, and `result` — NEVER the raw `command` string. This is the three-layer defense from the plan's `<threat_model>` section: audit + no-leak + boundary-pinned tests.

## Task Commits

Each task was committed atomically:

1. **Task 0: Cargo.toml — promote shlex to direct dep** — `82e02ac` (chore)
2. **Task 1: bash_paths module skeleton + safelist + 9 unit tests** — `c02211c` (feat)
3. **Task 2: bash_paths verb dispatch + operator split + 16 tests** — `5d9d279` (feat)

**Plan metadata:** this SUMMARY commit follows.

## Files Created/Modified

- `src-tauri/src/agents/bash_paths.rs` (NEW, ~420 LOC) — Full parser module with BashParseResult enum, public extract_target_paths function, private verb-dispatch helpers, and inline `#[cfg(test)] mod tests` with 25 unit tests covering D-10, D-11, D-12, and path-resolution invariants.
- `src-tauri/Cargo.toml` (MODIFIED, +9 lines) — Promote shlex 1.3.0 from transitive (via cc) to direct dep, placed after the Phase 8 tauri-plugin-shell block (far from Plan 02's `path-clean` addition to keep parallel Cargo.toml edits on distinct lines).
- `src-tauri/Cargo.lock` (MODIFIED, +1 line) — Auto-regenerated by cargo; adds shlex to aitc's direct-dep list.

## Tracing key emit sites (for Plan 05 integration-test grep)

Plan 05's integration tests will grep on `kind = "bash_parse"` to verify audit coverage. The 8 emit sites in `bash_paths.rs` are:

| Line | Branch | result field value |
|------|--------|-------------------|
| ~77 | shlex::split returned None or empty | `"ParseFailed"` (with explanatory message) |
| ~91 | single-word safelist match (13 commands) | `"Safelisted"` |
| ~100 | git subcommand safelist match (6 subcmds) | `"Safelisted"` |
| ~113 | find-without-destructive safelist | `"Safelisted"` |
| ~132 | verb dispatch yielded no targets | `"ParseFailed"` (with explanatory message) |
| ~143 | verb dispatch yielded one or more targets | `"Targets"` (with target_count field) |

The `command_len` and `tokens` fields are present on every call; `result` is always a static string literal (not a format-args call) so post-hoc log aggregation can simple-match on field value.

## Cargo.toml coordination with Plan 02

Plan 02's `path-clean = "1.0"` addition lives at a different alphabetical position in `[dependencies]` (P-section) while Plan 01's shlex addition is at the S-section after the Phase 8 `tauri-plugin-shell` block. Simultaneous Cargo.toml edits from Plan 01 and Plan 02 will therefore land on distinct lines and merge cleanly without conflict — this was the stated motivation for moving Task 0 into Plan 01 in the revised plan.

## Decisions Made

- **shlex over shell-words.** shlex already in Cargo.lock transitively; zero new bytes. `Option<Vec<String>>` return maps cleanly to `BashParseResult::ParseFailed` via explicit `match` (avoiding the `unwrap_or_default` footgun in RESEARCH Pitfall 2). RESEARCH §2 explicitly rejects shell-words as a no-value-add alternative given the shlex transitive.
- **`has_redirect` cheap pre-check.** `command.contains('>')` is O(N) in command length but done exactly once; the alternative (scan argv after shlex) requires tokenizing first. The false-positive cost (a quoted `>` inside a safelisted command de-safelists it) is low-probability and fails safely (the command still yields `Safelisted` behavior at the hook layer if verb dispatch returns empty → ParseFailed → Allow).
- **Heredoc ParseFailed shape.** Empirically verified via an ignored probe test (removed from the final commit): shlex tokenizes `cat <<EOF\nfoo\nEOF` as `[cat, <<EOF, foo, EOF]`. The parser's REDIRECT_TOKENS set contains only `[>, >>, 2>, &>]` — not `<<EOF` — so the redirect scan finds nothing; `cat` is not in the verb table; targets is empty → ParseFailed → Allow. This matches the CONTEXT D-10 escape hatch by design.
- **`sed -i` expression-positional handling.** Rather than trying to classify quoted sed expressions, the parser treats the FIRST non-flag positional after `-i` as the expression and the LAST non-flag positional as the target path. This is robust to quoted expressions (shlex strips outer quotes) and multi-arg flags.
- **`cp/mv/install` redirect-aware positional scan.** Because `cp a b > log` legitimately writes to both `b` (as cp's destination) and `log` (as the stdout redirect target), the verb dispatch filters out redirect-follower tokens from the "positionals for dst" list; the redirect scan separately captures them. Net result: both targets appear in the returned Vec without double-counting.

## Deviations from Plan

None required by Rule 1/2/3. Three minor execution-time shape adjustments worth documenting:

1. **Shlex probe test added then removed.** Task 2 initially included an `#[ignore]`-ed `shlex_tokenization_probe` test to empirically verify how shlex tokenizes operators and heredocs before writing the verb-dispatch logic. Output captured; probe deleted before final Task 2 commit to keep the final test file focused on asserting behavior, not inspecting dependency internals. This is a test-file hygiene choice, not a plan deviation.

2. **`cargo fmt -- src/agents/bash_paths.rs` reformats the entire workspace.** When invoked from within `src-tauri/`, `cargo fmt` ignores the path-filter and reformats every file in the workspace. I ran `git checkout --` on every unrelated file touched by fmt (57 files across `agents/`, `chat_runtime/`, `claude_resources/`, `comms/`, `conflict/`, `db/`, `mcp/`, `pipeline/`, `tests/`, plus aitc-hook tests) and kept only the formatting changes to `bash_paths.rs` itself. This is a scope-boundary defense per the executor rules ("only auto-fix issues directly caused by the current task's changes"). Pre-existing formatting drift in those files is out of scope for Plan 01.

3. **Cargo.toml `cargo check` does not exit 0 after Task 0.** The plan's Task 0 done-criteria included `cargo check --package aitc --lib` exits 0. This currently fails with `error[E0583]: file not found for module bash_paths` because `src-tauri/src/agents/mod.rs` already contains `pub mod bash_paths;` (landed pre-emptively via Plan 03's mod.rs registration). The error resolves the moment Task 1's file lands. I treated this as a plan-prose ambiguity, not a Rule 4 architectural issue — `shlex` itself resolves correctly at this point (`cargo tree --package aitc --depth 1 | grep shlex` confirms direct-dep). Verification advanced to "cargo test --package aitc --lib agents::bash_paths::tests" as soon as Task 1 completed. All 25 tests pass at the final state.

## Issues Encountered

- **Sidecar binary missing from worktree.** `cargo check --package aitc --lib` initially failed with `resource path binaries/aitc-hook-x86_64-unknown-linux-gnu doesn't exist`. This is a pre-existing Tauri build artefact requirement — the worktree doesn't ship with the pre-built sidecar. I built the sidecar once via `cargo build --package aitc-hook --bin aitc-hook --release` and copied it into `src-tauri/binaries/`; subsequent builds succeeded. This binary is not tracked by git (the worktree `binaries/` dir was already gitignored elsewhere), so no commit changes were needed for this side-effect.
- **Pre-existing clippy errors in sibling files.** `cargo clippy --package aitc --lib --tests -- -D warnings` emits 20+ errors across `conflict/engine.rs`, `chat_runtime/`, `agents/hook_install.rs`, etc. None are in `bash_paths.rs`. These are out of scope for Plan 01 per the executor rules (`<scope_boundary>` — only auto-fix issues directly caused by current task changes). Clippy is clean on `bash_paths.rs` itself.

## User Setup Required

None — no external service configuration. Plan 01 is pure internal parser logic.

## Next Phase Readiness

- **For Plan 02 (canonicalize_for_conflict):** the `Targets(Vec<PathBuf>)` variant's paths are absolute but NOT canonicalized. Plan 02's canonicalize helper should accept `&Path` and return `PathBuf`; apply it to each element of the Vec before passing to the conflict engine's `could_conflict_with` query.
- **For Plan 05 (/hook gating branch):** the call site is `extract_target_paths(&body.tool_input["command"], Path::new(&body.cwd))`. On `BashParseResult::Safelisted` or `BashParseResult::ParseFailed` the hook returns `Allow`; on `BashParseResult::Targets(paths)` the hook canonicalizes each path and issues one `could_conflict_with` query per target (union semantics — any positive match gates).
- **Known follow-ups surfaced by RESEARCH (out of scope for Plan 01):** (a) RESEARCH Pitfall 5 notes `update_pid_mapping` is unused in production — Plan 05 will wire it; (b) RESEARCH §1 notes `conflict_task` bakes window_ms at startup — a known latent issue that Plan 05 routes around by fresh-reading `get_window_ms()` per hook call.

## Self-Check

Verifying all claims before returning:

**Files exist:**
```
FOUND: src-tauri/src/agents/bash_paths.rs
FOUND: src-tauri/Cargo.toml (with shlex line)
FOUND: .planning/phases/17-conflict-triggered-pretooluse-gating-replace-tool-category-g/17-01-SUMMARY.md (this file, being written now)
```

**Commits exist:**
```
FOUND: 82e02ac (Task 0 — Cargo.toml shlex direct-dep)
FOUND: c02211c (Task 1 — bash_paths skeleton + safelist + 9 tests)
FOUND: 5d9d279 (Task 2 — verb dispatch + operator split + 16 tests)
```

**Tests pass:**
```
FOUND: test result: ok. 25 passed; 0 failed; 0 ignored
```

**Grep asserts:**
```
FOUND: pub enum BashParseResult  (1 match)
FOUND: pub fn extract_target_paths  (1 match)
FOUND: SINGLE_WORD_SAFELIST  (2 matches — const decl + contains-use)
FOUND: GIT_SAFE_SUBCMDS  (2 matches)
FOUND: kind = "bash_parse"  (8 matches across extract_target_paths branches)
FOUND: #[test]  (25 matches — one per unit test)
FOUND: fn parse_one_segment  (1 match)
FOUND: fn split_on_operators  (1 match)
NOT-FOUND: let _ = cwd  (0 matches — removed in Task 2 as required)
FOUND: shlex = "1.3.0" in Cargo.toml (line 81)
FOUND: Phase 17 (Plan 01 Task 0) in Cargo.toml (line 75)
```

## Self-Check: PASSED

---

*Phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g*
*Plan: 01*
*Completed: 2026-04-21*
