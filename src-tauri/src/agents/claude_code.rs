//! Claude Code adapter (built-in).
//!
//! Implements `AgentAdapter` for the Claude Code CLI agent. Launch and
//! terminate wired via `launcher.rs`. Intent detection uses hooks-based
//! infrastructure per D-08.

use crate::agents::adapter::{AgentAdapter, AgentState};
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

    async fn launch(&self, cwd: PathBuf, _intent: Option<String>) -> Result<(u32, tokio::process::Child), String> {
        launcher::launch_detached(
            "claude",
            &["--print", "--output-format", "stream-json"],
            &cwd,
            None,
            9417, // Default port; caller should override via env
        )
        .await
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
