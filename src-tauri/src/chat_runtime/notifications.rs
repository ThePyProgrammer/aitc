//! Phase 10: OS notification dispatcher for chat events (D-23).
//!
//! Fires only on `@user` mentions or `needs_user_input` hook / MCP signals.
//! Every-turn notifications are explicitly rejected.
//!
//! Mirrors `crate::comms::commands::dispatch_approval_notification` — wrapped
//! in `std::panic::catch_unwind` so tests using `tauri::test::mock_app()`
//! don't panic when the notification plugin isn't registered. In production
//! `lib.rs::run` always registers `tauri_plugin_notification::init()`.
//!
//! Deep-link format: `/comms?tab=chat&agent=<id>`. Carried inline in the body
//! until the frontend notification-click handler (Phase 11+) consumes it.
//!
//! Threat mitigations:
//! - T-10-25 (spoofing): user-agent-owned content is already trust-accepted.
//! - T-10-26 (panic): catch_unwind wrapper (mirrors approval notification).

#![allow(dead_code)]

use tauri_plugin_notification::NotificationExt;

pub fn dispatch_chat_notification<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    agent_id: &str,
    body: &str,
    deeplink_agent: Option<&str>,
) {
    let title = format!("AWAITING_USER — {agent_id}");
    let deeplink_suffix = deeplink_agent
        .map(|a| format!(" [/comms?tab=chat&agent={a}]"))
        .unwrap_or_default();
    let full_body = format!("{body}{deeplink_suffix}");

    // catch_unwind: the notification plugin panics on `.notification()` when
    // not registered (e.g. `tauri::test::mock_app`). Production always has it
    // registered; tests don't care about the side effect.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        app_handle
            .notification()
            .builder()
            .title(&title)
            .body(&full_body)
            .show()
    }));
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::warn!(
            agent_id = %agent_id,
            err = %e,
            "chat notification send failed"
        ),
        Err(_) => tracing::debug!(
            agent_id = %agent_id,
            "notification plugin unavailable (likely test runtime)"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_chat_notification_no_panic_in_mock_app() {
        // Mock app's notification plugin is unregistered; catch_unwind
        // ensures we swallow the panic and log instead.
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        dispatch_chat_notification(&handle, "A-1", "hello", Some("A-1"));
        dispatch_chat_notification(&handle, "A-1", "hello", None);
    }

    #[test]
    fn dispatch_chat_notification_with_long_body_no_panic() {
        // Stress the catch_unwind wrapper with a body longer than most
        // OS notification limits — must still exit cleanly.
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let big = "x".repeat(8192);
        dispatch_chat_notification(&handle, "KAGENT-9999", &big, Some("KAGENT-9999"));
    }
}
