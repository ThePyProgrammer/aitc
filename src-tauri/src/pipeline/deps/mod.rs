//! Phase 7: Dependency graph extraction (D-05..D-09, EMON-01).
//!
//! Parses source files via tree-sitter to extract import/use/mod relationships,
//! resolves them to repo-relative paths, returns a list of directed edges.
//! Parallelized via rayon over the file list from `build_tree_index`.
//!
//! Security mitigations (T-07-C memory exhaustion):
//! - [`MAX_EDGES_PER_NODE`] caps the fan-out of any single file so barrel-export
//!   hubs cannot explode edge counts.
//! - [`MAX_TOTAL_EDGES`] caps the whole graph; once hit, [`DependencyGraphResult`]
//!   returns `degraded: true` so the frontend can surface a GRAPH_OVERLOAD
//!   banner (UI-SPEC D-23).
//!
//! See: .planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-RESEARCH.md

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};

pub mod extract;
pub mod queries;
pub mod resolve;

pub use extract::SourceSignatureDto;

/// T-07-C: per-file fan-out cap. Generous relative to realistic barrel files;
/// primarily a safety net against pathological inputs. Plan 02 tuning.
pub const MAX_EDGES_PER_NODE: usize = 200;

/// T-07-C: global edge cap. Beyond this we stop appending, flag `degraded`,
/// and let the UI render a viewing-degraded banner.
pub const MAX_TOTAL_EDGES: usize = 100_000;

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
    /// Phase 12 D-27: caller file → bridge node (frontend invoke call-site).
    Invokes,
    /// Phase 12 D-27: bridge node → Rust handler file.
    Handles,
}

/// Internal Rust-side edge with absolute paths (converted to DTO at command boundary).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DependencyEdge {
    pub from: PathBuf,
    pub to: PathBuf,
    pub kind: EdgeKind,
}

/// Result of [`build_dependency_graph`].
///
/// - `edges` — resolved in-repo edges, directed from importer to importee.
/// - `degraded` — true when [`MAX_TOTAL_EDGES`] was reached and we stopped
///   appending. The UI uses this for the GRAPH_OVERLOAD banner.
/// - `unresolved_count` — number of extracted specifiers that could not be
///   resolved to an in-repo file (external deps, broken imports). Logged
///   server-side; reserved for the "{N}_IMPORTS_UNRESOLVED" UI pill.
#[derive(Debug, Clone)]
pub struct DependencyGraphResult {
    pub edges: Vec<DependencyEdge>,
    pub degraded: bool,
    pub unresolved_count: usize,
}

