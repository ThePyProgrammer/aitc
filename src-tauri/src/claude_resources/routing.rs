//! Phase 9 Plan 02 — path classification.
//!
//! Classifies a filesystem path into either the Pipeline domain (code files
//! the radar/heat map already track) or the Resource domain (Claude
//! resources under a `.claude` root). Mirrors the spoofing mitigation in
//! `pipeline::watcher::path_is_under_root` by using component-wise
//! `Path::starts_with` — rejects sibling-directory lookalikes like
//! `/home/x/.claude-fake/`.

#![allow(dead_code)]

use std::path::Path;

use crate::claude_resources::events::{Category, Scope};

/// Resolution of a path into one of the two domains the app watches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoutedPath {
    Pipeline,
    Resource(Scope),
}

/// Classify a path by prefix, preferring the project `.claude` root over the
/// broader repo root so that events under `<repo>/.claude/…` route to the
/// Resource domain and never leak into the Pipeline domain (T-09-02-04).
pub fn classify(
    path: &Path,
    repo_root: &Path,
    global_claude: &Path,
    project_claude: Option<&Path>,
) -> Option<RoutedPath> {
    if let Some(p) = project_claude {
        if path.starts_with(p) {
            return Some(RoutedPath::Resource(Scope::Project));
        }
    }
    if path.starts_with(global_claude) {
        return Some(RoutedPath::Resource(Scope::Global));
    }
    if path.starts_with(repo_root) {
        return Some(RoutedPath::Pipeline);
    }
    None
}

/// Map a path under a `.claude` scope root to the matching resource
/// category. Returns `None` for paths that don't match the allowlist —
/// callers (`scan.rs`) then skip those files.
pub fn category_for_path(path: &Path, scope_root: &Path) -> Option<Category> {
    let rel = path.strip_prefix(scope_root).ok()?;
    let mut comps = rel.components();
    let first = comps.next()?;
    let first_s = first.as_os_str().to_string_lossy().into_owned();

    // Single-component matches at the scope root.
    if comps.clone().next().is_none() {
        match first_s.as_str() {
            "settings.json" => return Some(Category::Settings),
            "CLAUDE.md" => return Some(Category::ClaudeMd),
            _ => {}
        }
    }

    match first_s.as_str() {
        "skills" => {
            // Must terminate at a file named SKILL.md anywhere inside a skill dir.
            if path
                .file_name()
                .map(|n| n == "SKILL.md")
                .unwrap_or(false)
            {
                return Some(Category::Skill);
            }
            None
        }
        "agents" => {
            if path
                .extension()
                .map(|e| e == "md")
                .unwrap_or(false)
            {
                return Some(Category::Agent);
            }
            None
        }
        "commands" => {
            if path
                .extension()
                .map(|e| e == "md")
                .unwrap_or(false)
            {
                return Some(Category::Command);
            }
            None
        }
        "plugins" => {
            if path
                .file_name()
                .map(|n| n == "installed_plugins.json")
                .unwrap_or(false)
            {
                return Some(Category::Plugin);
            }
            None
        }
        "hooks" => Some(Category::Hook),
        _ => None,
    }
}

/// Directory names that live under `~/.claude/` but are NEVER resource
/// sources. Walking them causes O(n) traversal of cache/session state
/// (Pitfall 1, Anti-Pattern 2).
pub fn is_excluded_subdir(first_component: &str) -> bool {
    matches!(
        first_component,
        "cache" | "session-env" | "projects" | "backups" | "downloads"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn classify_routes_by_prefix() {
        let repo_root = PathBuf::from("/home/u/repo");
        let global_claude = PathBuf::from("/home/u/.claude");
        let proj_claude = PathBuf::from("/home/u/repo/.claude");

        // Pipeline: repo-relative source file.
        assert_eq!(
            classify(
                &repo_root.join("src/foo.rs"),
                &repo_root,
                &global_claude,
                Some(&proj_claude),
            ),
            Some(RoutedPath::Pipeline)
        );

        // Global resource: under ~/.claude, no project set.
        assert_eq!(
            classify(
                &global_claude.join("skills/x/SKILL.md"),
                &repo_root,
                &global_claude,
                None,
            ),
            Some(RoutedPath::Resource(Scope::Global))
        );

        // Project resource: under <repo>/.claude.
        assert_eq!(
            classify(
                &proj_claude.join("settings.json"),
                &repo_root,
                &global_claude,
                Some(&proj_claude),
            ),
            Some(RoutedPath::Resource(Scope::Project))
        );

        // Outside all roots: None.
        assert_eq!(
            classify(
                Path::new("/tmp/unrelated.txt"),
                &repo_root,
                &global_claude,
                Some(&proj_claude),
            ),
            None,
        );
    }

    #[test]
    fn classify_project_precedes_repo() {
        let repo_root = PathBuf::from("/home/u/repo");
        let global_claude = PathBuf::from("/home/u/.claude");
        let proj_claude = repo_root.join(".claude");

        // A file under <repo>/.claude must NOT be treated as Pipeline even
        // though it is technically under the repo root.
        assert_eq!(
            classify(
                &proj_claude.join("settings.json"),
                &repo_root,
                &global_claude,
                Some(&proj_claude),
            ),
            Some(RoutedPath::Resource(Scope::Project))
        );
    }

    #[test]
    fn category_for_path_matches_expected_categories() {
        let root = PathBuf::from("/home/u/.claude");
        assert_eq!(
            category_for_path(
                &root.join("skills/example/SKILL.md"),
                &root
            ),
            Some(Category::Skill)
        );
        assert_eq!(
            category_for_path(
                &root.join("agents/example.md"),
                &root
            ),
            Some(Category::Agent)
        );
        assert_eq!(
            category_for_path(
                &root.join("commands/example.md"),
                &root
            ),
            Some(Category::Command)
        );
        assert_eq!(
            category_for_path(
                &root.join("plugins/installed_plugins.json"),
                &root
            ),
            Some(Category::Plugin)
        );
        assert_eq!(
            category_for_path(&root.join("hooks/sample.sh"), &root),
            Some(Category::Hook)
        );
        assert_eq!(
            category_for_path(&root.join("settings.json"), &root),
            Some(Category::Settings)
        );
        assert_eq!(
            category_for_path(&root.join("CLAUDE.md"), &root),
            Some(Category::ClaudeMd)
        );
        // Random other paths: None.
        assert_eq!(
            category_for_path(&root.join("random/file.txt"), &root),
            None
        );
    }

    #[test]
    fn excluded_subdirs_cover_pitfall_list() {
        for name in ["cache", "session-env", "projects", "backups", "downloads"] {
            assert!(is_excluded_subdir(name), "{name} should be excluded");
        }
        assert!(!is_excluded_subdir("skills"));
        assert!(!is_excluded_subdir("agents"));
    }
}
