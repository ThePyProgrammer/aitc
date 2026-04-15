---
phase: 07
plan: 02
subsystem: radar-graph
tags: [dependencies, tree-sitter, rust, rayon, wave-2]
dependency_graph:
  requires:
    - 07-01 (deps module skeleton, grammars, fixtures, radarStore graph slots)
  provides:
    - Real tree-sitter parsing for TS/TSX/JS/JSX/Rust/Python
    - Per-language import resolution (TS relative + tsconfig paths, Rust crate/mod/self/super, Python relative + __init__.py)
    - build_dependency_graph parallel orchestrator with DependencyGraphResult { edges, degraded, unresolved_count }
    - T-07-A, T-07-B, T-07-C mitigations active and tested
    - 10k-file benchmark asserting <2s (measured 211-222ms release)
    - get_dependency_graph Tauri command returns real in-repo edges
  affects:
    - src-tauri/src/pipeline/deps/extract.rs
    - src-tauri/src/pipeline/deps/resolve.rs
    - src-tauri/src/pipeline/deps/queries/python.rs
    - src-tauri/src/pipeline/deps/mod.rs
    - src-tauri/src/pipeline/commands.rs
    - src-tauri/tests/dep_graph_bench.rs
tech_stack:
  added: []
  patterns:
    - thread_local! Parser + Query cache per rayon worker (amortizes S-expression compile — required to hit D-24)
    - Lexical path normalization + pre-canonicalized repo_root for T-07-B (avoids per-edge canonicalize() syscalls; fallback path preserves safety for symlink trees)
    - rayon::par_iter().map(...).collect::<Vec<Vec<_>>>() with serial second-pass for MAX_TOTAL_EDGES (keeps the cap check single-threaded and deterministic)
    - tree-sitter ParseOptions::progress_callback for wall-clock parse budget (replaces removed set_timeout_micros API in 0.26)
key_files:
  created:
    - src-tauri/tests/dep_graph_bench.rs
  modified:
    - src-tauri/src/pipeline/deps/mod.rs
    - src-tauri/src/pipeline/deps/extract.rs
    - src-tauri/src/pipeline/deps/resolve.rs
    - src-tauri/src/pipeline/deps/queries/python.rs
    - src-tauri/src/pipeline/commands.rs
    - .planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/deferred-items.md
decisions:
  - "thread_local! Parser + Query cache — first correctness-preserving path to D-24; without it, 10k bench takes 24s (100× slower than target). Tests pass identically either way."
  - "Lexical normalize + canonical-root starts_with for T-07-B instead of canonicalize(candidate) per edge — saves ~50k realpath(3) calls on 10k repos. Fallback canonicalize path kept for symlinked trees. Callers must pass already-canonicalized repo_root (commands.rs::start_watch already does)."
  - "Python query broadened from module_name: (dotted_name) to module_name: (_) so relative_import nodes match — Plan 01 query silently dropped every `from .foo import bar`."
  - "DependencyGraphResult.unresolved_count counted but not yet surfaced over IPC — reserved for UI-SPEC {N}_IMPORTS_UNRESOLVED pill in a later plan."
  - "MAX_EDGES_PER_NODE=200 / MAX_TOTAL_EDGES=100_000 chosen from RESEARCH §Security Domain + D-23 `10k nodes acceptable with progressive culling` envelope."
metrics:
  duration: "~75min (2 tasks, 1 perf-regression discover+fix cycle)"
  tasks: 2
  files: 6
  completed: "2026-04-15T05:50:00Z"
  benchmark_10k_ms: 211
  benchmark_edges: 50000
---

# Phase 7 Plan 2: Rust Dependency Extraction Summary

Completed the Rust-side tree-sitter-driven dependency extractor for the graph-based radar (Phase 7). Six languages now parse: TypeScript, TSX, JavaScript, JSX, Rust, Python. Per-language resolvers convert specifiers to absolute repo-relative paths honoring relative imports, tsconfig `paths` aliases, Rust `mod` declarations / `crate::` / `super::` walks, and Python package `__init__.py`. The public `build_dependency_graph` entry point fans parse work across rayon workers, emits `DependencyGraphResult { edges, degraded, unresolved_count }`, and enforces all three STRIDE mitigations (T-07-A file-size + parse-time caps, T-07-B path-traversal containment, T-07-C per-node + total edge caps). The 10k-file benchmark settles in **211ms** release — 10× faster than the D-24 target.

## Execution

### Task 1 — Tree-sitter extractors + per-language resolvers (commit a6e0d3f)

