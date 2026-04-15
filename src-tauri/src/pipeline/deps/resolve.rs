//! Per-language import resolution (D-09).
//!
//! Converts an extracted specifier (as a string) into an absolute, canonicalized
//! `PathBuf` rooted inside `repo_root`. External specifiers (bare npm packages,
//! std/serde crates, stdlib Python modules) return `None` per D-07.
//!
//! Security mitigations:
//! - **T-07-B** (path traversal): the public [`resolve_import`] entry point
//!   canonicalizes both the resolved path and the repo root, then asserts
//!   `starts_with(&canonical_root)` before returning. A candidate that escapes
//!   the repo sandbox is dropped silently.
use crate::pipeline::deps::extract::SourceLanguage;
use std::path::{Path, PathBuf};

pub const TS_EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"];
pub const RUST_EXTENSIONS: &[&str] = &["rs"];

/// Caller-provided resolver context. Plan 03+ will populate this from
/// `tsconfig.json#/compilerOptions/paths` parsed at watch start. Plan 02 only
/// uses it in unit tests — `build_dependency_graph` passes `Default::default()`.
#[derive(Debug, Clone, Default)]
pub struct ResolveContext {
    /// Pairs of (alias, target_dirs) where alias is e.g. `"@/"` and target_dirs
    /// are repo-relative paths like `PathBuf::from("src")`.
    pub tsconfig_paths: Vec<(String, Vec<PathBuf>)>,
}

/// Master dispatch. Returns a canonicalized absolute path inside `repo_root`
/// or `None` if the spec is external / unresolvable / escapes the sandbox.
pub fn resolve_import(
    spec: &str,
    from_file: &Path,
    repo_root: &Path,
    language: SourceLanguage,
    ctx: &ResolveContext,
) -> Option<PathBuf> {
    let resolved = match language {
        SourceLanguage::TypeScript
        | SourceLanguage::Tsx
        | SourceLanguage::JavaScript
        | SourceLanguage::Jsx => resolve_ts_import(spec, from_file, repo_root, &ctx.tsconfig_paths),
        SourceLanguage::Rust => resolve_rust_import(spec, from_file, repo_root),
        SourceLanguage::Python => resolve_python_import(spec, from_file, repo_root),
    }?;

    // T-07-B: path-traversal check. Canonicalize resolved candidate + repo_root
    // and assert containment. Canonicalize can fail if the file vanished
    // between resolution and check — treat as unresolved.
    let canonical = resolved.canonicalize().ok()?;
    let canonical_root = repo_root.canonicalize().ok()?;
    if !canonical.starts_with(&canonical_root) {
        tracing::trace!(
            spec,
            from = %from_file.display(),
            candidate = %canonical.display(),
            "dep_graph: path traversal attempt dropped"
        );
        return None;
    }
    Some(canonical)
}

/// Resolve a TS/JS specifier. Handles:
/// - Relative (`./foo`, `../bar/baz`) via [`resolve_with_extensions`].
/// - tsconfig `paths` aliases (e.g. `"@/*": ["src/*"]`).
/// - Bare specifiers (`react`, `lodash`) → `None` (external, D-07).
pub fn resolve_ts_import(
    spec: &str,
    from_file: &Path,
    repo_root: &Path,
    tsconfig_paths: &[(String, Vec<PathBuf>)],
) -> Option<PathBuf> {
    if spec.starts_with("./") || spec.starts_with("../") {
        let base = from_file.parent()?;
        let joined = base.join(spec);
        return resolve_with_extensions(&joined, TS_EXTENSIONS);
    }
    for (alias, targets) in tsconfig_paths {
        let alias_stripped = alias.trim_end_matches('*');
        if alias_stripped.is_empty() {
            continue;
        }
        if let Some(rest) = spec.strip_prefix(alias_stripped) {
            let rest_trimmed = rest.trim_start_matches('/');
            for target in targets {
                let target_clean = target.to_string_lossy().trim_end_matches('*').to_string();
                let candidate = repo_root.join(&target_clean).join(rest_trimmed);
                if let Some(p) = resolve_with_extensions(&candidate, TS_EXTENSIONS) {
                    return Some(p);
                }
            }
        }
    }
    None // bare specifier — external, D-07 dropped
}

