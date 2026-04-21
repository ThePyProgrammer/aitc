// Plan-02 deviation (Rule 1 bug): the Plan-01 query only matched
// `module_name: (dotted_name)`, silently dropping every relative import
// (`from .foo import bar`), because those use a `(relative_import)` node
// instead. The corrected query captures the whole `module_name` field via an
// underscore wildcard, and the extractor reads the literal source text of that
// node (leading dots preserved) so the Python resolver can handle both
// absolute dotted paths and relative imports from the same capture.
//
// Patterns (index-sensitive — extract.rs relies on this order):
//   0: `import X` / `import X, Y` / `import a.b.c`
//   1: `from X import Y` / `from .X import Y`
pub const PYTHON_IMPORTS: &str = r#"
    (import_statement name: (dotted_name) @path) @import
    (import_from_statement module_name: (_) @path) @from
"#;
