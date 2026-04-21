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
        if first == "git" && argv.len() >= 2 && GIT_SAFE_SUBCMDS.contains(&argv[1].as_str()) {
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

    // Operator-split + per-segment verb dispatch (D-12). shlex returns
    // operators like `|`, `&&`, `;` as standalone tokens (verified in
    // `shlex_tokenization_probe`), so a literal string compare is sufficient.
    let segments = split_on_operators(argv.clone(), SHELL_OPERATORS);
    let mut targets = Vec::new();
    for seg in &segments {
        targets.extend(parse_one_segment(seg, cwd));
    }

    if targets.is_empty() {
        tracing::debug!(
            kind = "bash_parse",
            command_len = command.len(),
            tokens = argv.len(),
            result = "ParseFailed",
            "verb dispatch yielded no targets"
        );
        return BashParseResult::ParseFailed;
    }
    tracing::debug!(
        kind = "bash_parse",
        command_len = command.len(),
        tokens = argv.len(),
        target_count = targets.len(),
        result = "Targets"
    );
    BashParseResult::Targets(targets)
}

/// Split an argv vector at any token equal to one of `ops`. Empty segments
/// (e.g. from leading or consecutive operators) are dropped. Operator tokens
/// themselves are discarded.
fn split_on_operators(argv: Vec<String>, ops: &[&str]) -> Vec<Vec<String>> {
    let mut segments = Vec::new();
    let mut current: Vec<String> = Vec::new();
    for tok in argv {
        if ops.contains(&tok.as_str()) {
            if !current.is_empty() {
                segments.push(std::mem::take(&mut current));
            }
        } else {
            current.push(tok);
        }
    }
    if !current.is_empty() {
        segments.push(current);
    }
    segments
}

/// Resolve a raw path token against `cwd`. Absolute paths are returned as-is;
/// relative paths are joined to `cwd`. No tilde or env-var expansion (RESEARCH
/// §4) — `~/foo` becomes `<cwd>/~/foo`, an accepted conservative miss.
fn resolve(cwd: &Path, raw: &str) -> PathBuf {
    let p = Path::new(raw);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd.join(p)
    }
}

/// Tokens that the redirect scan recognises as stdout/stderr redirect
/// operators. Their right-hand neighbour is the write target.
const REDIRECT_TOKENS: &[&str] = &[">", ">>", "2>", "&>"];

