//! Gitignore-respecting walker with hardcoded excludes per D-10 and Pitfall 6.
//!
//! Hardcoded excludes (layered on .gitignore): .git, node_modules, target,
//! build, dist, .next, out. Also strips binary file extensions that AI agents
//! cannot meaningfully edit (see HARDCODED_BINARY_EXTENSIONS) and dependency
//! lockfiles across ecosystems (see HARDCODED_LOCKFILES).

use ignore::{overrides::OverrideBuilder, WalkBuilder};
use std::path::Path;

/// Hardcoded directory names excluded regardless of .gitignore contents.
/// Rationale (02-RESEARCH.md Pitfall 6): walking node_modules/ with 50k files
/// adds seconds of startup latency and fills the tree index with noise.
pub const HARDCODED_EXCLUDES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "build",
    "dist",
    ".next",
    "out",
];

/// Binary file extensions excluded from the walker. AI agents cannot edit
/// these formats, so surfacing them in the radar, heat map, or session_files
/// is noise at best and misleading at worst (a large PNG would dominate the
/// treemap purely on byte size). SVG is intentionally NOT in this list — it's
/// XML and frequently edited.
pub const HARDCODED_BINARY_EXTENSIONS: &[&str] = &[
    // Images
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "tif", "avif", "heic", "heif",
    // Video
    "mp4", "webm", "mov", "avi", "mkv", "m4v", "mpg", "mpeg", "wmv", "flv", "ogv",
    // Audio
    "mp3", "wav", "flac", "ogg", "m4a", "aac", "opus",
    // Fonts
    "ttf", "otf", "woff", "woff2", "eot",
    // Archives
    "zip", "tar", "gz", "tgz", "bz2", "7z", "rar", "xz", "zst",
    // Binary documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    // Compiled / executable
    "exe", "dll", "so", "dylib", "class", "jar", "war", "wasm", "pyc", "pyo", "bin", "obj",
    // Databases
    "db", "sqlite", "sqlite3",
    // Disk images
    "iso", "dmg", "img",
    // 3D / design binaries
    "blend", "fbx", "glb", "gltf", "stl", "psd", "ai",
];

/// Dependency-manager lockfiles excluded from the walker. These are
/// auto-generated ledgers — agents regenerate them by running a package
/// manager, not by direct editing, and they're typically massive (thousands
/// of lines), so they'd dominate the treemap and heat map for no value.
///
/// Listed as filename or glob; matched case-insensitively via character-class
/// expansion in build_walker. `Manifest.toml` (Julia) is deliberately omitted
/// — the name is too generic and collides with many unrelated manifests.
pub const HARDCODED_LOCKFILES: &[&str] = &[
    // JavaScript / TypeScript
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "npm-shrinkwrap.json",
    "deno.lock",
    // Python
    "uv.lock",
    "pixi.lock",
    "poetry.lock",
    "Pipfile.lock",
    "pdm.lock",
    "conda-lock.yml",
    // Rust
    "Cargo.lock",
    // Ruby
    "Gemfile.lock",
    // PHP
    "composer.lock",
    // Go
    "go.sum",
    // Elixir
    "mix.lock",
    // Erlang
    "rebar.lock",
    // Dart / Flutter
    "pubspec.lock",
    // Swift / Apple
    "Package.resolved",
    "Podfile.lock",
    "Cartfile.resolved",
    // .NET
    "packages.lock.json",
    "paket.lock",
    // Haskell
    "stack.yaml.lock",
    "cabal.project.freeze",
    // Nix
    "flake.lock",
    // Terraform
    ".terraform.lock.hcl",
    // R
    "renv.lock",
    // Perl
    "cpanfile.snapshot",
    // JVM / Gradle
    "gradle.lockfile",
    "gradle/dependency-locks/*.lockfile",
];

/// Expand an ASCII alphabetic pattern into a case-insensitive gitignore glob
/// by converting each letter into a `[aA]` character class. The `ignore`
/// crate's override matcher has no (?i) flag, so we desugar manually.
fn case_insensitive(pattern: &str) -> String {
    pattern
        .chars()
        .map(|c| {
            if c.is_ascii_alphabetic() {
                format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase())
            } else {
                c.to_string()
            }
        })
        .collect()
}

