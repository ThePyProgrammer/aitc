//! OpenCode adapter (built-in).
//!
//! Implements `AgentAdapter` for the OpenCode CLI agent.
//! Intent extraction parses the `-p` / `--prompt` flag from CLI args per D-08.

use crate::agents::adapter::{AgentAdapter, AgentState, LaunchOptions};
use crate::agents::launcher;
use async_trait::async_trait;
use std::path::PathBuf;

/// Stateless adapter for OpenCode agents.
pub struct OpenCodeAdapter;

impl OpenCodeAdapter {
    /// Extract intent from OpenCode CLI command line args.
    ///
    /// OpenCode accepts: `opencode [flags...] -p "prompt text"` or `--prompt "prompt text"`.
    pub fn extract_intent_from_args(args: &[String]) -> Option<String> {
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            if arg == "-p" || arg == "--prompt" {
                if let Some(value) = iter.next() {
                    if !value.is_empty() {
                        return Some(value.clone());
                    }
                }
            }
            // Also handle --prompt=value form
            if let Some(value) = arg.strip_prefix("--prompt=") {
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
        None
    }
}

#[async_trait]
impl AgentAdapter for OpenCodeAdapter {
    fn adapter_type(&self) -> &str {
        "opencode"
    }

    fn process_patterns(&self) -> Vec<String> {
        vec!["opencode".to_string()]
    }

    fn launch_binary(&self) -> String {
        "opencode".to_string()
    }

    async fn launch(
        &self,
        cwd: PathBuf,
        _intent: Option<String>,
        _options: LaunchOptions,
    ) -> Result<(u32, tokio::process::Child), String> {
        launcher::launch_detached(
            "opencode",
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
        // Read process command line via sysinfo to extract the -p flag
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
    fn adapter_type_returns_opencode() {
        let adapter = OpenCodeAdapter;
        assert_eq!(adapter.adapter_type(), "opencode");
    }

    #[test]
    fn opencode_extracts_intent_from_p_flag() {
        let args = vec![
            "opencode".to_string(),
            "-c".to_string(),
            "/tmp".to_string(),
            "-p".to_string(),
            "refactor auth module".to_string(),
        ];
        let intent = OpenCodeAdapter::extract_intent_from_args(&args);
        assert_eq!(intent.as_deref(), Some("refactor auth module"));
    }

    #[test]
    fn opencode_extracts_intent_from_prompt_flag() {
        let args = vec![
            "opencode".to_string(),
            "--prompt".to_string(),
            "fix the bug".to_string(),
        ];
        let intent = OpenCodeAdapter::extract_intent_from_args(&args);
        assert_eq!(intent.as_deref(), Some("fix the bug"));
    }

    #[test]
    fn opencode_extracts_intent_from_prompt_equals() {
        let args = vec![
            "opencode".to_string(),
            "--prompt=add tests".to_string(),
        ];
        let intent = OpenCodeAdapter::extract_intent_from_args(&args);
        assert_eq!(intent.as_deref(), Some("add tests"));
    }

    #[test]
    fn opencode_returns_none_without_p_flag() {
        let args = vec![
            "opencode".to_string(),
            "-c".to_string(),
            "/tmp".to_string(),
        ];
        let intent = OpenCodeAdapter::extract_intent_from_args(&args);
        assert!(intent.is_none());
    }

    #[test]
    fn opencode_returns_none_for_empty_args() {
        let args = vec!["opencode".to_string()];
        let intent = OpenCodeAdapter::extract_intent_from_args(&args);
        assert!(intent.is_none());
    }
}