/// Resolve a Rust `use` / `mod` spec. Handles:
/// - `mod sibling;` (single-segment) → sibling `.rs` file or `sibling/mod.rs`.
/// - `crate::foo::Bar` → `repo_root/src/foo.rs` (best-effort; drops final
///   segment as the imported item name).
/// - `self::` / `super::` relative walks.
/// - Anything else (external crate path like `std::path::Path`) → `None` (D-07).
pub fn resolve_rust_import(spec: &str, from_file: &Path, repo_root: &Path) -> Option<PathBuf> {
    let segments: Vec<&str> = spec.split("::").collect();
    if segments.is_empty() {
        return None;
    }
    // Single-segment specs come from `mod sibling;` declarations.
    if segments.len() == 1 {
        return resolve_rust_relative(&segments, from_file);
    }
    let head = segments[0];
    if head == "crate" {
        let path_segments = &segments[1..];
        // Drop final segment (item name); if only one path segment is left,
        // the item is itself a module and we resolve that file.
        let head_slice = if path_segments.len() > 1 {
            &path_segments[..path_segments.len() - 1]
        } else {
            path_segments
        };
        if head_slice.is_empty() {
            return None;
        }
        // Best-effort: assume the crate root lives at `repo_root/src/`.
        let mut candidate = repo_root.to_path_buf();
        candidate.push("src");
        for s in head_slice {
            candidate.push(s);
        }
        if let Some(p) = resolve_with_extensions(&candidate, RUST_EXTENSIONS) {
            return Some(p);
        }
        let mod_rs = candidate.join("mod.rs");
        if mod_rs.is_file() {
            return Some(mod_rs);
        }
        None
    } else if head == "self" || head == "super" {
        resolve_rust_relative(&segments, from_file)
    } else {
        // External crate (std, serde, tokio, …) — D-07 drop.
        None
    }
}

fn resolve_rust_relative(segments: &[&str], from_file: &Path) -> Option<PathBuf> {
    let mut base = from_file.parent()?.to_path_buf();
    let mut iter = segments.iter().peekable();
    while let Some(s) = iter.peek() {
        match **s {
            "super" => {
                base = base.parent()?.to_path_buf();
                iter.next();
            }
            "self" => {
                iter.next();
            }
            _ => break,
        }
    }
    let rest: Vec<&str> = iter.copied().collect();
    if rest.is_empty() {
        return None;
    }
    let head_slice: &[&str] = if rest.len() > 1 {
        &rest[..rest.len() - 1]
    } else {
        &rest[..]
    };
    let mut candidate = base;
    for s in head_slice {
        candidate.push(s);
    }
    if let Some(p) = resolve_with_extensions(&candidate, RUST_EXTENSIONS) {
        return Some(p);
    }
    let mod_rs = candidate.join("mod.rs");
    if mod_rs.is_file() {
        return Some(mod_rs);
    }
    None
}

/// Resolve a Python `import x` / `from .x import y` spec. Handles:
/// - Relative (`.foo`, `..baz`) — leading-dot count = parents to walk.
/// - Absolute dotted (`pkg.mod`) — rooted at `repo_root`.
/// - Package directories (`__init__.py`).
pub fn resolve_python_import(spec: &str, from_file: &Path, repo_root: &Path) -> Option<PathBuf> {
    if spec.starts_with('.') {
        let dots = spec.chars().take_while(|c| *c == '.').count();
        let rest = &spec[dots..];
        let mut base = from_file.parent()?.to_path_buf();
        // Leading-dot count: 1 = current pkg, 2 = parent pkg, etc.
        for _ in 1..dots {
            base = base.parent()?.to_path_buf();
        }
        let parts: Vec<&str> = rest.split('.').filter(|s| !s.is_empty()).collect();
        for p in &parts {
            base.push(p);
        }
        return resolve_python_module(&base);
    }
    let parts: Vec<&str> = spec.split('.').collect();
    let mut candidate = repo_root.to_path_buf();
    for p in &parts {
        candidate.push(p);
    }
    resolve_python_module(&candidate)
}

fn resolve_python_module(candidate: &Path) -> Option<PathBuf> {
    let py = candidate.with_extension("py");
    if py.is_file() {
        return Some(py);
    }
    let init = candidate.join("__init__.py");
    if init.is_file() {
        return Some(init);
    }
    None
}

