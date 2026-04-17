//! Phase 10: long-lived Claude Code subprocess launcher.
//!
//! Plan 02: real `tokio::process::Command` spawn with stdin/stdout/stderr
//! all piped so the parser + outbound writer can take ownership of them
//! later. Unlike `agents/launcher.rs::launch_detached`, Windows CREATE_NEW_
//! PROCESS_GROUP / DETACHED_PROCESS flags are intentionally omitted — piped
//! stdio requires the subprocess to stay parented to AITC.
//!
//! Target CLI:
//!   claude --input-format stream-json --output-format stream-json --verbose \
//!          --include-partial-messages \
//!          [--mcp-config <path> --strict-mcp-config] \
//!          <intent>

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use tokio::process::Child;

pub struct LaunchLiveSessionResult {
    pub pid: u32,
    pub child: Child,
    pub mcp_config_path: Option<PathBuf>,
}

/// Build the argv vector for a chattable Claude Code subprocess. Factored out
/// of `launch_live_session` so tests can assert the exact argv shape without
/// actually spawning.
///
/// `extra_flags` — Plan 04 extension point. Flags appended AFTER the
/// stream-json baseline (`--input-format`, `--output-format`, `--verbose`,
/// `--include-partial-messages`) and the optional `--mcp-config` pair, but
/// BEFORE the positional `intent`. Used by `ClaudeCodeAdapter::launch` to
/// pass `--dangerously-skip-permissions` or `--permission-mode acceptEdits`.
pub(crate) fn build_argv(
    intent: &str,
    mcp_config_path: Option<&Path>,
    extra_flags: Option<&[&str]>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--input-format".into(),
        "stream-json".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];
    if let Some(p) = mcp_config_path {
        args.push("--mcp-config".into());
        args.push(p.to_string_lossy().into_owned());
        args.push("--strict-mcp-config".into());
    }
    if let Some(flags) = extra_flags {
        for f in flags {
            args.push((*f).to_string());
        }
    }
    args.push(intent.into());
    args
}

