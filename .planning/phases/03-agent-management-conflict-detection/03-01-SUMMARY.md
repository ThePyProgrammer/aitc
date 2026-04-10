---
phase: 03-agent-management-conflict-detection
plan: 01
subsystem: agents
tags: [adapter-trait, registry, agent-management, extensibility]
dependency_graph:
  requires: []
  provides: [AgentAdapter-trait, AgentRegistry, AgentState-enum, AgentInfo-struct, GenericAgentConfig, phase3-db-migration]
  affects: [03-02, 03-03, 03-04]
tech_stack:
  added: [async-trait, axum, tauri-plugin-notification, toml, regex]
  patterns: [async-trait-for-dyn-dispatch, rwlock-hashmap-registry, toml-config-parsing, state-machine-enum]
key_files:
  created:
    - src-tauri/src/agents/mod.rs
    - src-tauri/src/agents/adapter.rs
    - src-tauri/src/agents/registry.rs
    - src-tauri/src/agents/claude_code.rs
    - src-tauri/src/agents/codex.rs
    - src-tauri/src/agents/opencode.rs
    - src-tauri/src/agents/generic.rs
    - src-tauri/src/db/migrations/002_phase3_enrichment.sql
  modified:
    - src-tauri/Cargo.toml
    - src-tauri/src/lib.rs
decisions:
  - "async-trait crate for dyn-compatible async trait methods (native async fn in traits not yet dyn-safe)"
  - "RwLock<HashMap> for concurrent registry access from async Tauri commands"
  - "Arc<dyn AgentAdapter> (not Box) for shared adapter references across registry and background tasks"
  - "TOML for GenericAdapter config format (idiomatic Rust ecosystem, Cargo.toml precedent)"
  - "Stateless unit structs for built-in adapters (no per-instance state, anti-pattern from RESEARCH.md)"
metrics:
  duration: "11 minutes"
  completed: "2026-04-10"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 16
  tests_passing: 16
---

# Phase 3 Plan 01: Agent Adapter Architecture & Registry Summary

AgentAdapter async trait with 6 methods, 5-state state machine, concurrent registry with RwLock, 4 adapter implementations (ClaudeCode, Codex, OpenCode, Generic with TOML config), and Phase 3 DB schema enrichment.

## What Was Built

### Task 1: AgentAdapter Trait, Types, and DB Migration
- **AgentState** enum with 5 variants (Running, Idle, Waiting, Conflict, Error) and `can_transition_to()` state machine validation
- **AgentInfo** struct with camelCase serialization for frontend IPC
- **AgentAdapter** async trait (Send + Sync) with 6 methods: adapter_type, process_patterns, launch, get_state, get_intent, terminate
- **DB migration 002** enriching agent_sessions (adapter_type, protocol, intent, pid, cwd, launched_by_aitc) and conflict_events (conflict_window_ms, agent_a_id, agent_b_id, hunk_hints)
- Phase 3 Rust dependencies added to Cargo.toml: axum, async-trait, tauri-plugin-notification, toml, regex; tokio "process" feature

### Task 2: AgentRegistry and Adapter Implementations
- **AgentRegistry** with `RwLock<HashMap<String, ManagedAgent>>` for concurrent async access
- Registry operations: upsert_agent (with merge on existing ID), remove_agent, get_agent, all_agents, update_state (with transition validation + warning), update_intent, find_adapter_for_process
- **ClaudeCodeAdapter** -- process patterns: ["claude", "claude-code"], adapter_type: "claude-code"
- **CodexAdapter** -- process pattern: ["codex"], adapter_type: "codex"
- **OpenCodeAdapter** -- process pattern: ["opencode"], adapter_type: "opencode"
- **GenericAdapter** -- TOML config parsing with regex validation, full feature parity per D-03
- Re-exports in mod.rs for clean API surface

## Decisions Made

1. **async-trait crate**: Native async fn in traits is not yet dyn-safe in stable Rust. async-trait 0.1 provides the `#[async_trait]` macro for `Box<dyn AgentAdapter>` dispatch.
2. **Arc over Box for adapters**: Adapters are shared between registry lookups and background tasks, requiring `Arc<dyn AgentAdapter>` not `Box<dyn AgentAdapter>`.
3. **Stateless unit structs**: Built-in adapters (ClaudeCode, Codex, OpenCode) are stateless unit structs per RESEARCH.md anti-pattern guidance. No per-instance state that could cause data races.
4. **Placeholder launch/terminate**: All adapters return `Err("launcher not wired")` for launch/terminate -- Plan 02 wires real subprocess management via launcher.rs.

## Threat Mitigations Applied

- **T-03-01 (TOML config tampering)**: All regex patterns validated via `Regex::new()` at parse time. process_names capped at 20 entries to prevent allowlist flooding.
- **T-03-03 (Registry DoS)**: Registry capped at MAX_AGENTS=100. upsert_agent returns Err when at capacity.

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `cargo test -p aitc --lib -- agents::` exits 0 with 16 tests passing
- All 4 adapter types implement AgentAdapter trait
- GenericAdapter parses sample TOML config with regex validation in tests
- State machine tests cover all valid and invalid transitions

## Self-Check: PASSED

- All 8 created files verified on disk
- Commit 10d7488 (Task 1) verified in git log
- Commit c88e5ab (Task 2) verified in git log
