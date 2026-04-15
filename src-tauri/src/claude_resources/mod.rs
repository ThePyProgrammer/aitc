//! Phase 9: ARSENAL — Claude resources manager.
//!
//! Surfaces resources under `~/.claude/` (global) and `<cwd>/.claude/`
//! (project) via a multi-root extension of the pipeline watcher.
//! Backend parses all formats (SKILL.md, agent.md, commands/*.md,
//! settings.json, installed_plugins.json, hook script metadata,
//! CLAUDE.md) per D-07; frontend receives typed `ResourceEvent`s
//! over a Channel<T> mirroring Phase 2's pipeline trio.
//!
//! See: .planning/phases/09-.../09-CONTEXT.md (D-01..D-15)
//! See: .planning/phases/09-.../09-RESEARCH.md

pub mod events;
// Modules introduced by Plan 02:
pub mod parse;
pub mod routing;
pub mod scan;
pub mod write_fence;
// Modules introduced by Plan 03:
pub mod claude_md;

#[cfg(test)]
pub mod fixtures;

pub use events::{Category, Resource, ResourceEvent, ResourceEventBatch,
                 ResourceId, ResourceMetadata, Scope};
