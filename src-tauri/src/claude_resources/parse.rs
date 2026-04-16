//! Phase 9 Plan 02 — parsers for every Claude resource format.
//!
//! Pure-logic layer: reads a single file from disk, returns a typed
//! `Resource` (or `Vec<Resource>` for multi-resource bundles like
//! `settings.json` and `installed_plugins.json`). Never executes hook
//! scripts; never propagates raw MCP env secret values across the
//! serde boundary (see SECRET_REGEX mask in `parse_settings`).

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use gray_matter::engine::YAML;
use gray_matter::Matter;
use regex::Regex;
use serde::Deserialize;

use crate::claude_resources::events::{
    Category, Resource, ResourceId, ResourceMetadata, Scope,
};

/// Case-insensitive regex flagging MCP env keys that carry secrets.
/// RESEARCH Open Question 5: mask values for keys matching
/// `(?i)token|secret|key|password|auth`.
fn secret_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new("(?i)token|secret|key|password|auth").unwrap())
}

fn scope_str(s: Scope) -> &'static str {
    match s {
        Scope::Global => "global",
        Scope::Project => "project",
    }
}

// ---------- frontmatter shapes ----------

/// Lenient list deserializer: real Claude agent/command frontmatter often
/// writes `tools: Read, Bash, Grep` (comma-separated string) rather than
/// `tools: [Read, Bash, Grep]` (YAML list). Accept either form plus a lone
/// string value and normalise to `Vec<String>`. The `(*)` suffix and other
/// punctuation inside items are preserved verbatim.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum StringOrList {
    List(Vec<String>),
    Csv(String),
}

impl From<StringOrList> for Vec<String> {
    fn from(v: StringOrList) -> Self {
        match v {
            StringOrList::List(xs) => xs,
            StringOrList::Csv(s) => s
                .split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect(),
        }
    }
}

fn de_opt_stringlist<'de, D>(d: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<StringOrList>::deserialize(d)?.map(Vec::<String>::from))
}

#[derive(Debug, Default, Deserialize)]
struct SkillFront {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, rename = "allowed-tools", deserialize_with = "de_opt_stringlist")]
    allowed_tools: Option<Vec<String>>,
    #[serde(default, deserialize_with = "de_opt_stringlist")]
    tools: Option<Vec<String>>,
}

#[derive(Debug, Default, Deserialize)]
struct AgentFront {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, deserialize_with = "de_opt_stringlist")]
    tools: Option<Vec<String>>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct CommandFront {
    #[serde(default)]
    description: Option<String>,
    #[serde(default, rename = "argument-hint")]
    argument_hint: Option<String>,
    #[serde(default, rename = "allowed-tools", deserialize_with = "de_opt_stringlist")]
    allowed_tools: Option<Vec<String>>,
}

// ---------- helpers ----------

fn read_file(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path)
        .map_err(|e| format!("read {} failed: {e}", path.display()))
}

fn parse_front<D: serde::de::DeserializeOwned + Default>(
    raw: &str,
) -> Result<(D, String), String> {
    // Detect whether a frontmatter block is present at all. gray_matter
    // returns None both when the `---...---` delimiters are missing AND when
    // the block fails to deserialize — we want to treat "no block" as a
    // valid empty-frontmatter case (fall back to Default::default), but
    // still surface real parse errors when a block is present.
    let has_front = raw.starts_with("---\n") || raw.starts_with("---\r\n");
    let matter: Matter<YAML> = Matter::new();
    match matter.parse_with_struct::<D>(raw) {
        Some(parsed) => Ok((parsed.data, parsed.content)),
        None if !has_front => Ok((D::default(), raw.to_string())),
        None => Err("missing or invalid YAML frontmatter".to_string()),
    }
}

fn file_stem_or(path: &Path, default: &str) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| default.to_string())
}

// ---------- public parsers ----------

/// Parse a `SKILL.md` file. The skill name is derived from the frontmatter
/// `name` if present, else from the parent directory name (e.g.
/// `skills/<skill-dir>/SKILL.md` → `<skill-dir>`).
pub fn parse_skill(path: &Path, scope: Scope) -> Result<Resource, String> {
    let (resource, _body) = parse_skill_with_body(path, scope)?;
    Ok(resource)
}