Implemented `extract.rs::parse_and_extract` and `extract_imports`. Parses source via tree-sitter, runs the per-language S-expression query from Plan 01, and returns `Vec<RawImport>` with `{spec, kind}` mapped from `pattern_index`. TS/TSX/JS/JSX pattern 0 distinguishes `import type ...` vs regular `import ...` by peeking the outer `@import` capture's source text (`TypeOnly` vs `Import`). Rust uses pattern 0/1 for `Use`/`ModDecl`. Python uses 0/1 for `ImportStmt`/`FromImport`.

Implemented `resolve.rs::resolve_import` master dispatch + 3 per-language resolvers:
- `resolve_ts_import` — handles `./foo`, `../bar`, `@/alias/x` (with `ResolveContext.tsconfig_paths`), directory `index.*` fallback, bare specifiers → `None` (D-07).
- `resolve_rust_import` — single-segment = `mod sibling;` (sibling `.rs` or `sibling/mod.rs`); `crate::foo::Bar` → `repo_root/src/foo.rs` (drops final item segment); `self::` / `super::` walk upward from `from_file.parent()`; external crates (`std::...`) → `None`.
- `resolve_python_import` — leading-dot count = parents to walk; absolute dotted path rooted at `repo_root`; `.py` file or `__init__.py` package resolution.

T-07-A (parse DoS): `MAX_FILE_SIZE_BYTES = 1_048_576` short-circuits with empty Vec + TRACE log. `MAX_PARSE_DURATION = 500ms` enforced via `ParseOptions::progress_callback` (the `set_timeout_micros` API was removed in tree-sitter 0.26 — deviation Rule 3, documented below).

T-07-B (path traversal): `resolve_import` lexically normalizes the resolved candidate and asserts `starts_with(&canonical_repo_root)`. Fallback `canonicalize()` path preserved for symlinked trees. Test `path_traversal_blocked` constructs a `../../…/secret.ts` spec targeting an *outside* tempdir and asserts `None`.

**Plan 01 query bug fix (Rule 1):** the Python query only matched `module_name: (dotted_name)`, silently dropping every `from .foo import bar`. Broadened to `module_name: (_)`.

14 unit tests green — `ts_imports`, `tsx_imports`, `js_imports`, `jsx_imports`, `rs_imports`, `py_imports`, `file_size_cap_skipped`, `ts_relative`, `tsconfig_alias`, `external_skipped`, `ts_index_file`, `rust_mod_decl`, `python_relative_from`, `python_relative_from_pkg`, `path_traversal_blocked`.

### Task 2 — Parallel orchestrator + caps + 10k benchmark (commit a447622)

`mod.rs::build_dependency_graph` fans parse + resolve work via `rayon::par_iter()`. Per-file batch is capped at `MAX_EDGES_PER_NODE = 200` with a `tracing::warn!` when the cap trips. Second serial pass concatenates batches under `MAX_TOTAL_EDGES = 100_000`; when exceeded, appends remaining capacity, sets `degraded = true`, and breaks. Unresolved specifiers increment a shared `AtomicUsize` for the `unresolved_count` pill reserved for future UI-SPEC work.

Returns `DependencyGraphResult { edges, degraded, unresolved_count }`. `commands.rs::get_dependency_graph` unpacks `.edges` through the existing repo-relative-forward-slash DTO pipeline; logs `degraded` at WARN.

5 module-level tests green — `small_repo_resolves_in_repo_edges` (a→b→c, react=external, unresolved=1), `per_node_edge_cap_enforced` (250 imports → exactly 200 edges), `mixed_language_repo_extracts_per_language_edges` (TS + Rust + Python coverage), `build_dependency_graph_stub_returns_empty`, `unsupported_extensions_are_ignored`.

**Benchmark (`cargo test --release --test dep_graph_bench -- --ignored --nocapture`):**
- 10,000 synthetic `.ts` files × 200 LOC × 5 imports each → 50,000 edges
- Release build, 14-core Intel Core Ultra 5 235U
- **Measured: 211-222ms** (two runs), well under the **2000ms D-24 target**
- `degraded=false, unresolved=0`

