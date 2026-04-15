//! Writes the bound registration server port to `~/.aitc/port` so the sidecar
//! binary can discover AITC without requiring `AITC_PORT` env propagation
//! (D-06). `PortFileGuard` removes the file on Drop to avoid stale readings on
//! restart.
//!
//! Plan 02 fills in the real body. Tests override the target path via
//! `AITC_PORT_FILE_OVERRIDE` env var so they don't scribble on the real
//! `~/.aitc/port`.

use std::path::PathBuf;

/// Env var honoured by [`port_file_path`] for test isolation.
const PORT_FILE_OVERRIDE_ENV: &str = "AITC_PORT_FILE_OVERRIDE";

/// RAII guard that removes the port file on drop. `path` is exposed so tests
/// and shutdown code can introspect the location.
pub struct PortFileGuard {
    pub path: PathBuf,
}

impl Drop for PortFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Return the canonical port file path (`~/.aitc/port`). Errors if the home
/// directory cannot be determined. Tests set `AITC_PORT_FILE_OVERRIDE` to
/// redirect to a tempdir.
pub fn port_file_path() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var(PORT_FILE_OVERRIDE_ENV) {
        return Ok(PathBuf::from(p));
    }
    let home = dirs::home_dir().ok_or_else(|| "home_dir unavailable".to_string())?;
    Ok(home.join(".aitc").join("port"))
}

/// Write `port` to the canonical port file and return a guard that deletes
/// the file when dropped. Writes go through a `.port.tmp` sibling first and
/// then atomically rename into place (RESEARCH §Security V14 — atomic write
/// so partial reads never see garbage).
pub fn write_port(port: u16) -> Result<PortFileGuard, String> {
    let path = port_file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
    }
    let tmp = path.with_extension("port.tmp");
    std::fs::write(&tmp, format!("{port}\n")).map_err(|e| format!("write tmp: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // User-only write, world-readable so the sidecar (same user) can read.
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o644));
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    Ok(PortFileGuard { path })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // These tests mutate AITC_PORT_FILE_OVERRIDE — run them under serial_test
    // so two cases can't clobber each other's env var.
    use serial_test::serial;

    #[test]
    #[serial]
    fn write_port_creates_file_with_port_only() {
        let td = TempDir::new().unwrap();
        let p = td.path().join("port");
        std::env::set_var(PORT_FILE_OVERRIDE_ENV, &p);
        let _guard = write_port(54321).unwrap();
        let s = std::fs::read_to_string(&p).unwrap();
        assert_eq!(s, "54321\n");
        std::env::remove_var(PORT_FILE_OVERRIDE_ENV);
    }

    #[test]
    #[serial]
    fn drop_guard_removes_file() {
        let td = TempDir::new().unwrap();
        let p = td.path().join("port");
        std::env::set_var(PORT_FILE_OVERRIDE_ENV, &p);
        {
            let _guard = write_port(54321).unwrap();
            assert!(p.exists());
        } // drop
        assert!(!p.exists());
        std::env::remove_var(PORT_FILE_OVERRIDE_ENV);
    }

    #[test]
    #[serial]
    fn write_port_creates_parent_dir_if_missing() {
        let td = TempDir::new().unwrap();
        let p = td.path().join("nested").join("dir").join("port");
        std::env::set_var(PORT_FILE_OVERRIDE_ENV, &p);
        let _guard = write_port(1234).unwrap();
        assert!(p.exists());
        std::env::remove_var(PORT_FILE_OVERRIDE_ENV);
    }
}
