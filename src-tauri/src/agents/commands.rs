//! Tauri command surface for agent management (Phase 3, Plan 02).
//!
//! Commands:
//!   - list_agents() -> Vec<AgentInfo>
//!   - launch_agent(agent_type, cwd, intent) -> AgentInfo
//!   - terminate_agent(agent_id) -> ()
//!   - update_agent_intent(agent_id, intent) -> ()
//!   - get_agent_logs(agent_id) -> Vec<String>

use crate::agents::adapter::{AgentInfo, AgentState, LaunchOptions};
use crate::agents::hook_waiters::{HookDecision, WaiterRegistry};
use crate::agents::launcher;
use crate::agents::registry::AgentRegistry;
use crate::pipeline::pipeline_state::PipelineState;
use sqlx::{Pool, Sqlite};
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

/// List adapter types whose launch binary resolves on PATH.
///
/// Used by the Deploy dialog to hide agent types that aren't installed,
/// so users can't select launches that are guaranteed to fail.
#[tauri::command]
#[specta::specta]
pub async fn list_available_agent_types(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<String>, String> {
    Ok(registry.available_adapter_types())
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
    options: Option<LaunchOptions>,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
    pipeline: tauri::State<'_, PipelineState>,
) -> Result<AgentInfo, String> {
    // T-03-05: Validate cwd -- canonicalize to resolve symlinks and `..` components,
    // preventing path traversal attacks.
    let cwd_path = PathBuf::from(&cwd)
        .canonicalize()
        .map_err(|e| format!("cwd is invalid or inaccessible: {e}"))?;
    if !cwd_path.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd_path.display()));
    }

    // Constrain launches to the currently watched repo. Anything outside it
    // would spawn an agent whose edits AITC can't observe -- the whole point
    // of the tool. If no watch is active we allow the launch (the radar view
    // already refuses to do useful work without one, so the user will see the
    // missing context before the agent does damage).
    if let Some(active) = pipeline.inner.lock().await.as_ref() {
        if !cwd_path.starts_with(&active.repo_root) {
            return Err(format!(
                "cwd {} is outside the watched repo {}. \
                 Point the agent at the monitored directory or a subdirectory.",
                cwd_path.display(),
                active.repo_root.display(),
            ));
        }
    }

    // T-03-05: Find adapter by exact agent_type -- reject unknown types.
    // Uses exact match (not substring) to prevent "code" matching "claude-code".
    let adapter = registry
        .find_adapter_by_type(&agent_type)
        .ok_or_else(|| {
            format!("No registered adapter for agent type '{agent_type}'")
        })?;

    // Launch via the adapter -- returns (pid, child) so we can read stdout
    let (pid, child) = adapter
        .launch(
            cwd_path.clone(),
            intent.clone(),
            options.unwrap_or_default(),
        )
        .await?;

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
///
/// Phase 8 D-10 force-deny: signals every pending hook waiter for this
/// agent with `HookDecision::Deny("agent terminated by user")` BEFORE the
/// OS kill. This prevents the EPIPE race where the sidecar dies mid-read
/// and Claude hangs waiting for a response that will never come. Also
/// clears the agent's always-allow set and session bindings so a
/// reconnection doesn't resurrect stale state.
#[tauri::command]
#[specta::specta]
pub async fn terminate_agent(
    agent_id: String,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
    waiters: tauri::State<'_, Arc<WaiterRegistry>>,
) -> Result<(), String> {
    let info = registry
        .get_agent(&agent_id)
        .await
        .ok_or_else(|| format!("Agent '{agent_id}' not found"))?;

    let pid = info
        .pid
        .ok_or_else(|| format!("Agent '{agent_id}' has no PID"))?;

    // D-10: force-deny BEFORE the OS kill so the sidecar gets a decision.
    waiters
        .signal_for_agent(
            &agent_id,
            HookDecision::Deny("agent terminated by user".into()),
        )
        .await;
    waiters.clear_always_allow_for_agent(&agent_id).await;
    waiters.clear_session_bindings_for_agent(&agent_id).await;

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

// ---------------------------------------------------------------------------
// Phase 8 Plan 04: passive-claude-detected consent flow + sidecar resolution.
// ---------------------------------------------------------------------------

/// Resolve the absolute path of the `aitc-hook` sidecar binary at runtime.
///
/// Tauri v2 stages sidecars next to the main executable with the target-triple
/// suffix stripped, so `ShellExt::sidecar("aitc-hook")` is the canonical way to
/// resolve the path (dev builds use `target/debug/aitc-hook`; bundled releases
/// use the staged copy in the app's exec dir).
#[tauri::command]
#[specta::specta]
pub async fn resolve_sidecar_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    let cmd = app_handle
        .shell()
        .sidecar("aitc-hook")
        .map_err(|e| format!("sidecar lookup: {e}"))?;
    let std_cmd: std::process::Command = cmd.into();
    let program = std_cmd.get_program().to_string_lossy().to_string();
    if program.is_empty() {
        return Err("sidecar path resolution returned empty".into());
    }
    Ok(program)
}