/// Same as `parse_skill` but also returns the markdown body (post-frontmatter)
/// for the detail-panel preview. The body is trimmed of leading blank lines
/// but not of trailing content (Pitfall 8).
pub fn parse_skill_with_body(
    path: &Path,
    scope: Scope,
) -> Result<(Resource, String), String> {
    let raw = read_file(path)?;
    let (front, body) = parse_front::<SkillFront>(&raw)?;
    let name = front
        .name
        .clone()
        .or_else(|| {
            path.parent()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "unknown".to_string());
    let id = ResourceId(format!("{}::skill::{}", scope_str(scope), name));
    let resource = Resource {
        id,
        category: Category::Skill,
        scope,
        name,
        description: front.description,
        path: path.to_path_buf(),
        metadata: ResourceMetadata::Skill {
            tools: front.tools,
            allowed_tools: front.allowed_tools,
        },
    };
    Ok((resource, body))
}

pub fn parse_agent(path: &Path, scope: Scope) -> Result<Resource, String> {
    let raw = read_file(path)?;
    let (front, _body) = parse_front::<AgentFront>(&raw)?;
    let name = front
        .name
        .clone()
        .unwrap_or_else(|| file_stem_or(path, "agent"));
    let id = ResourceId(format!("{}::agent::{}", scope_str(scope), name));
    Ok(Resource {
        id,
        category: Category::Agent,
        scope,
        name,
        description: front.description,
        path: path.to_path_buf(),
        metadata: ResourceMetadata::Agent {
            tools: front.tools,
            model: front.model,
        },
    })
}

pub fn parse_command(path: &Path, scope: Scope) -> Result<Resource, String> {
    let raw = read_file(path)?;
    let (front, _body) = parse_front::<CommandFront>(&raw)?;
    let name = file_stem_or(path, "command");
    let id = ResourceId(format!("{}::command::{}", scope_str(scope), name));
    Ok(Resource {
        id,
        category: Category::Command,
        scope,
        name,
        description: front.description,
        path: path.to_path_buf(),
        metadata: ResourceMetadata::Command {
            argument_hint: front.argument_hint,
            allowed_tools: front.allowed_tools,
        },
    })
}

/// Parse `installed_plugins.json`. Supports two schema variants:
///
/// * **v2 (current Claude Code):**
///   `{ "version": 2, "plugins": { "name@market": [ {entry}, ... ] } }`
///   — each plugin name maps to an array of installation entries (one per
///   scope). We emit one Resource per installation; the ResourceId suffix
///   appends the scope so multiple installations of the same plugin can
///   coexist.
/// * **legacy flat:** `{ "name@market": {entry} }` — used by older Claude
///   Code builds and by our fixture; single entry per plugin.
///
/// Keys are `"name@marketplace"`; preserves the full key as the ResourceId
/// suffix (Pitfall 9) while exposing the short name + marketplace via
/// metadata.
pub fn parse_installed_plugins(
    path: &Path,
    scope: Scope,
) -> Result<Vec<Resource>, String> {
    let raw = read_file(path)?;
    let val: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("parse {} as JSON failed: {e}", path.display()))?;
    let root_obj = val
        .as_object()
        .ok_or_else(|| "installed_plugins.json is not an object".to_string())?;

    // Detect v2 schema: top-level has "version" number + "plugins" object.
    let v2_plugins = root_obj
        .get("version")
        .and_then(|v| v.as_u64())
        .and_then(|_| root_obj.get("plugins"))
        .and_then(|p| p.as_object());

    let mut out: Vec<Resource> = Vec::new();

    if let Some(plugins_map) = v2_plugins {
        // v2: iterate plugins → each value is an array of install entries.
        for (full_key, installs_val) in plugins_map {
            let installs = match installs_val.as_array() {
                Some(a) => a.as_slice(),
                None => {
                    // Some schemas may store the entry directly; treat as single.
                    std::slice::from_ref(installs_val)
                }
            };
            for (idx, entry) in installs.iter().enumerate() {
                out.push(build_plugin_resource(
                    path, scope, full_key, entry, installs.len() > 1,
                    idx,
                ));
            }
        }
    } else {
        // Legacy flat: iterate each key as a single entry.
        for (full_key, entry) in root_obj {
            // Skip non-object entries (defensive — any bookkeeping fields).
            if !entry.is_object() {
                continue;
            }
            out.push(build_plugin_resource(path, scope, full_key, entry, false, 0));
        }
    }

    Ok(out)
}

