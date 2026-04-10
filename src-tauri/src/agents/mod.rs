pub mod adapter;
pub mod registry;
pub mod claude_code;
pub mod codex;
pub mod opencode;
pub mod generic;

pub use adapter::{AgentAdapter, AgentInfo, AgentState};
pub use registry::{AgentRegistry, ManagedAgent};
