//! Phase 12 Wave 1: tree-sitter TS/TSX scanner for `invoke(...)` and
//! `commands.xxx(...)` call-sites.
//!
//! Mirrors the thread-local parser + query cache pattern from
//! `pipeline/deps/extract.rs` (slots 0/1 for TS vs TSX). `bindings.ts` is
//! excluded from the walk because it self-matches `TAURI_INVOKE` against every
//! command.
//!
//! Variable-callee invokes (e.g. `const c = 'ping'; invoke(c)`) do NOT produce
//! a `CalleeHit` — the S-expression query requires a string-literal positional
//! arg. Aliased typed imports (`commands as C; C.ping()`) are also skipped
//! because `@_obj` predicate is pinned to the literal identifier `commands`.

use rayon::prelude::*;
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};
use walkdir::WalkDir;

use super::queries::typescript::IPC_CALLSITE_QUERY;
use super::CallShape;

#[derive(Debug, Clone)]
pub struct CalleeHit {
    /// snake_case — populated for Literal shape; empty for Typed.
    pub snake_name: String,
    /// camelCase — populated for Typed shape; empty for Literal.
    pub camel_name: String,
    pub file: PathBuf,
    /// 1-indexed (Pitfall 4).
    pub line: u32,
    pub shape: CallShape,
}

#[derive(Clone, Copy)]
enum Lang {
    Ts,
    Tsx,
}

fn lang_for(path: &Path) -> Option<Lang> {
    match path.extension().and_then(|s| s.to_str()) {
        Some("tsx" | "jsx") => Some(Lang::Tsx),
        Some("ts" | "js" | "mts" | "mjs" | "cts" | "cjs") => Some(Lang::Ts),
        _ => None,
    }
}

fn ts_language(lang: Lang) -> tree_sitter::Language {
    match lang {
        Lang::Ts => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
    }
}

thread_local! {
    static BRIDGE_PARSERS: RefCell<[Option<Parser>; 2]> = const { RefCell::new([None, None]) };
    static BRIDGE_QUERIES: RefCell<[Option<Query>; 2]> = const { RefCell::new([None, None]) };
}

fn scan_one_ts_file(path: &Path) -> Vec<CalleeHit> {
    let Ok(src) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Some(lang) = lang_for(path) else {
        return Vec::new();
    };
    let idx = match lang {
        Lang::Ts => 0,
        Lang::Tsx => 1,
    };
    let mut out = Vec::new();

    BRIDGE_PARSERS.with(|parsers_cell| {
        BRIDGE_QUERIES.with(|queries_cell| {
            let mut parsers = parsers_cell.borrow_mut();
            let mut queries = queries_cell.borrow_mut();

            // Lazy-init the parser slot.
            if parsers[idx].is_none() {
                let mut p = Parser::new();
                if p.set_language(&ts_language(lang)).is_err() {
                    return;
                }
                parsers[idx] = Some(p);
            }
            // Lazy-init the query slot.
            if queries[idx].is_none() {
                let Ok(q) = Query::new(&ts_language(lang), IPC_CALLSITE_QUERY) else {
                    tracing::error!(
                        lang = ?lang_name(lang),
                        "ipc_bridges: query compile failed"
                    );
                    return;
                };
                queries[idx] = Some(q);
            }

            let parser = parsers[idx].as_mut().expect("parser initialised above");
            let Some(tree) = parser.parse(&src, None) else {
                return;
            };
            let query = queries[idx].as_ref().expect("query initialised above");

            let mut cursor = QueryCursor::new();
            let mut matches = cursor.matches(query, tree.root_node(), src.as_bytes());

            // Capture-name lookup once per file; the query's capture list is
            // fixed at compile time.
            let capture_names = query.capture_names();
            let cmd_cap_idx = match capture_names.iter().position(|n| *n == "command") {
                Some(i) => i as u32,
                None => return,
            };

            while let Some(m) = matches.next() {
                // pattern_index: 0 = @invoke_literal, 1 = @commands_typed.
                let shape = match m.pattern_index {
                    0 => CallShape::Literal,
                    1 => CallShape::Typed,
                    _ => continue,
                };
                let Some(cap) = m.captures.iter().find(|c| c.index == cmd_cap_idx) else {
                    continue;
                };
                let Ok(name) = cap.node.utf8_text(src.as_bytes()) else {
                    continue;
                };
                // Tree-sitter rows are 0-indexed; D-06 requires 1-indexed.
                let line = cap.node.start_position().row as u32 + 1;

                match shape {
                    CallShape::Literal => out.push(CalleeHit {
                        snake_name: name.to_string(),
                        camel_name: String::new(),
                        file: path.to_path_buf(),
                        line,
                        shape,
                    }),
                    CallShape::Typed => out.push(CalleeHit {
                        snake_name: String::new(),
                        camel_name: name.to_string(),
                        file: path.to_path_buf(),
                        line,
                        shape,
                    }),
                }
            }
        });
    });

    out
}

