/// Same shape as TypeScript — JS grammar uses identical node names for
/// import_statement / export_statement / call_expression.
pub const JAVASCRIPT_IMPORTS: &str = r#"
    (import_statement source: (string (string_fragment) @path)) @import
    (export_statement source: (string (string_fragment) @path)) @reexport
    (call_expression
        function: (import)
        arguments: (arguments (string (string_fragment) @path))) @dynamic
    (call_expression
        function: (identifier) @_fn
        arguments: (arguments (string (string_fragment) @path))
        (#eq? @_fn "require")) @require
"#;
