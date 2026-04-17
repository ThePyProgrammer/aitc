//! Phase 10: MCP tool dispatch.
//!
//! Exposes two tools to Claude Code sessions:
//!   - `get_pending_user_messages` — drains queued outbound frames when the
//!     stdin JSONL primary path is not available (D-08 fallback). v1 returns
//!     an empty message list; Plans 11+ may hook it into a proper drain of
//!     OutboundFrames.
//!   - `request_user_input` — signals the @user / awaiting-user notification
//!     path (D-23). Dispatches the OS notification via the Phase 4 plumbing
//!     (chat_runtime::notifications::dispatch_chat_notification) and writes
//!     a visible system_note transcript marker so the UI shows the prompt.

#![allow(dead_code)]

use std::sync::Arc;

use crate::chat_runtime::session_registry::LiveSessionRegistry;

/// Returns the two-tool surface advertised via MCP `tools/list`. Static — no
/// per-call filtering or capability gating beyond the two hard-coded tools
/// in v1. Future additions go here (schema pinned to MCP 2025-03-26
/// `{name, description, inputSchema}` shape).
pub fn tool_list_v1() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "name": "get_pending_user_messages",
            "description": "Returns any queued user messages from AITC that haven't yet been consumed via stdin. \
Use this when you need to check if the user has typed a message. v1 primary path is stdin JSONL; this is a fallback.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
        serde_json::json!({
            "name": "request_user_input",
            "description": "Signals that Claude is awaiting user input on a specific prompt. \
AITC will notify the user via the OS notification plumbing and surface your prompt in the chat transcript.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "The question or instruction for the user"
                    },
                    "default": {
                        "type": "string",
                        "description": "Optional default value to suggest"
                    }
                },
                "required": ["prompt"]
            }
        }),
    ]
}

/// Fallback outbound drain. v1 returns an empty list — the primary transport
/// for user → agent messages is the stdin JSONL writer (Plan 02
/// `spawn_outbound_writer`). Claude CAN call this tool if the stdin pipe is
/// ever unavailable; future plans may wire it into a proper drain of pending
/// OutboundFrames from `LiveSessionRegistry`.
pub async fn call_get_pending_user_messages(
    _agent_id: &str,
    _sessions: &Arc<LiveSessionRegistry>,
    _pool: &sqlx::SqlitePool,
) -> Result<serde_json::Value, String> {
    // The MCP `tools/call` result shape is `{content: [{type, text}], isError}`
    // per the 2025-03-26 spec. We return a JSON-encoded `{messages: []}` string
    // so Claude's tool-result parser sees a predictable wrapper.
    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": "{\"messages\":[]}"
        }],
        "isError": false
    }))
}

/// Dispatches the awaiting-user signal. Writes a transcript `system_note`
/// row so the UI shows the prompt, fires an OS notification via the Phase 4
/// plumbing, and returns an ack `content` block. v1 does NOT long-hold —
/// the user types back into ChatInput and the reply flows through
/// `send_chat_message_to_agent` normally. Long-hold is Phase 11+ polish.
pub async fn call_request_user_input<R: tauri::Runtime>(
    agent_id: &str,
    args: serde_json::Value,
    app: &tauri::AppHandle<R>,
    pool: &sqlx::SqlitePool,
) -> Result<serde_json::Value, String> {
    let prompt = args
        .get("prompt")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing prompt argument".to_string())?;
    let default = args
        .get("default")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Insert a visible `system_note` transcript marker so the UI renders the
    // pending prompt. The Phase 5 EventCard dispatcher will treat this as a
    // system_note and render a centered label.
    let payload = serde_json::json!({
        "text": format!("request_user_input: {prompt}"),
        "kind": "awaiting_user",
        "prompt": prompt,
        "default": default,
    });
    if let Err(e) = crate::db::events::insert_agent_event(
        pool, agent_id, None, "system_note", &payload, None, None, None,
    )
    .await
    {
        tracing::warn!(
            agent_id = %agent_id,
            err = %e,
            "request_user_input: system_note insert failed"
        );
    }

    // Fire the OS notification. Plan 04 wires the real body; Plan 03 just
    // calls the existing no-op stub, which is already safe to invoke.
    crate::chat_runtime::notifications::dispatch_chat_notification(
        app,
        agent_id,
        &format!("AWAITING_USER — {}", truncate(prompt, 80)),
        Some(agent_id),
    );

    Ok(serde_json::json!({
        "content": [{
            "type": "text",
            "text": "Notification sent. User will respond via the AITC chat UI."
        }],
        "isError": false
    }))
}