fn lang_name(lang: Lang) -> &'static str {
    match lang {
        Lang::Ts => "typescript",
        Lang::Tsx => "tsx",
    }
}

/// Walk `frontend_src_root` for TS/TSX/JS/JSX files (excluding `bindings.ts`)
/// and return every literal / typed call-site the grammar matches.
pub fn scan_callsites(frontend_src_root: &Path) -> Vec<CalleeHit> {
    let files: Vec<PathBuf> = WalkDir::new(frontend_src_root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            let ext_match = matches!(
                p.extension().and_then(|s| s.to_str()),
                Some("ts" | "tsx" | "js" | "jsx" | "mts" | "mjs" | "cts" | "cjs")
            );
            let not_bindings =
                p.file_name().and_then(|s| s.to_str()) != Some("bindings.ts");
            ext_match && not_bindings
        })
        .map(|e| e.path().to_path_buf())
        .collect();

    files
        .par_iter()
        .flat_map(|p| scan_one_ts_file(p))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const LITERAL: &str = include_str!("test_fixtures/sample_caller_literal.ts");
    const TYPED: &str = include_str!("test_fixtures/sample_caller_typed.tsx");

    fn write(dir: &TempDir, name: &str, body: &str) -> PathBuf {
        let p = dir.path().join(name);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn scan_callsites_empty_root() {
        let dir = TempDir::new().unwrap();
        let result = scan_callsites(dir.path());
        assert_eq!(result.len(), 0);
    }

    // V-12-08: literal invoke('…', …) shapes extracted with snake_name set.
    #[test]
    fn literal_invoke() {
        let dir = TempDir::new().unwrap();
        write(&dir, "caller.ts", LITERAL);
        let hits = scan_callsites(dir.path());
        let literals: Vec<_> = hits
            .iter()
            .filter(|h| h.shape == CallShape::Literal)
            .collect();
        // Fixture has 3 valid literal invokes: 2 × ping + 1 × start_watch.
        assert_eq!(
            literals.len(),
            3,
            "expected 3 literal hits, got: {:?}",
            literals.iter().map(|h| &h.snake_name).collect::<Vec<_>>()
        );
        assert!(literals.iter().any(|h| h.snake_name == "ping"));
        assert!(literals.iter().any(|h| h.snake_name == "start_watch"));
        // 1-indexed line (Pitfall 4).
        for h in &literals {
            assert!(h.line >= 1, "line must be 1-indexed, got {}", h.line);
        }
    }

    // V-12-09: commands.camelName(…) shapes extracted with camel_name set.
    #[test]
    fn typed_invoke() {
        let dir = TempDir::new().unwrap();
        write(&dir, "caller.tsx", TYPED);
        let hits = scan_callsites(dir.path());
        let typed: Vec<_> = hits
            .iter()
            .filter(|h| h.shape == CallShape::Typed)
            .collect();
        // Fixture has 2 valid typed calls: commands.ping + commands.startWatch.
        // The aliased `C.aliasedCall()` is skipped per D-05.
        assert_eq!(
            typed.len(),
            2,
            "expected 2 typed hits (aliased skipped), got: {:?}",
            typed.iter().map(|h| &h.camel_name).collect::<Vec<_>>()
        );
        assert!(typed.iter().any(|h| h.camel_name == "ping"));
        assert!(typed.iter().any(|h| h.camel_name == "startWatch"));
    }

    // V-12-10: variable-callee `invoke(cmd)` produces NO literal hit.
    #[test]
    fn skips_variable_callee() {
        let dir = TempDir::new().unwrap();
        write(&dir, "caller.ts", LITERAL);
        let hits = scan_callsites(dir.path());
        let literals: Vec<_> = hits
            .iter()
            .filter(|h| h.shape == CallShape::Literal)
            .collect();
        // Count stays at 3 even though the fixture has `invoke(cmd)` after a
        // `const cmd = 'ping'` — the grammar's `.` anchor + `(string …)` arm
        // rejects non-string args.
        assert_eq!(
            literals.len(),
            3,
            "variable-callee invoke must be skipped; got names {:?}",
            literals.iter().map(|h| &h.snake_name).collect::<Vec<_>>()
        );
        // None of the hits should have an empty snake_name.
        for h in &literals {
            assert!(!h.snake_name.is_empty(), "literal hit must carry snake_name");
        }
    }

    // Excludes bindings.ts from walk (otherwise every command would self-match).
    #[test]
    fn excludes_bindings_ts() {
        let dir = TempDir::new().unwrap();
        let bindings_body =
            "export const commands = {\n  async ping() { return await TAURI_INVOKE(\"ping\"); },\n};\n";
        write(&dir, "bindings.ts", bindings_body);
        let hits = scan_callsites(dir.path());
        // bindings.ts itself is skipped by the walk.
        assert_eq!(hits.len(), 0, "bindings.ts must be excluded");
    }
}