/// Parse a single operator-free segment. Collects write targets from two
/// independent sources: (a) stdout/stderr redirects anywhere in the segment,
/// (b) the segment's first token interpreted as a mutating verb.
fn parse_one_segment(segment: &[String], cwd: &Path) -> Vec<PathBuf> {
    if segment.is_empty() {
        return Vec::new();
    }
    let first = segment[0].as_str();
    let mut targets: Vec<PathBuf> = Vec::new();

    // Redirect scan — runs regardless of verb so `cp a b > log` yields both
    // `<cwd>/b` and `<cwd>/log`.
    let mut i = 0;
    while i < segment.len() {
        let t = segment[i].as_str();
        if REDIRECT_TOKENS.contains(&t) && i + 1 < segment.len() {
            targets.push(resolve(cwd, &segment[i + 1]));
            i += 2;
            continue;
        }
        i += 1;
    }

    // Verb dispatch (D-12).
    match first {
        // `cp SRC DST`, `mv SRC DST`, `install SRC DST` — last non-flag arg is dst.
        // Flags that precede the positionals (e.g. `cp -r a b`) are skipped.
        "cp" | "mv" | "install" => {
            let positionals: Vec<&String> = segment
                .iter()
                .skip(1)
                .filter(|t| !t.starts_with('-') && !REDIRECT_TOKENS.contains(&t.as_str()))
                .collect();
            // A redirect target already consumed the token after the operator;
            // filter it out by not treating any redirect-follower as positional.
            let mut i = 1;
            let mut clean: Vec<&String> = Vec::new();
            while i < segment.len() {
                let t = segment[i].as_str();
                if REDIRECT_TOKENS.contains(&t) {
                    i += 2;
                    continue;
                }
                if !t.starts_with('-') {
                    clean.push(&segment[i]);
                }
                i += 1;
            }
            let _ = positionals; // superseded by redirect-aware `clean`.
            if let Some(dst) = clean.last() {
                targets.push(resolve(cwd, dst));
            }
        }

        // `rm PATH…`, `touch PATH…`, `mkdir PATH`, `patch PATH` — every
        // non-flag positional is a write target.
        "rm" | "touch" | "mkdir" | "patch" => {
            let mut i = 1;
            while i < segment.len() {
                let t = segment[i].as_str();
                if REDIRECT_TOKENS.contains(&t) {
                    // Skip the redirect operator and its operand — already
                    // recorded by the redirect scan above.
                    i += 2;
                    continue;
                }
                if !t.starts_with('-') {
                    targets.push(resolve(cwd, t));
                }
                i += 1;
            }
        }

        // `sed -i [EXPR] PATH…` — only treat as mutating when `-i` is present.
        // The last non-flag, non-quoted-expression positional is the path. For
        // safety, take the final positional that is not the verb itself.
        "sed" => {
            let has_inplace = segment.iter().skip(1).any(|t| t == "-i");
            if has_inplace {
                let mut i = 1;
                let mut skip_next_expr = true; // the first positional after `-i` is the expression
                let mut last_path: Option<&String> = None;
                while i < segment.len() {
                    let t = segment[i].as_str();
                    if REDIRECT_TOKENS.contains(&t) {
                        i += 2;
                        continue;
                    }
                    if t == "-i" || t.starts_with("-i") {
                        // sed accepts `-i` or `-i.bak`; both are flags.
                        i += 1;
                        continue;
                    }
                    if t.starts_with('-') {
                        // Some other flag (e.g. `-e`, `-E`); next token is its arg.
                        i += 2;
                        continue;
                    }
                    if skip_next_expr {
                        // First non-flag positional is the sed expression.
                        skip_next_expr = false;
                        i += 1;
                        continue;
                    }
                    last_path = Some(&segment[i]);
                    i += 1;
                }
                if let Some(p) = last_path {
                    targets.push(resolve(cwd, p));
                }
            }
        }

        // `awk -i inplace [PROG] PATH…` — only treat as mutating when BOTH
        // `-i` and `inplace` tokens are present.
        "awk" => {
            let has_inplace =
                segment.iter().any(|t| t == "-i") && segment.iter().any(|t| t == "inplace");
            if has_inplace {
                // The positionals after `-i inplace` are: PROGRAM, then PATH…
                // Skip the first non-flag non-"inplace" token as the program;
                // collect subsequent ones as paths.
                let mut i = 1;
                let mut skipped_prog = false;
                while i < segment.len() {
                    let t = segment[i].as_str();
                    if REDIRECT_TOKENS.contains(&t) {
                        i += 2;
                        continue;
                    }
                    if t == "-i" || t == "inplace" || t.starts_with('-') {
                        i += 1;
                        continue;
                    }
                    if !skipped_prog {
                        skipped_prog = true;
                        i += 1;
                        continue;
                    }
                    targets.push(resolve(cwd, t));
                    i += 1;
                }
            }
        }

        // `dd of=PATH [of=PATH2 ...]` — the `of=` prefix identifies the write
        // target. Multiple `of=` tokens are vanishingly rare but supported.
        "dd" => {
            for t in segment.iter().skip(1) {
                if let Some(path) = t.strip_prefix("of=") {
                    targets.push(resolve(cwd, path));
                }
            }
        }

        // `tee [-a] PATH…` — every non-flag positional is a write target.
        "tee" => {
            for t in segment.iter().skip(1) {
                if !t.starts_with('-') && !REDIRECT_TOKENS.contains(&t.as_str()) {
                    targets.push(resolve(cwd, t));
                }
            }
        }

        // Unknown verb — only redirect-derived targets (if any) survive. This
        // is how `find . -delete` falls through to empty → ParseFailed at the
        // caller: the redirect scan finds nothing and `find` isn't in the
        // verb table.
        _ => {}
    }

    targets
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

    // ---- D-12 verb dispatch (Tests 10-19) ----

    /// Assert the result is `Targets(expected)` exactly.
    fn assert_targets(r: BashParseResult, expected: Vec<PathBuf>) {
        match r {
            BashParseResult::Targets(v) => assert_eq!(v, expected),
            other => panic!("expected Targets({:?}), got {:?}", expected, other),
        }
    }

    #[test]
    fn verb_dispatch_cp() {
        assert_targets(
            extract_target_paths("cp a.txt b.txt", &cwd()),
            vec![PathBuf::from("/repo/b.txt")],
        );
    }

    #[test]
    fn verb_dispatch_mv() {
        assert_targets(
            extract_target_paths("mv a.txt b.txt", &cwd()),
            vec![PathBuf::from("/repo/b.txt")],
        );
    }

    #[test]
    fn verb_dispatch_rm() {
        assert_targets(
            extract_target_paths("rm foo.txt bar.txt", &cwd()),
            vec![
                PathBuf::from("/repo/foo.txt"),
                PathBuf::from("/repo/bar.txt"),
            ],
        );
    }

    #[test]
    fn verb_dispatch_touch() {
        assert_targets(
            extract_target_paths("touch new.rs", &cwd()),
            vec![PathBuf::from("/repo/new.rs")],
        );
    }

    #[test]
    fn verb_dispatch_mkdir() {
        assert_targets(
            extract_target_paths("mkdir newdir", &cwd()),
            vec![PathBuf::from("/repo/newdir")],
        );
    }

    #[test]
    fn verb_dispatch_sed_inplace() {
        assert_targets(
            extract_target_paths("sed -i 's/a/b/' f.rs", &cwd()),
            vec![PathBuf::from("/repo/f.rs")],
        );
    }

    #[test]
    fn verb_dispatch_dd_of() {
        // Absolute path stays absolute (no cwd prepend).
        assert_targets(
            extract_target_paths("dd of=/tmp/out.bin", &cwd()),
            vec![PathBuf::from("/tmp/out.bin")],
        );
    }

    #[test]
    fn verb_dispatch_tee_append() {
        // `cmd | tee -a out.log` — pipe segments split; second segment is
        // `tee -a out.log` which yields /repo/out.log.
        assert_targets(
            extract_target_paths("cmd | tee -a out.log", &cwd()),
            vec![PathBuf::from("/repo/out.log")],
        );
    }

    #[test]
    fn verb_dispatch_stdout_redirect() {
        assert_targets(
            extract_target_paths("echo hi > log.txt", &cwd()),
            vec![PathBuf::from("/repo/log.txt")],
        );
    }

    #[test]
    fn verb_dispatch_stderr_redirect() {
        assert_targets(
            extract_target_paths("foo 2> err.log", &cwd()),
            vec![PathBuf::from("/repo/err.log")],
        );
    }

    // ---- D-12 operator split (Tests 20-21) ----

    #[test]
    fn operator_split_preserves_both() {
        // `echo a` yields no targets; `rm b.txt` yields [b.txt].
        assert_targets(
            extract_target_paths("echo a && rm b.txt", &cwd()),
            vec![PathBuf::from("/repo/b.txt")],
        );
    }

    #[test]
    fn operator_split_pipe() {
        // `cat a.txt` yields no targets; `tee b.txt` yields [b.txt].
        assert_targets(
            extract_target_paths("cat a.txt | tee b.txt", &cwd()),
            vec![PathBuf::from("/repo/b.txt")],
        );
    }

    // ---- D-10 extended parse-failure cases (Tests 22-23) ----

    #[test]
    fn parse_fail_heredoc() {
        // shlex tokenizes `cat <<EOF\nfoo\nEOF` as ["cat", "<<EOF", "foo",
        // "EOF"]. `cat` is not in the verb table, nothing matches REDIRECT_
        // TOKENS (heredoc `<<` is not in our scan set), so targets is empty
        // → ParseFailed.
        assert!(matches!(
            extract_target_paths("cat <<EOF\nfoo\nEOF", &cwd()),
            BashParseResult::ParseFailed
        ));
    }

    #[test]
    fn parse_fail_unknown_verb() {
        // `unknown-binary` isn't in the verb table; no redirects; empty →
        // ParseFailed → Allow at the hook layer (D-10 escape hatch).
        assert!(matches!(
            extract_target_paths("unknown-binary foo bar", &cwd()),
            BashParseResult::ParseFailed
        ));
    }

    // ---- Path-resolution invariants (Tests 24-25) ----

    #[test]
    fn absolute_path_preserved() {
        // Both /tmp/a and /tmp/b are absolute; `cp SRC DST` returns DST.
        assert_targets(
            extract_target_paths("cp /tmp/a /tmp/b", &cwd()),
            vec![PathBuf::from("/tmp/b")],
        );
    }

    #[test]
    fn relative_path_resolved_against_cwd() {
        // Relative `log.txt` joins `/repo` → `/repo/log.txt`.
        assert_targets(
            extract_target_paths("echo x > log.txt", &cwd()),
            vec![PathBuf::from("/repo/log.txt")],
        );
    }
}
