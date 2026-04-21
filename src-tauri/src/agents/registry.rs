//! Agent registry -- manages active agents via a concurrent HashMap.
//!
//! The registry holds `ManagedAgent` entries keyed by agent ID, protected by
//! `RwLock` for safe concurrent access from async Tauri commands and background
//! tasks.

use crate::agents::adapter::{AgentAdapter, AgentInfo, AgentState};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Maximum number of agents the registry will accept (T-03-03 mitigation).
///
/// Raised 100 → 1000 pending Phase 18 (passive-scan flooding). The original
/// 100 was set when passive detection was young and the worst case was a
/// couple of PASSIVE-{pid} entries per repo. Phase 10's long-lived sessions
/// + any developer running multiple claude CLIs machine-wide overflow it
/// within seconds of boot. 1000 is a cheap safety net — HashMap handles it
/// trivially — and Phase 18 will properly scope passive registration.
const MAX_AGENTS: usize = 1000;

/// Maximum stdout ring buffer lines per agent.
const MAX_STDOUT_LINES: usize = 1000;

/// A managed agent entry in the registry.
pub struct ManagedAgent {
    pub info: AgentInfo,
    pub adapter: Arc<dyn AgentAdapter>,
    pub launched_by_aitc: bool,
    pub stdout_buffer: Option<VecDeque<String>>,
}

/// Read-only diagnostic snapshot of the agent registry (Phase 18 D-04).
///
/// Counts are derived by ID-prefix convention (`PASSIVE-*`, `KAGENT-*`);
/// `launched_count` is orthogonal and counts entries with
/// `launched_by_aitc = true`. `capacity_hits_since_start` is the lifetime
/// monotonic counter incremented on every `upsert_agent` at-capacity
/// failure since this `AgentRegistry` was constructed.
///
/// Intended for post-hoc debugging of "why did a launch fail with
/// 'Registry at capacity'?" questions. Safe to call at any cadence —
/// the backing `snapshot_stats()` method acquires only the read lock +
/// one atomic load (see Pitfall 7 / T-18-02).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RegistryStats {
    pub total_agents: u32,
    pub passive_count: u32,
    pub kagent_count: u32,
    pub launched_count: u32,
    pub capacity_hits_since_start: u64,
}

/// Central registry of all known agents.
///
/// Thread-safe via `RwLock<HashMap>`. The `adapters` list holds registered
/// adapter instances for process-name-based detection matching.
pub struct AgentRegistry {
    agents: RwLock<HashMap<String, ManagedAgent>>,
    adapters: Vec<Arc<dyn AgentAdapter>>,
    /// Phase 18 D-04: monotonic lifetime counter of `upsert_agent`
    /// at-capacity failures. Read via `snapshot_stats()`; never resets.
    /// Outlives `ActiveWatch` lifecycles — counts for the entire AITC
    /// process. `Ordering::Relaxed` because no happens-before relationship
    /// with other memory is required (pure diagnostic gauge).
    capacity_hits_since_start: AtomicU64,
}