/// Build one Plugin Resource from a single installation entry.
///
/// `disambiguate` + `idx` are used when a v2 plugin has multiple installs —
/// the ResourceId gets a per-install suffix so ids stay unique; `name` keeps
/// the short plugin name.
fn build_plugin_resource(
    path: &Path,
    scope: Scope,
    full_key: &str,
    entry: &serde_json::Value,
    disambiguate: bool,
    idx: usize,
) -> Resource {
    let (name, marketplace) = match full_key.split_once('@') {
        Some((n, m)) => (n.to_string(), Some(m.to_string())),
        None => (full_key.to_string(), None),
    };
    let version = entry
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let install_path = entry
        .get("installPath")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);
    let installed_at = entry
        .get("installedAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let last_updated = entry
        .get("lastUpdated")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let git_commit_sha = entry
        .get("gitCommitSha")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let id_suffix = if disambiguate {
        format!("{full_key}#{idx}")
    } else {
        full_key.to_string()
    };
    let id = ResourceId(format!(
        "{}::plugin::{}",
        scope_str(scope),
        id_suffix
    ));
    Resource {
        id,
        category: Category::Plugin,
        scope,
        name,
        description: None,
        path: path.to_path_buf(),
        metadata: ResourceMetadata::Plugin {
            version,
            marketplace,
            install_path,
            installed_at,
            last_updated,
            git_commit_sha,
        },
    }
}

/// Parse `settings.json` into a top-level Settings summary Resource plus one
/// Resource per hook entry and one per MCP server. MCP env values are masked:
/// only a boolean `env_masked` crosses the boundary — raw values stay in the
/// Rust-side `serde_json::Value` and are dropped.
pub fn parse_settings(path: &Path, scope: Scope) -> Result<Vec<Resource>, String> {
    let raw = read_file(path)?;
    let val: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("parse {} as JSON failed: {e}", path.display()))?;

    let mut out: Vec<Resource> = Vec::new();
    let scope_s = scope_str(scope);

    // ---- Hooks ----
    let mut hooks_count: u32 = 0;
    if let Some(hooks_obj) = val.get("hooks").and_then(|v| v.as_object()) {
        for (event_name, entries) in hooks_obj {
            let Some(arr) = entries.as_array() else { continue };
            for (i, entry) in arr.iter().enumerate() {
                hooks_count += 1;
                let matcher = entry
                    .get("matcher")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let display_name = matcher
                    .clone()
                    .unwrap_or_else(|| format!("{event_name}#{i}"));
                let id = ResourceId(format!(
                    "{}::hook::{}::{}",
                    scope_s, event_name, display_name
                ));
                out.push(Resource {
                    id,
                    category: Category::Hook,
                    scope,
                    name: display_name,
                    description: None,
                    path: path.to_path_buf(),
                    metadata: ResourceMetadata::Hook {
                        event: Some(event_name.clone()),
                        matcher,
                    },
                });
            }
        }
    }

    // ---- MCP servers ----
    let mut mcp_count: u32 = 0;
    if let Some(mcp_obj) = val.get("mcpServers").and_then(|v| v.as_object()) {
        for (server_name, server_val) in mcp_obj {
            mcp_count += 1;
            let command = server_val
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let args: Vec<String> = server_val
                .get("args")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let env_masked = server_val
                .get("env")
                .and_then(|v| v.as_object())
                .map(|env| env.keys().any(|k| secret_regex().is_match(k)))
                .unwrap_or(false);
            let id = ResourceId(format!("{}::mcp::{}", scope_s, server_name));
            out.push(Resource {
                id,
                category: Category::Mcp,
                scope,
                name: server_name.clone(),
                description: None,
                path: path.to_path_buf(),
                metadata: ResourceMetadata::Mcp {
                    command,
                    args,
                    env_masked,
                },
            });
        }
    }

    // ---- Top-level Settings summary ----
    out.push(Resource {
        id: ResourceId(format!("{scope_s}::settings::root")),
        category: Category::Settings,
        scope,
        name: "settings.json".to_string(),
        description: None,
        path: path.to_path_buf(),
        metadata: ResourceMetadata::Settings {
            hooks_count,
            mcp_servers_count: mcp_count,
        },
    });

    Ok(out)
}

/// Build a Hook Resource from a hook script path without reading the script
/// body. Enforces the "path + filename only" policy (T-09-02-03).
pub fn parse_hook_metadata(path: &Path, scope: Scope) -> Resource {
    let name = file_stem_or(path, "hook");
    let id = ResourceId(format!("{}::hook::{}", scope_str(scope), name));
    Resource {
        id,
        category: Category::Hook,
        scope,
        name,
        description: None,
        path: path.to_path_buf(),
        metadata: ResourceMetadata::Hook {
            event: None,
            matcher: None,
        },
    }
}

