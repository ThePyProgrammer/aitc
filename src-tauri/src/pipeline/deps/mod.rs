//! Phase 7: Dependency graph extraction (D-05..D-09, EMON-01).
//!
//! Parses source files via tree-sitter to extract import/use/mod relationships,
//! resolves them to repo-relative paths, returns a list of directed edges.
//! Parallelized via rayon over the file list from `build_tree_index`.
//!
//! See: .planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-RESEARCH.md

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};

pub mod extract;
pub mod queries;
pub mod resolve;

/// Wire-format for the get_dependency_graph Tauri command (D-05).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DependencyEdgeDto {
    /// Repo-relative forward-slash path of importing file.
    pub from: String,
    /// Repo-relative forward-slash path of imported file.
    pub to: String,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum EdgeKind {
    Import,
    Reexport,
    TypeOnly,
    DynamicImport,
    Use,
    ModDecl,
    FromImport,
    ImportStmt,
}

/// Internal Rust-side edge with absolute paths (converted to DTO at command boundary).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DependencyEdge {
    pub from: PathBuf,
    pub to: PathBuf,
    pub kind: EdgeKind,
}

/// STUB — Plan 02 implements full parallel parsing. Returns empty for now.
pub fn build_dependency_graph(
    _repo_root: &Path,
    _files: &[PathBuf],
) -> Vec<DependencyEdge> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn build_dependency_graph_stub_returns_empty() {
        let edges = build_dependency_graph(Path::new("/tmp"), &[]);
        assert_eq!(edges.len(), 0);
    }
}
