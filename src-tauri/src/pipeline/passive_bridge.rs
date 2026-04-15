//! Passive-scan bridge: ProcessSnapshot → AgentRegistry (AGNT-03, D-06, D-07).
//!
//! Spawned by `start_watch`, cancelled on `stop_watch`. Ticks every
//! `BRIDGE_INTERVAL_MS`, upserts `PASSIVE-{pid}` entries for candidates whose
//! PID is not already owned by a non-PASSIVE registry entry, and reaps stale
//! PASSIVE entries whose PID has disappeared from the snapshot.

use crate::agents::adapter::{AgentInfo, AgentState};
use crate::agents::generic::passive_sentinel_adapter;
use crate::agents::AgentRegistry;
use crate::pipeline::process_snapshot::ProcessSnapshot;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

/// Cadence for the passive-bridge tick. 2s balances liveness (PASSIVE entries
/// appear within one cycle of a new agent launch) against registry churn.
pub const BRIDGE_INTERVAL_MS: u64 = 2000;

/// Spawn the passive-scan bridge task. Returns a JoinHandle the caller
/// stores in ActiveWatch so it is aborted when the watch stops.
pub fn spawn_passive_bridge(
    registry: Arc<AgentRegistry>,
    snapshot: Arc<RwLock<ProcessSnapshot>>,
    repo_root: PathBuf,
    interval: Duration,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(interval);
        // Skip the immediate first tick so we don't double-fire with the refresher.
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = bridge_tick(&registry, &snapshot, Some(&repo_root)).await {
                tracing::warn!(error = %e, "passive_bridge tick failed");
            }
        }
    })
}

