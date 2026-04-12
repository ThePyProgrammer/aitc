//! Generic TOML-configured adapter (D-03: full feature parity).
//!
//! A power user can define a custom agent via a TOML config file with detect,
//! launch, state, and intent rules. The `GenericAdapter` parses this config
//! and implements `AgentAdapter` using the configured patterns.

use crate::agents::adapter::{AgentAdapter, AgentState};
use crate::agents::launcher;
use async_trait::async_trait;
use regex::Regex;
use serde::Deserialize;
use std::path::PathBuf;

/// Configuration for a generic agent, parsed from TOML.
///
/// T-03-01 mitigation: all regex patterns are validated at parse time via
/// `Regex::new()`. `process_names` capped at 20 entries.
#[derive(Debug, Clone, Deserialize)]
pub struct GenericAgentConfig {
    pub name: String,
    pub process_names: Vec<String>,
    pub launch_command: String,
    pub launch_args: Vec<String>,
    pub state_running_regex: Option<String>,
    pub state_error_regex: Option<String>,
    pub intent_regex: Option<String>,
    pub protocol: Option<String>,
}

/// A config-driven adapter that implements `AgentAdapter` using TOML-defined rules.
#[derive(Debug)]
pub struct GenericAdapter {
    pub config: GenericAgentConfig,
    state_running_re: Option<Regex>,
    state_error_re: Option<Regex>,
    intent_re: Option<Regex>,
}

impl GenericAdapter {
    /// Parse a TOML string into a `GenericAdapter`.
    ///
    /// Validates all regex patterns at load time (T-03-01) and caps
    /// `process_names` to 20 entries to prevent allowlist flooding.
    pub fn from_toml(toml_str: &str) -> Result<Self, String> {
        let config: GenericAgentConfig =
            toml_crate::from_str(toml_str).map_err(|e| format!("TOML parse error: {e}"))?;

        // T-03-01: Cap process_names to prevent allowlist flooding
        if config.process_names.len() > 20 {
            return Err(format!(
                "process_names has {} entries (max 20)",
                config.process_names.len()
            ));
        }

        let state_running_re = config
            .state_running_regex
            .as_deref()
            .map(Regex::new)
            .transpose()
            .map_err(|e| format!("Invalid state_running_regex: {e}"))?;

        let state_error_re = config
            .state_error_regex
            .as_deref()
            .map(Regex::new)
            .transpose()
            .map_err(|e| format!("Invalid state_error_regex: {e}"))?;

        let intent_re = config
            .intent_regex
            .as_deref()
            .map(Regex::new)
            .transpose()
            .map_err(|e| format!("Invalid intent_regex: {e}"))?;

        Ok(Self {
            config,
            state_running_re,
            state_error_re,
            intent_re,
        })
    }

    /// Check stdout lines against state regex patterns.
    pub fn check_state_from_stdout(&self, lines: &[String]) -> Option<AgentState> {
        for line in lines.iter().rev() {
            if let Some(re) = &self.state_error_re {
                if re.is_match(line) {
                    return Some(AgentState::Error);
                }
            }
            if let Some(re) = &self.state_running_re {
                if re.is_match(line) {
                    return Some(AgentState::Running);
                }
            }
        }
        None
    }

    /// Extract intent from stdout lines using configured regex.
    pub fn extract_intent_from_stdout(&self, lines: &[String]) -> Option<String> {
        let re = self.intent_re.as_ref()?;
        for line in lines.iter().rev() {
            if let Some(caps) = re.captures(line) {
                // Return first capture group if available, otherwise full match
                if let Some(group) = caps.get(1) {
                    return Some(group.as_str().to_string());
                }
                return Some(caps.get(0).unwrap().as_str().to_string());
            }
        }
        None
    }
}

#[async_trait]
impl AgentAdapter for GenericAdapter {
    fn adapter_type(&self) -> &str {
        &self.config.name
    }

    fn process_patterns(&self) -> Vec<String> {
        self.config.process_names.clone()
    }

    async fn launch(&self, cwd: PathBuf, _intent: Option<String>) -> Result<(u32, tokio::process::Child), String> {
        let args: Vec<&str> = self.config.launch_args.iter().map(|s| s.as_str()).collect();
        launcher::launch_detached(
            &self.config.launch_command,
            &args,
            &cwd,
            None,
            9417,
        )
        .await
    }

    async fn get_state(&self, pid: u32) -> AgentState {
        // Fallback: check if process is alive
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
        // Intent extracted from stdout buffer by the command layer
        // using extract_intent_from_stdout. Stateless adapter returns None.
        None
    }