/// Build the dependency graph for `files` under `repo_root`.
///
/// Parallelized via rayon: every file is parsed on a worker thread with its own
/// `Parser` instance (per research §Pattern 7 — Parser is not Send-safe across
/// a single .par_iter iteration but it is cheap to construct per work item).
pub fn build_dependency_graph(repo_root: &Path, files: &[PathBuf]) -> DependencyGraphResult {
    use crate::pipeline::deps::extract::{detect_language, parse_and_extract};
    use crate::pipeline::deps::resolve::{resolve_import, ResolveContext};
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // Plan 03+ will populate this from tsconfig.json; Plan 02 keeps it empty so
    // only literal relative / absolute-dotted / mod specs resolve.
    let ctx = ResolveContext::default();
    let unresolved = AtomicUsize::new(0);

    let per_file_edges: Vec<Vec<DependencyEdge>> = files
        .par_iter()
        .map(|path| {
            let lang = match detect_language(path.as_path()) {
                Some(l) => l,
                None => return Vec::new(),
            };
            let raw = parse_and_extract(path, lang);
            let mut out: Vec<DependencyEdge> =
                Vec::with_capacity(raw.len().min(MAX_EDGES_PER_NODE));
            for r in raw {
                if out.len() >= MAX_EDGES_PER_NODE {
                    tracing::warn!(
                        path = %path.display(),
                        cap = MAX_EDGES_PER_NODE,
                        "dep_graph: per-node edge cap hit"
                    );
                    break;
                }
                match resolve_import(&r.spec, path, repo_root, lang, &ctx) {
                    Some(target) => out.push(DependencyEdge {
                        from: path.clone(),
                        to: target,
                        kind: r.kind,
                    }),
                    None => {
                        unresolved.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
            out
        })
        .collect();

    let mut all: Vec<DependencyEdge> = Vec::new();
    let mut degraded = false;
    for batch in per_file_edges {
        if all.len() + batch.len() > MAX_TOTAL_EDGES {
            let take = MAX_TOTAL_EDGES.saturating_sub(all.len());
            all.extend(batch.into_iter().take(take));
            degraded = true;
            tracing::warn!(
                cap = MAX_TOTAL_EDGES,
                "dep_graph: total edge cap hit; truncating"
            );
            break;
        }
        all.extend(batch);
    }

    DependencyGraphResult {
        edges: all,
        degraded,
        unresolved_count: unresolved.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn build_dependency_graph_stub_returns_empty() {
        let result = build_dependency_graph(Path::new("/tmp"), &[]);
        assert_eq!(result.edges.len(), 0);
        assert!(!result.degraded);
        assert_eq!(result.unresolved_count, 0);
    }

    #[test]
    fn small_repo_resolves_in_repo_edges() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("a.ts"), "import {b} from './b';\n").unwrap();
        fs::write(root.join("b.ts"), "import {c} from './c';\n").unwrap();
        fs::write(root.join("c.ts"), "import React from 'react';\n").unwrap();
        let files = vec![
            root.join("a.ts"),
            root.join("b.ts"),
            root.join("c.ts"),
        ];
        let result = build_dependency_graph(root, &files);
        assert_eq!(result.edges.len(), 2, "react is external (D-07)");
        assert!(!result.degraded);
        assert_eq!(result.unresolved_count, 1, "'react' should be counted unresolved");
        // Edge shape: from=a.ts → to=b.ts, from=b.ts → to=c.ts (post-canonicalize).
        assert!(result.edges.iter().any(|e| e.from.ends_with("a.ts") && e.to.ends_with("b.ts")));
        assert!(result.edges.iter().any(|e| e.from.ends_with("b.ts") && e.to.ends_with("c.ts")));
    }

    #[test]
    fn per_node_edge_cap_enforced() {
        // T-07-C: a single file with 250 imports should emit at most 200 edges.
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let mut src = String::new();
        for i in 0..250 {
            fs::write(root.join(format!("dep{i}.ts")), "export {};\n").unwrap();
            src.push_str(&format!("import x{i} from './dep{i}';\n"));
        }
        fs::write(root.join("hub.ts"), src).unwrap();
        let mut files: Vec<_> = (0..250)
            .map(|i| root.join(format!("dep{i}.ts")))
            .collect();
        files.push(root.join("hub.ts"));
        let result = build_dependency_graph(root, &files);
        let from_hub = result
            .edges
            .iter()
            .filter(|e| e.from.ends_with("hub.ts"))
            .count();
        assert_eq!(from_hub, MAX_EDGES_PER_NODE, "per-node cap enforced");
    }

    #[test]
    fn mixed_language_repo_extracts_per_language_edges() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("a.ts"), "import {b} from './b';\n").unwrap();
        fs::write(root.join("b.ts"), "export const b = 1;\n").unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/lib.rs"), "mod sibling;\n").unwrap();
        fs::write(root.join("src/sibling.rs"), "pub fn x() {}\n").unwrap();
        fs::create_dir_all(root.join("pkg")).unwrap();
        fs::write(root.join("pkg/a.py"), "from .b import x\n").unwrap();
        fs::write(root.join("pkg/b.py"), "x = 1\n").unwrap();
        let files = vec![
            root.join("a.ts"),
            root.join("b.ts"),
            root.join("src/lib.rs"),
            root.join("src/sibling.rs"),
            root.join("pkg/a.py"),
            root.join("pkg/b.py"),
        ];
        let result = build_dependency_graph(root, &files);
        assert!(
            result.edges.iter().any(|e| e.kind == EdgeKind::Import),
            "expected a TS Import edge: {:?}",
            result.edges
        );
        assert!(
            result.edges.iter().any(|e| e.kind == EdgeKind::ModDecl),
            "expected a Rust ModDecl edge: {:?}",
            result.edges
        );
        assert!(
            result.edges.iter().any(|e| e.kind == EdgeKind::FromImport),
            "expected a Python FromImport edge: {:?}",
            result.edges
        );
    }

    #[test]
    fn unsupported_extensions_are_ignored() {
        // detect_language returns None for .md / .txt / etc — those files
        // shouldn't parse and shouldn't contribute to unresolved_count either.
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("a.md"), "# hi\n").unwrap();
        let files = vec![root.join("a.md")];
        let result = build_dependency_graph(root, &files);
        assert_eq!(result.edges.len(), 0);
        assert_eq!(result.unresolved_count, 0);
    }
}
