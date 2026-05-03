//! Tree-sitter parsing per language. Plan 02 implements the full extractor.
//!
//! Public surface:
//! - [`SourceLanguage`] enum and [`detect_language`] extension-based dispatcher.
//! - [`RawImport`] — unresolved specifier + edge kind emitted from tree-sitter.
//! - [`parse_and_extract`] — read a file, apply file-size cap (T-07-A), parse,
//!   and run the per-language S-expression query.
//! - [`extract_imports`] — run the query on a pre-parsed tree (useful in tests).
//!
//! Security mitigations:
//! - T-07-A (parser DoS): files larger than [`MAX_FILE_SIZE_BYTES`] (1 MiB) are
//!   skipped. Parse duration is wall-clock bounded via a `ParseOptions`
//!   progress callback that returns `ControlFlow::Break` after
//!   [`MAX_PARSE_DURATION`] (500 ms).
use crate::pipeline::deps::queries::{
    javascript::JAVASCRIPT_IMPORTS, python::PYTHON_IMPORTS, rust::RUST_IMPORTS,
    typescript::TYPESCRIPT_IMPORTS,
};
use crate::pipeline::deps::EdgeKind;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::cell::RefCell;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tree_sitter::{Language, ParseOptions, Parser, Query, QueryCursor, StreamingIterator};

// Perf (Plan-02 deviation Rule 1): the hot path used to rebuild `Query::new`
// from the S-expression source on every call. At 10k files × 5 imports that's
// 50k query compiles (~2-5ms each on Rust/TS grammars). Cache one `Parser`
// and one `Query` per language per thread — rayon reuses the same worker
// threads across parallel iterations, so thread_local storage amortizes the
// setup cost. Brings the 10k benchmark from 24s → <2s on a 14-core box.
thread_local! {
    static PARSERS: RefCell<[Option<Parser>; 6]> = const { RefCell::new([None, None, None, None, None, None]) };
    static QUERIES: RefCell<[Option<Query>; 6]> = const { RefCell::new([None, None, None, None, None, None]) };
}

fn lang_index(lang: SourceLanguage) -> usize {
    match lang {
        SourceLanguage::TypeScript => 0,
        SourceLanguage::Tsx => 1,
        SourceLanguage::JavaScript => 2,
        SourceLanguage::Jsx => 3,
        SourceLanguage::Rust => 4,
        SourceLanguage::Python => 5,
    }
}

/// T-07-A: maximum source-file size submitted to the parser. Files larger than
/// this are skipped (empty Vec returned, logged at TRACE). 1 MiB.
pub const MAX_FILE_SIZE_BYTES: u64 = 1_048_576;

/// T-07-A: per-file wall-clock parse budget. Parser is interrupted via the
/// ParseOptions progress callback once elapsed exceeds this.
pub const MAX_PARSE_DURATION: Duration = Duration::from_millis(500);

#[derive(Debug, Clone)]
pub struct RawImport {
    pub spec: String,
    pub kind: EdgeKind,
}

/// Best-effort signature metadata for a source file. `path` is repo-relative
/// at the command boundary; extraction itself intentionally stores no absolute
/// paths in the DTO to avoid leaking host filesystem layout over IPC.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSignatureDto {
    pub path: String,
    pub signatures: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceLanguage {
    TypeScript,
    Tsx,
    JavaScript,
    Jsx,
    Rust,
    Python,
}

pub fn detect_language(path: &Path) -> Option<SourceLanguage> {
    match path.extension()?.to_str()? {
        "ts" | "mts" | "cts" => Some(SourceLanguage::TypeScript),
        "tsx" => Some(SourceLanguage::Tsx),
        "js" | "mjs" | "cjs" => Some(SourceLanguage::JavaScript),
        "jsx" => Some(SourceLanguage::Jsx),
        "rs" => Some(SourceLanguage::Rust),
        "py" => Some(SourceLanguage::Python),
        _ => None,
    }
}

