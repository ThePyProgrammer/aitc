//! AITC sidecar binary entry point.
//!
//! Plan 01 (Wave 0) ships a stub that exits with code 2 and writes
//! `stub not implemented` to stderr so Plan 03 tests that expect the real
//! hook client fail until the body is filled in.

use std::process::ExitCode;

fn main() -> ExitCode {
    eprintln!("stub not implemented");
    ExitCode::from(2)
}