impl AgentRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
            adapters: Vec::new(),
            capacity_hits_since_start: AtomicU64::new(0),
        }
    }

    /// Register an adapter for process-name-based detection.
    pub fn register_adapter(&mut self, adapter: Arc<dyn AgentAdapter>) {
        self.adapters.push(adapter);
    }

    /// Insert or update an agent in the registry.
    ///
    /// If the agent already exists by ID, updates info fields but preserves
    /// the stdout_buffer (self-registration enrichment per Pitfall 5).
    /// Returns Err if registry is at capacity (T-03-03).
    pub async fn upsert_agent(
        &self,
        id: String,
        info: AgentInfo,
        adapter: Arc<dyn AgentAdapter>,
        launched_by_aitc: bool,
    ) -> Result<(), String> {
        let mut agents = self.agents.write().await;
        if let Some(existing) = agents.get_mut(&id) {
            // Merge: update info but keep stdout_buffer
            existing.info = info;
            existing.adapter = adapter;
            existing.launched_by_aitc = launched_by_aitc;
            Ok(())
        } else {
            if agents.len() >= MAX_AGENTS {
                // Phase 18 D-04: count every at-capacity failure for lifetime
                // observability via `snapshot_stats()` / `get_registry_stats`.
                // Atomic Relaxed increment; no additional lock acquisition
                // (write-lock on `agents` already held here).
                self.capacity_hits_since_start
                    .fetch_add(1, Ordering::Relaxed);
                return Err(format!(
                    "Registry at capacity ({MAX_AGENTS}). Cannot add agent '{id}'"
                ));
            }
            agents.insert(
                id,
                ManagedAgent {
                    info,
                    adapter,
                    launched_by_aitc,
                    stdout_buffer: Some(VecDeque::with_capacity(MAX_STDOUT_LINES)),
                },
            );
            Ok(())
        }
    }

    /// Remove an agent from the registry, returning it if found.
    pub async fn remove_agent(&self, id: &str) -> Option<ManagedAgent> {
        self.agents.write().await.remove(id)
    }

    /// Find any agent (PASSIVE or KAGENT or launched) whose info.pid matches.
    /// Scans the full map; registry is capped at MAX_AGENTS so O(n) is fine.
    #[allow(dead_code)]
    pub async fn find_agent_by_pid(&self, pid: u32) -> Option<AgentInfo> {
        let agents = self.agents.read().await;
        for (_id, managed) in agents.iter() {
            if managed.info.pid == Some(pid) {
                return Some(managed.info.clone());
            }
        }
        None
    }

    /// Remove all PASSIVE-{pid} entries whose pid is NOT in `live_pids`.
    /// Never touches non-PASSIVE keys. Returns the count of removed entries.
    #[allow(dead_code)]
    pub async fn reap_passive_agents(&self, live_pids: &std::collections::HashSet<u32>) -> usize {
        let mut agents = self.agents.write().await;
        let stale: Vec<String> = agents
            .iter()
            .filter(|(id, managed)| {
                id.starts_with("PASSIVE-")
                    && managed
                        .info
                        .pid
                        .map(|p| !live_pids.contains(&p))
                        .unwrap_or(true)
            })
            .map(|(id, _)| id.clone())
            .collect();
        let n = stale.len();
        for id in stale {
            agents.remove(&id);
        }
        n
    }

    /// Get a clone of an agent's info by ID.
    pub async fn get_agent(&self, id: &str) -> Option<AgentInfo> {
        self.agents.read().await.get(id).map(|a| a.info.clone())
    }

    /// Get info for all agents in the registry.
    pub async fn all_agents(&self) -> Vec<AgentInfo> {
        self.agents
            .read()
            .await
            .values()
            .map(|a| a.info.clone())
            .collect()
    }

    /// Phase 18 D-04: read-only diagnostic snapshot of registry state.
    ///
    /// Single read-lock acquisition + one atomic load. Does NOT contend
    /// with `upsert_agent`'s write path (T-18-02). Load the atomic BEFORE
    /// the read lock so any concurrent upsert failure this call races
    /// with is reflected in the NEXT call, not this one —
    /// monotonic-lagging semantics, never "from the future"
    /// (see 18-RESEARCH.md Pitfall 7).
    ///
    /// Counts are derived by ID prefix (`PASSIVE-*`, `KAGENT-*`) and by
    /// `launched_by_aitc = true`. `launched_count` is orthogonal — a
    /// launched agent has a `KAGENT-` ID and `launched_by_aitc = true`,
    /// so it appears in BOTH `kagent_count` and `launched_count`. That
    /// is intentional; the counts answer different questions.
    pub async fn snapshot_stats(&self) -> RegistryStats {
        let capacity_hits_since_start =
            self.capacity_hits_since_start.load(Ordering::Relaxed);
        let agents = self.agents.read().await;
        let total_agents = agents.len() as u32;
        let mut passive_count = 0u32;
        let mut kagent_count = 0u32;
        let mut launched_count = 0u32;
        for (id, managed) in agents.iter() {
            if id.starts_with("PASSIVE-") {
                passive_count += 1;
            } else if id.starts_with("KAGENT-") {
                kagent_count += 1;
            }
            if managed.launched_by_aitc {
                launched_count += 1;
            }
        }
        RegistryStats {
            total_agents,
            passive_count,
            kagent_count,
            launched_count,
            capacity_hits_since_start,
        }
    }

    /// Update an agent's state. Logs a warning if the transition is invalid
    /// per the state machine, but applies it anyway.
    pub async fn update_state(&self, id: &str, state: AgentState) {
        let mut agents = self.agents.write().await;
        if let Some(agent) = agents.get_mut(id) {
            if !agent.info.state.can_transition_to(&state) {
                tracing::warn!(
                    agent_id = id,
                    from = ?agent.info.state,
                    to = ?state,
                    "Invalid state transition (applying anyway)"
                );
            }
            agent.info.state = state;
        }
    }

    /// Update an agent's intent description.
    pub async fn update_intent(&self, id: &str, intent: String) {
        let mut agents = self.agents.write().await;
        if let Some(agent) = agents.get_mut(id) {
            agent.info.intent = Some(intent);
        }
    }

    /// Get read access to the agents map (for stdout buffer reads).
    pub async fn agents_read(
        &self,
    ) -> tokio::sync::RwLockReadGuard<'_, HashMap<String, ManagedAgent>> {
        self.agents.read().await
    }

    /// Get write access to the agents map (for stdout buffer writes).
    pub async fn agents_write(
        &self,
    ) -> tokio::sync::RwLockWriteGuard<'_, HashMap<String, ManagedAgent>> {
        self.agents.write().await
    }

    /// Find adapter by exact `adapter_type()` match. Used for explicit agent launches
    /// where the caller specifies the agent type string directly.
    pub fn find_adapter_by_type(&self, agent_type: &str) -> Option<Arc<dyn AgentAdapter>> {
        self.adapters
            .iter()
            .find(|a| a.adapter_type() == agent_type)
            .cloned()
    }

    /// Adapter types whose launch binary resolves on the current PATH.
    /// Used by the UI to hide agent types whose CLI isn't installed so the
    /// user can't pick a launch that is guaranteed to fail.
    pub fn available_adapter_types(&self) -> Vec<String> {
        self.adapters
            .iter()
            .filter(|a| binary_on_path(&a.launch_binary()))
            .map(|a| a.adapter_type().to_string())
            .collect()
    }

    /// Find the first adapter whose process_patterns match the given process name.
    /// Matching is lowercased substring, consistent with ProcessSnapshot logic.
    /// Used for process-scan detection, NOT for explicit launch-by-type.
    pub fn find_adapter_for_process(&self, process_name: &str) -> Option<Arc<dyn AgentAdapter>> {
        let lower = process_name.to_lowercase();
        self.adapters
            .iter()
            .find(|a| {
                a.process_patterns()
                    .iter()
                    .any(|p| lower.contains(&p.to_lowercase()))
            })
            .cloned()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Check whether `name` resolves to an executable on the current `PATH`.
///
/// Absolute paths are checked directly. On Windows, extensions from `PATHEXT`
/// (with sensible fallbacks) are tried in addition to the bare name.
fn binary_on_path(name: &str) -> bool {
    let path_buf = std::path::Path::new(name);
    if path_buf.is_absolute() {
        return path_buf.is_file();
    }

    let exe_candidates: Vec<String> = if cfg!(windows) {
        let pathext = std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".to_string());
        let mut out = vec![name.to_string()];
        for ext in pathext.split(';').filter(|e| !e.is_empty()) {
            // Avoid double-extension if user already passed one in
            if name.to_ascii_lowercase().ends_with(&ext.to_ascii_lowercase()) {
                continue;
            }
            out.push(format!("{name}{ext}"));
        }
        out
    } else {
        vec![name.to_string()]
    };

    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    for dir in std::env::split_paths(&paths) {
        for candidate in &exe_candidates {
            let full = dir.join(candidate);
            if full.is_file() {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::adapter::{AgentAdapter, AgentInfo, AgentState};
    use async_trait::async_trait;
    use std::path::PathBuf;

    /// Minimal test adapter for registry tests.
    struct TestAdapter {
        name: String,
        patterns: Vec<String>,
    }

    impl TestAdapter {
        fn new(name: &str, patterns: Vec<&str>) -> Self {
            Self {
                name: name.to_string(),
                patterns: patterns.into_iter().map(String::from).collect(),
            }
        }
    }

    #[async_trait]
    impl AgentAdapter for TestAdapter {
        fn adapter_type(&self) -> &str {
            &self.name
        }
        fn process_patterns(&self) -> Vec<String> {
            self.patterns.clone()
        }
        fn launch_binary(&self) -> String {
            self.name.clone()
        }
        async fn launch(
            &self,
            _cwd: PathBuf,
            _intent: Option<String>,
            _options: crate::agents::adapter::LaunchOptions,
        ) -> Result<(u32, tokio::process::Child), String> {
            Err("test adapter".to_string())
        }
        async fn get_state(&self, _pid: u32) -> AgentState {
            AgentState::Running
        }
        async fn get_intent(&self, _pid: u32) -> Option<String> {
            None
        }
        async fn terminate(&self, _pid: u32) -> Result<(), String> {
            Err("test adapter".to_string())
        }
    }

    fn make_info(id: &str, agent_type: &str) -> AgentInfo {
        AgentInfo {
            id: id.to_string(),
            agent_type: agent_type.to_string(),
            protocol: "test".to_string(),
            state: AgentState::Running,
            pid: Some(1234),
            cwd: Some(PathBuf::from("/test")),
            intent: None,
        }
    }

    #[tokio::test]
    async fn upsert_agent_adds_and_get_returns() {
        let reg = AgentRegistry::new();
        let adapter: Arc<dyn AgentAdapter> = Arc::new(TestAdapter::new("test", vec!["test"]));
        let info = make_info("a1", "test");
        reg.upsert_agent("a1".to_string(), info, adapter, false)
            .await
            .unwrap();
        let result = reg.get_agent("a1").await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "a1");
    }

    #[tokio::test]
    async fn remove_agent_removes_and_get_returns_none() {
        let reg = AgentRegistry::new();
        let adapter: Arc<dyn AgentAdapter> = Arc::new(TestAdapter::new("test", vec!["test"]));
        let info = make_info("a1", "test");
        reg.upsert_agent("a1".to_string(), info, adapter, false)
            .await
            .unwrap();
        let removed = reg.remove_agent("a1").await;
        assert!(removed.is_some());
        assert!(reg.get_agent("a1").await.is_none());
    }

    #[tokio::test]
    async fn all_agents_returns_all() {
        let reg = AgentRegistry::new();
        let adapter: Arc<dyn AgentAdapter> = Arc::new(TestAdapter::new("test", vec!["test"]));
        reg.upsert_agent(
            "a1".to_string(),
            make_info("a1", "test"),
            adapter.clone(),
            false,
        )
        .await
        .unwrap();
        reg.upsert_agent(
            "a2".to_string(),
            make_info("a2", "test"),
            adapter.clone(),
            true,
        )
        .await
        .unwrap();
        let all = reg.all_agents().await;
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn upsert_same_id_merges_updates() {
        let reg = AgentRegistry::new();
        let adapter: Arc<dyn AgentAdapter> = Arc::new(TestAdapter::new("test", vec!["test"]));
        let info1 = make_info("a1", "test");
        reg.upsert_agent("a1".to_string(), info1, adapter.clone(), false)
            .await
            .unwrap();

        // Update with new intent
        let mut info2 = make_info("a1", "test");
        info2.intent = Some("new task".to_string());
        reg.upsert_agent("a1".to_string(), info2, adapter.clone(), true)
            .await
            .unwrap();

        let result = reg.get_agent("a1").await.unwrap();
        assert_eq!(result.intent.as_deref(), Some("new task"));
        // Should still be 1 agent, not 2
        assert_eq!(reg.all_agents().await.len(), 1);
    }

    mod merge_by_pid {
        use super::*;

        fn info_with_pid(id: &str, pid: Option<u32>) -> AgentInfo {
            AgentInfo {
                id: id.into(),
                agent_type: "unknown".into(),
                protocol: "test".into(),
                state: AgentState::Running,
                pid,
                cwd: None,
                intent: None,
            }
        }

        fn dummy_adapter() -> Arc<dyn AgentAdapter> {
            Arc::new(TestAdapter::new("dummy", vec!["dummy"]))
        }

        #[tokio::test]
        async fn find_agent_by_pid_returns_kagent_when_pids_match() {
            let reg = AgentRegistry::new();
            let adapter = dummy_adapter();
            reg.upsert_agent(
                "KAGENT-1234".into(),
                info_with_pid("KAGENT-1234", Some(1234)),
                adapter.clone(),
                false,
            )
            .await
            .unwrap();
            reg.upsert_agent(
                "PASSIVE-5678".into(),
                info_with_pid("PASSIVE-5678", Some(5678)),
                adapter.clone(),
                false,
            )
            .await
            .unwrap();
            let found = reg.find_agent_by_pid(1234).await.unwrap();
            assert_eq!(found.id, "KAGENT-1234");
        }

        #[tokio::test]
        async fn find_agent_by_pid_returns_none_when_no_match() {
            let reg = AgentRegistry::new();
            assert!(reg.find_agent_by_pid(9999).await.is_none());
        }

        #[tokio::test]
        async fn find_agent_by_pid_finds_passive() {
            let reg = AgentRegistry::new();
            let adapter = dummy_adapter();
            reg.upsert_agent(
                "PASSIVE-5678".into(),
                info_with_pid("PASSIVE-5678", Some(5678)),
                adapter,
                false,
            )
            .await
            .unwrap();
            let found = reg.find_agent_by_pid(5678).await.unwrap();
            assert_eq!(found.id, "PASSIVE-5678");
        }

        #[tokio::test]
        async fn reap_drops_dead_passives() {
            use std::collections::HashSet;
            let reg = AgentRegistry::new();
            let adapter = dummy_adapter();
            for (id, pid) in [("PASSIVE-100", 100u32), ("PASSIVE-200", 200u32)] {
                reg.upsert_agent(id.into(), info_with_pid(id, Some(pid)), adapter.clone(), false)
                    .await
                    .unwrap();
            }
            reg.upsert_agent(
                "KAGENT-300".into(),
                info_with_pid("KAGENT-300", Some(300)),
                adapter.clone(),
                false,
            )
            .await
            .unwrap();
            let live: HashSet<u32> = [200, 300].into_iter().collect();
            let removed = reg.reap_passive_agents(&live).await;
            assert_eq!(removed, 1);
            assert!(reg.get_agent("PASSIVE-100").await.is_none());
            assert!(reg.get_agent("PASSIVE-200").await.is_some());
            assert!(reg.get_agent("KAGENT-300").await.is_some());
        }

        #[tokio::test]
        async fn reap_drops_dead_passives_never_removes_kagent() {
            use std::collections::HashSet;
            let reg = AgentRegistry::new();
            let adapter = dummy_adapter();
            reg.upsert_agent(
                "KAGENT-999".into(),
                info_with_pid("KAGENT-999", Some(999)),
                adapter,
                false,
            )
            .await
            .unwrap();
            let live: HashSet<u32> = HashSet::new();
            reg.reap_passive_agents(&live).await;
            assert!(reg.get_agent("KAGENT-999").await.is_some());
        }
    }

    // -----------------------------------------------------------------------
    // Phase 18 D-04: capacity-hit counter + snapshot_stats tests.
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn capacity_hit_increments_counter() {
        let reg = AgentRegistry::new();
        let adapter: Arc<dyn AgentAdapter> =
            Arc::new(TestAdapter::new("test", vec!["test"]));

        assert_eq!(
            reg.snapshot_stats().await.capacity_hits_since_start,
            0,
            "fresh registry should report 0 capacity hits"
        );

        // Fill to MAX_AGENTS (1000). All inserts share pid=Some(1234); that's
        // fine — capacity is keyed on HashMap length (unique IDs), not PID.
        for i in 0..1000 {
            let id = format!("a{i}");
            reg.upsert_agent(
                id.clone(),
                make_info(&id, "test"),
                adapter.clone(),
                false,
            )
            .await
            .expect("insert within capacity should succeed");
        }
        assert_eq!(reg.all_agents().await.len(), 1000);

        // 1001st should fail and bump the counter by 1.
        let err = reg
            .upsert_agent(
                "overflow".into(),
                make_info("overflow", "test"),
                adapter.clone(),
                false,
            )
            .await
            .expect_err("at capacity should return Err");
        assert!(
            err.contains("at capacity"),
            "error must mention capacity: {err}"
        );
        assert_eq!(
            reg.snapshot_stats().await.capacity_hits_since_start,
            1,
            "first overflow should bump counter to 1"
        );

        // Second overflow bumps to 2 (counter is monotonic).
        let _ = reg
            .upsert_agent(
                "overflow2".into(),
                make_info("overflow2", "test"),
                adapter,
                false,
            )
            .await;
        assert_eq!(
            reg.snapshot_stats().await.capacity_hits_since_start,
            2,
            "second overflow should bump counter to 2"
        );
    }
}

