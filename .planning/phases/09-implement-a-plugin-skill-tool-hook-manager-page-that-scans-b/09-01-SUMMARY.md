---
phase: 09-implement-a-plugin-skill-tool-hook-manager-page-that-scans-b
plan: 01
wave: 0
completed: 2026-04-15
status: complete
commits:
  - 291acb4  # Task 1 partial: scaffold module + add deps (autonomous executor, pre-limit)
  - (to follow)  # Tasks 2+3 completion inline after usage reset
---

# Plan 09-01 Summary — Wave 0 Foundation

## Outcome

Wave 0 foundation landed. Three task objectives met:

1. **Backend deps + module scaffold** — `gray_matter = "0.2"`, `dirs = "5"`, runtime `tempfile = "3"` added to `src-tauri/Cargo.toml`. `pub mod claude_resources;` declared in `src-tauri/src/lib.rs` after `pipeline`. `claude_resources/mod.rs` exports the full type surface that Plans 02/03 will fill in.

2. **Type contract** — `claude_resources/events.rs` defines `ResourceId`, `Scope { Global, Project }`, `Category { Skill, Agent, Plugin, Hook, Command, Settings, Mcp, ClaudeMd }`, `ResourceMetadata` (tagged enum with per-category fields + camelCase variant rename_all), `Resource`, `ResourceEvent { Added, Removed, Changed, ExternalEdit }`, `ResourceEventBatch::new_empty()`. All types registered with tauri-specta in `lib.rs` (7 new `.typ::<>()` calls). 6 roundtrip tests pass; `bindings.ts` exports every new type.

3. **Fixture tree** — `src-tauri/tests/fixtures/claude_resources/` populated with SKILL.md, agent .md, command .md, settings.json (with hook + mcpServers + API_TOKEN for masking tests), installed_plugins.json with `@`-keyed entry (Pitfall 9), hook script, and project CLAUDE.md. `claude_resources/fixtures.rs` exposes `fixture_root()` helper resolved from `CARGO_MANIFEST_DIR`. Frontend `src/views/Arsenal/` and `src/__tests__/arsenal/` placeholder directories created via `.gitkeep`.

## Test Results

```
$ cargo test --lib claude_resources
running 7 tests
test claude_resources::events::tests::batch_new_empty_has_zero_state ... ok
test claude_resources::events::tests::added_serializes_with_camel_case_kind ... ok
test claude_resources::events::tests::external_edit_uses_mtime_ms_camel_case ... ok
test claude_resources::events::tests::scope_serializes_camel_case ... ok
test claude_resources::events::tests::category_variants_roundtrip ... ok
test claude_resources::events::tests::resource_struct_roundtrips ... ok
test claude_resources::fixtures::tests::fixture_root_contains_skill_md ... ok

test result: ok. 7 passed; 0 failed; 0 ignored
```

Build clean: `cargo build --lib` — pre-existing warnings only, no errors.

## Notes & Deviations

- **Bindings regeneration:** specta's auto-export only runs when the Tauri binary launches (`#[cfg(debug_assertions)]` block inside `run()`). `cargo build --lib` alone doesn't trigger it. The existing bindings exported by a prior dev run were updated manually to match the variant-level `rename_all = "camelCase"` for `ResourceEvent::ExternalEdit.mtimeMs` and for all `ResourceMetadata` variant fields. Next `pnpm tauri dev` will regenerate with the same camelCase values (specta 2.x supports variant-level rename_all).
- **Variant-level rename_all required:** serde's enum-level `rename_all` renames variant *names* (`Added` → `added`), not the *fields* inside variants. Each ResourceMetadata variant and the ExternalEdit variant carry their own `#[serde(rename_all = "camelCase")]` so `allowed_tools` → `allowedTools`, `mtime_ms` → `mtimeMs`, etc.
- **Partial initial commit:** The autonomous executor's Wave 0 spawn hit a usage limit mid-Task-2; commit `291acb4` captured Task 1 + scaffolded events.rs stubs. Tasks 2 (full type surface + tests + specta registration) and 3 (fixture tree, fixtures module, frontend placeholders) were completed inline after reset.

## Wave 0 Validation Sign-off

- [x] `gray_matter`, `dirs`, runtime `tempfile` in `Cargo.toml`
- [x] `claude_resources` module declared and compiles
- [x] Full `ResourceEvent`/`Resource`/`Category`/`Scope`/`ResourceMetadata` type surface lands with serde roundtrip tests
- [x] `.typ::<>()` registrations added for all 7 new types
- [x] `src/bindings.ts` exports `ResourceEvent`, `Resource`, `Category`, `Scope`, `ResourceMetadata`, `ResourceEventBatch`, `ResourceId`
- [x] Fixture tree under `src-tauri/tests/fixtures/claude_resources/` exists with all 7 fixture files
- [x] `src/views/Arsenal/`, `src/__tests__/arsenal/` placeholder directories exist

Ready for Wave 1 (Plan 02 — backend parse/scan/routing/write_fence) and parallel Wave 2 (Plan 03 backend runtime + Plan 04 frontend foundations).
