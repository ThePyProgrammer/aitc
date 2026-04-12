//! Shared helpers for integration tests in src-tauri/tests/.
//! TODO(plan-04/05): add tempdir git-repo fixture and fake ProcessSnapshot
//! factory as the bridge + forwarder tests come online.

#![allow(dead_code)]

use std::path::PathBuf;

/// Placeholder for a tempdir-backed git repo fixture.
pub fn tempdir_repo_fixture() -> PathBuf {
    unimplemented!("TODO(plan-04): create tempdir with `git init` and return its path");
}
