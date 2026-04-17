# Cross-Language Boundary Visualization

> How to make the TS frontend ↔ Rust backend IPC boundary visible, navigable, and agent-traversable on the radar map.

## The Problem

AITC monitors a Tauri app where:
- **TypeScript frontend** calls **Rust backend** via IPC (`invoke()` → `#[tauri::command]`)
- **tauri-specta** generates `src/bindings.ts` with TypeScript types from Rust signatures
- An AI agent working on the frontend might trigger changes that affect backend handlers
- The radar map currently shows all files in one flat graph with no language distinction

Agents don't care about language boundaries. They cross them freely. The map needs to make this visible.

## Prior Art

### Sourcetrail (most relevant)
- **Unified SQLite graph** across all indexed languages
- **Color-coded nodes** by category (types=grey, functions=yellow, variables=blue)
- **"Striped hatching"** for symbols referenced but not defined in indexed source -- a visual hint for cross-boundary references
- **Limitation:** cross-language edges were implicit, not explicit IPC/API connections

### FalkorDB CodeGraph (best schema)
- Explicit typed-edge model: `CALLS`, `DEPENDS_ON`, `CONTAINS`, `INHERITS_FROM`, `WRITTEN_IN`, `DEFINED_IN`
- The `WRITTEN_IN` edge type explicitly tags language per node
- `DEPENDS_ON` can cross language boundaries
- **Directly applicable** as a template for AITC's graph schema

### Sourcegraph/SCIP
- Language-agnostic symbol format (SCIP index)
- Indexers exist for both TypeScript and Rust
- Cross-language navigation partially implemented (e.g., Protobuf → generated Java)

### Microservice Graph Prior Art

| Tool | Approach | Key Pattern |
|------|----------|-------------|
| **Netflix Vizceral** | WebGL animated traffic particles, 3-level hierarchy (region → service → node) | Particles flow along edges showing real-time traffic |
| **Kiali** | 4 graph types (app, versioned app, workload, service), health-colored edges | Namespace filtering, animated HTTP/TCP traffic |
| **Uber CRISP** | DAG from Jaeger traces, critical path via reverse replay | Flame graph + heatmap output |
| **Grafana Tempo** | Auto-generated service graph from trace spans | Health proportions on edges |
| **Backstage** | API-first model -- services are entities, APIs are contracts | APIs as explicit boundary nodes |

### Polyglot Code Explorer
- Uses **git temporal coupling** to reveal cross-language dependencies without AST parsing
- Language coloring on **Voronoi treemaps** makes frontend vs backend instantly recognizable
- Doesn't require understanding each language's import system

## Recommended Approach for AITC

### 1. IPC Bridge Detection Pipeline

Static analysis to discover the TS ↔ Rust boundary:

```
Step 1: Parse src/bindings.ts (tauri-specta output)
        → Extract all command names + their TypeScript signatures
        
Step 2: AST-scan TypeScript files for invoke<T>('command_name')
        → Map each call site to its containing file
        
Step 3: AST-scan Rust files for #[tauri::command] fn handler()
        → Map each handler to its containing file
        
Step 4: Cross-reference
        → For each command: TS caller files ←→ Rust handler file
        → Build bridge nodes connecting them
        
Step 5: Detect orphans
        → Commands defined in Rust but never invoked from TS
        → invoke() calls to non-existent commands (dead code)
```

This pipeline runs on every graph rebuild (when `fetchGraph` fires). It's cheap because `bindings.ts` is the single source of truth -- no need to parse every file.

### 2. Spatial Separation

Frontend files cluster on one side, backend on the other:

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   TypeScript Frontend    │    Rust Backend           │
│                          │                           │
│   ┌───┐  ┌───┐         ◇ start_watch               │
│   │.tsx│──│.ts│────────◇ get_tree_index  ───── .rs  │
│   └───┘  └───┘         ◇ get_dep_graph              │
│     ┌───┐               │          ┌───┐             │
│     │.ts│───────────────◇ list_agents ──── .rs      │
│     └───┘               │          └───┘             │
│                    IPC BOUNDARY                       │
└─────────────────────────────────────────────────────┘
```

Implementation: apply `forceX` pushing TS files toward x=0.3 and Rust files toward x=0.7 of the canvas width. The IPC boundary is a visual divider at x=0.5.

### 3. Bridge Nodes

Each Tauri IPC command becomes a **diamond-shaped node** positioned on the boundary line:

- **Visual:** Diamond icon, neutral color (white/grey), labeled with command name
- **Edges:** TS callers → bridge → Rust handler (two separate edges)
- **Hover:** Shows the full command signature, which TS files call it, which Rust file handles it
- **Agent traversal:** When an agent's comet trail crosses the boundary, it passes through the bridge node, making cross-stack movement visible

### 4. Color Coding

| Language/Runtime | Accent Color | Rationale |
|-----------------|-------------|-----------|
| TypeScript/JS | Blue (#00cffc, secondary) | Convention from VS Code language icons |
| Rust | Orange (#ffd16f, tertiary) | Rust brand color family |
| IPC Bridge | White/grey | Neutral gateway |
| Shared types | Dotted, dim | Structural plumbing, low visual weight |

### 5. Edge Types

| Edge Type | Visual Style | Meaning |
|-----------|-------------|---------|
| `import` | Thin solid arrow (current) | Static import within same language |
| `ipc-call` | Thick dashed arrow, crosses boundary | Frontend invoke() → backend command |
| `type-share` | Dotted line | Shared type via tauri-specta |
| `temporal-coupling` | Faint weighted line | Files that change together in git |

## What This Enables

With IPC bridge nodes, the radar map answers questions like:
- "Which backend commands does this frontend view depend on?"
- "If I change this Rust handler, which frontend files are affected?"
- "Is this agent working on both sides of the IPC boundary?"
- "Are there unused commands? Dead invoke() calls?"

## Sources

Full source list (~30 URLs) available in `outputs/codebase-spatial-representation-research-crosslang.md`.

Key references:
- [Sourcetrail docs](https://github.com/CoatiSoftware/Sourcetrail/blob/master/DOCUMENTATION.md)
- [FalkorDB CodeGraph](https://github.com/FalkorDB/code-graph)
- [Netflix Vizceral](https://github.com/Netflix/vizceral)
- [Kiali](https://kiali.io/)
- [Polyglot Code Explorer](https://polyglot.korny.info/)
