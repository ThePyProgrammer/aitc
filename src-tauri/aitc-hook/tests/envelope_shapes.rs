//! Contract-lock tests for the modern PreToolUse hookSpecificOutput envelope.
//!
//! These tests are RED in Wave 0 (Plan 01). Plan 03 fills in the bodies of
//! `build_allow_envelope` and `build_allow_with_edits_envelope` and turns
//! these tests GREEN. Do NOT weaken these assertions — they lock the
//! Anthropic contract shape.

use aitc_hook::{build_allow_envelope, build_allow_with_edits_envelope};
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
