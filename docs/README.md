# AITC — Developer Documentation

This directory contains build, test, and operational docs for the AI Traffic
Controller (AITC) desktop app. User-facing docs live in the app itself and in
the root `README.md`.

---

## Phase 8 Hook Testing

The `aitc-hook` sidecar binary is a Cargo workspace member at
`src-tauri/aitc-hook/`. Integration tests in
`src-tauri/tests/hook_e2e_with_real_sidecar.rs` drive the entire Phase 8 stack
(compiled sidecar → HTTP /hook → SQLite → waiter signal → envelope stdout) and
require the sidecar binary to be built first.

### Quick run (just the e2e guard)

```sh
cd src-tauri
cargo build -p aitc-hook                      # produces target/debug/aitc-hook
cargo test --test hook_e2e_with_real_sidecar  # 4 tests: allow / allow_with_edits / deny / abandon
```

### Full Phase 8 suite

```sh
cd src-tauri
cargo build -p aitc-hook
cargo test --workspace      # runs sidecar tests + backend unit/integration tests
cd ..
pnpm vitest run             # frontend component + store tests
pnpm tsc --noEmit           # frontend type-check
```

### Rebuilding the sidecar after source changes

The sidecar is bundled via the Tauri v2 `bundle.externalBin` entry in
`src-tauri/tauri.conf.json`. After changes to `src-tauri/aitc-hook/src/*.rs`,
rebuild the release binary and re-bundle the app:

```sh
cd src-tauri
cargo build -p aitc-hook --release
cargo tauri build              # or: pnpm tauri build
```

For day-to-day dev, `cargo tauri dev` / `pnpm tauri dev` automatically
rebuilds the sidecar when its sources change.

### Regenerating tauri-specta bindings

Adding or changing a `#[tauri::command]` signature (e.g.
`approve_request`'s `alwaysAllowForSession` parameter) regenerates
`src/bindings.ts` on the next build. If bindings get out of sync with the Rust
command surface:

```sh
cd src-tauri
cargo test --lib       # tauri-specta writes bindings.ts during test runs
```

### Port file convention (~/.aitc/port)

When the AITC app starts, it binds the self-registration HTTP server to an
OS-assigned port on `127.0.0.1` and writes that port number to `~/.aitc/port`
(atomic tmp-and-rename). The sidecar reads that file at hook-invocation time
to find the AITC instance. The file is deleted on clean shutdown via the
`PortFileGuard` `Drop` impl.

Override for local testing / multi-instance:

- `AITC_PORT=<n>` — forces the sidecar to hit `127.0.0.1:<n>` and skips file lookup.
- `AITC_PORT_FILE_OVERRIDE=<path>` — read the port from a custom file.

### Manual UAT checklist

The `tests/manual/phase-08-uat.md` checklist covers the platform-specific
behaviors (Windows `taskkill`, OS notifications with onClick routing) and the
visual conformance of `08-UI-SPEC.md` that CI cannot verify. Run it before
marking Phase 8 complete.
