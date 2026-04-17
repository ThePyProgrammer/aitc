//! Phase 10: OS notification dispatcher for chat events (D-23).
//!
//! Fires only on `@user` mentions or `needs_user_input` hook / MCP signals.
//! Every-turn notifications are explicitly rejected.
//!
//! Wave 0 (Plan 01) declares the signature — Plan 04 wires the body through
//! the existing Phase 4 `dispatch_approval_notification` plumbing.

#![allow(dead_code)]

pub fn dispatch_chat_notification<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _agent_id: &str,
    _body: &str,
    _deeplink_agent: Option<&str>,
) {
    // Plan 04: Tauri notification via tauri-plugin-notification + deeplink URL.
}
