//! S-expression queries for IPC-bridge call-site extraction. Each query
//! string is consumed by `tree_sitter::Query::new(language, QUERY)` at scan
//! time. Mirrors `pipeline/deps/queries/` layout.

pub mod typescript;