/// Parse a CLAUDE.md instruction file. Reads fs metadata for the byte size
/// and preserves the D-13 editable flag chosen by the caller.
pub fn parse_claude_md(
    path: &Path,
    scope: Scope,
    editable: bool,
) -> Result<Resource, String> {
    let meta = std::fs::metadata(path)
        .map_err(|e| format!("stat {} failed: {e}", path.display()))?;
    let byte_size = meta.len();
    // Name is path-based so the frontend can distinguish the variants.
    let name = if path
        .components()
        .any(|c| c.as_os_str().to_string_lossy() == ".claude")
    {
        "project .claude/CLAUDE.md".to_string()
    } else if editable {
        "project CLAUDE.md".to_string()
    } else {
        "CLAUDE.md".to_string()
    };
    let id = ResourceId(format!(
        "{}::claudeMd::{}",
        scope_str(scope),
        name.replace(' ', "_")
    ));
    Ok(Resource {
        id,
        category: Category::ClaudeMd,
        scope,
        name,
        description: None,
        path: path.to_path_buf(),
        metadata: ResourceMetadata::ClaudeMd {
            editable,
            byte_size,
        },
    })
}

// ---------- tests ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude_resources::fixtures::fixture_root;

    #[test]
    fn parse_skill_fixture() {
        let path = fixture_root().join("skills/example-skill/SKILL.md");
        let r = parse_skill(&path, Scope::Global).expect("parse_skill");
        assert_eq!(r.category, Category::Skill);
        assert_eq!(r.name, "example-skill");
        assert_eq!(
            r.description.as_deref(),
            Some("A sample skill fixture for unit tests.")
        );
        assert_eq!(r.id.0, "global::skill::example-skill");
        match r.metadata {
            ResourceMetadata::Skill {
                tools,
                allowed_tools,
            } => {
                assert_eq!(tools, None);
                assert_eq!(
                    allowed_tools,
                    Some(vec!["Read".to_string(), "Grep".to_string()])
                );
            }
            other => panic!("expected Skill metadata, got {other:?}"),
        }
    }

    #[test]
    fn parse_skill_returns_body_content_non_empty() {
        let path = fixture_root().join("skills/example-skill/SKILL.md");
        let (r, body) = parse_skill_with_body(&path, Scope::Global).unwrap();
        assert_eq!(
            r.description.as_deref(),
            Some("A sample skill fixture for unit tests.")
        );
        assert!(
            body.contains("This is fixture content"),
            "body missing expected marker: {body:?}"
        );
    }

    #[test]
    fn parse_agent_fixture() {
        let path = fixture_root().join("agents/example-agent.md");
        let r = parse_agent(&path, Scope::Global).expect("parse_agent");
        assert_eq!(r.category, Category::Agent);
        assert_eq!(r.name, "example-agent");
        match r.metadata {
            ResourceMetadata::Agent { tools, model } => {
                assert_eq!(
                    tools,
                    Some(vec!["Read".to_string(), "Bash".to_string()])
                );
                assert_eq!(model.as_deref(), Some("sonnet"));
            }
            other => panic!("expected Agent metadata, got {other:?}"),
        }
    }

    #[test]
    fn parse_command_fixture() {
        let path = fixture_root().join("commands/example-command.md");
        let r = parse_command(&path, Scope::Global).expect("parse_command");
        assert_eq!(r.category, Category::Command);
        assert_eq!(r.name, "example-command");
        assert_eq!(r.description.as_deref(), Some("Sample slash command."));
        match r.metadata {
            ResourceMetadata::Command {
                argument_hint,
                allowed_tools,
            } => {
                assert_eq!(argument_hint.as_deref(), Some("<path>"));
                assert_eq!(allowed_tools, Some(vec!["Read".to_string()]));
            }
            other => panic!("expected Command metadata, got {other:?}"),
        }
    }

    #[test]
    fn parse_settings_masks_env_secrets() {
        let path = fixture_root().join("settings.json");
        let resources =
            parse_settings(&path, Scope::Global).expect("parse_settings");

        let hooks: Vec<_> = resources
            .iter()
            .filter(|r| r.category == Category::Hook)
            .collect();
        let mcps: Vec<_> = resources
            .iter()
            .filter(|r| r.category == Category::Mcp)
            .collect();
        assert_eq!(hooks.len(), 1, "one hook in fixture");
        assert_eq!(mcps.len(), 1, "one mcp server in fixture");

        let mcp = mcps[0];
        assert_eq!(mcp.name, "example-server");
        match &mcp.metadata {
            ResourceMetadata::Mcp {
                command,
                args,
                env_masked,
            } => {
                assert_eq!(command, "node");
                assert_eq!(args, &vec!["server.js".to_string()]);
                assert!(
                    *env_masked,
                    "API_TOKEN must trip the SECRET_REGEX and mark env_masked"
                );
            }
            other => panic!("expected Mcp metadata, got {other:?}"),
        }

        // Security contract: raw env values MUST NOT cross the serde boundary.
        let json = serde_json::to_string(&resources).unwrap();
        assert!(
            !json.contains("API_TOKEN"),
            "API_TOKEN key leaked into serialized Resource: {json}"
        );
        assert!(
            !json.contains("sk-test-abc123"),
            "API_TOKEN value leaked into serialized Resource: {json}"
        );
    }

    /// Regression: real agent frontmatter writes `tools: Read, Bash, Grep`
    /// as a comma-separated string rather than a YAML list. Strict parsing
    /// rejected every such file with "missing or invalid YAML frontmatter"
    /// even though the block was valid YAML.
    #[test]
    fn parse_agent_accepts_csv_tools_string() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("real-agent.md");
        std::fs::write(
            &path,
            "---\nname: real-agent\ndescription: Handles stuff.\ntools: Read, Bash, Grep, Glob\ncolor: blue\n---\n\nBody.\n",
        )
        .expect("write");
        let r = parse_agent(&path, Scope::Global).expect("lenient parse");
        assert_eq!(r.name, "real-agent");
        match r.metadata {
            ResourceMetadata::Agent { tools, .. } => {
                assert_eq!(
                    tools.as_deref(),
                    Some(&["Read".into(), "Bash".into(), "Grep".into(), "Glob".into()][..])
                );
            }
            other => panic!("expected Agent, got {other:?}"),
        }
    }

    /// Regression: some real commands/agents ship with no frontmatter at
    /// all (e.g. `commands/turing/rules/loop-protocol.md`, `commands/blueprint/agents/persona.md`).
    /// The parser must treat "no frontmatter block" as empty defaults, not
    /// as a parse error.
    #[test]
    fn parse_command_tolerates_missing_frontmatter() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("persona.md");
        std::fs::write(
            &path,
            "# Senior Engineer Persona\n\nJust prose. No frontmatter at all.\n",
        )
        .expect("write");
        let r = parse_command(&path, Scope::Global).expect("lenient parse");
        assert_eq!(r.name, "persona");
        assert!(r.description.is_none());
        match r.metadata {
            ResourceMetadata::Command { argument_hint, allowed_tools } => {
                assert!(argument_hint.is_none());
                assert!(allowed_tools.is_none());
            }
            other => panic!("expected Command, got {other:?}"),
        }
    }

    #[test]
    fn parse_agent_tolerates_missing_frontmatter() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("loop-protocol.md");
        std::fs::write(&path, "# Just a header\n\nBody.\n").expect("write");
        let r = parse_agent(&path, Scope::Global).expect("lenient parse");
        assert_eq!(r.name, "loop-protocol");
    }

    #[test]
    fn parse_installed_plugins_multi_entry() {
        let path = fixture_root().join("plugins/installed_plugins.json");
        let rs =
            parse_installed_plugins(&path, Scope::Global).expect("parse plugins");
        assert_eq!(rs.len(), 1);
        let r = &rs[0];
        assert_eq!(r.category, Category::Plugin);
        assert_eq!(r.name, "rapid");
        assert_eq!(r.id.0, "global::plugin::rapid@pragnition-plugins");
        match &r.metadata {
            ResourceMetadata::Plugin {
                version,
                marketplace,
                ..
            } => {
                assert_eq!(version, "1.2.3");
                assert_eq!(marketplace.as_deref(), Some("pragnition-plugins"));
            }
            other => panic!("expected Plugin metadata, got {other:?}"),
        }
    }

    /// Regression: real `~/.claude/plugins/installed_plugins.json` uses the
    /// v2 schema `{ "version": 2, "plugins": { "name@market": [ {entry}, ... ] } }`.
    /// The legacy flat parser emitted garbage "version" and "plugins" rows
    /// instead of the real plugins — caught in UAT, fixed by the v2 branch.
    #[test]
    fn parse_installed_plugins_v2_schema() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("installed_plugins.json");
        std::fs::write(
            &path,
            r#"{
                "version": 2,
                "plugins": {
                    "rapid@pragnition-plugins": [
                        {
                            "scope": "user",
                            "installPath": "/home/u/.claude/plugins/cache/rapid",
                            "version": "6.2.0",
                            "installedAt": "2026-03-16T02:50:21.149Z",
                            "lastUpdated": "2026-04-09T06:32:23.696Z",
                            "gitCommitSha": "91ea44fbb57dd0bc66845ff4760bb135af835e5e"
                        }
                    ],
                    "superpowers@claude-plugins-official": [
                        {
                            "scope": "user",
                            "installPath": "/home/u/.claude/plugins/cache/superpowers",
                            "version": "5.0.7"
                        }
                    ]
                }
            }"#,
        )
        .expect("write");

        let rs =
            parse_installed_plugins(&path, Scope::Global).expect("parse v2");
        assert_eq!(rs.len(), 2, "expected two plugins, got {rs:?}");

        // No garbage entries named "version" or "plugins" (the old bug).
        assert!(
            !rs.iter().any(|r| r.name == "version" || r.name == "plugins"),
            "v2 parser leaked top-level keys as plugins: {rs:?}"
        );

        let rapid = rs
            .iter()
            .find(|r| r.name == "rapid")
            .expect("rapid plugin");
        assert_eq!(
            rapid.id.0,
            "global::plugin::rapid@pragnition-plugins"
        );
        match &rapid.metadata {
            ResourceMetadata::Plugin {
                version,
                marketplace,
                install_path,
                ..
            } => {
                assert_eq!(version, "6.2.0");
                assert_eq!(marketplace.as_deref(), Some("pragnition-plugins"));
                assert!(install_path.is_some());
            }
            other => panic!("expected Plugin, got {other:?}"),
        }
    }

    #[test]
    fn parse_hook_metadata_path_only() {
        let path = fixture_root().join("hooks/sample-hook.sh");
        let r = parse_hook_metadata(&path, Scope::Global);
        assert_eq!(r.category, Category::Hook);
        assert_eq!(r.name, "sample-hook");
        match &r.metadata {
            ResourceMetadata::Hook { event, matcher } => {
                assert!(event.is_none());
                assert!(matcher.is_none());
            }
            other => panic!("expected Hook metadata, got {other:?}"),
        }
        // Script body MUST NOT cross the serde boundary.
        let json = serde_json::to_string(&r).unwrap();
        assert!(
            !json.contains("fixture hook"),
            "hook body leaked into Resource: {json}"
        );
        assert!(
            !json.contains("/usr/bin/env bash"),
            "hook shebang leaked into Resource: {json}"
        );
    }

    #[test]
    fn parse_claude_md_returns_editable_flag() {
        let path = fixture_root().join("CLAUDE.md");
        let editable =
            parse_claude_md(&path, Scope::Project, true).expect("claude md");
        let readonly =
            parse_claude_md(&path, Scope::Global, false).expect("claude md");
        match editable.metadata {
            ResourceMetadata::ClaudeMd {
                editable, byte_size,
            } => {
                assert!(editable);
                assert!(byte_size > 0);
            }
            other => panic!("expected ClaudeMd metadata, got {other:?}"),
        }
        match readonly.metadata {
            ResourceMetadata::ClaudeMd { editable, .. } => {
                assert!(!editable);
            }
            other => panic!("expected ClaudeMd metadata, got {other:?}"),
        }
    }

    /// Contract change (previously asserted Err): SKILL.md without a
    /// `---...---` frontmatter block is now tolerated and falls back to
    /// filename-derived defaults. Mirrors the agent/command lenient path
    /// so real-world files that ship as plain markdown still surface.
    #[test]
    fn parse_skill_missing_frontmatter_uses_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("my-skill");
        std::fs::create_dir_all(&sub).unwrap();
        let path = sub.join("SKILL.md");
        std::fs::write(&path, "no frontmatter here\njust a body\n").unwrap();
        let r = parse_skill(&path, Scope::Global).expect("lenient");
        // name falls back to parent directory name per parse_skill_with_body.
        assert_eq!(r.name, "my-skill");
        assert!(r.description.is_none());
    }
}
