//! Phase 10: stdin writer task for outbound user messages.
//!
//! Plan 02: real FIFO serial writer. Drains `OutboundFrame`s off the
//! `mpsc::Receiver`, serializes each via `serde_json::to_string` (T-10-06 —
//! never `format!`), writes `<line>\n` + flushes, and emits a
//! `DeliveryUpdate` for the frame's event_id. On `io::Error` (including
//! BrokenPipe from a dead subprocess), emits `status:"unsupported"` for the
//! current frame and breaks the loop — the supervisor path will mark the
//! session archived independently (T-10-10 eventual-consistency).

#![allow(dead_code)]

use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;
use tokio::sync::mpsc;

use super::types::{DeliveryUpdate, OutboundFrame};

pub fn spawn_outbound_writer(
    stdin: ChildStdin,
    rx: mpsc::Receiver<OutboundFrame>,
    delivery: mpsc::Sender<DeliveryUpdate>,
    agent_id: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(run_outbound_writer(stdin, rx, delivery, agent_id))
}

/// Inner body — re-used by `spawn_outbound_writer` and by unit tests that
/// drive it with a `tokio::io::DuplexStream` in place of a real ChildStdin.
async fn run_outbound_writer(
    stdin: ChildStdin,
    rx: mpsc::Receiver<OutboundFrame>,
    delivery: mpsc::Sender<DeliveryUpdate>,
    agent_id: String,
) {
    drive_outbound_writer(stdin, rx, delivery, agent_id).await;
}

