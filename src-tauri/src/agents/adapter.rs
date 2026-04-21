//! Agent adapter trait and core types for Phase 3.
//!
//! The `AgentAdapter` trait is the single abstraction for all agent types (D-01).
//! Built-in adapters (Claude Code, Codex, OpenCode) implement it directly;
//! `GenericAdapter` reads TOML config for extensibility (D-03).

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

/// Agent lifecycle state machine.
///
/// Valid transitions (per 03-RESEARCH.md):
/// - Running -> Idle, Waiting, Conflict, Error
/// - Idle -> Running, Error
/// - Waiting -> Running, Error
/// - Conflict -> Running, Error
/// - Error -> Running
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentState {
    Running,
    Idle,
    Waiting,
    Conflict,
    Error,
}

impl AgentState {
    /// Check whether a transition from `self` to `next` is valid per the
    /// state machine defined in 03-RESEARCH.md.
    pub fn can_transition_to(&self, next: &AgentState) -> bool {
        match self {
            AgentState::Running => matches!(
                next,
                AgentState::Idle | AgentState::Waiting | AgentState::Conflict | AgentState::Error
            ),
            AgentState::Idle => matches!(next, AgentState::Running | AgentState::Error),
            AgentState::Waiting => matches!(next, AgentState::Running | AgentState::Error),
            AgentState::Conflict => matches!(next, AgentState::Running | AgentState::Error),
            AgentState::Error => matches!(next, AgentState::Running),
        }
    }
}

/// Adapter-specific launch tuning. Currently only Claude Code consumes any of
/// these; other adapters ignore them. Kept as one serializable struct so the
/// IPC surface stays flat even as new options show up.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    /// Claude Code: adds `--permission-mode acceptEdits` so file-edit tools
    /// run without prompting.
    pub accept_edits: bool,
    /// Claude Code: adds `--dangerously-skip-permissions` which disables the
    /// permission prompt entirely. Takes precedence over `accept_edits`.
    pub dangerously_skip_permissions: bool,
    /// Phase 10: the AITC-assigned agent_id for this launch. Needed by
    /// duplex adapters (claude-code) so they can write the per-session MCP
    /// config to `.claude/aitc-mcp-<agent_id>.json` BEFORE spawning. Other
    /// adapters ignore it. `None` means "generate inside the command layer";
    /// `Some(id)` forces a specific id (used by relaunch_agent_session to
    /// preserve transcript continuity for an archived agent — D-04).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Phase 10: AITC self_register port (defaults to 9417). Duplex adapters
    /// splice this into the MCP config URL so Claude's `--mcp-config` points
    /// at the running /mcp handler.
    #[serde(default)]
    pub aitc_port: Option<u16>,
}

/// Capability flags reported by an adapter at launch time. Consumed by
/// `agents::commands::launch_agent` to route the spawned `Child` through
/// either the long-lived stream-json runtime (Plan 02) or the simple
/// raw-stdout/stderr capture path (D-12). Add more flags here as future
/// adapters expose new behaviors.
#[derive(Debug, Clone, Copy)]
pub struct AdapterCapabilities {
    /// When true, the adapter supports bidirectional chat via the Phase 10
    /// long-lived stream-json runtime: `launch` returns a `Child` with all
    /// three stdio pipes piped, and the command layer hands those pipes to
    /// parser + outbound writer + supervisor. When false, the adapter is
    /// transcript-only (outbound messages are rejected with
    /// `delivery_status='unsupported'`; `Child` stdout/stderr are captured
    /// as raw line events).
    pub chat_duplex: bool,
}

impl Default for AdapterCapabilities {
    fn default() -> Self {
        AdapterCapabilities { chat_duplex: false }
    }
}

/// Metadata about an agent visible to the frontend and stored in the registry.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub agent_type: String,
    pub protocol: String,
    pub state: AgentState,
    pub pid: Option<u32>,
    pub cwd: Option<PathBuf>,
    pub intent: Option<String>,
}

/// The core abstraction for all agent types.
///
/// Each adapter knows how to detect, launch, poll state, extract intent, and
/// terminate its agent type. Must be `Send + Sync` for use inside
/// `Arc<dyn AgentAdapter>` in async contexts.
#[async_trait]
pub trait AgentAdapter: Send + Sync {
    /// Unique identifier for this adapter type (e.g. "claude-code", "codex").
    fn adapter_type(&self) -> &str;

    /// Process name patterns used by `ProcessSnapshot` to detect this agent.
    /// Matching is lowercased substring, consistent with the Phase 2 allowlist.
    fn process_patterns(&self) -> Vec<String>;

