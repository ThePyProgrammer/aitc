pub mod adapter;
pub mod registry;
pub mod claude_code;
pub mod codex;
pub mod opencode;
pub mod generic;
pub mod launcher;
pub mod self_register;
pub mod notifications;

pub use adapter::{AgentAdapter, AgentInfo, AgentState};
pub use registry::{AgentRegistry, ManagedAgent};
