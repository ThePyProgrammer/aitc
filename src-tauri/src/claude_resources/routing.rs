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
                // SKILL.md is the canonical skill marker — classify as Skill
                // even when shipped under a plugin's commands/ tree
                // (e.g. commands/blueprint/challenge/SKILL.md).
                let is_skill_md = path
                    .file_name()
                    .map(|n| n == "SKILL.md")
                    .unwrap_or(false);
                if is_skill_md {
                    return Some(Category::Skill);
                }
                // Plugins ship agents under commands/<plugin>/agents/*.md
                // (e.g. commands/blueprint/agents/adr-researcher.md).
                let has_agents_segment = rel
                    .components()
                    .any(|c| c.as_os_str() == "agents");
                return Some(if has_agents_segment {
                    Category::Agent
                } else {
                    Category::Command
                });
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

// ---------------------------------------------------------------------------
// Plan 03 additions: ScopeKind enum + classify_event helper + allowlist
// ---------------------------------------------------------------------------

/// Distinguishes an extra root's role for the single-Debouncer fan-out.
/// `Global` = `~/.claude/`, `Project` = `<cwd>/.claude/`. Used by the
/// watcher to stamp the correct `Scope` on `ResourceEvent`s.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeKind {
    Global,
    Project,
}

impl From<ScopeKind> for Scope {
    fn from(k: ScopeKind) -> Self {
        match k {
            ScopeKind::Global => Scope::Global,
            ScopeKind::Project => Scope::Project,
        }
    }
}

/// The allowlisted subdirs to watch under each extra root. Files outside
/// these subdirs (plus file-level `settings.json` and `CLAUDE.md` at the
/// scope root) are NOT watched — Pitfall 1 (inotify allowlist).
pub const EXTRA_ROOT_ALLOWLIST_SUBDIRS: &[&str] =
    &["skills", "agents", "commands", "hooks", "plugins"];

/// Decide where a debounced event should route given the repo root and any
/// extra (`.claude/`) roots.
///
/// Ordering invariant (CRITICAL): a path under `<cwd>/.claude/` starts with
/// both `repo_root` AND the extra root. Extra roots are checked FIRST so
/// such a path routes to `Resource(Project)` — never `Pipeline`. This is
/// the D-06 fan-out guarantee.
///
/// Returns `None` when the path is outside every known root, or when it
/// lies under an extra root but targets an excluded subdir (`cache/`,
/// `session-env/`, etc.) or a non-allowlisted path.
pub fn classify_event(
    path: &Path,
    repo_root: &Path,
    extra_roots: &[(std::path::PathBuf, ScopeKind)],
) -> Option<RoutedPath> {
    // Extra roots take precedence over repo_root.
    for (root, kind) in extra_roots {
        if path.starts_with(root) {
            let suffix = match path.strip_prefix(root) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let first = suffix
                .components()
                .next()
                .and_then(|c| c.as_os_str().to_str());
            // Exclude list wins over allowlist (defence in depth).
            if let Some(f) = first {
                if is_excluded_subdir(f) {
                    return None;
                }
            }
            let is_allowed_subdir = first
                .map(|f| EXTRA_ROOT_ALLOWLIST_SUBDIRS.contains(&f))
                .unwrap_or(false);
            let is_scope_level_file = matches!(
                suffix.to_str(),
                Some("settings.json") | Some("CLAUDE.md")
            );
            if is_allowed_subdir || is_scope_level_file {
                return Some(RoutedPath::Resource((*kind).into()));
            }
            return None;
        }
    }
    if path.starts_with(repo_root) {
        return Some(RoutedPath::Pipeline);
    }
    None
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

    #[test]
    fn classify_event_routes_repo_only_events_to_pipeline() {
        let repo = PathBuf::from("/home/u/repo");
        let global = PathBuf::from("/home/u/.claude");
        let extras = vec![(global.clone(), ScopeKind::Global)];
        assert_eq!(
            classify_event(&repo.join("src/foo.rs"), &repo, &extras),
            Some(RoutedPath::Pipeline)
        );
    }

    #[test]
    fn classify_event_routes_extra_root_allowlisted_to_resource() {
        let repo = PathBuf::from("/home/u/repo");
        let global = PathBuf::from("/home/u/.claude");
        let extras = vec![(global.clone(), ScopeKind::Global)];
        assert_eq!(
            classify_event(&global.join("skills/x/SKILL.md"), &repo, &extras),
            Some(RoutedPath::Resource(Scope::Global))
        );
        assert_eq!(
            classify_event(&global.join("settings.json"), &repo, &extras),
            Some(RoutedPath::Resource(Scope::Global))
        );
        assert_eq!(
            classify_event(&global.join("CLAUDE.md"), &repo, &extras),
            Some(RoutedPath::Resource(Scope::Global))
        );
    }

    #[test]
    fn classify_event_project_extras_take_precedence_over_repo_root() {
        // Project extra root lives UNDER the repo root. The ordering
        // invariant must route the event to Resource(Project), not Pipeline.
        let repo = PathBuf::from("/home/u/repo");
        let proj_claude = repo.join(".claude");
        let extras = vec![(proj_claude.clone(), ScopeKind::Project)];
        assert_eq!(
            classify_event(&proj_claude.join("settings.json"), &repo, &extras),
            Some(RoutedPath::Resource(Scope::Project))
        );
        assert_eq!(
            classify_event(&proj_claude.join("skills/a/SKILL.md"), &repo, &extras),
            Some(RoutedPath::Resource(Scope::Project))
        );
    }

    #[test]
    fn classify_event_drops_excluded_subdirs_under_extra_root() {
        let repo = PathBuf::from("/home/u/repo");
        let global = PathBuf::from("/home/u/.claude");
        let extras = vec![(global.clone(), ScopeKind::Global)];
        for d in ["cache", "session-env", "projects", "backups", "downloads"] {
            assert_eq!(
                classify_event(&global.join(d).join("x"), &repo, &extras),
                None,
                "{d}/ must be dropped"
            );
        }
    }

    #[test]
    fn classify_event_drops_non_allowlisted_under_extra_root() {
        let repo = PathBuf::from("/home/u/repo");
        let global = PathBuf::from("/home/u/.claude");
        let extras = vec![(global.clone(), ScopeKind::Global)];
        // A random file at scope root that is NOT CLAUDE.md or settings.json.
        assert_eq!(
            classify_event(&global.join("random.txt"), &repo, &extras),
            None
        );
        // A non-allowlisted subdir.
        assert_eq!(
            classify_event(&global.join("something-else/file.md"), &repo, &extras),
            None
        );
    }

    #[test]
    fn classify_event_returns_none_for_path_outside_all_roots() {
        let repo = PathBuf::from("/home/u/repo");
        let global = PathBuf::from("/home/u/.claude");
        let extras = vec![(global.clone(), ScopeKind::Global)];
        assert_eq!(
            classify_event(Path::new("/tmp/unrelated"), &repo, &extras),
            None
        );
    }

    #[test]
    fn scope_kind_converts_to_scope() {
        assert_eq!(Scope::from(ScopeKind::Global), Scope::Global);
        assert_eq!(Scope::from(ScopeKind::Project), Scope::Project);
    }
}