fn ts_language_for(lang: SourceLanguage) -> Language {
    match lang {
        SourceLanguage::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        SourceLanguage::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
        SourceLanguage::JavaScript | SourceLanguage::Jsx => {
            tree_sitter_javascript::LANGUAGE.into()
        }
        SourceLanguage::Rust => tree_sitter_rust::LANGUAGE.into(),
        SourceLanguage::Python => tree_sitter_python::LANGUAGE.into(),
    }
}

fn query_for(lang: SourceLanguage) -> &'static str {
    match lang {
        SourceLanguage::TypeScript | SourceLanguage::Tsx => TYPESCRIPT_IMPORTS,
        SourceLanguage::JavaScript | SourceLanguage::Jsx => JAVASCRIPT_IMPORTS,
        SourceLanguage::Rust => RUST_IMPORTS,
        SourceLanguage::Python => PYTHON_IMPORTS,
    }
}

/// T-07-A mitigated parse helper. Reads the file, enforces size cap, and parses
/// with a wall-clock budget. Callers decide which extraction pass to run.
fn parse_guarded<T>(path: &Path, language: SourceLanguage, f: impl FnOnce(&tree_sitter::Tree, &str) -> T) -> Option<T> {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return None,
    };
    if metadata.len() > MAX_FILE_SIZE_BYTES {
        tracing::trace!(
            path = %path.display(),
            size = metadata.len(),
            "dep_graph: skipping oversize file"
        );
        return None;
    }
    let source = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return None,
    };

    // Use the thread-local parser + cached query. See the PARSERS/QUERIES
    // comments above for why this matters.
    PARSERS.with(|cell| {
        let mut slot = cell.borrow_mut();
        let idx = lang_index(language);
        if slot[idx].is_none() {
            let mut parser = Parser::new();
            let ts_lang = ts_language_for(language);
            if parser.set_language(&ts_lang).is_err() {
                return None;
            }
            slot[idx] = Some(parser);
        }
        let parser = slot[idx].as_mut().expect("parser initialized above");

        let started = Instant::now();
        // T-07-A / T-13-03: wall-clock parse budget via ParseOptions progress callback.
        let mut progress = |_state: &tree_sitter::ParseState| -> ControlFlow<()> {
            if started.elapsed() > MAX_PARSE_DURATION {
                ControlFlow::Break(())
            } else {
                ControlFlow::Continue(())
            }
        };
        let options = ParseOptions::new().progress_callback(&mut progress);
        let src_bytes = source.as_bytes();
        let tree = match parser.parse_with_options(
            &mut |byte, _| {
                if byte >= src_bytes.len() {
                    &[]
                } else {
                    &src_bytes[byte..]
                }
            },
            None,
            Some(options),
        ) {
            Some(t) => t,
            None => {
                tracing::trace!(
                    path = %path.display(),
                    "dep_graph: parse timeout/failure"
                );
                return None;
            }
        };
        if started.elapsed() > MAX_PARSE_DURATION {
            tracing::trace!(path = %path.display(), "dep_graph: parse exceeded wall-clock budget");
            return None;
        }

        Some(f(&tree, &source))
    })
}

/// T-07-A mitigated entry point. Reads the file, enforces size cap, parses with
/// a wall-clock budget, then dispatches to [`extract_imports`].
pub fn parse_and_extract(path: &Path, language: SourceLanguage) -> Vec<RawImport> {
    parse_guarded(path, language, |tree, source| {
        extract_imports(tree, source, language)
    })
    .unwrap_or_default()
}

/// Run the per-language import query against a parsed tree. Returns every
/// matched specifier together with the edge kind inferred from the pattern
/// index (and, for JS/TS, by peeking at the token stream for `import type`).
///
/// Uses a thread-local `Query` cache so the S-expression isn't recompiled
/// once per file — critical for D-24.
pub fn extract_imports(
    tree: &tree_sitter::Tree,
    source: &str,
    language: SourceLanguage,
) -> Vec<RawImport> {
    QUERIES.with(|cell| {
        let mut slot = cell.borrow_mut();
        let idx = lang_index(language);
        if slot[idx].is_none() {
            let lang_obj = ts_language_for(language);
            let query_str = query_for(language);
            match Query::new(&lang_obj, query_str) {
                Ok(q) => slot[idx] = Some(q),
                Err(e) => {
                    tracing::error!("dep_graph: query compile failed for {:?}: {e:?}", language);
                    return Vec::new();
                }
            }
        }
        let query = slot[idx].as_ref().expect("query initialized above");
        run_query(query, tree, source, language)
    })
}

