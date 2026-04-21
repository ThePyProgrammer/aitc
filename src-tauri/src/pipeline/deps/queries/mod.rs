//! S-expression queries per language. Each query string is consumed by
//! tree-sitter::Query::new(language, QUERY) at extract time.

pub mod javascript;
pub mod python;
pub mod rust;
pub mod typescript;
