//! Phase 10: long-lived Claude Code chat runtime.
//!
//! Spawns + supervises a single `claude --input-format stream-json` subprocess
//! per chattable agent (D-06). stream-json NDJSON parsed progressively into
//! `agent_events` rows; stdin JSONL frames written FIFO for outbound messages
//! (D-08 + D-10). MCP server on self_register host is the fallback transport.
//!
//! Wave 0 (Plan 01) provides the public type surface only. Plan 02 wires
//! real submodules (launcher, parser, outbound, supervisor, commands,
//! auto_resume, notifications, session_registry).

pub mod types;

pub use types::{
    AgentEvent, ChatChannel, DeliveryUpdate, OutboundFrame, SessionEndedPayload,
    SessionStartedPayload, StreamEvent,
};
