//! Placeholder — implemented in Plan 02-02 Task 2.
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub struct FileNode {
    pub size: u64,
    pub modified_at: Option<SystemTime>,
}

pub fn build_tree_index(_root: &std::path::Path) -> HashMap<PathBuf, FileNode> {
    HashMap::new()
}
