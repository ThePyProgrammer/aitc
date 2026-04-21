//! Phase 17: Best-effort Bash `command` → target-path extractor + read-only
//! safelist for the conflict-gate predicate. CONTEXT D-09..D-13.
//!
//! Allow-on-parse-failure (D-10): a command we can't locate a write target
//! in is, by definition, not a known conflict surface. Safelist short-circuits
//! before parsing so common read-only tools stay zero-overhead.
//!
//! # Tracing contract (D-13)
//!
//! Every return path emits `tracing::debug!(kind = "bash_parse", ...)` with
//! `command_len`, `tokens`, and `result` fields — NEVER the raw `command`
//! string, which can contain secrets. `Plan 05`'s integration tests grep on
//! the `kind = "bash_parse"` key.

use std::path::{Path, PathBuf};

/// Result of attempting to extract write targets from a Bash command string.
///
/// * `Safelisted` — first-token matched a known read-only pattern; no parse
///   needed, no conflict query, no approval row. Fast path for `ls`, `pwd`,
///   `git status`, etc.
/// * `Targets(...)` — parser found one or more write targets. Caller
///   canonicalizes each path and issues a conflict query per-target.
/// * `ParseFailed` — shlex returned `None`, argv was empty, or the verb
///   dispatch yielded no targets (unknown verb, heredoc, process substitution,
///   etc.). Maps to `Allow` at the hook layer (D-10).
#[derive(Debug)]
pub enum BashParseResult {
    Safelisted,
    Targets(Vec<PathBuf>),
    ParseFailed,
}

/// Single-word read-only commands that bypass parsing entirely (D-11).
/// Any command whose argv is exactly one of these tokens is safelisted,
/// provided the command string contains no `>` redirect.
const SINGLE_WORD_SAFELIST: &[&str] = &[
    "ls", "pwd", "cat", "head", "tail", "echo", "wc", "which", "whoami", "date", "uname", "test",
    "[",
];

/// Git subcommands considered read-only (D-11). Full argv of `git <subcmd>
/// ...` with `<subcmd>` in this list is safelisted, provided no redirect.
const GIT_SAFE_SUBCMDS: &[&str] = &["status", "diff", "log", "show", "branch", "stash"];

/// Flags that disable the `find` safelist (D-11). If any appear in argv,
/// the command falls through to full parsing.
const DESTRUCTIVE_FIND_FLAGS: &[&str] = &["-exec", "-execdir", "-delete", "-ok"];

/// Shell operators used to segment a command into independently-parsed
/// sub-commands (D-12). Each segment is dispatched to `parse_one_segment`
/// and the union of targets is returned.
const SHELL_OPERATORS: &[&str] = &["|", "&&", "||", ";"];

