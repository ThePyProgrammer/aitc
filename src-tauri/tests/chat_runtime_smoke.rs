//! Phase 10 Wave 0 — integration-test shell.
//!
//! Plan 02 adds real e2e tests against a mocked/real `claude` subprocess.
//! Wave 0 just proves the crate-level imports resolve.

#[test]
fn chat_runtime_public_surface_is_reachable() {
    use aitc_lib::chat_runtime::{types::AgentEvent, LiveSessionRegistry};
    let _reg: std::sync::Arc<LiveSessionRegistry> = LiveSessionRegistry::new_arc();
    let _ = std::any::type_name::<AgentEvent>();
}
