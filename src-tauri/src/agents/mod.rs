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