/// Spawn the long-lived Claude Code subprocess for a chattable session.
///
/// `aitc_port` is injected as `AITC_PORT` env (Phase 3 precedent) so the
/// `/register` + `/hook` + `/mcp` sidecar routes remain addressable.
///
/// `extra_flags` — Plan 04 passes permission-mode flags here (e.g.
/// `--dangerously-skip-permissions`) so the adapter can still honor the
/// `LaunchOptions` bypass chips without duplicating argv construction.
pub async fn launch_live_session(
    program: &str,
    intent: &str,
    cwd: &Path,
    aitc_port: u16,
    mcp_config_path: Option<&Path>,
    env_vars: Option<Vec<(&str, &str)>>,
    extra_flags: Option<&[&str]>,
) -> Result<LaunchLiveSessionResult, String> {
    let args = build_argv(intent, mcp_config_path, extra_flags);
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args.iter().map(String::as_str))
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("AITC_PORT", aitc_port.to_string());

    if let Some(vars) = env_vars {
        for (k, v) in vars {
            cmd.env(k, v);
        }
    }

    // NOTE: Windows process-detach creation flags are deliberately NOT set
    // here — piped stdio requires the subprocess to stay attached to the
    // parent. Phase 3's `launch_detached(stdio=null)` took the detached
    // path; chattable sessions take the attached path.

    let child = cmd
        .spawn()
        .map_err(|e| format!("launch_live_session spawn '{program}': {e}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "spawned process has no PID".to_string())?;

    Ok(LaunchLiveSessionResult {
        pid,
        child,
        mcp_config_path: mcp_config_path.map(Path::to_path_buf),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn launch_live_session_argv_includes_stream_json_flags() {
        let argv = build_argv("do the thing", None, None);
        // Exact ordering — the stream-json flag set appears first, then
        // --verbose + --include-partial-messages, then the positional intent.
        assert_eq!(
            argv,
            vec![
                "--input-format".to_string(),
                "stream-json".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--include-partial-messages".into(),
                "do the thing".into(),
            ]
        );
    }

    #[test]
    fn launch_live_session_with_mcp_config_includes_flag_pair() {
        let path = PathBuf::from("/tmp/aitc-mcp.json");
        let argv = build_argv("task", Some(&path), None);
        assert!(argv.iter().any(|a| a == "--mcp-config"));
        assert!(argv.iter().any(|a| a == "/tmp/aitc-mcp.json"));
        assert!(argv.iter().any(|a| a == "--strict-mcp-config"));
        // --strict-mcp-config appears AFTER --mcp-config + path.
        let mcp_pos = argv.iter().position(|a| a == "--mcp-config").unwrap();
        let path_pos = argv.iter().position(|a| a == "/tmp/aitc-mcp.json").unwrap();
        let strict_pos = argv
            .iter()
            .position(|a| a == "--strict-mcp-config")
            .unwrap();
        assert!(mcp_pos < path_pos);
        assert!(path_pos < strict_pos);
        // Intent is the final positional.
        assert_eq!(argv.last().unwrap(), "task");
    }

    #[test]
    fn launch_live_session_no_mcp_config_omits_flag_pair() {
        let argv = build_argv("task", None, None);
        assert!(!argv.iter().any(|a| a == "--mcp-config"));
        assert!(!argv.iter().any(|a| a == "--strict-mcp-config"));
    }

    #[test]
    fn launch_live_session_extra_flags_appear_before_intent_and_after_mcp_pair() {
        let path = PathBuf::from("/tmp/aitc-mcp.json");
        let flags = ["--dangerously-skip-permissions"];
        let argv = build_argv("task", Some(&path), Some(&flags));
        let intent_pos = argv.iter().position(|a| a == "task").unwrap();
        let strict_pos = argv
            .iter()
            .position(|a| a == "--strict-mcp-config")
            .unwrap();
        let dangerous_pos = argv
            .iter()
            .position(|a| a == "--dangerously-skip-permissions")
            .unwrap();
        assert!(strict_pos < dangerous_pos, "extra flags come after mcp pair");
        assert!(
            dangerous_pos < intent_pos,
            "extra flags come before positional intent"
        );
        assert_eq!(argv.last().unwrap(), "task");
    }

    #[test]
    fn launch_live_session_permission_mode_pair_preserved() {
        let flags = ["--permission-mode", "acceptEdits"];
        let argv = build_argv("task", None, Some(&flags));
        let pm_pos = argv.iter().position(|a| a == "--permission-mode").unwrap();
        let value_pos = argv.iter().position(|a| a == "acceptEdits").unwrap();
        assert_eq!(value_pos, pm_pos + 1);
    }

    // Spawn a real subprocess via the real launcher — pipes stdio so the test
    // can write to stdin and read from stdout. Uses `cat` on Unix and
    // `cmd.exe /C more` on Windows as a universal "echo stdin to stdout"
    // program. `more` works on Windows when fed via stdin because cmd with
    // a file-less /C redirects stdin through.
    #[cfg(not(windows))]
    #[tokio::test]
    async fn launch_live_session_echo_pipes_stdio() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        // We can't point launch_live_session at `cat` with the real argv
        // (stream-json flags would fail) — so test the non-argv parts of the
        // launcher by spawning a raw Command with the same Stdio::piped()
        // config. This covers the "stdin/stdout/stderr are still Some after
        // spawn" invariant, which is the real contract the supervisor relies
        // on.
        let tmp = std::env::temp_dir();
        let mut cmd = tokio::process::Command::new("cat");
        cmd.current_dir(&tmp)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        let mut stdin = child.stdin.take().expect("stdin piped");
        let mut stdout = child.stdout.take().expect("stdout piped");
        stdin.write_all(b"HELLO\n").await.unwrap();
        stdin.shutdown().await.unwrap();
        drop(stdin);
        let mut buf = Vec::new();
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            stdout.read_to_end(&mut buf),
        )
        .await;
        assert!(String::from_utf8_lossy(&buf).starts_with("HELLO"));
        let _ = child.wait().await;
    }

    #[tokio::test]
    async fn launch_live_session_missing_program_returns_err() {
        let tmp = std::env::temp_dir();
        let result = launch_live_session(
            "claude-that-does-not-exist-xyz-aitc",
            "nothing",
            &tmp,
            9417,
            None,
            None,
            None,
        )
        .await;
        assert!(result.is_err());
    }
}
