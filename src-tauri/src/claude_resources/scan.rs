//! Phase 9 Plan 02 — allowlisted initial-scan walker.
//!
//! Walks a `.claude` scope root and emits `Vec<Resource>`. Only traverses
//! the fixed category subdirs (`skills/`, `agents/`, `commands/`, `hooks/`,
//! `plugins/`) plus the scope-root files (`settings.json`, `CLAUDE.md`).
//! Explicitly excludes `cache/`, `session-env/`, `projects/`, `backups/`,
//! `downloads/` (Pitfall 1, Anti-Pattern 2). Tolerates per-file parse
//! errors via `tracing::warn!` — a single malformed SKILL.md never aborts
//! the whole scan.

#![allow(dead_code)]

use std::path::Path;

use walkdir::WalkDir;

use crate::claude_resources::events::{Category, Resource, Scope};
use crate::claude_resources::parse::{
    parse_agent, parse_claude_md, parse_command, parse_hook_metadata,
    parse_installed_plugins, parse_settings, parse_skill,
};
use crate::claude_resources::routing::{category_for_path, is_excluded_subdir};

const CATEGORY_SUBDIRS: &[&str] =
    &["skills", "agents", "commands", "hooks", "plugins"];

/// Maximum traversal depth beneath a category subdir. Skills live at
/// `skills/<plugin>/<skill>/SKILL.md` (depth 4 from the scope root), every
/// other category is shallower.
const MAX_DEPTH: usize = 4;