**Perf journey (Rule 1 fixes):**
1. First benchmark run: **24.3s** — 12× over target.
2. Hypothesis A (per-edge `.canonicalize()` syscalls): lexical normalize + canonical-root starts_with. Re-ran: still 24.3s. Hypothesis wrong.
3. Added a scratch `tests/profile_bench.rs` breaking out serial parse vs parallel parse. Discovered: serial parse of 1000 files = 12.8s. Root cause: **`Query::new` from the S-expression string compiles on every single call to `extract_imports`** (50k times at 10k scale).
4. Added `thread_local! { PARSERS: …, QUERIES: … }` arrays indexed by `SourceLanguage`. Rayon reuses the same worker threads across iterations, so one parser + one query per language per thread ≈ 6 × 14 = 84 compiles total. Scratch profile file removed before commit.
5. Re-ran: **222ms → 211ms**. Target hit with an order of magnitude headroom.

Both the lexical normalize (Hypothesis A) and the parser/query cache (Hypothesis B) were kept — they compound. The normalize fix also removes a canonicalize-both syscall pair from every resolution, which will matter on very symlink-heavy trees.

## Commits

- `a6e0d3f` — feat(07-02): implement tree-sitter extractors + per-language import resolvers
- `a447622` — feat(07-02): build_dependency_graph parallel orchestrator + 10k benchmark (222ms)

## Verification

- `cd src-tauri && cargo test --lib pipeline::deps::` — **21 passed, 0 failed** (17 extract/resolve + 4 mod.rs + 1 stub; `detect_language` inherits from Plan 01).
- `cd src-tauri && cargo test --release --test dep_graph_bench -- --ignored bench_dep_graph_10k --nocapture` — **PASSED in 211ms** (`assert!(elapsed.as_millis() < 2000)` held; also asserts `edges > 40_000`, got 50,000).
- `cd src-tauri && cargo build --lib` — succeeds in 45s (clean rebuild after the perf refactor).
- `grep -q "MAX_FILE_SIZE_BYTES: u64 = 1_048_576" src-tauri/src/pipeline/deps/extract.rs` — OK (T-07-A).
- `grep -qE "set_timeout_micros|progress_callback" src-tauri/src/pipeline/deps/extract.rs` — OK (T-07-A, matches `progress_callback`).
- `grep -q "starts_with(&canonical_root)" src-tauri/src/pipeline/deps/resolve.rs` — OK (T-07-B).
- `grep -q "par_iter" src-tauri/src/pipeline/deps/mod.rs` — OK.
- `grep -q "MAX_EDGES_PER_NODE: usize = 200" src-tauri/src/pipeline/deps/mod.rs` — OK (T-07-C).
- `grep -q "MAX_TOTAL_EDGES: usize = 100_000" src-tauri/src/pipeline/deps/mod.rs` — OK (T-07-C).
- `grep -q "DependencyGraphResult" src-tauri/src/pipeline/deps/mod.rs` — OK.

Success criteria all met:
- EMON-01 ✔ (TS/TSX/JS/JSX/Rust/Python parse real imports)
- VIZN-04 backend half ✔ (10k in 211ms, measured not extrapolated)
- 14 unit tests + 4 mod integration tests ✔
- 10k benchmark prints actual elapsed + asserts <2000ms ✔
- Three threat mitigations active + tested ✔
- `get_dependency_graph` Tauri command wired to real orchestrator ✔

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — API] `set_timeout_micros` removed in tree-sitter 0.26**

- **Found during:** Task 1 initial implementation
- **Issue:** Plan action step 1 specified `parser.set_timeout_micros(MAX_PARSE_DURATION.as_micros() as u64)`. That method was removed in tree-sitter 0.26 (confirmed via `grep ~/.cargo/registry/.../tree-sitter-0.26.8/binding_rust/lib.rs` — only `ParseOptions::progress_callback` exists). Plan based its snippet on 0.25 API.
- **Fix:** Replaced with `ParseOptions::new().progress_callback(&mut |state| { if started.elapsed() > MAX_PARSE_DURATION { Break } else { Continue } })` passed to `parser.parse_with_options`. Semantics preserved (wall-clock budget enforced).
- **Files modified:** `src-tauri/src/pipeline/deps/extract.rs`
- **Commit:** a6e0d3f

**2. [Rule 1 — Bug] Plan 01 Python query silently dropped all relative imports**

- **Found during:** Task 1 `py_imports` test iteration
- **Issue:** Plan 01's `PYTHON_IMPORTS` query was `(import_from_statement module_name: (dotted_name) @path) @from`. The Python grammar distinguishes `relative_import` from `dotted_name`; `from .foo import bar` is `module_name: (relative_import ...)`, which didn't match. All 2 relative imports in the fixture (`from .foo import bar`, `from ..baz import qux`) were dropped — `py_imports` test failed with `expected 2 FromImport, got 0`.
- **Fix:** Broadened to `module_name: (_)` so both node types match. The extractor uses the literal source text of the captured node, so relative-dot prefixes flow through to the resolver, which already handles them.
- **Files modified:** `src-tauri/src/pipeline/deps/queries/python.rs`
- **Commit:** a6e0d3f