/// Accept the passive-detected Claude hook consent prompt for `repo_cwd`:
/// records the decision in `app_settings` AND installs the AITC PreToolUse
/// hook into `<repo_cwd>/.claude/settings.local.json`.
#[tauri::command]
#[specta::specta]
pub async fn accept_passive_hook_consent(
    repo_cwd: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::comms::app_settings::record_passive_hook_consent(pool.inner(), &repo_cwd, "accepted")
        .await?;
    let sidecar_abs = resolve_sidecar_path(app_handle.clone()).await?;
    crate::agents::hook_install::install_aitc_hook(
        std::path::Path::new(&repo_cwd),
        &sidecar_abs,
    )?;
    Ok(())
}

/// Decline the passive-detected Claude hook consent prompt for `repo_cwd`:
/// records the decision so we never re-prompt. Does NOT install the hook.
#[tauri::command]
#[specta::specta]
pub async fn decline_passive_hook_consent(
    repo_cwd: String,
    pool: tauri::State<'_, Pool<Sqlite>>,
) -> Result<(), String> {
    crate::comms::app_settings::record_passive_hook_consent(pool.inner(), &repo_cwd, "declined")
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;

    #[tokio::test]
    async fn list_agents_returns_empty_for_new_registry() {
        let registry = AgentRegistry::new();
        let all = registry.all_agents().await;
        assert!(all.is_empty());
    }

    // The accept/decline commands take `tauri::State<'_, Pool<Sqlite>>` which
    // can't be constructed outside a running Tauri runtime. Tests below
    // exercise the command bodies' core steps — app_settings upsert +
    // install — directly so we still cover the side-effects end-to-end.

    async fn fresh_pool() -> Pool<Sqlite> {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn accept_passive_hook_consent_writes_settings_local() {
        let pool = fresh_pool().await;
        let td = TempDir::new().unwrap();
        let cwd = td.path().to_str().unwrap().to_string();

        // Simulate the command body: record consent, then install with a
        // fake sidecar path (install doesn't validate the path exists).
        crate::comms::app_settings::record_passive_hook_consent(&pool, &cwd, "accepted")
            .await
            .unwrap();
        crate::agents::hook_install::install_aitc_hook(
            td.path(),
            "/fake/test/sidecar/aitc-hook",
        )
        .unwrap();

        assert!(td.path().join(".claude/settings.local.json").exists());
        assert!(
            crate::comms::app_settings::has_passive_hook_consent_entry(&pool, &cwd)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn decline_passive_hook_consent_records_only() {
        let pool = fresh_pool().await;
        let td = TempDir::new().unwrap();
        let cwd = td.path().to_str().unwrap().to_string();

        crate::comms::app_settings::record_passive_hook_consent(&pool, &cwd, "declined")
            .await
            .unwrap();

        assert!(
            !td.path().join(".claude/settings.local.json").exists(),
            "decline must not write settings.local.json"
        );
        let rows = crate::comms::app_settings::get_passive_hook_consent_repos(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, "declined");
    }
}
