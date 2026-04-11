use std::path::{Path, PathBuf};

/// Manages file backups for conflict resolution.
///
/// Stores pre-resolution file snapshots in the app data directory so that
/// resolved conflicts can be reviewed or reverted later.
pub struct BackupManager {
    backup_dir: PathBuf,
}

impl BackupManager {
    /// Create a new BackupManager rooted at `app_data_dir/conflict_backups`.
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            backup_dir: app_data_dir.join("conflict_backups"),
        }
    }

    /// Validate that a path component contains no traversal or separator characters.
    fn validate_component(component: &str) -> Result<(), String> {
        if component.contains("..") {
            return Err(format!(
                "Path component contains '..' traversal: {component}"
            ));
        }
        if component.contains(std::path::MAIN_SEPARATOR) {
            return Err(format!(
                "Path component contains path separator: {component}"
            ));
        }
        // Also check forward slash on Windows
        if component.contains('/') {
            return Err(format!(
                "Path component contains path separator: {component}"
            ));
        }
        if component.is_empty() {
            return Err("Path component is empty".to_string());
        }
        Ok(())
    }

    /// Save a file backup for a given conflict.
    ///
    /// Creates `conflict_backups/{conflict_id}/{label}.bak` and returns the
    /// relative path from backup_dir.
    ///
    /// # Security
    /// Validates that `conflict_id` and `label` contain no path separators or
    /// `..` segments (T-05-02 path traversal mitigation).
    pub fn save_backup(
        &self,
        conflict_id: &str,
        label: &str,
        content: &str,
    ) -> Result<String, String> {
        Self::validate_component(conflict_id)?;
        Self::validate_component(label)?;

        let conflict_dir = self.backup_dir.join(conflict_id);
        std::fs::create_dir_all(&conflict_dir)
            .map_err(|e| format!("Failed to create backup directory: {e}"))?;

        let file_name = format!("{label}.bak");
        let file_path = conflict_dir.join(&file_name);

        std::fs::write(&file_path, content)
            .map_err(|e| format!("Failed to write backup file: {e}"))?;

        // Return relative path from backup_dir
        let relative = format!("{conflict_id}/{file_name}");
        Ok(relative)
    }

    /// Read a backup file by its relative path (as returned by `save_backup`).
    ///
    /// # Security
    /// Validates that the resolved path stays within backup_dir (T-05-05).
    pub fn read_backup(&self, relative_path: &str) -> Result<String, String> {
        // Validate no traversal in the relative path
        if relative_path.contains("..") {
            return Err("Backup path contains '..' traversal".to_string());
        }

        let full_path = self.backup_dir.join(relative_path);

        // Canonicalize and verify containment
        let canonical_backup_dir = self
            .backup_dir
            .canonicalize()
            .unwrap_or_else(|_| self.backup_dir.clone());
        let canonical_path = full_path
            .canonicalize()
            .map_err(|e| format!("Failed to resolve backup path: {e}"))?;

        if !canonical_path.starts_with(&canonical_backup_dir) {
            return Err("Backup path resolves outside backup directory".to_string());
        }

        std::fs::read_to_string(&canonical_path)
            .map_err(|e| format!("Failed to read backup file: {e}"))
    }

    /// Delete all backups for a given conflict.
    pub fn delete_backups(&self, conflict_id: &str) -> Result<(), String> {
        Self::validate_component(conflict_id)?;

        let conflict_dir = self.backup_dir.join(conflict_id);
        if conflict_dir.exists() {
            std::fs::remove_dir_all(&conflict_dir)
                .map_err(|e| format!("Failed to delete backup directory: {e}"))?;
        }
        Ok(())
    }

    /// Get the backup directory path (for testing).
    #[cfg(test)]
    pub fn backup_dir(&self) -> &Path {
        &self.backup_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_and_read_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = BackupManager::new(tmp.path().to_path_buf());

        let path = mgr
            .save_backup("CNFL-100", "base", "hello world")
            .unwrap();
        assert_eq!(path, "CNFL-100/base.bak");

        let content = mgr.read_backup(&path).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn rejects_path_traversal_in_conflict_id() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = BackupManager::new(tmp.path().to_path_buf());

        let result = mgr.save_backup("../evil", "base", "content");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains(".."));
    }

    #[test]
    fn rejects_path_traversal_in_label() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = BackupManager::new(tmp.path().to_path_buf());

        let result = mgr.save_backup("CNFL-100", "../evil", "content");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_separator_in_conflict_id() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = BackupManager::new(tmp.path().to_path_buf());

        let result = mgr.save_backup("CNFL/100", "base", "content");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_traversal_in_read_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = BackupManager::new(tmp.path().to_path_buf());

        let result = mgr.read_backup("../../../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn delete_backups_removes_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = BackupManager::new(tmp.path().to_path_buf());

        mgr.save_backup("CNFL-200", "base", "content").unwrap();
        mgr.save_backup("CNFL-200", "merged", "merged content")
            .unwrap();

        let conflict_dir = mgr.backup_dir().join("CNFL-200");
        assert!(conflict_dir.exists());

        mgr.delete_backups("CNFL-200").unwrap();
        assert!(!conflict_dir.exists());
    }

    #[test]
    fn delete_nonexistent_is_ok() {
        let tmp = tempfile::tempdir().unwrap();
        let mgr = BackupManager::new(tmp.path().to_path_buf());
        // Should not error
        mgr.delete_backups("CNFL-NONEXIST").unwrap();
    }
}