/// Truncate to `max` chars (char count, not bytes — so we don't split a UTF-8
/// sequence). Appends `…` when truncating.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let keep = max.saturating_sub(1);
        format!("{}…", s.chars().take(keep).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::events::tests::make_pool_with_chat_schema;

    #[test]
    fn tool_list_v1_has_exactly_two_tools_with_required_fields() {
        let tools = tool_list_v1();
        assert_eq!(tools.len(), 2);
        let names: Vec<&str> = tools
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"get_pending_user_messages"));
        assert!(names.contains(&"request_user_input"));
        for tool in &tools {
            assert!(tool["name"].is_string(), "tool must have string name");
            assert!(
                tool["description"].is_string(),
                "tool must have string description"
            );
            assert!(
                tool["inputSchema"]["type"] == serde_json::json!("object"),
                "inputSchema must be of type object"
            );
            assert!(
                tool["inputSchema"]["properties"].is_object(),
                "inputSchema.properties must be an object"
            );
            assert!(
                tool["inputSchema"]["required"].is_array(),
                "inputSchema.required must be an array"
            );
        }
        // request_user_input requires `prompt`.
        let rui = tools
            .iter()
            .find(|t| t["name"] == "request_user_input")
            .unwrap();
        let required: Vec<&str> = rui["inputSchema"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert!(required.contains(&"prompt"));
    }

    #[tokio::test]
    async fn get_pending_user_messages_returns_empty_content_block() {
        let pool = make_pool_with_chat_schema().await;
        let sessions = LiveSessionRegistry::new_arc();
        let result = call_get_pending_user_messages("A-1", &sessions, &pool)
            .await
            .unwrap();
        assert_eq!(result["isError"], serde_json::json!(false));
        let text = result["content"][0]["text"].as_str().unwrap();
        let inner: serde_json::Value = serde_json::from_str(text).unwrap();
        let messages = inner["messages"].as_array().unwrap();
        assert!(messages.is_empty(), "v1 returns an empty messages list");
    }

    #[tokio::test]
    async fn request_user_input_rejects_missing_prompt() {
        let pool = make_pool_with_chat_schema().await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let result = call_request_user_input(
            "A-1",
            serde_json::json!({}),
            &app_handle,
            &pool,
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing prompt"));
    }

    #[tokio::test]
    async fn request_user_input_inserts_system_note_row() {
        let pool = make_pool_with_chat_schema().await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let result = call_request_user_input(
            "A-1",
            serde_json::json!({"prompt": "Confirm deployment?"}),
            &app_handle,
            &pool,
        )
        .await
        .unwrap();
        // Ack shape.
        assert_eq!(result["isError"], serde_json::json!(false));
        assert!(result["content"][0]["text"].is_string());
        // system_note row written.
        let events = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "system_note");
        assert_eq!(events[0].payload_json["kind"], "awaiting_user");
        assert_eq!(events[0].payload_json["prompt"], "Confirm deployment?");
        assert!(events[0]
            .payload_json["text"]
            .as_str()
            .unwrap()
            .contains("request_user_input:"));
    }

    #[tokio::test]
    async fn request_user_input_accepts_optional_default() {
        let pool = make_pool_with_chat_schema().await;
        let app = tauri::test::mock_app();
        let app_handle = app.handle().clone();
        let _ = call_request_user_input(
            "A-1",
            serde_json::json!({"prompt": "pick", "default": "yes"}),
            &app_handle,
            &pool,
        )
        .await
        .unwrap();
        let events = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
            .await
            .unwrap();
        assert_eq!(events[0].payload_json["default"], "yes");
    }

    #[test]
    fn truncate_leaves_short_strings_untouched() {
        assert_eq!(truncate("hi", 10), "hi");
        assert_eq!(truncate("", 10), "");
    }

    #[test]
    fn truncate_appends_ellipsis_when_over_limit() {
        let out = truncate("abcdefghijk", 5);
        assert_eq!(out.chars().count(), 5);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn truncate_handles_multibyte_chars_without_panicking() {
        // 10 two-byte chars.
        let s = "áááááááááá";
        let out = truncate(s, 5);
        assert_eq!(out.chars().count(), 5);
    }
}