fn run_query(
    query: &Query,
    tree: &tree_sitter::Tree,
    source: &str,
    language: SourceLanguage,
) -> Vec<RawImport> {
    let mut cursor = QueryCursor::new();
    let mut out = Vec::new();
    let src_bytes = source.as_bytes();
    let mut matches = cursor.matches(query, tree.root_node(), src_bytes);

    while let Some(m) = matches.next() {
        // Per Plan-02, pattern_index maps to an EdgeKind per language. For JS/TS
        // pattern 0 (import_statement) can be either Import or TypeOnly — peek at
        // the outer @import capture's text to distinguish `import type ...`.
        let kind = match (language, m.pattern_index) {
            (
                SourceLanguage::TypeScript
                | SourceLanguage::Tsx
                | SourceLanguage::JavaScript
                | SourceLanguage::Jsx,
                0,
            ) => {
                let import_capture_idx = query
                    .capture_names()
                    .iter()
                    .position(|n| *n == "import");
                let is_type_only = import_capture_idx
                    .and_then(|idx| {
                        m.captures
                            .iter()
                            .find(|c| c.index as usize == idx)
                            .and_then(|c| c.node.utf8_text(src_bytes).ok())
                    })
                    .map(|text| text.trim_start().starts_with("import type"))
                    .unwrap_or(false);
                if is_type_only {
                    EdgeKind::TypeOnly
                } else {
                    EdgeKind::Import
                }
            }
            (
                SourceLanguage::TypeScript
                | SourceLanguage::Tsx
                | SourceLanguage::JavaScript
                | SourceLanguage::Jsx,
                1,
            ) => EdgeKind::Reexport,
            (
                SourceLanguage::TypeScript
                | SourceLanguage::Tsx
                | SourceLanguage::JavaScript
                | SourceLanguage::Jsx,
                2 | 3,
            ) => EdgeKind::DynamicImport,
            (SourceLanguage::Rust, 0) => EdgeKind::Use,
            (SourceLanguage::Rust, 1) => EdgeKind::ModDecl,
            (SourceLanguage::Python, 0) => EdgeKind::ImportStmt,
            (SourceLanguage::Python, 1) => EdgeKind::FromImport,
            _ => continue,
        };

        // The @path capture carries the specifier text; @name is used only for
        // Rust `mod` declarations (which resolve to `<siblingfile>.rs`) and
        // emits as-is.
        for c in m.captures {
            let name = query.capture_names()[c.index as usize];
            if name == "path" || name == "name" {
                if let Ok(spec) = c.node.utf8_text(src_bytes) {
                    out.push(RawImport {
                        spec: spec.to_string(),
                        kind: kind.clone(),
                    });
                }
            }
        }
    }
    out
}

/// T-13-03 mitigated entry point for source signatures. Reuses the same
/// detect_language / MAX_FILE_SIZE_BYTES / MAX_PARSE_DURATION / thread-local
/// parser path as dependency extraction and returns an empty Vec on every
/// unsupported or failure mode.
pub fn extract_source_signatures(path: &Path) -> Vec<String> {
    let language = match detect_language(path) {
        Some(l) => l,
        None => return Vec::new(),
    };
    parse_guarded(path, language, |tree, source| {
        extract_signatures_from_tree(tree, source, language)
    })
    .unwrap_or_default()
}

fn extract_signatures_from_tree(
    tree: &tree_sitter::Tree,
    source: &str,
    language: SourceLanguage,
) -> Vec<String> {
    let mut out = Vec::new();
    collect_signature_nodes(tree.root_node(), source, language, 0, &mut out);
    out.sort();
    out.dedup();
    out.truncate(32);
    out
}

