//! Claude Code adapter (built-in).
//!
//! Implements `AgentAdapter` for the Claude Code CLI agent. Launch and
//! terminate are placeholders until Plan 02 wires `launcher.rs`.

use crate::agents::adapter::{AgentAdapter, AgentState};
use async_trait::async_trait;
use std::path::PathBuf;

/// Stateless adapter for Claude Code agents (per anti-pattern in RESEARCH.md).
pub struct ClaudeCodeAdapter;

#[async_trait]
impl AgentAdapter for ClaudeCodeAdapter {
    fn adapter_type(&self) -> &str {
        "claude-code"
    }

    fn process_patterns(&self) -> Vec<String> {
        vec!["claude".to_string(), "claude-code".to_string()]
    }

    async fn launch(&self, _cwd: PathBuf, _intent: Option<String>) -> Result<u32, String> {
        // Placeholder -- Plan 02 wires real launcher.rs
        Err("launcher not wired".to_string())
    }

    async fn get_state(&self, _pid: u32) -> AgentState {
        // Placeholder -- Plan 02 wires real state polling
        AgentState::Running
    }

    async fn get_intent(&self, _pid: u32) -> Option<String> {
        // Placeholder -- Plan 02 adds hooks-based intent detection
        None
    }

    async fn terminate(&self, _pid: u32) -> Result<(), String> {
        // Placeholder -- Plan 02 wires real termination
        Err("launcher not wired".to_string())
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
}
