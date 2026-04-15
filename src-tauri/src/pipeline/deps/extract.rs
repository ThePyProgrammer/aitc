//! Tree-sitter parsing per language. Plan 02 implements; this file only
//! declares the public surface so the module compiles.
use crate::pipeline::deps::EdgeKind;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct RawImport {
    pub spec: String,
    pub kind: EdgeKind,
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

pub fn detect_language(path: &PathBuf) -> Option<SourceLanguage> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_language_recognises_extensions() {
        assert_eq!(detect_language(&PathBuf::from("a.ts")), Some(SourceLanguage::TypeScript));
        assert_eq!(detect_language(&PathBuf::from("a.tsx")), Some(SourceLanguage::Tsx));
        assert_eq!(detect_language(&PathBuf::from("a.js")), Some(SourceLanguage::JavaScript));
        assert_eq!(detect_language(&PathBuf::from("a.jsx")), Some(SourceLanguage::Jsx));
        assert_eq!(detect_language(&PathBuf::from("a.rs")), Some(SourceLanguage::Rust));
        assert_eq!(detect_language(&PathBuf::from("a.py")), Some(SourceLanguage::Python));
        assert_eq!(detect_language(&PathBuf::from("a.md")), None);
    }
}
