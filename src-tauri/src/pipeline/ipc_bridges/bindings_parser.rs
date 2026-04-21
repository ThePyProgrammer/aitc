//! Phase 12 Wave 1: regex-over-src/bindings.ts parser.
//!
//! tauri-specta emits a stable shape for every command:
//!
//! ```text
//! async camelName(args) : Promise<Result<…>> {
//!     ...
//!     await TAURI_INVOKE("snake_name", { ... });
//!     ...
//! }
//! ```
//!
//! This module lifts every such shape into a [`BindingCommand`]. Paired
//! `signature_re` + `invoke_re` regexes walk the generated TS file; channel
//! args are detected via a third regex applied to the captured args text.
//!
//! OnceLock is used to compile each regex exactly once per process (D-35 perf
//! guarantee — regex compilation is ~1ms; hot-path cold-cache would defeat the
//! <100ms build budget).
//!
//! Pitfall 3 note: the parser does NOT `zip` the two regex iterators. It pairs
//! each header with the NEXT `TAURI_INVOKE(…)` after the header's end-offset
//! via `Regex::captures_at`, so a header with no following invoke is skipped
//! defensively rather than mis-pairing with a later command.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct BindingCommand {
    pub camel_name: String,
    pub snake_name: String,
    /// `(args) → return`, ≤ 200 chars (D-06).
    pub signature_summary: String,
    pub has_channel_arg: bool,
}

fn signature_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?m)^async\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*:\s*Promise<([\s\S]*?)>\s*\{",
        )
        .expect("bindings signature regex compiles")
    })
}

fn invoke_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"TAURI_INVOKE\("([a-z_][a-z0-9_]*)""#).expect("invoke regex compiles")
    })
}

fn channel_arg_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"TAURI_CHANNEL<").expect("channel regex compiles"))
}

/// Parse a tauri-specta generated `bindings.ts` source buffer into a list of
/// commands. Silent on parse holes — headers without a following `TAURI_INVOKE`
/// in the rest of the file are skipped defensively.
pub fn parse_bindings(src: &str) -> Vec<BindingCommand> {
    let mut out = Vec::new();
    for sig in signature_re().captures_iter(src) {
        let camel = sig
            .get(1)
            .expect("signature regex group 1 always present")
            .as_str()
            .to_string();
        let args_text = sig
            .get(2)
            .expect("signature regex group 2 always present")
            .as_str();
        let ret_text = sig
            .get(3)
            .expect("signature regex group 3 always present")
            .as_str();
        let header_end = sig
            .get(0)
            .expect("signature regex full match always present")
            .end();

        // Pitfall 3: pair header with the NEXT TAURI_INVOKE by byte offset, not
        // by zipping disjoint iterators.
        let snake_name = match invoke_re().captures_at(src, header_end) {
            Some(inv_cap) => inv_cap
                .get(1)
                .expect("invoke regex group 1 always present")
                .as_str()
                .to_string(),
            None => continue, // header with no following invoke — skip defensively
        };

        let has_channel_arg = channel_arg_re().is_match(args_text);

        let mut signature_summary =
            format!("({}) → {}", args_text.trim(), ret_text.trim());
        if signature_summary.len() > 200 {
            // Truncate at character boundary, append ellipsis marker.
            let mut end = 197;
            while !signature_summary.is_char_boundary(end) {
                end -= 1;
            }
            signature_summary.truncate(end);
            signature_summary.push_str("...");
        }

        out.push(BindingCommand {
            camel_name: camel,
            snake_name,
            signature_summary,
            has_channel_arg,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE_BINDINGS: &str = include_str!("../../../../src/bindings.ts");
    const SAMPLE_BINDINGS: &str = include_str!("test_fixtures/sample_bindings.ts");

    #[test]
    fn parse_bindings_empty_input() {
        let result = parse_bindings("");
        assert_eq!(result.len(), 0);
    }

    // V-12-01: the live bindings.ts must surface ≥ 40 commands (current ≈ 51).
    #[test]
    fn parse_bindings_returns_command_set() {
        let cmds = parse_bindings(LIVE_BINDINGS);
        assert!(
            cmds.len() >= 40,
            "expected >=40 commands in live bindings.ts, got {}",
            cmds.len()
        );
    }

    // V-12-02: camelCase header must pair with the next TAURI_INVOKE by offset,
    // yielding the snake_case Rust fn name.
    #[test]
    fn preserves_camel_snake_pair() {
        let cmds = parse_bindings(SAMPLE_BINDINGS);
        let start = cmds
            .iter()
            .find(|c| c.camel_name == "startWatch")
            .expect("startWatch present");
        assert_eq!(start.snake_name, "start_watch");

        let dangling = cmds
            .iter()
            .find(|c| c.camel_name == "danglingCommand")
            .expect("danglingCommand present");
        assert_eq!(dangling.snake_name, "dangling_command");

        let ping = cmds
            .iter()
            .find(|c| c.camel_name == "ping")
            .expect("ping present");
        assert_eq!(ping.snake_name, "ping");
    }

    // V-12-03: TAURI_CHANNEL<…> args are detected in args_text.
    #[test]
    fn detects_channel_arg() {
        let cmds = parse_bindings(SAMPLE_BINDINGS);
        let start = cmds
            .iter()
            .find(|c| c.camel_name == "startWatch")
            .expect("startWatch present");
        assert!(
            start.has_channel_arg,
            "startWatch has TAURI_CHANNEL arg"
        );
        let ping = cmds
            .iter()
            .find(|c| c.camel_name == "ping")
            .expect("ping present");
        assert!(!ping.has_channel_arg, "ping has no channel");
    }

    // V-12-04: every signature summary is ≤ 200 chars and contains "→".
    #[test]
    fn signature_summary_bounded() {
        let cmds = parse_bindings(LIVE_BINDINGS);
        assert!(!cmds.is_empty(), "fixture fixture parse returned empty");
        for c in &cmds {
            assert!(
                c.signature_summary.len() <= 200,
                "{} sig too long: {} chars",
                c.camel_name,
                c.signature_summary.len()
            );
            assert!(
                c.signature_summary.contains('→'),
                "summary should contain '→' separator: {}",
                c.signature_summary
            );
        }
    }
}