/// Construct a WalkBuilder that:
/// - respects `.gitignore`, `.ignore`, `.git/info/exclude`, and global gitignore
/// - additionally excludes HARDCODED_EXCLUDES directories
/// - additionally excludes HARDCODED_BINARY_EXTENSIONS file types
/// - additionally excludes HARDCODED_LOCKFILES across ecosystems
/// - skips hidden files by default (matches D-10 intent of repo-relevant files only)
/// - follows a single-threaded walk (parallel has overhead for <10k files — escalate later if benchmarks need it)
pub fn build_walker(root: &Path) -> WalkBuilder {
    let mut overrides = OverrideBuilder::new(root);
    for excluded in HARDCODED_EXCLUDES {
        // `!pattern` in gitignore-speak means "exclude this". OverrideBuilder
        // uses gitignore syntax with inverted sense: add("!pattern") means
        // "treat this as excluded". Add both the dir itself and its contents
        // to catch both the entry and its descendants.
        let _ = overrides.add(&format!("!**/{}", excluded));
        let _ = overrides.add(&format!("!**/{}/**", excluded));
    }
    for ext in HARDCODED_BINARY_EXTENSIONS {
        let _ = overrides.add(&format!("!**/*.{}", case_insensitive(ext)));
    }
    for name in HARDCODED_LOCKFILES {
        // Lockfile entries may be a bare filename or a path glob (e.g.
        // "gradle/dependency-locks/*.lockfile"). If it already contains a
        // path separator, treat it as an in-tree pattern; otherwise match
        // at any depth.
        let pattern = case_insensitive(name);
        if name.contains('/') {
            let _ = overrides.add(&format!("!{}", pattern));
            let _ = overrides.add(&format!("!**/{}", pattern));
        } else {
            let _ = overrides.add(&format!("!**/{}", pattern));
        }
    }
    let overrides = overrides.build().expect("override builder failed");

    let mut b = WalkBuilder::new(root);
    b.standard_filters(true)
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .overrides(overrides);
    b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::test_util::make_temp_repo;
    use std::fs;

    fn collect_paths(root: &Path) -> Vec<String> {
        build_walker(root)
            .build()
            .flatten()
            .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
            .map(|e| {
                e.path()
                    .strip_prefix(root)
                    .unwrap_or(e.path())
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect()
    }

    #[test]
    fn skips_dot_git_dir() {
        let tmp = make_temp_repo();
        // make_temp_repo already creates .git/HEAD; re-creating is idempotent.
        fs::create_dir_all(tmp.path().join(".git")).unwrap();
        fs::write(tmp.path().join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        let paths = collect_paths(tmp.path());
        assert!(
            !paths.iter().any(|p| p.contains(".git/")),
            "found .git file: {paths:?}"
        );
    }

    #[test]
    fn skips_hardcoded_build_dirs() {
        let tmp = make_temp_repo();
        for dir in ["node_modules", "target", "build", "dist", ".next", "out"] {
            let d = tmp.path().join(dir);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("junk.bin"), b"x").unwrap();
        }
        let paths = collect_paths(tmp.path());
        for dir in ["node_modules", "target", "build", "dist", ".next", "out"] {
            assert!(
                !paths.iter().any(|p| p.contains(&format!("{}/", dir))),
                "found {} files in walk: {:?}",
                dir,
                paths
            );
        }
    }

    #[test]
    fn respects_gitignore_glob() {
        let tmp = make_temp_repo();
        fs::write(tmp.path().join(".gitignore"), "*.log\n").unwrap();
        fs::write(tmp.path().join("app.log"), "nope").unwrap();
        fs::write(tmp.path().join("app.rs"), "ok").unwrap();
        let paths = collect_paths(tmp.path());
        assert!(
            paths.iter().any(|p| p.ends_with("app.rs")),
            "missing app.rs: {paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.ends_with("app.log")),
            "found app.log: {paths:?}"
        );
    }

    #[test]
    fn skips_binary_extensions() {
        let tmp = make_temp_repo();
        // Representative extensions across the categories agents can't edit.
        let binary_files = [
            "logo.png",
            "hero.JPG", // case-insensitive match
            "demo.mp4",
            "theme.woff2",
            "archive.zip",
            "spec.pdf",
            "native.dll",
            "cache.sqlite",
            "asset.blend",
        ];
        for name in &binary_files {
            fs::write(tmp.path().join(name), b"x").unwrap();
        }
        // A sibling source file that MUST still appear.
        fs::write(tmp.path().join("main.rs"), "fn x() {}").unwrap();
        // SVG is intentionally text-editable and should NOT be filtered.
        fs::write(tmp.path().join("icon.svg"), "<svg/>").unwrap();

        let paths = collect_paths(tmp.path());
        for name in &binary_files {
            assert!(
                !paths.iter().any(|p| p.ends_with(&name.to_string())),
                "binary file {} leaked into walk: {:?}",
                name,
                paths
            );
        }
        assert!(paths.iter().any(|p| p.ends_with("main.rs")), "source file stripped: {paths:?}");
        assert!(paths.iter().any(|p| p.ends_with("icon.svg")), "svg should not be filtered: {paths:?}");
    }

    #[test]
    fn skips_lockfiles_across_ecosystems() {
        let tmp = make_temp_repo();
        // One representative lockfile per ecosystem the list targets. Both
        // canonical and case-shifted variants to confirm case-insensitive
        // matching holds on case-sensitive filesystems.
        let lockfiles = [
            "package-lock.json",
            "yarn.lock",
            "pnpm-lock.yaml",
            "bun.lock",
            "bun.lockb",
            "npm-shrinkwrap.json",
            "deno.lock",
            "uv.lock",
            "pixi.lock",
            "poetry.lock",
            "Pipfile.lock",
            "pdm.lock",
            "conda-lock.yml",
            "Cargo.lock",
            "cargo.lock", // case-insensitive sanity
            "Gemfile.lock",
            "composer.lock",
            "go.sum",
            "mix.lock",
            "rebar.lock",
            "pubspec.lock",
            "Package.resolved",
            "Podfile.lock",
            "Cartfile.resolved",
            "packages.lock.json",
            "paket.lock",
            "stack.yaml.lock",
            "cabal.project.freeze",
            "flake.lock",
            ".terraform.lock.hcl",
            "renv.lock",
            "cpanfile.snapshot",
            "gradle.lockfile",
        ];
        for name in &lockfiles {
            fs::write(tmp.path().join(name), b"x").unwrap();
        }
        // Gradle nested lock path.
        fs::create_dir_all(tmp.path().join("gradle").join("dependency-locks")).unwrap();
        fs::write(
            tmp.path()
                .join("gradle")
                .join("dependency-locks")
                .join("compileClasspath.lockfile"),
            b"x",
        )
        .unwrap();
        // Regression guard: these LOOK lockfile-ish but must stay visible
        // because agents actually edit them (manifests, not lockfiles).
        fs::write(tmp.path().join("package.json"), "{}").unwrap();
        fs::write(tmp.path().join("Cargo.toml"), "[package]\nname=\"x\"").unwrap();
        fs::write(tmp.path().join("pyproject.toml"), "[project]").unwrap();

        let paths = collect_paths(tmp.path());
        for name in &lockfiles {
            assert!(
                !paths.iter().any(|p| p.ends_with(&name.to_string())),
                "lockfile {} leaked into walk: {:?}",
                name,
                paths
            );
        }
        assert!(
            !paths
                .iter()
                .any(|p| p.ends_with("compileClasspath.lockfile")),
            "gradle dependency-lock leaked: {paths:?}"
        );
        for manifest in ["package.json", "Cargo.toml", "pyproject.toml"] {
            assert!(
                paths.iter().any(|p| p.ends_with(manifest)),
                "manifest {} was incorrectly stripped: {:?}",
                manifest,
                paths
            );
        }
    }

    #[test]
    fn includes_regular_source_files() {
        let tmp = make_temp_repo();
        fs::create_dir_all(tmp.path().join("src")).unwrap();
        fs::write(tmp.path().join("src").join("main.rs"), "fn main() {}").unwrap();
        fs::write(tmp.path().join("README.md"), "# readme").unwrap();
        let paths = collect_paths(tmp.path());
        assert!(
            paths.iter().any(|p| p.ends_with("src/main.rs")),
            "missing src/main.rs: {paths:?}"
        );
        assert!(
            paths.iter().any(|p| p.ends_with("README.md")),
            "missing README.md: {paths:?}"
        );
    }
}
