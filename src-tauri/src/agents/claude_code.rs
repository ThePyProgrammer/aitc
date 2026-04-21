//! Claude Code adapter (built-in).
//!
//! Implements `AgentAdapter` for the Claude Code CLI agent.
//!
//! Phase 10 (D-06): `launch` now spawns a LONG-LIVED
//! `claude --input-format stream-json --output-format stream-json --verbose
//! --include-partial-messages [--mcp-config <path> --strict-mcp-config]
//! <intent>` subprocess with stdin/stdout/stderr all piped. The command layer
//! (agents/commands.rs) takes ownership of the pipes and hands them to the
//! chat_runtime parser + outbound writer + supervisor. `terminate` is still
//! wired via `launcher::terminate_process`.
//!
//! Capabilities (D-02): `chat_duplex = true`. Codex / OpenCode / Generic
//! inherit the default `chat_duplex = false` and take the read-only
//! raw-stdout-capture path.

use crate::agents::adapter::{
    AdapterCapabilities, AgentAdapter, AgentState, LaunchOptions,
};
use crate::agents::launcher;
use async_trait::async_trait;
use std::path::PathBuf;

/// Stateless adapter for Claude Code agents (per anti-pattern in RESEARCH.md).
pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    /// Check if Claude Code hooks are configured in the agent's cwd.
    fn has_hooks_config(cwd: &std::path::Path) -> bool {
        let hooks_dir = cwd.join(".claude").join("hooks");
        let settings = cwd.join(".claude").join("settings.json");
        hooks_dir.exists() || settings.exists()
    }

    /// Scan stdout lines for Claude Code hooks output (JSON with "event" and "tool_name" keys).
    /// Returns the most recent task description from PreToolUse hook output, if any.
    fn extract_intent_from_hooks_output(lines: &[String]) -> Option<String> {
        // Scan in reverse for the most recent hooks output
        for line in lines.iter().rev() {
            // Claude Code hooks output JSON lines with event/tool_name keys
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                if value.get("event").is_some() && value.get("tool_name").is_some() {
                    // Extract task description from the hook output
                    if let Some(desc) = value.get("task_description").and_then(|v| v.as_str()) {
                        return Some(desc.to_string());
                    }
                    // Fallback: use tool_name as partial intent indicator
                    if let Some(tool) = value.get("tool_name").and_then(|v| v.as_str()) {
                        return Some(format!("Using tool: {}", tool));
                    }
                }
            }
        }
        None
    }
}

#[async_trait]
impl AgentAdapter for ClaudeCodeAdapter {
    fn adapter_type(&self) -> &str {
        "claude-code"
    }

    fn process_patterns(&self) -> Vec<String> {
        vec!["claude".to_string(), "claude-code".to_string()]
    }

    fn launch_binary(&self) -> String {
        "claude".to_string()
    }

    async fn launch(
        &self,
        cwd: PathBuf,
        intent: Option<String>,
        options: LaunchOptions,
    ) -> Result<(u32, tokio::process::Child), String> {
        // D-06: long-lived stream-json subprocess. The intent is NOT passed
        // as a positional argv — `--input-format stream-json` expects the
        // first user turn on stdin as a JSONL frame. The command layer
        // (`launch_agent_inner`) enqueues the intent via
        // `send_chat_message_to_agent_inner` immediately after the outbound
        // writer is wired. We still require the intent at launch-time so
        // misconfigured deploys surface the error before spawn rather than
        // producing a silent Claude subprocess waiting on an empty pipe.
        let _prompt = intent.ok_or_else(|| {
            "Claude Code launches require an INTENT_LABEL. The intent is \
             delivered to claude as the initial user turn via stdin JSONL \
             after the long-lived stream-json subprocess spawns."
                .to_string()
        })?;

        // Phase 8 hook install: preserved verbatim from the pre-Plan-04 path.
        // A bypass chip (dangerously_skip_permissions / accept_edits) hands
        // full trust to Claude for that launch, so installing the AITC hook
        // would contradict the user's intent. AITC_SIDECAR_PATH is set by
        // lib.rs::setup after `tauri_plugin_shell::sidecar("aitc-hook")`;
        // missing env var => skip silently (dev/test path).
        if !options.dangerously_skip_permissions && !options.accept_edits {
            match std::env::var("AITC_SIDECAR_PATH") {
                Ok(sidecar_abs) if !sidecar_abs.is_empty() => {
                    match crate::agents::hook_install::install_aitc_hook(
                        &cwd,
                        &sidecar_abs,
                    ) {
                        Ok(()) => tracing::info!(
                            cwd = %cwd.display(),
                            sidecar = %sidecar_abs,
                            "AITC PreToolUse hook installed"
                        ),
                        Err(e) => tracing::warn!(
                            cwd = %cwd.display(),
                            error = %e,
                            "install_aitc_hook failed; launch continues unhooked"
                        ),
                    }
                }
                _ => tracing::debug!(
                    "AITC_SIDECAR_PATH unset; skipping hook install (dev/test path)"
                ),
            }
        }

        // Plan 10 / D-11: write the per-session MCP config BEFORE spawning,
        // so `claude --mcp-config <path>` can read it at startup. We need
        // the agent_id and aitc_port — both come in via LaunchOptions from
        // the command layer (which generates the agent_id up front).
        // A missing agent_id is a hard error: the command layer always
        // populates it for a claude_code launch; absence means we were
        // called incorrectly. A missing port defaults to 9417 (dev default).
        let aitc_port = options.aitc_port.unwrap_or(9417);
        let mcp_config_path = match options.agent_id.as_deref() {
            Some(id) => match crate::mcp::session_config::write_session_mcp_config(
                &cwd, id, aitc_port,
            ) {
                Ok(p) => Some(p),
                Err(e) => {
                    tracing::warn!(
                        cwd = %cwd.display(),
                        agent_id = %id,
                        error = %e,
                        "write_session_mcp_config failed; launching without MCP server"
                    );
                    None
                }
            },
            None => {
                tracing::warn!(
                    cwd = %cwd.display(),
                    "claude_code::launch called without agent_id in LaunchOptions; \
                     per-session MCP config skipped"
                );
                None
            }
        };

        // Permission tuning. `dangerously_skip_permissions` wins if both are
        // set since it's the strictly-looser option -- applying both would be
        // contradictory.
        let mut flag_storage: Vec<String> = Vec::new();
        if options.dangerously_skip_permissions {
            flag_storage.push("--dangerously-skip-permissions".into());
        } else if options.accept_edits {
            flag_storage.push("--permission-mode".into());
            flag_storage.push("acceptEdits".into());
        }
        let flag_refs: Vec<&str> = flag_storage.iter().map(String::as_str).collect();
        let extra_flags: Option<&[&str]> = if flag_refs.is_empty() {
            None
        } else {
            Some(&flag_refs)
        };

        // D-06: long-lived stream-json subprocess via `launch_live_session`.
        // Returns `LaunchLiveSessionResult { pid, child, mcp_config_path }`
        // — the Child has all three stdio pipes piped; the command layer
        // takes ownership of them and sends the initial user turn (intent)
        // via stdin JSONL.
        let result = crate::chat_runtime::launcher::launch_live_session(
            "claude",
            &cwd,
            aitc_port,
            mcp_config_path.as_deref(),
            None,
            extra_flags,
        )
        .await?;
        Ok((result.pid, result.child))
    }

