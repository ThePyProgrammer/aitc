//! System load metrics via sysinfo.
//!
//! Provides a Tauri command returning live CPU and memory usage percentages.
//! The frontend polls this every 2 seconds for the Comms Hub telemetry panel.

use serde::{Deserialize, Serialize};

/// Live system load snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemLoadInfo {
    pub cpu_percent: f64,
    pub memory_percent: f64,
}

/// Tauri command: get current CPU and memory usage.
///
/// Uses sysinfo to query OS kernel metrics. A short 200ms delay after
/// `refresh_cpu_all()` ensures `global_cpu_usage()` returns a meaningful
/// value on first invocation.
#[tauri::command]
#[specta::specta]
pub async fn get_system_load() -> Result<SystemLoadInfo, String> {
    let mut system = sysinfo::System::new();

    system.refresh_cpu_all();
    // CPU usage requires a short delay after refresh to produce meaningful values
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
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
