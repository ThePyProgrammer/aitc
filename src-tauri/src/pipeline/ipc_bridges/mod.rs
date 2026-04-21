//! Phase 12: IPC bridge extraction (D-01..D-13, VIZN-01/05 extension).
//!
//! Parses src/bindings.ts (tauri-specta canonical) for the command surface,
//! grep-scans src-tauri/src/**/*.rs for #[tauri::command] attributes,
//! tree-sitter-scans src/**/*.ts(x) for invoke('literal', …) and
//! commands.camelName(…) call-sites. Returns a Vec<IpcBridgeDto> via the
//! new get_ipc_bridges command (wired in Wave 1).
//!
//! See: .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-RESEARCH.md

use serde::{Deserialize, Serialize};
use specta::Type;
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
    /// Repo-relative forward-slash path to the Rust handler file.
    pub handler_file: String,
    /// 1-indexed line number of the `fn` declaration.
    pub handler_line: u32,
    /// Aggregated frontend call-sites.
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

/// Build the complete IPC-bridge surface for `repo_root`.
///
/// Phase 12 Wave 1 fills this in; Wave 0 returns an empty Vec so the
/// get_ipc_bridges command wire works end-to-end.
pub fn build_ipc_bridges(_repo_root: &Path) -> Vec<IpcBridgeDto> {
    Vec::new() // Wave 1 fills in (V-12-11/12)
}

#[cfg(test)]
mod tests {
    use super::*;

    // V-12-01..V-12-04 are covered by the real assertions in
    // `super::bindings_parser::tests::*` — removed from mod.rs to avoid
    // redundant failure noise during Wave-1 bring-up.
    //
    // V-12-05..V-12-07 are covered by
    // `super::rust_handler_scanner::tests::{matches_attribute_to_fn,
    // supports_fn_variants, duplicate_warn_once}`.
    //
    // V-12-08..V-12-10 are covered by
    // `super::frontend_callsite_scanner::tests::{literal_invoke, typed_invoke,
    // skips_variable_callee}`.

    #[test]
    fn merge_preserves_order_and_dedup_v_12_11() {
        panic!("pending: V-12-11");
    }

    #[test]
    fn dangling_states_v_12_12() {
        panic!("pending: V-12-12");
    }

    #[test]
    fn get_ipc_bridges_smoke_v_12_13() {
        panic!("pending: V-12-13");
    }

    // Wave 0 sanity: empty build returns an empty Vec (compile-path only).
    #[test]
    fn build_ipc_bridges_empty_root_returns_empty() {
        use tempfile::TempDir;
        let dir = TempDir::new().unwrap();
        let result = build_ipc_bridges(dir.path());
        assert_eq!(result.len(), 0);
    }
}
