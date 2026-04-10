//! Codex adapter (built-in).
//!
//! Implements `AgentAdapter` for the OpenAI Codex CLI agent.

use crate::agents::adapter::{AgentAdapter, AgentState};
use async_trait::async_trait;
use std::path::PathBuf;

/// Stateless adapter for Codex agents.
pub struct CodexAdapter;

#[async_trait]
impl AgentAdapter for CodexAdapter {
    fn adapter_type(&self) -> &str {
        "codex"
    }

    fn process_patterns(&self) -> Vec<String> {
        vec!["codex".to_string()]
    }

    async fn launch(&self, _cwd: PathBuf, _intent: Option<String>) -> Result<u32, String> {
        Err("launcher not wired".to_string())
    }

    async fn get_state(&self, _pid: u32) -> AgentState {
        AgentState::Running
    }

    async fn get_intent(&self, _pid: u32) -> Option<String> {
        // Placeholder -- Plan 02 Task 2 wires real Codex intent extraction from CLI args
        None
    }

    async fn terminate(&self, _pid: u32) -> Result<(), String> {
        Err("launcher not wired".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_type_returns_codex() {
        let adapter = CodexAdapter;
        assert_eq!(adapter.adapter_type(), "codex");
    }
}
