//! Writes the bound registration server port to `~/.aitc/port` so the sidecar
//! binary can discover AITC without requiring `AITC_PORT` env propagation
//! (D-06). `PortFileGuard` removes the file on Drop to avoid stale readings on
//! restart.
//!
//! Plan 01 (Wave 0) locks the signature; Plan 02 fills in the real body
//! (mkdir -p ~/.aitc, write port, register Drop cleanup).

use std::path::PathBuf;

/// RAII guard that removes the port file on drop. `path` is exposed so tests
/// and shutdown code can introspect the location.
pub struct PortFileGuard {
    pub path: PathBuf,
}

impl Drop for PortFileGuard {
    fn drop(&mut self) {
        // Plan 02 fills in: best-effort std::fs::remove_file(&self.path).
    }
}

/// Return the canonical port file path (`~/.aitc/port`). Errors if the home
/// directory cannot be determined.
pub fn port_file_path() -> Result<PathBuf, String> {
    todo!("plan 02")
}

/// Write `port` to the canonical port file and return a guard that deletes
/// the file when dropped.
pub fn write_port(_port: u16) -> Result<PortFileGuard, String> {
    todo!("plan 02")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[should_panic(expected = "plan 02")]
    fn write_port_creates_file_with_port_only() {
        let _ = write_port(12345);
    }

    #[test]
    #[should_panic(expected = "plan 02")]
    fn drop_guard_removes_file() {
        let _ = write_port(12345);
    }
}