/// One tick of the bridge. Public for direct unit testing.
///
/// 1. Reap first — drop PASSIVE entries whose PID is no longer live (keeps
///    upsert paths simple and avoids ordering issues with double-listing).
/// 2. Then upsert each live candidate as `PASSIVE-{pid}`, unless a
///    non-PASSIVE entry (KAGENT or launched) already owns the PID (D-07
///    Pitfall 4 — key collision avoidance).
pub async fn bridge_tick(
    registry: &AgentRegistry,
    snapshot: &RwLock<ProcessSnapshot>,
    repo_root: Option<&std::path::Path>,
) -> Result<(), String> {
    let candidates = {
        let snap = snapshot.read().await;
        snap.candidates()
    };

    // Scope passive detection to the watched repo. Previously the bridge
    // upserted every process on the machine matching the allowlist, which
    // filled the 100-agent registry cap in seconds when the user had many
    // unrelated claude processes running. Matches the UI's useScopedAgents
    // rule so the two layers agree on what "in this airspace" means.
    let in_scope: Vec<_> = candidates
        .into_iter()
        .filter(|c| match (repo_root, c.cwd.as_ref()) {
            (Some(root), Some(cwd)) => cwd.starts_with(root),
            _ => true, // no root known -> keep the previous behaviour
        })
        .collect();

    let mut live_pids: HashSet<u32> = HashSet::with_capacity(in_scope.len());
    for c in &in_scope {
        live_pids.insert(c.pid);
    }
    // Reap first: drop PASSIVE entries whose PID is no longer live.
    registry.reap_passive_agents(&live_pids).await;

    // Upsert each live candidate as PASSIVE-{pid}, unless a non-passive entry
    // (e.g., KAGENT) already owns the PID (D-07).
    let mut capacity_hit = 0usize;
    for c in in_scope {
        if let Some(existing) = registry.find_agent_by_pid(c.pid).await {
            if !existing.id.starts_with("PASSIVE-") {
                continue; // KAGENT or launched entry owns this PID; skip.
            }
        }

        // Classify by matching the process name against registered adapter
        // patterns. ProcessSnapshot already filters to allowlisted names so
        // there's usually a hit; fall back to "unknown" for anything that
        // slips through (e.g., future allowlist additions without a matching
        // adapter).
        let matched = registry.find_adapter_for_process(&c.name);
        let agent_type = matched
            .as_ref()
            .map(|a| a.adapter_type().to_string())
            .unwrap_or_else(|| "unknown".into());

        let id = format!("PASSIVE-{}", c.pid);
        let info = AgentInfo {
            id: id.clone(),
            agent_type,
            protocol: "passive-scan".into(),
            state: AgentState::Running,
            pid: Some(c.pid),
            cwd: c.cwd.clone(),
            intent: None,
        };
        // Prefer the matched adapter so get_state / get_intent polls go to
        // the right CLI-specific logic. Fall back to the passive sentinel
        // adapter when nothing matched, so the registry API still works.
        let adapter = matched.unwrap_or_else(passive_sentinel_adapter);
        if let Err(e) = registry.upsert_agent(id, info, adapter, false).await {
            // The capacity-exhaustion case floods the log if we emit one line
            // per skipped candidate (#cap=100, #candidates=500+). Coalesce to
            // a single tick-level warning below.
            if e.contains("at capacity") {
                capacity_hit += 1;
            } else {
                tracing::warn!(pid = c.pid, error = %e, "passive upsert failed");
            }
        }
    }
    if capacity_hit > 0 {
        tracing::warn!(
            skipped = capacity_hit,
            "passive_bridge: registry at capacity, agents skipped this tick (tighten allowlist or raise MAX_AGENTS)"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::process_snapshot::CandidateProc;
    use std::path::PathBuf;

    fn cand(pid: u32, name: &str) -> CandidateProc {
        CandidateProc {
            pid,
            name: name.into(),
            cwd: PathBuf::from("/tmp/test-cwd"),
            exe: None,
            parent: None,
        }
    }

    fn seeded_snapshot(candidates: Vec<CandidateProc>) -> Arc<RwLock<ProcessSnapshot>> {
        Arc::new(RwLock::new(ProcessSnapshot::from_candidates_for_test(candidates)))
    }

    #[tokio::test]
    async fn passive_scan_bridge_upserts_passive_entries_for_live_pids() {
        // Registry with no adapters registered -> fall back to "unknown".
        let reg = Arc::new(AgentRegistry::new());
        let snap = seeded_snapshot(vec![cand(111, "claude-code"), cand(222, "codex")]);
        bridge_tick(&reg, &snap, None).await.unwrap();
        let p1 = reg.get_agent("PASSIVE-111").await.expect("PASSIVE-111 missing");
        assert_eq!(p1.agent_type, "unknown");
        assert_eq!(p1.protocol, "passive-scan");
        assert_eq!(p1.pid, Some(111));
        assert!(reg.get_agent("PASSIVE-222").await.is_some());
    }

    #[tokio::test]
    async fn passive_scan_bridge_classifies_by_registered_adapter() {
        use std::sync::Arc;
        // Registry with real adapters -> passive entries should be typed.
        let mut reg = AgentRegistry::new();
        reg.register_adapter(Arc::new(crate::agents::claude_code::ClaudeCodeAdapter));
        reg.register_adapter(Arc::new(crate::agents::codex::CodexAdapter));
        let reg = Arc::new(reg);

        let snap = seeded_snapshot(vec![cand(111, "claude-code"), cand(222, "codex")]);
        bridge_tick(&reg, &snap, None).await.unwrap();

        let p1 = reg.get_agent("PASSIVE-111").await.expect("PASSIVE-111 missing");
        assert_eq!(p1.agent_type, "claude-code");
        let p2 = reg.get_agent("PASSIVE-222").await.expect("PASSIVE-222 missing");
        assert_eq!(p2.agent_type, "codex");
    }

    #[tokio::test]
    async fn passive_scan_bridge_does_not_overwrite_kagent_with_same_pid() {
        let reg = Arc::new(AgentRegistry::new());
        // Seed a KAGENT at pid=111.
        let adapter = passive_sentinel_adapter();
        reg.upsert_agent(
            "KAGENT-111".into(),
            AgentInfo {
                id: "KAGENT-111".into(),
                agent_type: "claude-code".into(),
                protocol: "http".into(),
                state: AgentState::Running,
                pid: Some(111),
                cwd: None,
                intent: None,
            },
            adapter,
            false,
        )
        .await
        .unwrap();
        let snap = seeded_snapshot(vec![cand(111, "claude-code")]);
        bridge_tick(&reg, &snap, None).await.unwrap();
        assert!(
            reg.get_agent("PASSIVE-111").await.is_none(),
            "must NOT create PASSIVE-111 when KAGENT-111 owns pid"
        );
        assert!(reg.get_agent("KAGENT-111").await.is_some());
    }

    #[tokio::test]
    async fn passive_scan_bridge_reaps_passives_whose_pids_disappear() {
        let reg = Arc::new(AgentRegistry::new());
        let adapter = passive_sentinel_adapter();
        reg.upsert_agent(
            "PASSIVE-333".into(),
            AgentInfo {
                id: "PASSIVE-333".into(),
                agent_type: "unknown".into(),
                protocol: "passive-scan".into(),
                state: AgentState::Running,
                pid: Some(333),
                cwd: None,
                intent: None,
            },
            adapter,
            false,
        )
        .await
        .unwrap();
        // Snapshot shows no live candidates -> reap removes PASSIVE-333.
        let snap = seeded_snapshot(vec![]);
        bridge_tick(&reg, &snap, None).await.unwrap();
        assert!(reg.get_agent("PASSIVE-333").await.is_none());
    }
}
