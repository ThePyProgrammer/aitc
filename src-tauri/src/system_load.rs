//! System load metrics via sysinfo.
//!
//! Provides a Tauri command returning live CPU and memory usage percentages.
//! The frontend polls this every 2 seconds for the Comms Hub telemetry panel.
//!
//! WR-01: The System struct is held in managed state (SystemLoadState) and
//! reused across calls. The 2-second polling cadence from the frontend
//! provides sufficient delta for meaningful CPU usage readings, eliminating
//! the need for a blocking 200ms sleep on every call.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Live system load snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemLoadInfo {
    pub cpu_percent: f64,
    pub memory_percent: f64,
}

/// Managed state wrapping a reusable sysinfo::System instance.
/// The System struct retains kernel state between refreshes, producing
/// accurate delta-based CPU usage values without a sleep delay.
pub struct SystemLoadState {
    pub system: Arc<Mutex<sysinfo::System>>,
}

impl SystemLoadState {
    pub fn new() -> Self {
        Self {
            system: Arc::new(Mutex::new(sysinfo::System::new())),
        }
    }
}

/// Tauri command: get current CPU and memory usage.
///
/// Reuses the System instance from managed state. The frontend's 2-second
/// polling interval provides the time delta needed for meaningful CPU
/// usage values between refresh calls.
#[tauri::command]
#[specta::specta]
pub async fn get_system_load(
    state: tauri::State<'_, SystemLoadState>,
) -> Result<SystemLoadInfo, String> {
    let mut system = state.system.lock().await;

    system.refresh_cpu_all();
    system.refresh_memory();

    let cpu_percent = system.global_cpu_usage() as f64;
    let total_memory = system.total_memory() as f64;
    let memory_percent = if total_memory > 0.0 {
        (system.used_memory() as f64 / total_memory) * 100.0
    } else {
        0.0
    };

    Ok(SystemLoadInfo {
        cpu_percent,
        memory_percent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_load_info_serializes_camel_case() {
        let info = SystemLoadInfo {
            cpu_percent: 42.5,
            memory_percent: 65.3,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("cpuPercent"));
        assert!(json.contains("memoryPercent"));
    }
}
