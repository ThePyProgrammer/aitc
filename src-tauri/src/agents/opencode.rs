//! OpenCode adapter (built-in).
//!
//! Implements `AgentAdapter` for the OpenCode CLI agent.

use crate::agents::adapter::{AgentAdapter, AgentState};
use async_trait::async_trait;
use std::path::PathBuf;

/// Stateless adapter for OpenCode agents.
pub struct OpenCodeAdapter;

#[async_trait]
impl AgentAdapter for OpenCodeAdapter {
    fn adapter_type(&self) -> &str {
        "opencode"
    }

    fn process_patterns(&self) -> Vec<String> {
        vec!["opencode".to_string()]
    }

    async fn launch(&self, _cwd: PathBuf, _intent: Option<String>) -> Result<u32, String> {
        Err("launcher not wired".to_string())
    }

    async fn get_state(&self, _pid: u32) -> AgentState {
        AgentState::Running
    }

    async fn get_intent(&self, _pid: u32) -> Option<String> {
        // Placeholder -- Plan 02 Task 2 wires real OpenCode intent extraction from -p flag
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
    fn adapter_type_returns_opencode() {
        let adapter = OpenCodeAdapter;
        assert_eq!(adapter.adapter_type(), "opencode");
    }
}
