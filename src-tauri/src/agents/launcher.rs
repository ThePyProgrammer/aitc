//! Detached subprocess launcher and termination for agent lifecycle.
//!
//! Spawns agent processes as detached subprocesses with stdout capture.
//! On Windows, uses `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS` flags
//! so agents survive AITC restarts. Termination uses `taskkill` on Windows.

use crate::agents::adapter::AgentState;
use crate::agents::registry::AgentRegistry;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;

/// Windows process creation flag: create a new process group.
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

/// Windows process creation flag: detach from the console.
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x00000008;

/// Maximum lines to keep in the per-agent stdout ring buffer.
const MAX_STDOUT_LINES: usize = 1000;

/// Launch a program as a detached subprocess with stdout/stderr piped.
///
/// Returns `(pid, child)` on success. The caller is responsible for spawning
/// a stdout reader task via [`spawn_stdout_reader`].
///
/// # Arguments
/// * `program` - Binary name (resolved via PATH).
/// * `args` - Command-line arguments.
/// * `cwd` - Working directory for the spawned process.
/// * `env_vars` - Optional extra environment variables to inject.
/// * `aitc_port` - The AITC self-registration server port, injected as `AITC_PORT`.
pub async fn launch_detached(
    program: &str,
    args: &[&str],
    cwd: &Path,
    env_vars: Option<Vec<(&str, &str)>>,
    aitc_port: u16,
) -> Result<(u32, tokio::process::Child), String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Inject AITC_PORT so agents can self-register.
    cmd.env("AITC_PORT", aitc_port.to_string());

    // Inject any additional env vars.
    if let Some(vars) = env_vars {
        for (key, value) in vars {
            cmd.env(key, value);
        }
    }

    // Windows: detach from console so agent survives AITC exit.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn '{program}': {e}"))?;
    let pid = child.id().ok_or_else(|| "Spawned process has no PID".to_string())?;

    Ok((pid, child))
}

/// Terminate a process by PID.
///
/// On Windows: uses `taskkill /PID <pid> /T` for graceful termination first,
/// then `/F` for forced kill after a timeout.
///
/// On Unix: sends SIGTERM (falls back to `kill` command).
pub async fn terminate_process(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Graceful attempt via taskkill (sends WM_CLOSE / CTRL_BREAK)
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .output()
            .await
            .map_err(|e| format!("taskkill failed: {e}"))?;

        if output.status.success() {
            return Ok(());
        }

        // Wait briefly then force-kill
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

        let force_output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .await
            .map_err(|e| format!("taskkill /F failed: {e}"))?;

        if force_output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&force_output.stderr);
            Err(format!("Failed to terminate PID {pid}: {stderr}"))
        }
    }

    #[cfg(not(windows))]
    {
        let output = Command::new("kill")
            .args([&pid.to_string()])
            .output()
            .await
            .map_err(|e| format!("kill failed: {e}"))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to terminate PID {pid}: {stderr}"))
        }
    }
}

/// Append a line (tagged or not) to the agent's ring buffer with ring-buffer
/// eviction. Held as a small helper so stdout and stderr readers can share it.
async fn push_log_line(registry: &AgentRegistry, agent_id: &str, line: String) {
    let mut agents = registry.agents_write().await;
    if let Some(agent) = agents.get_mut(agent_id) {
        if let Some(buf) = &mut agent.stdout_buffer {
            if buf.len() >= MAX_STDOUT_LINES {
                buf.pop_front();
            }
            buf.push_back(line);
        }
    }
}

/// Spawn a background task that reads stdout AND stderr from a child process
/// line-by-line and appends each line to the agent's ring buffer. stderr lines
/// are prefixed with `[stderr]` so they're still distinguishable.
///
/// When the child exits, updates agent state to `Idle` (exit 0) or `Error`
/// (non-zero / signalled) and logs the final status via `tracing::warn!` when
/// non-zero so the dev console surfaces the failure cause.
pub fn spawn_stdout_reader(
    mut child: tokio::process::Child,
    agent_id: String,
    registry: Arc<AgentRegistry>,
) -> tokio::task::JoinHandle<()> {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    tokio::spawn(async move {
        // Drain stderr in parallel with stdout. Previously stderr was piped
        // but never read, so claude's actual error messages vanished and the
        // agent just flipped to Error with no context.
        let stderr_task = stderr.map(|stderr| {
            let registry = registry.clone();
            let agent_id = agent_id.clone();
            tokio::spawn(async move {
                let reader = tokio::io::BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    push_log_line(&registry, &agent_id, format!("[stderr] {line}")).await;
                }
            })
        });

        if let Some(stdout) = stdout {
            let reader = tokio::io::BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                push_log_line(&registry, &agent_id, line).await;
            }
        }

        // Wait for stderr drain to finish so we don't race the exit message.
        if let Some(handle) = stderr_task {
            let _ = handle.await;
        }

        // Child exited -- determine state from exit code
        let (new_state, exit_summary) = match child.wait().await {
            Ok(status) if status.success() => (AgentState::Idle, "exit=0".to_string()),
            Ok(status) => {
                let code = status
                    .code()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "signalled".to_string());
                (AgentState::Error, format!("exit={code}"))
            }
            Err(e) => (AgentState::Error, format!("wait failed: {e}")),
        };

        if new_state == AgentState::Error {
            tracing::warn!(
                agent_id = %agent_id,
                status = %exit_summary,
                "agent child process exited non-zero"
            );
            push_log_line(
                &registry,
                &agent_id,
                format!("[aitc] child exited with {exit_summary}"),
            )
            .await;
        }

        registry.update_state(&agent_id, new_state).await;
    })
}

/// Read the stdout buffer for a given agent. Returns empty vec if agent not found.
pub async fn read_stdout_buffer(
    registry: &AgentRegistry,
    agent_id: &str,
) -> Vec<String> {
    let agents = registry.agents_read().await;
    agents
        .get(agent_id)
        .and_then(|a| a.stdout_buffer.as_ref())
        .map(|buf| buf.iter().cloned().collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn terminate_nonexistent_pid_returns_err() {
        let result = terminate_process(999999).await;
        assert!(result.is_err(), "Terminating PID 999999 should fail");
    }

    #[tokio::test]
    async fn launch_detached_echo_returns_pid() {
        let tmp = std::env::temp_dir();

        #[cfg(windows)]
        let (program, args) = ("cmd", vec!["/c", "echo", "hello"]);
        #[cfg(not(windows))]
        let (program, args) = ("echo", vec!["hello"]);

        let result = launch_detached(program, &args, &tmp, None, 9417).await;
        assert!(result.is_ok(), "launch_detached should succeed: {:?}", result.err());
        let (pid, mut child) = result.unwrap();
        assert!(pid > 0, "PID should be > 0");

        // Wait for the process to finish
        let _ = child.wait().await;
    }
}
