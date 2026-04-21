//! Phase 12 Wave 1 target: tree-sitter TS/TSX scanner for invoke/commands call-sites.
//! Wave 0 scaffold: exported types + stub returning empty Vec.

use super::CallShape;
use std::path::{Path, PathBuf};

#[allow(dead_code)]
pub struct CalleeHit {
    /// snake_case — from invoke('literal', …) or looked up from bindings.ts.
    pub snake_name: String,
    /// camelCase — from commands.camelName(…) or looked up from bindings.ts.
    pub camel_name: String,
    pub file: PathBuf,
    /// 1-indexed.
    pub line: u32,
    pub shape: CallShape,
}

pub fn scan_callsites(_frontend_src_root: &Path) -> Vec<CalleeHit> {
    Vec::new() // Wave 1 fills in (V-12-08..V-12-10)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn scan_callsites_empty_root() {
        let dir = TempDir::new().unwrap();
        let result = scan_callsites(dir.path());
        assert_eq!(result.len(), 0);
    }
}