/// Best-effort Bash → target-path extraction.
///
/// Contract (D-09):
/// * Input: a single `command` string as it appears in `tool_input.command`
///   plus a `cwd` against which relative paths are resolved.
/// * Output: `BashParseResult` — one of `Safelisted`, `Targets(Vec<PathBuf>)`,
///   or `ParseFailed`. Paths are absolute but NOT canonicalized; the hook
///   layer canonicalizes to share the D-02 code path with Edit/Write.
///
/// Parser scope (D-12): operator-split; per-segment verb dispatch over
/// `cp`/`mv`/`rm`/`touch`/`mkdir`/`patch`/`sed -i`/`awk -i inplace`/`dd of=`/
/// `install`/`tee` plus stdout/stderr redirects (`>`, `>>`, `2>`, `&>`).
/// Compiler/build-output inference is explicitly out of scope for v1.
pub fn extract_target_paths(command: &str, cwd: &Path) -> BashParseResult {
    // Cheap pre-check: any stdout-ish redirect forbids safelist (D-11 last
    // bullet). `>` in a quoted context is rare enough that the false-positive
    // cost (parsing a command we could have safelisted) is acceptable.
    let has_redirect = command.contains('>');

    let argv = match shlex::split(command) {
        Some(v) if !v.is_empty() => v,
        _ => {
            tracing::debug!(
                kind = "bash_parse",
                command_len = command.len(),
                tokens = 0_usize,
                result = "ParseFailed",
                "shlex::split returned None or empty"
            );
            return BashParseResult::ParseFailed;
        }
    };

    // Safelist dispatch (D-11) — only when no redirect present.
    if !has_redirect {
        let first = argv[0].as_str();
        if argv.len() == 1 && SINGLE_WORD_SAFELIST.contains(&first) {
            tracing::debug!(
                kind = "bash_parse",
                command_len = command.len(),
                tokens = argv.len(),
                result = "Safelisted"
            );
            return BashParseResult::Safelisted;
        }
        if first == "git"
            && argv.len() >= 2
            && GIT_SAFE_SUBCMDS.contains(&argv[1].as_str())
        {
            tracing::debug!(
                kind = "bash_parse",
                command_len = command.len(),
                tokens = argv.len(),
                result = "Safelisted"
            );
            return BashParseResult::Safelisted;
        }
        if first == "find"
            && !argv
                .iter()
                .any(|t| DESTRUCTIVE_FIND_FLAGS.contains(&t.as_str()))
        {
            tracing::debug!(
                kind = "bash_parse",
                command_len = command.len(),
                tokens = argv.len(),
                result = "Safelisted"
            );
            return BashParseResult::Safelisted;
        }
    }

    // Verb dispatch — Task 2 replaces this stub with operator-split + per-
    // segment verb table. Task 1 tests that DEPEND on verb dispatch assert
    // only the safelist-negative property (not-Safelisted), so this stub
    // returning ParseFailed is compatible.
    tracing::debug!(
        kind = "bash_parse",
        command_len = command.len(),
        tokens = argv.len(),
        result = "ParseFailed",
        "Task 1 stub — verb dispatch pending Task 2"
    );
    // `cwd`, `SHELL_OPERATORS`, `parse_one_segment`, `split_on_operators` are
    // load-bearing for Task 2 — silence unused warnings in the Task 1 stub.
    let _ = cwd;
    let _ = SHELL_OPERATORS;
    BashParseResult::ParseFailed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cwd() -> PathBuf {
        PathBuf::from("/repo")
    }

    // ---- D-11 safelist (Tests 1-7) ----

    #[test]
    fn safelist_ls() {
        assert!(matches!(
            extract_target_paths("ls", &cwd()),
            BashParseResult::Safelisted
        ));
    }

    #[test]
    fn safelist_git_status() {
        assert!(matches!(
            extract_target_paths("git status", &cwd()),
            BashParseResult::Safelisted
        ));
    }

    #[test]
    fn safelist_git_log() {
        assert!(matches!(
            extract_target_paths("git log", &cwd()),
            BashParseResult::Safelisted
        ));
    }

    #[test]
    fn safelist_pwd() {
        assert!(matches!(
            extract_target_paths("pwd", &cwd()),
            BashParseResult::Safelisted
        ));
    }

    #[test]
    fn safelist_excludes_redirect() {
        // D-11 last bullet: any `>` in the command string kills the safelist.
        // Task 1 stub returns ParseFailed here; Task 2 will return Targets.
        // Both are NOT Safelisted — which is the property under test.
        let r = extract_target_paths("git diff > out.patch", &cwd());
        assert!(!matches!(r, BashParseResult::Safelisted));
    }

    #[test]
    fn safelist_find_without_destructive() {
        assert!(matches!(
            extract_target_paths("find . -name 'x.rs'", &cwd()),
            BashParseResult::Safelisted
        ));
    }

    #[test]
    fn safelist_find_with_delete_falls_through() {
        // `-delete` is destructive → safelist declines. Task 1 stub returns
        // ParseFailed (no verb matches `find`); Task 2 may return Targets or
        // ParseFailed depending on verb-table scope. The invariant under test
        // is ONLY the safelist-negative property.
        let r = extract_target_paths("find . -delete", &cwd());
        assert!(!matches!(r, BashParseResult::Safelisted));
    }

    // ---- D-10 parse-failure fallback (Tests 8-9) ----

    #[test]
    fn parse_fail_unterminated_quote() {
        assert!(matches!(
            extract_target_paths("echo \"unterminated", &cwd()),
            BashParseResult::ParseFailed
        ));
    }

    #[test]
    fn parse_fail_empty_argv() {
        assert!(matches!(
            extract_target_paths("", &cwd()),
            BashParseResult::ParseFailed
        ));
    }
}