    async fn terminate(&self, pid: u32) -> Result<(), String> {
        launcher::terminate_process(pid).await
    }
}

/// Sentinel adapter used for PASSIVE-scan entries (AGNT-03 / D-06).
///
/// Returns a `GenericAdapter` configured with a process_names pattern that
/// never matches any real process (`__passive__never_matches__`). Passive
/// entries are view-only — attempting to `terminate` one falls through to
/// `launcher::terminate_process` with the original PID, which is what the
/// UI already disables for unknown agent_type per 06-RESEARCH.md Q1.
pub fn passive_sentinel_adapter() -> std::sync::Arc<dyn AgentAdapter> {
    // Minimal TOML -- only mandatory fields. from_toml validates regexes and
    // caps process_names, neither of which can fail on this config.
    const PASSIVE_SENTINEL_TOML: &str = r#"
name = "passive-scan"
process_names = ["__passive__never_matches__"]
launch_command = ""
launch_args = []
"#;
    std::sync::Arc::new(
        GenericAdapter::from_toml(PASSIVE_SENTINEL_TOML)
            .expect("passive_sentinel_adapter TOML is well-formed"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_TOML: &str = r#"
name = "my-custom-agent"
process_names = ["my-agent", "custom-agent"]
launch_command = "my-agent"
launch_args = ["--mode", "auto"]
state_running_regex = "status:\\s*running"
state_error_regex = "error|fatal"
intent_regex = "task:\\s*(.+)"
protocol = "custom"
"#;

    #[test]
    fn parses_toml_config() {
        let adapter = GenericAdapter::from_toml(SAMPLE_TOML).unwrap();
        assert_eq!(adapter.config.name, "my-custom-agent");
        assert_eq!(adapter.config.process_names.len(), 2);
        assert_eq!(adapter.config.launch_command, "my-agent");
        assert_eq!(adapter.config.launch_args, vec!["--mode", "auto"]);
        assert!(adapter.config.state_running_regex.is_some());
        assert!(adapter.config.intent_regex.is_some());
    }

    #[test]
    fn process_patterns_returns_configured_names() {
        let adapter = GenericAdapter::from_toml(SAMPLE_TOML).unwrap();
        let patterns = adapter.process_patterns();
        assert!(patterns.contains(&"my-agent".to_string()));
        assert!(patterns.contains(&"custom-agent".to_string()));
    }

    #[test]
    fn adapter_type_matches_config_name() {
        let adapter = GenericAdapter::from_toml(SAMPLE_TOML).unwrap();
        assert_eq!(adapter.adapter_type(), "my-custom-agent");
    }

    #[test]
    fn rejects_invalid_regex() {
        let bad_toml = r#"
name = "bad"
process_names = ["bad"]
launch_command = "bad"
launch_args = []
state_running_regex = "[invalid("
"#;
        let result = GenericAdapter::from_toml(bad_toml);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid state_running_regex"));
    }

    #[test]
    fn rejects_too_many_process_names() {
        let names: Vec<String> = (0..21).map(|i| format!("\"agent-{i}\"")).collect();
        let toml = format!(
            r#"
name = "flood"
process_names = [{}]
launch_command = "flood"
launch_args = []
"#,
            names.join(", ")
        );
        let result = GenericAdapter::from_toml(&toml);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("max 20"));
    }

    #[test]
    fn check_state_from_stdout_detects_error() {
        let adapter = GenericAdapter::from_toml(SAMPLE_TOML).unwrap();
        let lines = vec!["output line".to_string(), "fatal crash".to_string()];
        assert_eq!(
            adapter.check_state_from_stdout(&lines),
            Some(AgentState::Error)
        );
    }

    #[test]
    fn check_state_from_stdout_detects_running() {
        let adapter = GenericAdapter::from_toml(SAMPLE_TOML).unwrap();
        let lines = vec!["status: running".to_string()];
        assert_eq!(
            adapter.check_state_from_stdout(&lines),
            Some(AgentState::Running)
        );
    }

    #[test]
    fn extract_intent_from_stdout_captures_group() {
        let adapter = GenericAdapter::from_toml(SAMPLE_TOML).unwrap();
        let lines = vec!["task: fix the login page".to_string()];
        assert_eq!(
            adapter.extract_intent_from_stdout(&lines).as_deref(),
            Some("fix the login page")
        );
    }

    #[test]
    fn extract_intent_from_stdout_returns_none_for_no_match() {
        let adapter = GenericAdapter::from_toml(SAMPLE_TOML).unwrap();
        let lines = vec!["no intent here".to_string()];
        assert!(adapter.extract_intent_from_stdout(&lines).is_none());
    }
}