    fn capabilities(&self) -> AdapterCapabilities {
        // D-01 + D-02: Claude Code is the only v1 adapter with bidirectional
        // chat. Routed through the long-lived stream-json path.
        AdapterCapabilities { chat_duplex: true }
    }

    async fn get_state(&self, pid: u32) -> AgentState {
        // Check if process is alive via sysinfo
        let s = sysinfo::System::new_with_specifics(
            sysinfo::RefreshKind::nothing()
                .with_processes(sysinfo::ProcessRefreshKind::nothing()),
        );
        let sysinfo_pid = sysinfo::Pid::from_u32(pid);
        if s.process(sysinfo_pid).is_some() {
            AgentState::Running
        } else {
            AgentState::Error
        }
    }

    async fn get_intent(&self, _pid: u32) -> Option<String> {
        // Intent detection infrastructure for Claude Code per D-08:
        // This works when the user has configured Claude Code hooks to output
        // to stdout. The stdout_buffer is read by the command layer, which
        // calls extract_intent_from_hooks_output. This method returns None
        // as intent must be read from the registry's stdout buffer (not accessible
        // from the stateless adapter alone). The command layer handles the
        // full flow: check hooks config, scan stdout buffer, extract intent.
        //
        // Fallback: user can manually label via update_agent_intent command (D-08).
        None
    }

    async fn terminate(&self, pid: u32) -> Result<(), String> {
        launcher::terminate_process(pid).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_type_returns_claude_code() {
        let adapter = ClaudeCodeAdapter;
        assert_eq!(adapter.adapter_type(), "claude-code");
    }

    #[test]
    fn capabilities_reports_chat_duplex_true() {
        // D-01 + D-02: Claude Code is the only v1 duplex adapter.
        let adapter = ClaudeCodeAdapter;
        assert!(adapter.capabilities().chat_duplex);
    }

    #[test]
    fn process_patterns_contains_claude() {
        let adapter = ClaudeCodeAdapter;
        let patterns = adapter.process_patterns();
        assert!(patterns.contains(&"claude".to_string()));
        assert!(patterns.contains(&"claude-code".to_string()));
    }

    #[test]
    fn extract_intent_from_hooks_output_finds_task() {
        let lines = vec![
            r#"{"event":"PreToolUse","tool_name":"write_file","task_description":"Implementing auth module"}"#.to_string(),
        ];
        let intent = ClaudeCodeAdapter::extract_intent_from_hooks_output(&lines);
        assert_eq!(intent.as_deref(), Some("Implementing auth module"));
    }

    #[test]
    fn extract_intent_from_hooks_output_fallback_to_tool_name() {
        let lines = vec![
            r#"{"event":"PreToolUse","tool_name":"read_file"}"#.to_string(),
        ];
        let intent = ClaudeCodeAdapter::extract_intent_from_hooks_output(&lines);
        assert_eq!(intent.as_deref(), Some("Using tool: read_file"));
    }

    #[test]
    fn extract_intent_from_hooks_output_returns_none_for_empty() {
        let lines: Vec<String> = vec![];
        let intent = ClaudeCodeAdapter::extract_intent_from_hooks_output(&lines);
        assert!(intent.is_none());
    }

    #[test]
    fn has_hooks_config_returns_false_for_nonexistent() {
        let path = std::path::Path::new("/nonexistent/path/12345");
        assert!(!ClaudeCodeAdapter::has_hooks_config(path));
    }
}