**3. [Rule 1 — Perf] Tree-sitter `Query::new` hot-path recompile drives 10k bench to 24s**

- **Found during:** Task 2 initial benchmark run
- **Issue:** `extract_imports` called `Query::new(&lang_obj, query_str)` on every invocation — 50,000 query compiles for the 10k benchmark. Compiling the TypeScript import query was the dominant cost (≈2-5ms each on this CPU). First benchmark: 24.3s against a 2s target.
- **Fix:** Added `thread_local! { static PARSERS / QUERIES }` arrays indexed by `SourceLanguage` (6 slots each). Rayon worker threads reuse their cached `Parser`/`Query` across all files they handle — amortizing the compile cost to one-time per thread per language. No correctness change; all 21 unit tests pass unchanged. Benchmark: 211-222ms.
- **Files modified:** `src-tauri/src/pipeline/deps/extract.rs`
- **Commit:** a447622

**4. [Rule 1 — Perf] Per-edge double-`.canonicalize()` burns syscalls**

- **Found during:** Task 2 benchmark investigation
- **Issue:** The T-07-B containment check canonicalized *both* the candidate and `repo_root` on every `resolve_import` call — 100k `realpath(3)` syscalls at 10k scale. Note: this alone wasn't the dominant cost (kept the benchmark at 24s), but it compounds with the Query fix and will matter on larger repos.
- **Fix:** `resolve_import` now lexically normalizes the candidate (cheap `.`/`..` fold) and does `starts_with(canonical_repo_root)`. Callers pass an already-canonicalized `repo_root` (commands.rs `start_watch` already sets `active.repo_root = strip_unc(canonicalize(...))`). Fallback canonicalize-both path retained — kicks in only when lexical check fails, which happens only for symlinked trees. The path-traversal test still enforces containment.
- **Files modified:** `src-tauri/src/pipeline/deps/resolve.rs`
- **Commit:** a447622

**5. [Rule 3 — Plan Accuracy] `-p aitc_lib` flag doesn't match Cargo package name**

- **Found during:** Task 1 test run
- **Issue:** Plan verification commands use `cargo test -p aitc_lib pipeline::deps...`, but the package name in `src-tauri/Cargo.toml` is `aitc` (`aitc_lib` is the `[lib]` name, not a package name). Cargo rejects `-p aitc_lib` with "package ID specification did not match any packages".
- **Fix:** Dropped the `-p` flag and used `cargo test --lib pipeline::deps::` instead. This runs exactly the same tests from the same lib target.
- **Files modified:** none (test invocations only)
- **Commit:** N/A

## Deferred Issues

See `deferred-items.md` in the phase directory. Already-documented pre-existing issues:
- `src/bindings.ts` TS6133/TS2440 errors on `npm run build` (present on commit 216a65b before Phase 07).
- `agentStore.test.ts > launchAgent` failing (same).
- Newly flagged in this plan: **`conflict::engine::tests::test_conflict_detected_different_pids_within_window` and `test_custom_window_duration`** both fail on the base commit `e6b55d1` (verified via `git checkout e6b55d1 -- src-tauri/src/conflict/engine.rs && cargo test --lib conflict::engine::tests`). Out of scope per the Scope Boundary rule.

## Self-Check: PASSED

Verified file existence:
- `src-tauri/src/pipeline/deps/extract.rs` — FOUND
- `src-tauri/src/pipeline/deps/resolve.rs` — FOUND
- `src-tauri/src/pipeline/deps/mod.rs` — FOUND
- `src-tauri/src/pipeline/deps/queries/python.rs` — FOUND
- `src-tauri/src/pipeline/commands.rs` — FOUND
- `src-tauri/tests/dep_graph_bench.rs` — FOUND

Verified commits:
- `a6e0d3f feat(07-02): implement tree-sitter extractors + per-language import resolvers` — FOUND
- `a447622 feat(07-02): build_dependency_graph parallel orchestrator + 10k benchmark (222ms)` — FOUND

Verified runtime:
- `cargo test --lib pipeline::deps::` — 21/21 pass
- `cargo test --release --test dep_graph_bench -- --ignored` — 1/1 pass, 211ms (< 2000ms target)
- All grep acceptance criteria emit OK
