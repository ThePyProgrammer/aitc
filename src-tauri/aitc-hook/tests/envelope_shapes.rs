//! Contract-lock tests for the modern PreToolUse hookSpecificOutput envelope
//! and the library surface used by `main.rs` (port resolution, stdin parsing,
//! AITC decision deserialization).
//!
//! These tests were RED in Wave 0 (Plan 01). Plan 03 fills in the bodies of
//! the helpers and turns them GREEN. Do NOT weaken these assertions — they
//! lock the Anthropic contract shape (Pitfall 1: never emit the deprecated
//! top-level `{"decision": "..."}` form).

use aitc_hook::{
    build_allow_envelope, build_allow_with_edits_envelope, parse_claude_stdin, resolve_port,
    AitcDecision,
};
use serde_json::json;

#[test]
fn allow_envelope_matches_modern_contract() {
    let got = build_allow_envelope();
    assert_eq!(
        got,
        json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow"
            }
        }),
        "Plan 03 must emit the modern PreToolUse hookSpecificOutput envelope"
    );
}

#[test]
fn allow_with_edits_envelope_includes_updated_input() {
    let input = json!({"file_path": "/tmp/x.ts", "new_string": "42"});
    let got = build_allow_with_edits_envelope(&input);
    assert_eq!(got["hookSpecificOutput"]["permissionDecision"], "allow");
    assert_eq!(got["hookSpecificOutput"]["updatedInput"], input);
    assert_eq!(got["hookSpecificOutput"]["hookEventName"], "PreToolUse");
}

#[test]
fn deny_envelope_is_never_emitted_as_json_by_this_helper() {
    // Deny path uses exit code 2 + stderr per D-03 / RESEARCH Pitfall 1.
    // These helpers only produce Allow variants. This test locks that intent.
    assert_ne!(
        build_allow_envelope()["hookSpecificOutput"]["permissionDecision"],
        "deny"
    );
}

#[test]
fn envelope_never_contains_deprecated_decision_field() {
    // Pitfall 1: top-level `decision` + `reason` is the deprecated form.
    // Modern PreToolUse must use hookSpecificOutput.permissionDecision instead.
    assert!(build_allow_envelope().get("decision").is_none());
    assert!(build_allow_envelope().get("reason").is_none());
    let input = json!({"x": 1});
    assert!(build_allow_with_edits_envelope(&input)
        .get("decision")
        .is_none());
    assert!(build_allow_with_edits_envelope(&input)
        .get("reason")
        .is_none());
}

#[test]
fn parse_claude_stdin_canonical_edit_fixture() {
    let raw = include_str!("../../tests/fixtures/pretool_use_stdin.json");
    let got = parse_claude_stdin(raw).expect("fixture parses");
    assert_eq!(got.tool_name, "Edit");
    assert_eq!(got.session_id.as_deref(), Some("sess_abc123"));
    assert_eq!(got.tool_input["file_path"], "/home/dev/proj/src/app.ts");
    assert_eq!(got.hook_event_name.as_deref(), Some("PreToolUse"));
}

#[test]
fn parse_claude_stdin_rejects_garbage() {
    assert!(parse_claude_stdin("not json {").is_err());
}

// NOTE: the port-resolution tests mutate process-wide env vars. Rust test
// runners execute tests from the same binary on shared threads, so any two
// tests touching AITC_PORT could race. We serialize them by putting the env
// writes into a single `#[test]` and tearing down each step. Calling
// `env::set_var`/`remove_var` is `unsafe` on nightly but stable today; we
// rely on the Plan's behavior table, not on parallel execution.

#[test]
fn resolve_port_prefers_env_var_then_file_then_invalidates_bounds() {
    // 1. env var wins
    std::env::set_var("AITC_PORT", "9001");
    std::env::remove_var("AITC_PORT_FILE_OVERRIDE");
    assert_eq!(resolve_port(), Some(9001));

    // 2. env unset + file override
    let td = tempfile::TempDir::new().unwrap();
    let p = td.path().join("port");
    std::fs::write(&p, "9002\n").unwrap();
    std::env::remove_var("AITC_PORT");
    std::env::set_var("AITC_PORT_FILE_OVERRIDE", &p);
    assert_eq!(resolve_port(), Some(9002));

    // 3. env zero → fall through to file (file still wins)
    std::env::set_var("AITC_PORT", "0");
    assert_eq!(
        resolve_port(),
        Some(9002),
        "AITC_PORT=0 must fall through to file (T-08-06)"
    );

    // 4. env unparseable → fall through to file
    std::env::set_var("AITC_PORT", "not_a_number");
    assert_eq!(resolve_port(), Some(9002));

    // 5. env out-of-range → fall through to file
    std::env::set_var("AITC_PORT", "65536");
    assert_eq!(resolve_port(), Some(9002));

    // 6. neither → None
    std::env::remove_var("AITC_PORT");
    std::env::remove_var("AITC_PORT_FILE_OVERRIDE");
    // Point HOME somewhere empty so we don't accidentally read a real ~/.aitc/port.
    let home = tempfile::TempDir::new().unwrap();
    std::env::set_var("HOME", home.path());
    assert_eq!(resolve_port(), None);
}

#[test]
fn aitc_decision_deserializes_all_three_variants() {
    let allow: AitcDecision = serde_json::from_str(r#"{"kind":"allow"}"#).unwrap();
    assert!(matches!(allow, AitcDecision::Allow));

    let awe: AitcDecision =
        serde_json::from_str(r#"{"kind":"allow_with_edits","updated_input":{"x":1}}"#).unwrap();
    match awe {
        AitcDecision::AllowWithEdits { updated_input } => {
            assert_eq!(updated_input, json!({"x": 1}));
        }
        _ => panic!("expected AllowWithEdits"),
    }

    let deny: AitcDecision = serde_json::from_str(r#"{"kind":"deny","reason":"nope"}"#).unwrap();
    match deny {
        AitcDecision::Deny { reason } => assert_eq!(reason, "nope"),
        _ => panic!("expected Deny"),
    }
}
