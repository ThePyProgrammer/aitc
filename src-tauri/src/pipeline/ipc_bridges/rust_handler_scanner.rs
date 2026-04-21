//! Phase 12 Wave 1 target: regex-grep for #[tauri::command] attributes + fn declarations.
//! Wave 0 scaffold: exported types + stub returning empty HashMap.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[allow(dead_code)]
pub struct HandlerHit {
    pub snake_name: String,
    pub file: PathBuf,
    pub line: u32,
}

pub fn scan_rust_handlers(_src_tauri_root: &Path) -> HashMap<String, HandlerHit> {
    HashMap::new() // Wave 1 fills in (V-12-05..V-12-07)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn scan_rust_handlers_empty_root() {
        let dir = TempDir::new().unwrap();
        let result = scan_rust_handlers(dir.path());
        assert_eq!(result.len(), 0);
    }
}
