//! Generic TOML-configured adapter (D-03: full feature parity).
//!
//! A power user can define a custom agent via a TOML config file with detect,
//! launch, state, and intent rules. The `GenericAdapter` parses this config
//! and implements `AgentAdapter` using the configured patterns.

use crate::agents::adapter::{AgentAdapter, AgentState};
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
    config: GenericAgentConfig,
    _state_running_re: Option<Regex>,
    _state_error_re: Option<Regex>,
    _intent_re: Option<Regex>,
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
            _state_running_re: state_running_re,
            _state_error_re: state_error_re,
            _intent_re: intent_re,
        })
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

    async fn launch(&self, _cwd: PathBuf, _intent: Option<String>) -> Result<u32, String> {
        // Placeholder -- same as built-in adapters for now
        Err("launcher not wired".to_string())
    }

    async fn get_state(&self, _pid: u32) -> AgentState {
        // Placeholder -- will use _state_running_re / _state_error_re on stdout
        AgentState::Running
    }

    async fn get_intent(&self, _pid: u32) -> Option<String> {
        // Placeholder -- will use _intent_re on stdout
        None
    }

    async fn terminate(&self, _pid: u32) -> Result<(), String> {
        Err("launcher not wired".to_string())
    }
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
}