pub(crate) async fn drive_outbound_writer<W>(
    mut stdin: W,
    mut rx: mpsc::Receiver<OutboundFrame>,
    delivery: mpsc::Sender<DeliveryUpdate>,
    agent_id: String,
) where
    W: tokio::io::AsyncWrite + Unpin,
{
    while let Some(frame) = rx.recv().await {
        // T-10-06: build the envelope via serde_json so content escaping is
        // correct for quotes, newlines, backslashes, control chars.
        //
        // Canonical wire format (per RESEARCH.md Pattern 3):
        //   {"type":"user","message":{"role":"user","content":[{"type":"text","text":"<content>"}]}}
        let envelope = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": frame.content}],
            }
        });
        let mut line = match serde_json::to_string(&envelope) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(
                    agent_id = %agent_id,
                    err = %e,
                    event_id = frame.event_id,
                    "outbound envelope serialize failed"
                );
                let _ = delivery
                    .send(DeliveryUpdate {
                        event_id: frame.event_id,
                        status: "unsupported".into(),
                    })
                    .await;
                continue;
            }
        };
        line.push('\n');

        match stdin.write_all(line.as_bytes()).await {
            Ok(()) => {
                if let Err(e) = stdin.flush().await {
                    tracing::warn!(
                        agent_id = %agent_id,
                        err = %e,
                        "stdin flush failed (likely subprocess exit)"
                    );
                    let _ = delivery
                        .send(DeliveryUpdate {
                            event_id: frame.event_id,
                            status: "unsupported".into(),
                        })
                        .await;
                    break;
                }
                let _ = delivery
                    .send(DeliveryUpdate {
                        event_id: frame.event_id,
                        status: "delivered".into(),
                    })
                    .await;
            }
            Err(e) => {
                tracing::warn!(
                    agent_id = %agent_id,
                    err = %e,
                    "stdin write failed (likely subprocess exit)"
                );
                let _ = delivery
                    .send(DeliveryUpdate {
                        event_id: frame.event_id,
                        status: "unsupported".into(),
                    })
                    .await;
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn writes_one_jsonl_line_per_frame() {
        let (write_half, mut read_half) = tokio::io::duplex(64 * 1024);
        let (frames_tx, frames_rx) = mpsc::channel::<OutboundFrame>(8);
        let (deliv_tx, mut deliv_rx) = mpsc::channel::<DeliveryUpdate>(8);

        let writer = tokio::spawn(drive_outbound_writer(
            write_half,
            frames_rx,
            deliv_tx,
            "A-1".into(),
        ));

        frames_tx
            .send(OutboundFrame {
                event_id: 42,
                content: "hello".into(),
            })
            .await
            .unwrap();
        drop(frames_tx); // close the channel so writer exits after draining

        // Read one line from the pipe.
        let mut buf = Vec::new();
        // Give the writer time to write + close.
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            read_half.read_to_end(&mut buf),
        )
        .await;
        let read_str = String::from_utf8_lossy(&buf);
        assert!(read_str.ends_with('\n'));
        let line = read_str.trim_end_matches('\n');
        // serde_json emits keys alphabetically — compare by decoded value
        // shape, not by byte-equal string. The wire format is JSON; key
        // order isn't load-bearing.
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(v["type"], serde_json::json!("user"));
        assert_eq!(v["message"]["role"], serde_json::json!("user"));
        assert_eq!(
            v["message"]["content"][0],
            serde_json::json!({"type": "text", "text": "hello"})
        );

        // DeliveryUpdate(delivered) arrives.
        let upd = deliv_rx.recv().await.unwrap();
        assert_eq!(upd.event_id, 42);
        assert_eq!(upd.status, "delivered");

        let _ = writer.await;
    }

    #[tokio::test]
    async fn fifo_order_preserved() {
        let (write_half, mut read_half) = tokio::io::duplex(64 * 1024);
        let (frames_tx, frames_rx) = mpsc::channel::<OutboundFrame>(8);
        let (deliv_tx, mut deliv_rx) = mpsc::channel::<DeliveryUpdate>(8);

        let writer = tokio::spawn(drive_outbound_writer(
            write_half,
            frames_rx,
            deliv_tx,
            "A-1".into(),
        ));

        for (i, s) in ["A", "B", "C"].iter().enumerate() {
            frames_tx
                .send(OutboundFrame {
                    event_id: i as i64,
                    content: (*s).into(),
                })
                .await
                .unwrap();
        }
        drop(frames_tx);

        let mut buf = Vec::new();
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            read_half.read_to_end(&mut buf),
        )
        .await;
        let s = String::from_utf8_lossy(&buf);
        let lines: Vec<&str> = s.trim_end_matches('\n').split('\n').collect();
        assert_eq!(lines.len(), 3);
        for (i, expected) in ["A", "B", "C"].iter().enumerate() {
            let v: serde_json::Value = serde_json::from_str(lines[i]).unwrap();
            assert_eq!(
                v["message"]["content"][0]["text"],
                serde_json::json!(*expected)
            );
        }
        // Three delivery updates in order.
        for i in 0..3 {
            let upd = deliv_rx.recv().await.unwrap();
            assert_eq!(upd.event_id, i as i64);
            assert_eq!(upd.status, "delivered");
        }
        let _ = writer.await;
    }

    #[tokio::test]
    async fn broken_pipe_emits_unsupported_and_breaks() {
        let (write_half, read_half) = tokio::io::duplex(64);
        let (frames_tx, frames_rx) = mpsc::channel::<OutboundFrame>(8);
        let (deliv_tx, mut deliv_rx) = mpsc::channel::<DeliveryUpdate>(8);

        let writer = tokio::spawn(drive_outbound_writer(
            write_half,
            frames_rx,
            deliv_tx,
            "A-1".into(),
        ));

        // Drop the read side to break the pipe.
        drop(read_half);

        // Send more than the 64-byte duplex capacity to guarantee write fails.
        let big = "x".repeat(1024);
        frames_tx
            .send(OutboundFrame {
                event_id: 99,
                content: big,
            })
            .await
            .unwrap();

        // Expect an unsupported update within 1 second.
        let upd = tokio::time::timeout(std::time::Duration::from_secs(1), deliv_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(upd.event_id, 99);
        assert_eq!(upd.status, "unsupported");

        // Writer should have exited.
        let join = tokio::time::timeout(std::time::Duration::from_secs(1), writer).await;
        assert!(join.is_ok(), "writer task must exit on BrokenPipe");
    }

    #[tokio::test]
    async fn json_special_chars_escaped() {
        let (write_half, mut read_half) = tokio::io::duplex(64 * 1024);
        let (frames_tx, frames_rx) = mpsc::channel::<OutboundFrame>(8);
        let (deliv_tx, mut _deliv_rx) = mpsc::channel::<DeliveryUpdate>(8);

        let writer = tokio::spawn(drive_outbound_writer(
            write_half,
            frames_rx,
            deliv_tx,
            "A-1".into(),
        ));

        let raw = "quote\"\\backslash\nnewline";
        frames_tx
            .send(OutboundFrame {
                event_id: 1,
                content: raw.into(),
            })
            .await
            .unwrap();
        drop(frames_tx);

        let mut buf = Vec::new();
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            read_half.read_to_end(&mut buf),
        )
        .await;
        let s = String::from_utf8_lossy(&buf);
        let line = s.trim_end_matches('\n');
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        let roundtrip = v["message"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(roundtrip, raw);
        let _ = writer.await;
    }
}
