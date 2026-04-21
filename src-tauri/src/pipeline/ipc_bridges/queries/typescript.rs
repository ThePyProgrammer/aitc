// Phase 12 tree-sitter query for invoke/commands call-sites.
//
// Pattern 0 (@invoke_literal): `invoke('snake_name', …)` with a string-literal
// first argument. Variable-callee invokes like `invoke(cmd, …)` do NOT match
// because the `.` anchor + `(string …)` arm forces a string positional arg.
//
// Pattern 1 (@commands_typed): `commands.camelName(…)` where `commands` is the
// exact identifier (aliased imports like `commands as C` are skipped — D-05).
//
// The `@command` capture holds the name (snake_case for pattern 0, camelCase
// for pattern 1). `@_fn` / `@_obj` are predicate-only scratch captures.

pub const IPC_CALLSITE_QUERY: &str = r#"
    (call_expression
      function: (identifier) @_fn
      arguments: (arguments
        .
        (string (string_fragment) @command)
      )
      (#eq? @_fn "invoke")) @invoke_literal

    (call_expression
      function: (member_expression
        object: (identifier) @_obj
        property: (property_identifier) @command)
      (#eq? @_obj "commands")) @commands_typed
"#;
