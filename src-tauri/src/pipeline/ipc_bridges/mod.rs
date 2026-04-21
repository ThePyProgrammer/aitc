//! Phase 12: IPC bridge extraction (D-01..D-13, VIZN-01/05 extension).
//!
//! Parses src/bindings.ts (tauri-specta canonical) for the command surface,
//! grep-scans src-tauri/src/**/*.rs for #[tauri::command] attributes,
//! tree-sitter-scans src/**/*.ts(x) for invoke('literal', …) and
//! commands.camelName(…) call-sites. Returns a Vec<IpcBridgeDto> via the
//! new get_ipc_bridges command (wired in Plan 12-03).
//!
//! See: .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-RESEARCH.md

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::Path;

pub mod bindings_parser;
pub mod frontend_callsite_scanner;
pub mod queries;
pub mod rust_handler_scanner;

/// Wire-format for the get_ipc_bridges Tauri command (D-06).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcBridgeDto {
    /// camelCase name from bindings.ts (e.g. "startWatch").
    pub command_name: String,
    /// snake_case Rust fn name (e.g. "start_watch").
    pub rust_name: String,
    /// Repo-relative forward-slash path to the Rust handler file. Empty
    /// string if no handler was found (dangling command — D-09).
    pub handler_file: String,
    /// 1-indexed line number of the `fn` declaration. 0 if dangling.
    pub handler_line: u32,
    /// Aggregated frontend call-sites (sorted by (file, line)).
    pub caller_files: Vec<IpcCallSite>,
    /// Truncated "(args) → return" summary for the tooltip (≤ 200 chars).
    pub signature_summary: String,
    /// True if the command signature contains a `TAURI_CHANNEL<…>` arg.
    pub has_channel_arg: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcCallSite {
    /// Repo-relative forward-slash path of the caller file.
    pub file: String,
    /// 1-indexed line number of the call-site.
    pub line: u32,
    /// Which call-site shape produced this hit.
    pub shape: CallShape,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CallShape {
    Literal,
    Typed,
}

/// Normalize an absolute path to a repo-relative forward-slash string.
/// Matches `pipeline/commands.rs:356-368` convention (commit `a1b15b6`).
fn repo_rel(abs: &Path, repo_root: &Path) -> String {
    abs.strip_prefix(repo_root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Build the complete IPC-bridge surface for `repo_root`.
///
/// 1. Parse `repo_root/src/bindings.ts` for the command catalog.
/// 2. Parallel-scan `repo_root/src-tauri/src/**/*.rs` for handler fns.
/// 3. Parallel-scan `repo_root/src/**/*.{ts,tsx,js,jsx}` (excluding
///    `bindings.ts`) for call-sites.
/// 4. Merge by snake_name (Rust side) / camel_name (typed frontend side),
///    tagging dangling states (D-09), and emit a deterministic Vec sorted
///    alphabetically by `command_name` (D-14).
pub fn build_ipc_bridges(repo_root: &Path) -> Vec<IpcBridgeDto> {
    let bindings_path = repo_root.join("src").join("bindings.ts");
    let Ok(bindings_src) = std::fs::read_to_string(&bindings_path) else {
        tracing::warn!(
            path = %bindings_path.display(),
            "ipc_bridges: bindings.ts missing; returning empty Vec"
        );
        return Vec::new();
    };

    let bindings = bindings_parser::parse_bindings(&bindings_src);
    let handlers = rust_handler_scanner::scan_rust_handlers(&repo_root.join("src-tauri"));
    let callsites = frontend_callsite_scanner::scan_callsites(&repo_root.join("src"));

    // Index callsites: literal shape keyed on snake_name, typed shape keyed on
    // camel_name. Both may populate a single IpcBridgeDto.caller_files slot.
    let mut callers_by_snake: HashMap<String, Vec<IpcCallSite>> = HashMap::new();
    let mut callers_by_camel: HashMap<String, Vec<IpcCallSite>> = HashMap::new();
    for hit in callsites {
        let site = IpcCallSite {
            file: repo_rel(&hit.file, repo_root),
            line: hit.line,
            shape: hit.shape.clone(),
        };
        match hit.shape {
            CallShape::Literal => {
                callers_by_snake
                    .entry(hit.snake_name)
                    .or_default()
                    .push(site);
            }
            CallShape::Typed => {
                callers_by_camel.entry(hit.camel_name).or_default().push(site);
            }
        }
    }

    let mut out: Vec<IpcBridgeDto> = Vec::with_capacity(bindings.len());
    for b in bindings {
        let (handler_file, handler_line) = match handlers.get(&b.snake_name) {
            Some(h) => (repo_rel(&h.file, repo_root), h.line),
            None => {
                // V-12-12 dangling: no handler found.
                tracing::warn!(
                    name = %b.snake_name,
                    command = %b.camel_name,
                    "ipc_bridges: no Rust handler found for command (dangling)"
                );
                (String::new(), 0)
            }
        };

        let mut caller_files: Vec<IpcCallSite> = Vec::new();
        if let Some(v) = callers_by_snake.get(&b.snake_name) {
            caller_files.extend(v.iter().cloned());
        }
        if let Some(v) = callers_by_camel.get(&b.camel_name) {
            caller_files.extend(v.iter().cloned());
        }
        // (file, line) sort — deterministic across runs (D-14).
        caller_files.sort_by(|a, b2| a.file.cmp(&b2.file).then(a.line.cmp(&b2.line)));

        if caller_files.is_empty() {
            // V-12-12 dangling: no frontend callers.
            tracing::info!(
                command = %b.camel_name,
                "ipc_bridges: command has no frontend callers (dangling)"
            );
        }

        out.push(IpcBridgeDto {
            command_name: b.camel_name,
            rust_name: b.snake_name,
            handler_file,
            handler_line,
            caller_files,
            signature_summary: b.signature_summary,
            has_channel_arg: b.has_channel_arg,
        });
    }

    // Alphabetic by command_name for deterministic x-spread (D-14).
    out.sort_by(|a, b| a.command_name.cmp(&b.command_name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // V-12-01..V-12-04 are covered in `super::bindings_parser::tests::*`.
    // V-12-05..V-12-07 are covered in `super::rust_handler_scanner::tests::*`.
    // V-12-08..V-12-10 are covered in `super::frontend_callsite_scanner::tests::*`.
    // V-12-13 belongs to Plan 12-03 (`get_ipc_bridges` Tauri command — lives
    // in `pipeline::commands::tests`).

    fn build_mini_repo(root: &Path) {
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("src-tauri/src")).unwrap();
        std::fs::write(
            root.join("src/bindings.ts"),
            include_str!("test_fixtures/sample_bindings.ts"),
        )
        .unwrap();
        std::fs::write(
            root.join("src-tauri/src/handlers.rs"),
            include_str!("test_fixtures/sample_handler.rs"),
        )
        .unwrap();
        std::fs::write(
            root.join("src/caller_a.ts"),
            include_str!("test_fixtures/sample_caller_literal.ts"),
        )
        .unwrap();
        std::fs::write(
            root.join("src/caller_b.tsx"),
            include_str!("test_fixtures/sample_caller_typed.tsx"),
        )
        .unwrap();
    }

    // V-12-11: merge produces a deterministic, alphabetically sorted Vec; each
    // caller_files list is itself sorted by (file, line). Literal + typed
    // callers for the same command aggregate together.
    #[test]
    fn merge_preserves_order_and_dedup() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        build_mini_repo(root);

        let bridges = build_ipc_bridges(root);
        assert_eq!(
            bridges.len(),
            3,
            "3 commands expected (danglingCommand, ping, startWatch), got {}: {:?}",
            bridges.len(),
            bridges.iter().map(|b| &b.command_name).collect::<Vec<_>>()
        );
        // Alphabetic order: danglingCommand < ping < startWatch.
        assert_eq!(bridges[0].command_name, "danglingCommand");
        assert_eq!(bridges[1].command_name, "ping");
        assert_eq!(bridges[2].command_name, "startWatch");

        // ping aggregates 2 literal (caller_a.ts lines 7,9) + 1 typed
        // (caller_b.tsx line 9) = 3 callers total.
        let ping = &bridges[1];
        assert_eq!(
            ping.caller_files.len(),
            3,
            "ping should have 2 literal + 1 typed = 3 callers, got {:?}",
            ping.caller_files
        );
        // Confirm both shapes represented.
        assert!(
            ping.caller_files.iter().any(|c| c.shape == CallShape::Literal),
            "ping should have at least one literal caller"
        );
        assert!(
            ping.caller_files.iter().any(|c| c.shape == CallShape::Typed),
            "ping should have at least one typed caller"
        );
        // caller_files sorted ascending by (file, line).
        for w in ping.caller_files.windows(2) {
            let ord_ok = w[0].file < w[1].file
                || (w[0].file == w[1].file && w[0].line <= w[1].line);
            assert!(
                ord_ok,
                "caller_files must be (file, line)-sorted; found {:?} before {:?}",
                w[0], w[1]
            );
        }
    }

    // V-12-12: dangling states — handler-absent and caller-absent paths emit
    // empty strings / zero lines / empty Vec and fire tracing logs (not
    // assertable here without a subscriber, but the data shape is the
    // contract).
    #[test]
    fn dangling_states() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        build_mini_repo(root);

        let bridges = build_ipc_bridges(root);

        // danglingCommand: no handler in sample_handler.rs, no callers.
        let dangling = bridges
            .iter()
            .find(|b| b.command_name == "danglingCommand")
            .expect("danglingCommand present");
        assert_eq!(
            dangling.handler_file, "",
            "dangling command must emit empty handler_file, got {:?}",
            dangling.handler_file
        );
        assert_eq!(
            dangling.handler_line, 0,
            "dangling command must emit handler_line=0"
        );
        assert!(
            dangling.caller_files.is_empty(),
            "danglingCommand has no callers, got {:?}",
            dangling.caller_files
        );

        // ping: resolved handler + callers present.
        let ping = bridges
            .iter()
            .find(|b| b.command_name == "ping")
            .expect("ping present");
        assert!(
            !ping.handler_file.is_empty(),
            "ping handler_file should be set, got empty"
        );
        assert!(
            ping.handler_line > 0,
            "ping handler_line should be 1-indexed > 0, got {}",
            ping.handler_line
        );
        // Path is repo-relative forward-slash.
        assert!(
            ping.handler_file.contains("src-tauri/src/handlers.rs"),
            "ping handler_file should be repo-rel fwd-slash, got {:?}",
            ping.handler_file
        );

        // startWatch: handler + typed caller + channel arg.
        let sw = bridges
            .iter()
            .find(|b| b.command_name == "startWatch")
            .expect("startWatch present");
        assert!(!sw.handler_file.is_empty());
        assert!(
            sw.caller_files.iter().any(|c| c.shape == CallShape::Typed),
            "startWatch must have a typed caller: {:?}",
            sw.caller_files
        );
        assert!(
            sw.has_channel_arg,
            "startWatch has TAURI_CHANNEL<…> arg"
        );
    }

    // Empty root (no bindings.ts at all) returns an empty Vec with a
    // tracing::warn! on the missing file.
    #[test]
    fn build_ipc_bridges_empty_root_returns_empty() {
        use tempfile::TempDir;
        let dir = TempDir::new().unwrap();
        let result = build_ipc_bridges(dir.path());
        assert_eq!(result.len(), 0);
    }
}
