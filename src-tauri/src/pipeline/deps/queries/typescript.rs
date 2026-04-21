// Source: tree-sitter-typescript grammar node-types.json + official examples
//         https://github.com/tree-sitter/tree-sitter-typescript

/// Matches:
///   import foo from 'x'
///   import { a, b } from 'x'
///   import * as ns from 'x'
///   import type { T } from 'x'
///   export { x } from 'y'
///   export * from 'y'
///   import('x')          (dynamic)
///   require('x')         (CommonJS)
pub const TYPESCRIPT_IMPORTS: &str = r#"
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
