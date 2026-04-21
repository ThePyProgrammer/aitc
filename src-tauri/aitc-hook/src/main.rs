//! AITC sidecar binary entry point.
//!
//! Flow:
//!   1. Read Claude Code PreToolUse JSON from stdin.
//!   2. Resolve the AITC server port (env var → file → `~/.aitc/port`).
//!   3. POST a `HookRequest` to `http://127.0.0.1:{port}/hook`.
//!   4. Translate the AITC `AitcDecision` into Claude Code's modern
//!      `hookSpecificOutput.permissionDecision` envelope on stdout, or
//!      exit with code 2 + stderr reason on deny / any failure.
//!
//! Every error path is a **fail-safe deny** (D-11): Claude Code treats exit
//! code 2 as "block this tool, show stderr as reason". This means a broken
//! AITC never allows a tool call it shouldn't — it just blocks it.
//!
//! NEVER emits the deprecated top-level decision/reason form
//! (Pitfall 1 in 08-RESEARCH.md). The envelope helpers in `lib.rs` guard
//! against regression via `envelope_never_contains_deprecated_decision_field`.

use std::io::{self, Read, Write};
use std::process::ExitCode;

use aitc_hook::{
    build_allow_envelope, build_allow_with_edits_envelope, parse_claude_stdin, post_and_translate,
    resolve_port, AitcDecision, HookRequest,
};

/// Claude Code permission mode that opts out of AITC gating. Agents launched
/// with `--dangerously-skip-permissions` have already told Claude Code "don't
/// ask me anything" — AITC respects that by short-circuiting to allow without
/// contacting the backend. Also the robust choice: bypass agents keep working
/// even if AITC is offline.
const BYPASS_PERMISSION_MODE: &str = "bypassPermissions";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::from(0),
        Err(reason) => {
            // Claude Code: exit code 2 = block tool call with stderr as reason.
            let _ = writeln!(io::stderr(), "{reason}");
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<(), String> {
    // 1. Read Claude's PreToolUse JSON from stdin.
    let mut raw = String::new();
    io::stdin()
        .read_to_string(&mut raw)
        .map_err(|e| format!("stdin read: {e}"))?;
    if raw.trim().is_empty() {
        return Err("stdin parse: empty input".to_string());
    }
    let event = parse_claude_stdin(&raw)?;

    // bypassPermissions fast path: the user has already told Claude Code not
    // to prompt, so AITC doesn't either. Skip the HTTP round-trip entirely so
    // these agents keep moving even when AITC is offline.
    if event.permission_mode.as_deref() == Some(BYPASS_PERMISSION_MODE) {
        let env = build_allow_envelope();
        writeln!(io::stdout(), "{env}").map_err(|e| format!("stdout write: {e}"))?;
        return Ok(());
    }

    // 2. Resolve the AITC server port (or fail safe if unresolvable).
    let port = resolve_port().ok_or_else(|| "AITC unreachable: no port".to_string())?;
    let url = format!("http://127.0.0.1:{port}/hook");

    // 3. Build the /hook body. session_id is the primary correlation key
    //    (Pitfall 7 option 4: AITC binds session_id → agent_id on first
    //    contact). PID is included as a fallback — never truncated
    //    (Pitfall 5: `std::process::id()` returns the full u32 PID).
    let pid = std::process::id();
    let body = HookRequest {
        pid,
        session_id: event.session_id.as_deref(),
        tool_name: &event.tool_name,
        tool_input: &event.tool_input,
        cwd: event.cwd.as_deref(),
    };

    // 4. POST and translate the decision.
    let decision = post_and_translate(&url, &body)?;

    match decision {
        AitcDecision::Allow => {
            let env = build_allow_envelope();
            writeln!(io::stdout(), "{env}").map_err(|e| format!("stdout write: {e}"))?;
        }
        AitcDecision::AllowWithEdits { updated_input } => {
            let env = build_allow_with_edits_envelope(&updated_input);
            writeln!(io::stdout(), "{env}").map_err(|e| format!("stdout write: {e}"))?;
        }
        AitcDecision::Deny { reason } => {
            // Deny path: exit 2 with stderr reason. NEVER write JSON to
            // stdout (Claude would interpret any JSON as "allow with
            // hookSpecificOutput", which is the opposite of what we want).
            return Err(reason);
        }
    }
    Ok(())
}
