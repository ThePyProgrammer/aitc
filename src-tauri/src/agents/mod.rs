pub mod adapter;
pub mod registry;
pub mod claude_code;
pub mod codex;
pub mod opencode;
pub mod generic;
pub mod launcher;
pub mod self_register;
pub mod notifications;
pub mod commands;

// Phase 8: Real Claude Code hook integration (PreToolUse approvals).
pub mod hook_install;
pub mod hook_waiters;

pub use adapter::{AgentAdapter, AgentInfo, AgentState};
pub use registry::{AgentRegistry, ManagedAgent};

/// Phase 10: the AITC self_register server's actual bound port.
///
/// Registered on Tauri managed state after `start_registration_server`
/// returns, so the `launch_agent` + `relaunch_agent_session` commands can
/// inject it into `LaunchOptions.aitc_port` — duplex adapters splice it
/// into the MCP config URL (D-11). Wrapped in a newtype so a bare `u16`
/// doesn't conflict with any other managed state.
#[derive(Debug, Clone, Copy)]
pub struct AitcPort(pub u16);