pub fn scan_scope(root: &Path, scope: Scope) -> Result<Vec<Resource>, String> {
    if !root.exists() {
        // Pitfall 7: missing project `.claude/` is the happy path, not an error.
        return Ok(vec![]);
    }

    let mut out: Vec<Resource> = Vec::new();

    // ---- Category subdir walks ----
    for subdir in CATEGORY_SUBDIRS {
        let dir = root.join(subdir);
        if !dir.exists() {
            continue;
        }
        let walker = WalkDir::new(&dir)
            .max_depth(MAX_DEPTH)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                // Never descend into excluded subdirs if they appear inside
                // a category tree (defence in depth — the outer scope-root
                // loop already skips them).
                let name = e.file_name().to_string_lossy().into_owned();
                !is_excluded_subdir(&name)
            });

        for entry in walker.flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let Some(cat) = category_for_path(path, root) else {
                continue;
            };
            match cat {
                Category::Skill => match parse_skill(path, scope) {
                    Ok(r) => out.push(r),
                    Err(e) => tracing::warn!(path = %path.display(), error = %e, "parse_skill failed"),
                },
                Category::Agent => match parse_agent(path, scope) {
                    Ok(r) => out.push(r),
                    Err(e) => tracing::warn!(path = %path.display(), error = %e, "parse_agent failed"),
                },
                Category::Command => match parse_command(path, scope) {
                    Ok(r) => out.push(r),
                    Err(e) => tracing::warn!(path = %path.display(), error = %e, "parse_command failed"),
                },
                Category::Plugin => match parse_installed_plugins(path, scope) {
                    Ok(rs) => out.extend(rs),
                    Err(e) => tracing::warn!(path = %path.display(), error = %e, "parse_installed_plugins failed"),
                },
                Category::Hook => {
                    out.push(parse_hook_metadata(path, scope));
                }
                // Settings / Mcp / ClaudeMd are handled at scope root below.
                _ => {}
            }
        }
    }

    // ---- Scope-root settings.json ----
    let settings = root.join("settings.json");
    if settings.is_file() {
        match parse_settings(&settings, scope) {
            Ok(rs) => out.extend(rs),
            Err(e) => tracing::warn!(path = %settings.display(), error = %e, "parse_settings failed"),
        }
    }

    // ---- CLAUDE.md discovery (D-13) ----
    // Locations checked:
    //   - `<scope_root>/CLAUDE.md`                (e.g. ~/.claude/CLAUDE.md)
    //   - `<scope_root_parent>/CLAUDE.md`         (e.g. <cwd>/CLAUDE.md when scope_root = <cwd>/.claude)
    // Editable flag: project-scope files only — `~/.claude/CLAUDE.md` is
    // read-only this phase.
    let inner_claude = root.join("CLAUDE.md");
    if inner_claude.is_file() {
        let editable = matches!(scope, Scope::Project);
        match parse_claude_md(&inner_claude, scope, editable) {
            Ok(r) => out.push(r),
            Err(e) => tracing::warn!(path = %inner_claude.display(), error = %e, "parse_claude_md failed"),
        }
    }
    if let Some(parent) = root.parent() {
        let outer_claude = parent.join("CLAUDE.md");
        // Only surface the parent CLAUDE.md when the scope root is literally a
        // `.claude` dir (i.e. a project scope with both `<cwd>/CLAUDE.md` and
        // `<cwd>/.claude/CLAUDE.md`). For `~/.claude` the home directory is
        // not in scope.
        if matches!(scope, Scope::Project)
            && outer_claude.is_file()
            && root
                .file_name()
                .map(|n| n == ".claude")
                .unwrap_or(false)
        {
            match parse_claude_md(&outer_claude, scope, true) {
                Ok(r) => out.push(r),
                Err(e) => tracing::warn!(path = %outer_claude.display(), error = %e, "parse_claude_md failed"),
            }
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude_resources::fixtures::fixture_root;
    use std::fs;

    #[test]
    fn scan_scope_enumerates_all_categories() {
        let root = fixture_root();
        let rs = scan_scope(&root, Scope::Global).expect("scan");

        let count_of = |c: Category| rs.iter().filter(|r| r.category == c).count();
        assert!(count_of(Category::Skill) >= 1, "skills: {rs:?}");
        assert!(count_of(Category::Agent) >= 1, "agents");
        assert!(count_of(Category::Command) >= 1, "commands");
        assert!(count_of(Category::Plugin) >= 1, "plugins");
        assert!(count_of(Category::Hook) >= 1, "hooks");
        assert!(count_of(Category::Settings) >= 1, "settings");
        assert!(count_of(Category::Mcp) >= 1, "mcp");
        // Fixture root has no `<root>/CLAUDE.md` at scope-root parent level
        // for Global, but it has one at the scope root itself (depending on
        // layout). Total is expected to be ≥ 7 across categories.
        assert!(rs.len() >= 7, "expected ≥ 7 resources, got {}: {:#?}", rs.len(), rs);
    }

    fn mk_scope_tree(base: &Path) {
        fs::create_dir_all(base.join("skills/s1")).unwrap();
        fs::write(
            base.join("skills/s1/SKILL.md"),
            "---\nname: s1\ndescription: d\n---\nbody",
        )
        .unwrap();
    }

    #[test]
    fn scan_excludes_cache_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        mk_scope_tree(root);
        fs::create_dir_all(root.join("cache/deep")).unwrap();
        fs::write(root.join("cache/deep/SKILL.md"), "junk").unwrap();

        let rs = scan_scope(root, Scope::Global).unwrap();
        assert!(
            !rs.iter().any(|r| r.path.to_string_lossy().contains("/cache/")),
            "cache/ should be excluded: {rs:#?}"
        );
    }

    #[test]
    fn scan_excludes_session_env_projects_backups_downloads() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        mk_scope_tree(root);
        for dir in ["session-env", "projects", "backups", "downloads"] {
            fs::create_dir_all(root.join(dir)).unwrap();
            fs::write(root.join(dir).join("SKILL.md"), "junk").unwrap();
        }

        let rs = scan_scope(root, Scope::Global).unwrap();
        for dir in ["session-env", "projects", "backups", "downloads"] {
            let needle = format!("/{dir}/");
            assert!(
                !rs.iter()
                    .any(|r| r.path.to_string_lossy().contains(&needle)),
                "{dir}/ should be excluded"
            );
        }
    }

    #[test]
    fn scan_missing_project_claude_is_ok() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("does-not-exist");
        let rs = scan_scope(&missing, Scope::Project).expect("Ok on missing");
        assert!(rs.is_empty(), "should return empty vec, got {rs:?}");
    }
}
