//! Codex adapter (built-in).
//!
//! Implements `AgentAdapter` for the OpenAI Codex CLI agent.
//! Intent extraction parses the positional prompt argument from CLI args per D-08.

use crate::agents::adapter::{AgentAdapter, AgentState};
use crate::agents::launcher;
use async_trait::async_trait;
use std::path::PathBuf;

/// Stateless adapter for Codex agents.
pub struct CodexAdapter;

impl CodexAdapter {
    /// Extract intent from Codex CLI command line args.
    ///
    /// Codex CLI accepts: `codex [flags...] "prompt text"`.
    /// The first non-flag positional argument is the prompt/intent.
    pub fn extract_intent_from_args(args: &[String]) -> Option<String> {
        let mut skip_next = false;
        for (i, arg) in args.iter().enumerate() {
            if skip_next {
                skip_next = false;
                continue;
            }
            // Skip the binary name (first arg)
            if i == 0 {
                continue;
            }
            // Skip flags and their values
            if arg.starts_with('-') {
                // Flags that take a value: skip next arg too
                if arg == "--model" || arg == "-m" || arg == "--approval-mode" {
                    skip_next = true;
                }
                continue;
            }
            // First non-flag argument is the prompt
            if !arg.is_empty() {
                return Some(arg.clone());
            }
        }
        None
    }
}

#[async_trait]
impl AgentAdapter for CodexAdapter {
    fn adapter_type(&self) -> &str {
        "codex"
    }

    fn process_patterns(&self) -> Vec<String> {
        vec!["codex".to_string()]
    }

    async fn launch(&self, cwd: PathBuf, _intent: Option<String>) -> Result<(u32, tokio::process::Child), String> {
        launcher::launch_detached(
            "codex",
            &[],
            &cwd,
            None,
            9417,
        )
        .await
    }

    async fn get_state(&self, pid: u32) -> AgentState {
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

    async fn get_intent(&self, pid: u32) -> Option<String> {
        // Read process command line via sysinfo to extract the prompt argument
        let s = sysinfo::System::new_with_specifics(
            sysinfo::RefreshKind::nothing()
                .with_processes(sysinfo::ProcessRefreshKind::everything()),
        );
        let sysinfo_pid = sysinfo::Pid::from_u32(pid);
        if let Some(process) = s.process(sysinfo_pid) {
            let args: Vec<String> = process.cmd().iter().map(|s| s.to_string_lossy().to_string()).collect();
            return Self::extract_intent_from_args(&args);
        }
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
    fn adapter_type_returns_codex() {
        let adapter = CodexAdapter;
        assert_eq!(adapter.adapter_type(), "codex");
    }

    #[test]
    fn codex_extracts_intent_from_args() {
        let args = vec![
            "codex".to_string(),
            "--full-auto".to_string(),
            "fix login bug".to_string(),
        ];
        let intent = CodexAdapter::extract_intent_from_args(&args);
        assert_eq!(intent.as_deref(), Some("fix login bug"));
    }

    #[test]
    fn codex_extracts_intent_with_model_flag() {
        let args = vec![
            "codex".to_string(),
            "--model".to_string(),
            "o3".to_string(),
            "refactor auth".to_string(),
        ];
        let intent = CodexAdapter::extract_intent_from_args(&args);
        assert_eq!(intent.as_deref(), Some("refactor auth"));
    }

    #[test]
    fn codex_returns_none_for_no_prompt() {
        let args = vec![
            "codex".to_string(),
            "--full-auto".to_string(),
        ];
        let intent = CodexAdapter::extract_intent_from_args(&args);
        assert!(intent.is_none());
    }

    #[test]
    fn codex_returns_none_for_empty_args() {
        let args = vec!["codex".to_string()];
        let intent = CodexAdapter::extract_intent_from_args(&args);
        assert!(intent.is_none());
    }
}