/// Walk the TS/JS/Rust extension list and look for a matching concrete file.
/// Also handles directory-with-index files (`foo/` → `foo/index.ts`).
pub fn resolve_with_extensions(path: &Path, extensions: &[&str]) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    for ext in extensions {
        let candidate = path.with_extension(ext);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if path.is_dir() {
        for ext in extensions {
            let candidate = path.join(format!("index.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_ts_repo() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("src/lib")).unwrap();
        fs::create_dir_all(root.join("bar")).unwrap();
        fs::write(root.join("src/a.ts"), "").unwrap();
        fs::write(root.join("src/foo.ts"), "").unwrap();
        fs::write(root.join("bar/baz.ts"), "").unwrap();
        fs::write(root.join("src/lib/x.ts"), "").unwrap();
        dir
    }

    #[test]
    fn ts_relative() {
        let dir = setup_ts_repo();
        let root = dir.path();
        let from = root.join("src/a.ts");
        let resolved = resolve_ts_import("./foo", &from, root, &[]);
        assert!(resolved.is_some(), "expected ./foo → src/foo.ts");
        assert!(resolved.unwrap().ends_with("src/foo.ts"));
    }

    #[test]
    fn tsconfig_alias() {
        let dir = setup_ts_repo();
        let root = dir.path();
        let from = root.join("src/a.ts");
        let paths = vec![("@/".to_string(), vec![PathBuf::from("src")])];
        let resolved = resolve_ts_import("@/lib/x", &from, root, &paths);
        assert!(resolved.is_some(), "expected @/lib/x → src/lib/x.ts");
        assert!(resolved.unwrap().ends_with("src/lib/x.ts"));
    }

    #[test]
    fn external_skipped() {
        let dir = setup_ts_repo();
        let root = dir.path();
        let from = root.join("src/a.ts");
        let resolved = resolve_ts_import("react", &from, root, &[]);
        assert!(resolved.is_none(), "bare specifier 'react' must be None (D-07)");
    }

    #[test]
    fn ts_index_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("src/foo")).unwrap();
        fs::write(root.join("src/foo/index.ts"), "").unwrap();
        fs::write(root.join("src/a.ts"), "").unwrap();
        let from = root.join("src/a.ts");
        let resolved = resolve_ts_import("./foo", &from, root, &[]);
        assert!(resolved.is_some());
        assert!(resolved.unwrap().ends_with("src/foo/index.ts"));
    }

    #[test]
    fn rust_mod_decl() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/lib.rs"), "").unwrap();
        fs::write(root.join("src/sibling.rs"), "").unwrap();
        let from = root.join("src/lib.rs");
        let resolved = resolve_rust_import("sibling", &from, root);
        assert!(resolved.is_some());
        assert!(resolved.unwrap().ends_with("src/sibling.rs"));
    }

    #[test]
    fn python_relative_from() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("pkg")).unwrap();
        fs::write(root.join("pkg/a.py"), "").unwrap();
        fs::write(root.join("pkg/foo.py"), "").unwrap();
        let from = root.join("pkg/a.py");
        let resolved = resolve_python_import(".foo", &from, root);
        assert!(resolved.is_some());
        assert!(resolved.unwrap().ends_with("pkg/foo.py"));
    }

    #[test]
    fn python_relative_from_pkg() {
        // `.foo` where foo/ is a package directory with __init__.py
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("pkg/foo")).unwrap();
        fs::write(root.join("pkg/a.py"), "").unwrap();
        fs::write(root.join("pkg/foo/__init__.py"), "").unwrap();
        let from = root.join("pkg/a.py");
        let resolved = resolve_python_import(".foo", &from, root);
        assert!(resolved.is_some());
        assert!(resolved.unwrap().ends_with("pkg/foo/__init__.py"));
    }

    #[test]
    fn path_traversal_blocked() {
        // T-07-B: constructing a candidate whose canonicalized target lives
        // outside repo_root must return None via resolve_import's containment
        // check.
        let outside_dir = tempfile::tempdir().unwrap();
        let repo_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.ts");
        fs::write(&outside_file, "").unwrap();
        fs::create_dir_all(repo_dir.path().join("src")).unwrap();
        let from = repo_dir.path().join("src/a.ts");
        fs::write(&from, "").unwrap();
        // Craft a spec that physically resolves OUTSIDE the repo. Use relative
        // traversal targeting the outside tempdir (an absolute path on disk
        // we just created). We build the spec at runtime from the known dir
        // layout.
        let outside_canon = outside_dir.path().canonicalize().unwrap();
        let repo_canon = repo_dir.path().canonicalize().unwrap();
        // From `<repo>/src/a.ts`, walk up twice to the temp-dir parent, then
        // sideways into `<outside>/secret`. Computing the relative traversal:
        let from_canon = from.canonicalize().unwrap();
        let from_parent = from_canon.parent().unwrap();
        let rel = pathdiff_manual(from_parent, &outside_canon.join("secret"));
        let spec = format!("./{}", rel.to_string_lossy().replace('\\', "/"));

        let ctx = ResolveContext::default();
        let resolved = resolve_import(
            &spec,
            &from_canon,
            repo_canon.as_path(),
            SourceLanguage::TypeScript,
            &ctx,
        );
        assert!(
            resolved.is_none(),
            "path traversal ({spec}) must return None; got {resolved:?}"
        );
    }

    /// Minimal pathdiff (we don't want a new dep for one test). Assumes both
    /// paths are absolute and produces a `../../a/b`-style relative path.
    fn pathdiff_manual(from: &Path, to: &Path) -> PathBuf {
        let from_components: Vec<_> = from.components().collect();
        let to_components: Vec<_> = to.components().collect();
        let common = from_components
            .iter()
            .zip(to_components.iter())
            .take_while(|(a, b)| a == b)
            .count();
        let mut out = PathBuf::new();
        for _ in common..from_components.len() {
            out.push("..");
        }
        for c in &to_components[common..] {
            out.push(c.as_os_str());
        }
        out
    }
}
