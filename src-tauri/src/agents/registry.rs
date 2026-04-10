//! Agent registry -- manages active agents via a concurrent HashMap.
//!
//! The registry holds `ManagedAgent` entries keyed by agent ID, protected by
//! `RwLock` for safe concurrent access from async Tauri commands and background
//! tasks.

use crate::agents::adapter::{AgentAdapter, AgentInfo, AgentState};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Maximum number of agents the registry will accept (T-03-03 mitigation).
const MAX_AGENTS: usize = 100;

/// Maximum stdout ring buffer lines per agent.
const MAX_STDOUT_LINES: usize = 1000;

/// A managed agent entry in the registry.
pub struct ManagedAgent {
    pub info: AgentInfo,
    pub adapter: Arc<dyn AgentAdapter>,
    pub launched_by_aitc: bool,
    pub stdout_buffer: Option<VecDeque<String>>,
}

/// Central registry of all known agents.
///
/// Thread-safe via `RwLock<HashMap>`. The `adapters` list holds registered
/// adapter instances for process-name-based detection matching.
pub struct AgentRegistry {
    agents: RwLock<HashMap<String, ManagedAgent>>,
    adapters: Vec<Arc<dyn AgentAdapter>>,
}

impl AgentRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
            adapters: Vec::new(),
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

    /// Find the first adapter whose process_patterns match the given process name.
    /// Matching is lowercased substring, consistent with ProcessSnapshot logic.
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
        async fn launch(&self, _cwd: PathBuf, _intent: Option<String>) -> Result<u32, String> {
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
}
