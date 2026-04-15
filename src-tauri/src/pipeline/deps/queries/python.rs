pub const PYTHON_IMPORTS: &str = r#"
    (import_statement name: (dotted_name) @path) @import
    (import_from_statement
        module_name: (dotted_name) @path
        name: (dotted_name)*) @from
"#;
