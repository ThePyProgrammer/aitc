---
quick_id: 260414-k8p
description: Implement CI workflows across OSes (including Arch)
date: 2026-04-14
commits:
  - e29775b
  - 0346d38
  - d8678f9
---

# Quick Task 260414-k8p — Summary

## Outcome

Added GitHub Actions CI covering Linux (Ubuntu + Arch container), Windows, and macOS for both PR checks and tag-triggered Tauri installer builds. Fills the gap identified during the CachyOS compatibility audit — Linux was never CI-tested.

## Files Created

- `.github/workflows/ci.yml` — PR/push checks, 3-OS matrix + `arch-check` container job on `archlinux:latest`
- `.github/workflows/release.yml` — tag-triggered (`v*`) + manual dispatch; uses `tauri-apps/tauri-action@v0` to build `.deb`/`.AppImage`/`.msi`/`.dmg` and attach to a draft release

## Matrix Coverage

| Job | Runner | Purpose |
|-----|--------|---------|
| `check` | ubuntu-24.04 / windows-latest / macos-latest | npm build + vitest + cargo fmt/clippy/check/test |
| `arch-check` | `archlinux:latest` container | CachyOS/Arch parity — build + cargo check/test |
| `release` | ubuntu-22.04 / windows-latest / macos-latest (aarch64 + x86_64) | Tauri installer bundles |

## Key Decisions

- Actions pinned to major version tags per constraints (`@v4`, `@v2`, `@stable`, `@v0`)
- Rust cache via `Swatinem/rust-cache@v2` scoped to `src-tauri -> target`
- Node via `actions/setup-node@v4` with built-in npm cache
- Arch coverage is check-only (no installer build) — the Ubuntu `.deb`/`.AppImage` serve Arch users for distribution
- `working-directory: src-tauri` on all cargo steps since there's no root Cargo workspace

## Not Done / Follow-ups

- Workflows have not been pushed/validated against GitHub Actions — first real run happens on next PR/tag
- No `actionlint` available locally; YAML syntax validated via `yaml.safe_load` only
- Secrets (`TAURI_PRIVATE_KEY`, code-signing certs) not configured — release workflow will build unsigned artifacts until those are added as repo secrets

## Commits

- `e29775b` — add PR checks workflow with 3-OS matrix + Arch container
- `0346d38` — add tag-triggered Tauri release workflow
- `d8678f9` — merge quick task worktree
