//! Tauri command surface for agent management (Phase 3, Plan 02).
//!
//! Commands:
//!   - list_agents() -> Vec<AgentInfo>
//!   - launch_agent(agent_type, cwd, intent) -> AgentInfo
//!   - terminate_agent(agent_id) -> ()
//!   - update_agent_intent(agent_id, intent) -> ()
//!   - get_agent_logs(agent_id) -> Vec<String>

use crate::agents::adapter::{AgentInfo, AgentState};
use crate::agents::launcher;
use crate::agents::registry::AgentRegistry;
use std::path::PathBuf;
use std::sync::Arc;

/// List all currently tracked agents.
#[tauri::command]
#[specta::specta]
pub async fn list_agents(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<AgentInfo>, String> {
    Ok(registry.all_agents().await)
}

/// Launch a new agent of the given type in the specified working directory.
///
/// T-03-05 mitigations:
/// - Validates cwd exists and is a directory.
/// - Only launches binaries matched by registered adapters (no arbitrary PATH exec).
#[tauri::command]
#[specta::specta]
pub async fn launch_agent(
    agent_type: String,
    cwd: String,
    intent: Option<String>,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<AgentInfo, String> {
    // T-03-05: Validate cwd -- canonicalize to resolve symlinks and `..` components,
    // preventing path traversal attacks.
    let cwd_path = PathBuf::from(&cwd)
        .canonicalize()
        .map_err(|e| format!("cwd is invalid or inaccessible: {e}"))?;
    if !cwd_path.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd_path.display()));
    }

    // T-03-05: Find adapter by exact agent_type -- reject unknown types.
    // Uses exact match (not substring) to prevent "code" matching "claude-code".
    let adapter = registry
        .find_adapter_by_type(&agent_type)
        .ok_or_else(|| {
            format!("No registered adapter for agent type '{agent_type}'")
        })?;

    // Launch via the adapter -- returns (pid, child) so we can read stdout
    let (pid, child) = adapter.launch(cwd_path.clone(), intent.clone()).await?;

    // Generate agent ID
    let agent_id = format!("KAGENT-{:04}", pid % 10000);

    let info = AgentInfo {
        id: agent_id.clone(),
        agent_type: adapter.adapter_type().to_string(),
        protocol: "cli".to_string(),
        state: AgentState::Running,
        pid: Some(pid),
        cwd: Some(cwd_path),
        intent,
    };

    registry
        .upsert_agent(agent_id.clone(), info.clone(), adapter, true)
        .await?;

    // Spawn stdout reader so agent logs are captured into the ring buffer
    launcher::spawn_stdout_reader(child, agent_id, registry.inner().clone());

    Ok(info)
}

/// Terminate a running agent by ID.
///
/// T-03-06 mitigation: Only terminates processes tracked in the registry.
/// Will not kill arbitrary PIDs.
#[tauri::command]
#[specta::specta]
pub async fn terminate_agent(
    agent_id: String,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<(), String> {
    let info = registry
        .get_agent(&agent_id)
        .await
        .ok_or_else(|| format!("Agent '{agent_id}' not found"))?;

    let pid = info
        .pid
        .ok_or_else(|| format!("Agent '{agent_id}' has no PID"))?;

    // Terminate the process
    launcher::terminate_process(pid).await?;

    // Remove from registry
    registry.remove_agent(&agent_id).await;

    Ok(())
}

/// Update an agent's intent/task description (manual labeling per D-08 fallback).
#[tauri::command]
#[specta::specta]
pub async fn update_agent_intent(
    agent_id: String,
    intent: String,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<(), String> {
    // Verify agent exists
    if registry.get_agent(&agent_id).await.is_none() {
        return Err(format!("Agent '{agent_id}' not found"));
    }
    registry.update_intent(&agent_id, intent).await;
    Ok(())
}

/// Get the stdout log buffer for an agent.
///
/// T-03-08: accepted risk -- logs are local process output.
#[tauri::command]
#[specta::specta]
pub async fn get_agent_logs(
    agent_id: String,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<String>, String> {
    Ok(launcher::read_stdout_buffer(&registry, &agent_id).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn list_agents_returns_empty_for_new_registry() {
        let registry = AgentRegistry::new();
        let all = registry.all_agents().await;
        assert!(all.is_empty());
    }
}
