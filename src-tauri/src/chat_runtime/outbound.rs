//! Phase 10: stdin writer task for outbound user messages.
//!
//! Plan 02 owns `child.stdin` and serializes `OutboundFrame`s into
//! stream-json user message envelopes (one JSON object per line + flush).
//! On each successful write, emits `DeliveryUpdate { status: 'delivered' }`
//! so the `agent-delivery-updated` Tauri event can flip the outbound row's
//! delivery_status column (D-10).

#![allow(dead_code)]

use tokio::process::ChildStdin;
use tokio::sync::mpsc;

use super::types::{DeliveryUpdate, OutboundFrame};

pub fn spawn_outbound_writer(
    _stdin: ChildStdin,
    _rx: mpsc::Receiver<OutboundFrame>,
    _delivery: mpsc::Sender<DeliveryUpdate>,
    _agent_id: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move { todo!("Plan 02 — FIFO serial write + flush + DeliveryUpdate emit") })
}