    /// The executable name this adapter would spawn via `launch_detached`.
    /// Used for PATH availability checks so the UI can hide agent types
    /// whose CLI isn't installed on the host.
    fn launch_binary(&self) -> String;

    /// Launch a new agent session in the given working directory.
    /// Returns `(pid, child)` on success. The caller is responsible for spawning
    /// a stdout reader task from the child handle. Adapters are free to ignore
    /// `options` if they don't map to their underlying CLI.
    async fn launch(
        &self,
        cwd: PathBuf,
        intent: Option<String>,
        options: LaunchOptions,
    ) -> Result<(u32, tokio::process::Child), String>;

    /// Poll the current state of an agent by PID.
    async fn get_state(&self, pid: u32) -> AgentState;

    /// Extract the agent's current intent/task description if available.
    async fn get_intent(&self, pid: u32) -> Option<String>;

    /// Terminate an agent process by PID.
    async fn terminate(&self, pid: u32) -> Result<(), String>;

    /// Adapter capability flags. Default returns `chat_duplex=false` so the
    /// existing read-only adapters (Codex/OpenCode/Generic) inherit the
    /// conservative behavior; Claude Code overrides to `true` (D-01, D-02).
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_state_valid_transitions() {
        // Running -> all except Running and self-loop
        assert!(AgentState::Running.can_transition_to(&AgentState::Idle));
        assert!(AgentState::Running.can_transition_to(&AgentState::Waiting));
        assert!(AgentState::Running.can_transition_to(&AgentState::Conflict));
        assert!(AgentState::Running.can_transition_to(&AgentState::Error));

        // Idle -> Running, Error
        assert!(AgentState::Idle.can_transition_to(&AgentState::Running));
        assert!(AgentState::Idle.can_transition_to(&AgentState::Error));

        // Waiting -> Running, Error
        assert!(AgentState::Waiting.can_transition_to(&AgentState::Running));
        assert!(AgentState::Waiting.can_transition_to(&AgentState::Error));

        // Conflict -> Running, Error
        assert!(AgentState::Conflict.can_transition_to(&AgentState::Running));
        assert!(AgentState::Conflict.can_transition_to(&AgentState::Error));

        // Error -> Running
        assert!(AgentState::Error.can_transition_to(&AgentState::Running));
    }

    #[test]
    fn agent_state_invalid_transitions() {
        // Running -> Running (self-loop)
        assert!(!AgentState::Running.can_transition_to(&AgentState::Running));

        // Idle -> Conflict, Waiting, Idle
        assert!(!AgentState::Idle.can_transition_to(&AgentState::Conflict));
        assert!(!AgentState::Idle.can_transition_to(&AgentState::Waiting));
        assert!(!AgentState::Idle.can_transition_to(&AgentState::Idle));

        // Waiting -> Idle, Conflict, Waiting
        assert!(!AgentState::Waiting.can_transition_to(&AgentState::Idle));
        assert!(!AgentState::Waiting.can_transition_to(&AgentState::Conflict));
        assert!(!AgentState::Waiting.can_transition_to(&AgentState::Waiting));

        // Error -> Idle, Waiting, Conflict, Error
        assert!(!AgentState::Error.can_transition_to(&AgentState::Idle));
        assert!(!AgentState::Error.can_transition_to(&AgentState::Waiting));
        assert!(!AgentState::Error.can_transition_to(&AgentState::Conflict));
        assert!(!AgentState::Error.can_transition_to(&AgentState::Error));
    }

    #[test]
    fn adapter_capabilities_default_is_read_only() {
        let caps = AdapterCapabilities::default();
        assert!(!caps.chat_duplex);
    }

    #[test]
    fn adapter_capabilities_is_copy_and_clone() {
        let c = AdapterCapabilities { chat_duplex: true };
        let d = c; // copy
        let e = c.clone(); // clone
        assert!(d.chat_duplex);
        assert!(e.chat_duplex);
        assert!(c.chat_duplex);
    }

    #[test]
    fn agent_info_serializes_camelcase() {
        let info = AgentInfo {
            id: "agent-1".to_string(),
            agent_type: "claude-code".to_string(),
            protocol: "hooks".to_string(),
            state: AgentState::Running,
            pid: Some(1234),
            cwd: Some(PathBuf::from("/home/dev/myrepo")),
            intent: Some("Fix auth bug".to_string()),
        };
        let json = serde_json::to_string(&info).expect("serialize");
        assert!(
            json.contains("\"agentType\":\"claude-code\""),
            "expected camelCase agentType, got: {json}"
        );
        assert!(
            json.contains("\"state\":\"running\""),
            "expected camelCase state value, got: {json}"
        );
        assert!(
            json.contains("\"pid\":1234"),
            "expected pid field, got: {json}"
        );
    }
}
