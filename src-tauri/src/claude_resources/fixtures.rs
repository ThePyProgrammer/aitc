//! Test-only helpers exposing the shared fixture tree at
//! `src-tauri/tests/fixtures/claude_resources/`.

#![allow(dead_code)]

use std::path::PathBuf;

/// Absolute path to the fixture root, resolved from CARGO_MANIFEST_DIR
/// so tests work regardless of current working directory.
pub fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("claude_resources")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_root_contains_skill_md() {
        let root = fixture_root();
        assert!(
            root.join("skills/example-skill/SKILL.md").exists(),
            "fixture tree missing SKILL.md at {root:?}"
        );
    }
}