fn collect_signature_nodes(
    node: tree_sitter::Node<'_>,
    source: &str,
    language: SourceLanguage,
    depth: usize,
    out: &mut Vec<String>,
) {
    if out.len() >= 32 || depth > 4 {
        return;
    }
    let kind = node.kind();
    if is_signature_node(kind, language) {
        if let Some(sig) = signature_line(node, source, language) {
            out.push(sig);
        }
        // Do not descend into function/class bodies; code zoom needs top-level
        // exported shape, not a full symbol index.
        if matches!(kind, "function_declaration" | "method_definition" | "function_item" | "function_definition" | "class_declaration" | "class_definition") {
            return;
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.is_named() {
            collect_signature_nodes(child, source, language, depth + 1, out);
        }
    }
}

fn is_signature_node(kind: &str, language: SourceLanguage) -> bool {
    match language {
        SourceLanguage::TypeScript | SourceLanguage::Tsx => matches!(
            kind,
            "function_declaration"
                | "class_declaration"
                | "interface_declaration"
                | "type_alias_declaration"
                | "method_definition"
                | "lexical_declaration"
                | "export_statement"
        ),
        SourceLanguage::JavaScript | SourceLanguage::Jsx => matches!(
            kind,
            "function_declaration" | "class_declaration" | "method_definition" | "lexical_declaration" | "export_statement"
        ),
        SourceLanguage::Rust => matches!(kind, "function_item" | "struct_item" | "enum_item" | "impl_item"),
        SourceLanguage::Python => matches!(kind, "function_definition" | "class_definition"),
    }
}

fn signature_line(
    node: tree_sitter::Node<'_>,
    source: &str,
    language: SourceLanguage,
) -> Option<String> {
    let text = node.utf8_text(source.as_bytes()).ok()?;
    let first = text.lines().find(|l| !l.trim().is_empty())?.trim();
    let mut sig = match language {
        SourceLanguage::TypeScript | SourceLanguage::Tsx | SourceLanguage::JavaScript | SourceLanguage::Jsx => {
            trim_js_signature(first)?
        }
        SourceLanguage::Rust => trim_rust_signature(first)?,
        SourceLanguage::Python => trim_python_signature(first)?,
    };
    if sig.len() > 160 {
        sig.truncate(157);
        sig.push_str("...");
    }
    Some(sig)
}

fn trim_js_signature(line: &str) -> Option<String> {
    let l = line.trim().trim_end_matches('{').trim().trim_end_matches(';').trim();
    let interesting = [
        "export function ", "function ", "export class ", "class ", "export interface ",
        "interface ", "export type ", "type ", "export const ", "const ", "export let ", "let ",
    ];
    if interesting.iter().any(|p| l.starts_with(p)) {
        Some(l.to_string())
    } else {
        None
    }
}

fn trim_rust_signature(line: &str) -> Option<String> {
    let l = line.trim().trim_end_matches('{').trim().trim_end_matches(';').trim();
    let public = l.strip_prefix("pub ").unwrap_or(l);
    if ["fn ", "struct ", "enum ", "impl"].iter().any(|p| public.starts_with(p)) {
        Some(l.to_string())
    } else {
        None
    }
}

fn trim_python_signature(line: &str) -> Option<String> {
    let l = line.trim().trim_end_matches(':').trim();
    if l.starts_with("def ") || l.starts_with("class ") {
        Some(l.to_string())
    } else {
        None
    }
}

/// Convenience helper for tests/callers that have a path string.
pub fn detect_language_pathbuf(path: &PathBuf) -> Option<SourceLanguage> {
    detect_language(path.as_path())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn parse_source(source: &str, lang: SourceLanguage) -> Vec<RawImport> {
        let mut parser = Parser::new();
        parser.set_language(&ts_language_for(lang)).unwrap();
        let tree = parser.parse(source, None).unwrap();
        extract_imports(&tree, source, lang)
    }

    #[test]
    fn detect_language_recognises_extensions() {
        assert_eq!(
            detect_language(Path::new("a.ts")),
            Some(SourceLanguage::TypeScript)
        );
        assert_eq!(detect_language(Path::new("a.tsx")), Some(SourceLanguage::Tsx));
        assert_eq!(
            detect_language(Path::new("a.js")),
            Some(SourceLanguage::JavaScript)
        );
        assert_eq!(detect_language(Path::new("a.jsx")), Some(SourceLanguage::Jsx));
        assert_eq!(detect_language(Path::new("a.rs")), Some(SourceLanguage::Rust));
        assert_eq!(
            detect_language(Path::new("a.py")),
            Some(SourceLanguage::Python)
        );
        assert_eq!(detect_language(Path::new("a.md")), None);
    }

    #[test]
    fn ts_imports() {
        let source = include_str!("test_fixtures/sample.ts");
        let imports = parse_source(source, SourceLanguage::TypeScript);
        let specs: Vec<&str> = imports.iter().map(|i| i.spec.as_str()).collect();
        assert_eq!(
            specs,
            vec![
                "./foo",
                "../bar/baz",
                "@/lib/x",
                "./types",
                "./x",
                "./y",
                "./dyn",
                "./cjs",
            ],
            "TS fixture specs mismatch: got {specs:?}"
        );
        let kinds: Vec<EdgeKind> = imports.iter().map(|i| i.kind.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                EdgeKind::Import,
                EdgeKind::Import,
                EdgeKind::Import,
                EdgeKind::TypeOnly,
                EdgeKind::Reexport,
                EdgeKind::Reexport,
                EdgeKind::DynamicImport,
                EdgeKind::DynamicImport,
            ],
            "TS fixture kinds mismatch"
        );
    }

    #[test]
    fn tsx_imports() {
        let source = include_str!("test_fixtures/sample.tsx");
        let imports = parse_source(source, SourceLanguage::Tsx);
        let specs: Vec<&str> = imports.iter().map(|i| i.spec.as_str()).collect();
        assert_eq!(specs, vec!["react", "./Foo"]);
    }

    #[test]
    fn js_imports() {
        let source = include_str!("test_fixtures/sample.js");
        let imports = parse_source(source, SourceLanguage::JavaScript);
        let specs: Vec<&str> = imports.iter().map(|i| i.spec.as_str()).collect();
        assert_eq!(specs, vec!["./foo.js", "../bar/baz.js", "./x"]);
    }

    #[test]
    fn jsx_imports() {
        let source = include_str!("test_fixtures/sample.jsx");
        let imports = parse_source(source, SourceLanguage::Jsx);
        let specs: Vec<&str> = imports.iter().map(|i| i.spec.as_str()).collect();
        assert_eq!(specs, vec!["react", "./Foo.jsx"]);
    }

    #[test]
    fn rs_imports() {
        let source = include_str!("test_fixtures/sample.rs");
        let imports = parse_source(source, SourceLanguage::Rust);
        // Rust emits: crate::foo::Bar (Use), super::baz (Use),
        // std::path::Path (Use), sibling (ModDecl)
        let specs: Vec<&str> = imports.iter().map(|i| i.spec.as_str()).collect();
        let kinds: Vec<EdgeKind> = imports.iter().map(|i| i.kind.clone()).collect();
        assert_eq!(specs.len(), 4, "expected 4 specs, got {specs:?}");
        assert!(specs.iter().any(|s| s.contains("crate::foo::Bar")));
        assert!(specs.iter().any(|s| s.contains("super::baz")));
        assert!(specs.iter().any(|s| s.contains("std::path::Path")));
        assert!(specs.contains(&"sibling"));
        assert_eq!(kinds.iter().filter(|k| **k == EdgeKind::Use).count(), 3);
        assert_eq!(kinds.iter().filter(|k| **k == EdgeKind::ModDecl).count(), 1);
    }

    #[test]
    fn py_imports() {
        let source = include_str!("test_fixtures/sample.py");
        let imports = parse_source(source, SourceLanguage::Python);
        let specs: Vec<&str> = imports.iter().map(|i| i.spec.as_str()).collect();
        let kinds: Vec<EdgeKind> = imports.iter().map(|i| i.kind.clone()).collect();
        // os (ImportStmt), .foo (FromImport), ..baz (FromImport), package.module (ImportStmt)
        assert!(specs.contains(&"os"), "missing 'os' spec in {specs:?}");
        assert!(
            specs.contains(&"package.module"),
            "missing 'package.module' spec in {specs:?}"
        );
        // Python relative imports put the dots in a separate `import_prefix` node,
        // so the dotted_name captures for the relative imports are "foo" and "baz".
        // Verify by kind counts rather than exact dotted text.
        assert_eq!(
            kinds.iter().filter(|k| **k == EdgeKind::ImportStmt).count(),
            2,
            "expected 2 ImportStmt, got kinds={kinds:?}"
        );
        assert_eq!(
            kinds.iter().filter(|k| **k == EdgeKind::FromImport).count(),
            2,
            "expected 2 FromImport, got kinds={kinds:?}"
        );
    }

    #[test]
    fn file_size_cap_skipped() {
        // T-07-A: files larger than MAX_FILE_SIZE_BYTES return an empty vec.
        let mut tmp = NamedTempFile::with_suffix(".ts").unwrap();
        // Write 2 MiB of comments followed by a real import — the real import
        // must NOT appear in the output.
        let padding = "// padding\n".repeat(220_000); // ~2.4 MiB
        tmp.write_all(padding.as_bytes()).unwrap();
        tmp.write_all(b"import foo from './foo';\n").unwrap();
        tmp.flush().unwrap();
        let path = tmp.path();
        let imports = parse_and_extract(path, SourceLanguage::TypeScript);
        assert!(
            imports.is_empty(),
            "expected empty imports for oversize file, got {imports:?}"
        );
    }

    #[test]
    fn signature_oversize_guard_returns_empty() {
        let mut tmp = NamedTempFile::with_suffix(".ts").unwrap();
        let padding = "// padding\n".repeat(220_000);
        tmp.write_all(padding.as_bytes()).unwrap();
        tmp.write_all(b"export function leaked() {}\n").unwrap();
        tmp.flush().unwrap();
        assert!(extract_source_signatures(tmp.path()).is_empty());
    }

    #[test]
    fn signature_unsupported_extension_returns_empty() {
        let mut tmp = NamedTempFile::with_suffix(".md").unwrap();
        tmp.write_all(b"export function ignored() {}\n").unwrap();
        tmp.flush().unwrap();
        assert!(extract_source_signatures(tmp.path()).is_empty());
    }

    #[test]
    fn signature_extracts_typescript_rust_and_python() {
        let mut ts = NamedTempFile::with_suffix(".ts").unwrap();
        ts.write_all(b"export function alpha(x: number) { return x; }\ninterface Local {}\n").unwrap();
        ts.flush().unwrap();
        let ts_sigs = extract_source_signatures(ts.path());
        assert!(ts_sigs.iter().any(|s| s.contains("export function alpha")), "{ts_sigs:?}");

        let mut rs = NamedTempFile::with_suffix(".rs").unwrap();
        rs.write_all(b"pub struct Widget { id: u64 }\npub fn build_widget() -> Widget { Widget { id: 1 } }\n").unwrap();
        rs.flush().unwrap();
        let rs_sigs = extract_source_signatures(rs.path());
        assert!(rs_sigs.iter().any(|s| s.contains("pub struct Widget")), "{rs_sigs:?}");

        let mut py = NamedTempFile::with_suffix(".py").unwrap();
        py.write_all(b"class Controller:\n    pass\ndef route():\n    return None\n").unwrap();
        py.flush().unwrap();
        let py_sigs = extract_source_signatures(py.path());
        assert!(py_sigs.iter().any(|s| s.contains("class Controller")), "{py_sigs:?}");
    }
}
