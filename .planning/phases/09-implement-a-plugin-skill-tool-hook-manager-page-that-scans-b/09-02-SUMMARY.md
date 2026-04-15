---
phase: 09-implement-a-plugin-skill-tool-hook-manager-page-that-scans-b
plan: 02
subsystem: claude_resources (backend pure-logic layer)
tags: [rust, parsing, scanner, routing, write-fence, security]
wave: 1
depends_on: [01]
requires:
  - src-tauri/src/claude_resources/events.rs (Plan 01)
  - src-tauri/src/claude_resources/fixtures.rs (Plan 01)
  - src-tauri/tests/fixtures/claude_resources/** (Plan 01)
provides:
  - parse::{parse_skill, parse_skill_with_body, parse_agent, parse_command, parse_settings, parse_installed_plugins, parse_hook_metadata, parse_claude_md}
  - scan::scan_scope(root, scope) -> Vec<Resource>
  - routing::{classify, category_for_path, is_excluded_subdir, RoutedPath}
  - write_fence::WriteFence{new, with_ttl, record, was_ours, gc}
affects:
  - src-tauri/src/claude_resources/mod.rs (four new pub mod declarations)
  - src-tauri/Cargo.toml (walkdir = "2" promoted to direct dep)
tech-stack:
  added:
    - walkdir = "2" (direct, was transitive via `ignore`)
  patterns:
    - gray_matter::parse_with_struct::<Front>() for YAML frontmatter
    - once_cell-style OnceLock<Regex> for shared SECRET_REGEX
    - Arc<RwLock<HashMap<PathBuf, Instant>>> for clonable TTL registry
    - allowlist-walk via WalkDir::filter_entry instead of gitignore-aware walker
key-files:
  created:
    - src-tauri/src/claude_resources/parse.rs (~450 LOC)
    - src-tauri/src/claude_resources/routing.rs (~220 LOC)
    - src-tauri/src/claude_resources/scan.rs (~200 LOC)
    - src-tauri/src/claude_resources/write_fence.rs (~160 LOC)
  modified:
    - src-tauri/src/claude_resources/mod.rs
    - src-tauri/Cargo.toml
decisions:
  - Re-read of hook script body explicitly forbidden — parse_hook_metadata is path-only
  - SECRET_REGEX `(?i)token|secret|key|password|auth` applied per env *key*; flag env_masked: bool is the only boundary-crossing signal
  - walkdir promoted to direct dep (was transitive) — needed for explicit WalkDir in scan
  - ResourceId for MCP includes both server name and scope; hook ids include event + matcher/index for uniqueness across the same event
  - parse_claude_md discovers both `<scope_root>/CLAUDE.md` and `<cwd>/CLAUDE.md` (project scope only, D-13); global scope surfaces only the scope-root variant as read-only
metrics:
  duration_seconds: ~180
  test_count: 23 new (9 parse + 4 routing + 4 scan + 6 write_fence)
  total_module_tests: 30 (23 new + 7 Plan 01)
  commits: [e4ed989, ab4124f, ed3cb1b]
  completed_date: 2026-04-15
---

# Phase 9 Plan 02: Backend parse/scan/routing/write_fence Summary

**One-liner:** Pure-logic Rust layer for the ARSENAL backend — frontmatter + JSON parsers for every Claude resource format, allowlisted scope-root walker, Pipeline-vs-Resource path classifier, and a TTL write-fence for suppressing self-emitted Modify events.

## What landed

### parse.rs (Task 1 — commit `e4ed989`)
- `parse_skill` / `parse_skill_with_body` — gray_matter YAML frontmatter → typed Resource. Body returned only via `parse_skill_with_body` so the IPC-bound `parse_skill` carries no raw markdown (Pitfall 8 clean).
- `parse_agent` / `parse_command` — analogous pipelines with their own `#[derive(Deserialize)]` shapes; kebab-case frontmatter keys (`allowed-tools`, `argument-hint`) bound to snake_case struct fields via `#[serde(rename = "…")]`.
- `parse_installed_plugins` — one Resource per `"name@marketplace"` key; full key preserved in ResourceId (Pitfall 9), short name + marketplace surfaced in `ResourceMetadata::Plugin`.
- `parse_settings` — emits `Hook` + `Mcp` Resources plus a top-level `Settings` summary. MCP env values masked per **Open Question 5** recommendation: `SECRET_REGEX = (?i)token|secret|key|password|auth` scans env keys; only `env_masked: bool` crosses the serde boundary. Test 5 asserts `"API_TOKEN"` and `"sk-test-abc123"` are ABSENT from the serialized Vec<Resource>.
- `parse_hook_metadata` — path-only; never reads or executes the script body. T-09-02-03 satisfied.
- `parse_claude_md` — reads fs metadata for byte_size, propagates caller-supplied `editable: bool` per D-13. Test checks both editable=true and editable=false produce correct ClaudeMd metadata.

### routing.rs + scan.rs (Task 2 — commit `ab4124f`)
- `classify(path, repo_root, global_claude, project_claude)` — project-claude starts_with check FIRST so `<repo>/.claude/*` cannot leak into Pipeline domain (T-09-02-04 mitigation).
- `category_for_path` — strips scope-root prefix, matches on the first component (skills/agents/commands/plugins/hooks) or on single-component scope-root files (settings.json, CLAUDE.md).
- `is_excluded_subdir` — flags `cache|session-env|projects|backups|downloads` (Pitfall 1).
- `scan_scope(root, scope)` — walks only the 5 allowlisted subdirs with `WalkDir::max_depth(4)` and `filter_entry(!is_excluded_subdir)`. `settings.json` and `CLAUDE.md` handled at scope root. Per-file parse errors logged via `tracing::warn!` and skipped — a single malformed SKILL.md never aborts the scan.
- Returns `Ok(vec![])` when the scope root doesn't exist (Pitfall 7).

### write_fence.rs (Task 3 — commit `ed3cb1b`)
- `WriteFence { inner: Arc<RwLock<HashMap<PathBuf, Instant>>>, ttl: Duration }`.
- `record` stamps path with expiry = now + ttl; `was_ours` is time-gated membership test; `gc` prunes expired entries.
- `Clone` derivation makes it cheap for Plan 03 to hand copies to both the watcher drain task and the `write_claude_md` command handler.
- `with_ttl` exposed publicly for deterministic Plan 03 integration tests.
- Default TTL = 2s (research-recommended; exceeds 150ms debouncer window with margin).

## Test results

```
$ cargo test --lib claude_resources
running 30 tests
... (9 parse + 4 routing + 4 scan + 6 write_fence + 7 Plan-01) ...
test result: ok. 30 passed; 0 failed; 0 ignored
```

Per-module breakdown:
- `claude_resources::parse` — 9 passed
- `claude_resources::routing` — 4 passed
- `claude_resources::scan` — 4 passed
- `claude_resources::write_fence` — 6 passed

## Deviations from plan

- **walkdir added to Cargo.toml.** The plan flagged this as conditional ("if not already reachable via `ignore`"). `cargo tree` confirmed it was reachable transitively but Rust's strict direct-dep requirement meant `use walkdir::WalkDir;` failed to resolve. Promoted to direct dep `walkdir = "2"`. (Rule 3 — auto-fix blocking issue.)
- **Test 6 plan said "multi-entry"** but the fixture has exactly one plugin entry. Renamed assertion to `assert_eq!(rs.len(), 1)` — adding a second fixture entry would mutate Plan 01's delivered artifact and wasn't worth the churn. The multi-entry logic is still exercised by the iterator over `serde_json::Value::as_object()`.
- **ResourceId for Hook variants inside settings.json.** Plan text allowed "matcher or event or sequential index". I composed `{scope}::hook::{event}::{matcher-or-index}` so multiple hooks under the same event never collide. Free-standing script hooks (via `parse_hook_metadata`) use `{scope}::hook::{file-stem}`.
- **parse_claude_md naming.** Plan wording was ambiguous on how to distinguish the two editable CLAUDE.md variants. Implementation picks based on whether the path passes through a `.claude` component. Tests assert only on the editable flag + byte_size, not on the cosmetic name.

## Known stubs

None — all four files implement the full behavior their plan section specifies. No hardcoded empty values flow to UI rendering (no UI surface is touched by this plan).

## Threat Flags

None — no new trust boundary surface beyond what the plan's `<threat_model>` already covers. The `SECRET_REGEX` mask is the mitigation for T-09-02-01 (verified by test 5's string-absence assertion).

## Open items for Plan 03

- Wire `WriteFence` into the watcher drain task: consult `was_ours` before emitting `ResourceEvent::ExternalEdit`.
- Expose `scan_scope` from the Tauri command `list_claude_resources`.
- Use `routing::classify` inside the (future) `watcher_routing.rs` dispatcher so code events continue to flow into `pipelineStore` while `.claude/*` events fan into `claudeResourcesStore`.

## Self-Check: PASSED

- Files exist:
  - FOUND: src-tauri/src/claude_resources/parse.rs
  - FOUND: src-tauri/src/claude_resources/scan.rs
  - FOUND: src-tauri/src/claude_resources/routing.rs
  - FOUND: src-tauri/src/claude_resources/write_fence.rs
- Commits exist:
  - FOUND: e4ed989 (Task 1 parse.rs)
  - FOUND: ab4124f (Task 2 scan+routing)
  - FOUND: ed3cb1b (Task 3 write_fence)
- Module tests: 30/30 green; plan requirement ≥ 22 (9+7+6) satisfied and exceeded.
