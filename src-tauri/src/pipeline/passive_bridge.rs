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
use sqlx::{Pool, Sqlite};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

/// Cadence for the passive-bridge tick. 2s balances liveness (PASSIVE entries
/// appear within one cycle of a new agent launch) against registry churn.
pub const BRIDGE_INTERVAL_MS: u64 = 2000;

/// Spawn the passive-scan bridge task. Returns a JoinHandle the caller
/// stores in ActiveWatch so it is aborted when the watch stops.
///
/// `pool` + `app` are `Option` so the bridge can run in headless test
/// harnesses that don't wire up SQLite / a Tauri app handle. When both are
/// `Some`, the bridge emits a `passive-claude-detected` Tauri event on first
/// sighting of a Claude process in a repo whose consent decision isn't
/// already recorded (D-04).
pub fn spawn_passive_bridge(
    registry: Arc<AgentRegistry>,
    snapshot: Arc<RwLock<ProcessSnapshot>>,
    repo_root: PathBuf,
    interval: Duration,
    pool: Option<Pool<Sqlite>>,
    app: Option<AppHandle>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(interval);
        // Skip the immediate first tick so we don't double-fire with the refresher.
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = bridge_tick(
                &registry,
                &snapshot,
                Some(&repo_root),
                pool.as_ref(),
                app.as_ref(),
            )
            .await
            {
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
/// Payload for the `passive-claude-detected` Tauri event (D-04).
///
/// Serialized camelCase so the TS side reads `{cwd, pid, agentId}` directly
/// (the tauri-specta binding emitter ignores event payloads, hence the
/// hand-rolled shape here).
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PassiveClaudeDetectedPayload {
    pub cwd: String,
    pub pid: u32,
    pub agent_id: String,
}

pub async fn bridge_tick(
    registry: &AgentRegistry,
    snapshot: &RwLock<ProcessSnapshot>,
    repo_root: Option<&std::path::Path>,
    pool: Option<&Pool<Sqlite>>,
    app: Option<&AppHandle>,
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

    // Phase 18 D-02: drop subprocess children whose parent is itself an
    // in-scope allowlisted candidate. Prevents Phase 10's MCP-helper /
    // node-shim / aitc-hook amplification from flooding PASSIVE-{pid}
    // entries under each top-level agent. Filter order matters: cwd-scope
    // BEFORE this step so a parent filtered out by cwd does NOT keep its
    // child in-filter (see 18-RESEARCH.md Pitfall 4 / CONTEXT.md D-02).
    //
    // Note: `in_scope` holds `ProcessInfo` (returned by
    // `ProcessSnapshot::candidates()`). The field is `parent_pid`, not
    // `parent` — do not copy the `CandidateProc` field name.
    let candidate_pids: HashSet<u32> = in_scope.iter().map(|c| c.pid).collect();
    // Skeleton: shadow with identity filter; filter logic lands in the
    // next commit.
    let _ = &candidate_pids;
    let in_scope: Vec<_> = in_scope.into_iter().collect();

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
        // Detect whether we've seen this PID before this tick. A brand-new
        // PASSIVE entry is the only moment we emit the D-04 consent event.
        let was_new = registry.get_agent(&id).await.is_none();

        let info = AgentInfo {
            id: id.clone(),
            agent_type: agent_type.clone(),
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
        let upsert_result = registry
            .upsert_agent(id.clone(), info, adapter, false)
            .await;
        if let Err(e) = &upsert_result {
            // The capacity-exhaustion case floods the log if we emit one line
            // per skipped candidate (#cap=100, #candidates=500+). Coalesce to
            // a single tick-level warning below.
            if e.contains("at capacity") {
                capacity_hit += 1;
            } else {
                tracing::warn!(pid = c.pid, error = %e, "passive upsert failed");
            }
        }

        // D-04: offer to install the hook for newly-sighted claude processes.
        // One-shot per (cwd, AITC session): we short-circuit when
        // app_settings already has an entry (accepted or declined). The
        // "declined" sentinel is written immediately after emit so subsequent
        // ticks skip — the frontend accept command overwrites it to
        // "accepted" and runs the install.
        if was_new
            && upsert_result.is_ok()
            && agent_type == "claude-code"
        {
            if let (Some(pool), Some(cwd)) = (pool, c.cwd.as_ref()) {
                let cwd_str = cwd.to_string_lossy().to_string();
                // err-on-the-side-of-no-prompt: if we can't read consent
                // state, assume an entry exists and skip the emit.
                let has_entry = crate::comms::app_settings::has_passive_hook_consent_entry(
                    pool, &cwd_str,
                )
                .await
                .unwrap_or(true);
                if !has_entry {
                    // Fire the Tauri event only when an app handle is
                    // available. Tests drive bridge_tick with `app=None` but
                    // still want the sentinel written so they can assert the
                    // dedup behaviour without spinning up a Tauri runtime.
                    if let Some(app) = app {
                        let payload = PassiveClaudeDetectedPayload {
                            cwd: cwd_str.clone(),
                            pid: c.pid,
                            agent_id: id.clone(),
                        };
                        use tauri::Emitter;
                        if let Err(e) = app.emit("passive-claude-detected", payload) {
                            tracing::warn!(
                                error = %e,
                                "passive-claude-detected emit failed"
                            );
                        }
                    }
                    // Write the dedup sentinel so we never re-emit for this
                    // repo until the user makes a choice (accept flips it
                    // to "accepted"; decline leaves it as-is).
                    if let Err(e) = crate::comms::app_settings::record_passive_hook_consent(
                        pool, &cwd_str, "declined",
                    )
                    .await
                    {
                        tracing::warn!(
                            cwd = %cwd_str,
                            error = %e,
                            "failed to write consent dedup sentinel"
                        );
                    }
                }
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

    fn cand_with_parent(pid: u32, name: &str, parent_pid: u32) -> CandidateProc {
        CandidateProc {
            pid,
            name: name.into(),
            cwd: PathBuf::from("/tmp/test-cwd"),
            exe: None,
            parent: Some(parent_pid),
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
        bridge_tick(&reg, &snap, None, None, None).await.unwrap();
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
        bridge_tick(&reg, &snap, None, None, None).await.unwrap();

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
        bridge_tick(&reg, &snap, None, None, None).await.unwrap();
        assert!(
            reg.get_agent("PASSIVE-111").await.is_none(),
            "must NOT create PASSIVE-111 when KAGENT-111 owns pid"
        );
        assert!(reg.get_agent("KAGENT-111").await.is_some());
    }

    // ------------------------------------------------------------------
    // D-04 event-emission coverage. These drive the new bridge_tick args.
    // ------------------------------------------------------------------

    async fn consent_pool() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::comms::app_settings::ensure_schema(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn passive_bridge_writes_dedup_sentinel_on_first_claude_sighting() {
        // With a consent pool + no app handle, we still exercise the
        // dedup-sentinel write path. The emit is a no-op (app=None) but the
        // sentinel must still land so the next tick doesn't re-attempt.
        let mut reg = AgentRegistry::new();
        reg.register_adapter(Arc::new(crate::agents::claude_code::ClaudeCodeAdapter));
        let reg = Arc::new(reg);
        let pool = consent_pool().await;
        let snap = seeded_snapshot(vec![cand(1111, "claude-code")]);
        // First tick: no entry exists -> sentinel written.
        bridge_tick(&reg, &snap, None, Some(&pool), None)
            .await
            .unwrap();
        assert!(
            crate::comms::app_settings::has_passive_hook_consent_entry(
                &pool,
                "/tmp/test-cwd",
            )
            .await
            .unwrap(),
            "sentinel must be written after first sighting"
        );
    }

    #[tokio::test]
    async fn passive_bridge_dedups_after_decision() {
        // Pre-record accepted; bridge_tick must NOT overwrite it.
        let mut reg = AgentRegistry::new();
        reg.register_adapter(Arc::new(crate::agents::claude_code::ClaudeCodeAdapter));
        let reg = Arc::new(reg);
        let pool = consent_pool().await;
        crate::comms::app_settings::record_passive_hook_consent(
            &pool,
            "/tmp/test-cwd",
            "accepted",
        )
        .await
        .unwrap();
        let snap = seeded_snapshot(vec![cand(2222, "claude-code")]);
        bridge_tick(&reg, &snap, None, Some(&pool), None)
            .await
            .unwrap();
        let rows = crate::comms::app_settings::get_passive_hook_consent_repos(&pool)
            .await
            .unwrap();
        // Still exactly one row and still "accepted" — no overwrite to
        // "declined" by the sentinel path.
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, "accepted");
    }

    #[tokio::test]
    async fn passive_bridge_skips_emit_for_non_claude_agent_type() {
        // Codex sightings must never trigger a consent prompt (D-04 is
        // Claude-specific — only Claude reads settings.local.json).
        let mut reg = AgentRegistry::new();
        reg.register_adapter(Arc::new(crate::agents::codex::CodexAdapter));
        let reg = Arc::new(reg);
        let pool = consent_pool().await;
        let snap = seeded_snapshot(vec![cand(3333, "codex")]);
        bridge_tick(&reg, &snap, None, Some(&pool), None)
            .await
            .unwrap();
        assert!(
            !crate::comms::app_settings::has_passive_hook_consent_entry(
                &pool,
                "/tmp/test-cwd",
            )
            .await
            .unwrap(),
            "Codex sightings must not trigger D-04 consent dedup"
        );
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
        bridge_tick(&reg, &snap, None, None, None).await.unwrap();
        assert!(reg.get_agent("PASSIVE-333").await.is_none());
    }
}
