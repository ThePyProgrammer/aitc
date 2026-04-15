//! Phase 9: ARSENAL event/resource type contract.
//!
//! Defines the typed surface that flows from the Rust backend (parser +
//! routed watcher) to the frontend `claudeResourcesStore` over a Channel<T>.
//! Backend parses every format per D-07; frontend never parses YAML/JSON.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

/// Opaque stable identifier for a Resource — composed as
/// `"{scope}::{category}::{name}"` per RESEARCH.md Pattern 2 so the
/// frontend can treat it as an opaque key without parsing.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
pub struct ResourceId(pub String);

/// D-02: scope tabs Global | Project | Combined. `Combined` is a UI-only
/// concept derived from the union of Global + Project — backend only emits
/// the two physical scopes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    Global,
    Project,
}

/// D-01: four UI categories (Skills, Agents, Plugins, Configuration). The
/// "Configuration" UI tab bundles Hook + Command + Settings + Mcp; the
/// backend keeps them as distinct enum variants so the parser, store, and
/// detail panel can render them with the right metadata. ClaudeMd is its
/// own category — surfaced under Configuration in the rail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Skill,
    Agent,
    Plugin,
    Hook,
    Command,
    Settings,
    Mcp,
    ClaudeMd,
}

/// Per-category metadata payload. Tagged enum (`kind` discriminator) so the
/// frontend can switch on `metadata.kind` and render the right detail panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResourceMetadata {
    #[serde(rename_all = "camelCase")]
    Skill {
        tools: Option<Vec<String>>,
        allowed_tools: Option<Vec<String>>,
    },
    #[serde(rename_all = "camelCase")]
    Agent {
        tools: Option<Vec<String>>,
        model: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Plugin {
        version: String,
        marketplace: Option<String>,
        install_path: Option<PathBuf>,
        installed_at: Option<String>,
        last_updated: Option<String>,
        git_commit_sha: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Hook {
        event: Option<String>,
        matcher: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Command {
        argument_hint: Option<String>,
        allowed_tools: Option<Vec<String>>,
    },
    #[serde(rename_all = "camelCase")]
    Settings {
        hooks_count: u32,
        mcp_servers_count: u32,
    },
    #[serde(rename_all = "camelCase")]
    Mcp {
        command: String,
        args: Vec<String>,
        /// True when at least one env value was masked in the parsed payload
        /// (RESEARCH Open Question 5: mask values for keys matching
        /// /token|secret|key|password|auth/i).
        env_masked: bool,
    },
    #[serde(rename_all = "camelCase")]
    ClaudeMd {
        editable: bool,
        byte_size: u64,
    },
}

/// A discovered Claude resource. Identity is `id` (stable across rescans);
/// `path` is informational and may change if the file moves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: ResourceId,
    pub category: Category,
    pub scope: Scope,
    pub name: String,
    pub description: Option<String>,
    pub path: PathBuf,
    pub metadata: ResourceMetadata,
}

/// Channel-emitted event variants. `Added`/`Changed` carry the parsed
/// `Resource`; `Removed` carries only the id; `ExternalEdit` exists per
/// D-15 so the frontend can decide between silent refresh and the
/// "file changed on disk" banner when an editor is mounted on `path`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResourceEvent {
    Added {
        resource: Resource,
    },
    Removed {
        id: ResourceId,
    },
    Changed {
        resource: Resource,
    },
    #[serde(rename_all = "camelCase")]
    ExternalEdit {
        path: PathBuf,
        mtime_ms: i64,
    },
}

/// Batched event envelope mirrors `pipeline::events::FileEventBatch` so the
/// frontend ring-buffer pattern from Phase 2 carries over unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEventBatch {
    pub events: Vec<ResourceEvent>,
    pub batch_id: u64,
    pub dropped_batches: u32,
}

impl ResourceEventBatch {
    pub fn new_empty() -> Self {
        Self {
            events: vec![],
            batch_id: 0,
            dropped_batches: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_resource() -> Resource {
        Resource {
            id: ResourceId("global::skill::example".to_string()),
            category: Category::Skill,
            scope: Scope::Global,
            name: "example".to_string(),
            description: Some("desc".to_string()),
            path: PathBuf::from("/home/u/.claude/skills/example/SKILL.md"),
            metadata: ResourceMetadata::Skill {
                tools: Some(vec!["Read".to_string()]),
                allowed_tools: None,
            },
        }
    }

    #[test]
    fn added_serializes_with_camel_case_kind() {
        let ev = ResourceEvent::Added {
            resource: sample_resource(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"kind\":\"added\""), "got: {json}");
    }

    #[test]
    fn external_edit_uses_mtime_ms_camel_case() {
        let ev = ResourceEvent::ExternalEdit {
            path: PathBuf::from("/tmp/CLAUDE.md"),
            mtime_ms: 1_700_000_000_000,
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"kind\":\"externalEdit\""), "got: {json}");
        assert!(json.contains("\"mtimeMs\":1700000000000"), "got: {json}");
    }

    #[test]
    fn batch_new_empty_has_zero_state() {
        let b = ResourceEventBatch::new_empty();
        assert!(b.events.is_empty());
        assert_eq!(b.batch_id, 0);
        assert_eq!(b.dropped_batches, 0);
    }

    #[test]
    fn category_variants_roundtrip() {
        let cats = [
            Category::Skill,
            Category::Agent,
            Category::Plugin,
            Category::Hook,
            Category::Command,
            Category::Settings,
            Category::Mcp,
            Category::ClaudeMd,
        ];
        for c in cats {
            let s = serde_json::to_string(&c).unwrap();
            let back: Category = serde_json::from_str(&s).unwrap();
            assert_eq!(c, back, "roundtrip failed for {c:?} via {s}");
        }
    }

    #[test]
    fn scope_serializes_camel_case() {
        assert_eq!(serde_json::to_string(&Scope::Global).unwrap(), "\"global\"");
        assert_eq!(
            serde_json::to_string(&Scope::Project).unwrap(),
            "\"project\""
        );
    }

    #[test]
    fn resource_struct_roundtrips() {
        let r = sample_resource();
        let json = serde_json::to_string(&r).unwrap();
        let back: Resource = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
    }
}
