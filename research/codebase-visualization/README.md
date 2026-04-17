# Codebase Visualization Research

Research wiki for the AITC radar graph view. Findings from a 4-researcher deep investigation into how to best represent codebases spatially, track AI agent movement across frontend/backend boundaries, and render it all at interactive framerates.

**Date:** 2026-04-17
**Researchers:** 4 parallel agents, ~170 sources consulted
**Status:** Complete (round 1), informing Phases 11-16

## Pages

- [Synthesis & Recommendations](00-synthesis.md) — the TL;DR, design principles, and what we're building
- [Tool Survey](01-tool-survey.md) — how 14 existing tools represent codebases (Sourcetrail, CodeSee, Understand, aider, Gephi, etc.)
- [Layout Algorithms](02-layout-algorithms.md) — force-directed vs hierarchical vs treemap vs hybrid, with performance benchmarks at scale
- [Cross-Language Boundaries](03-cross-language.md) — how to visualize TS frontend ↔ Rust backend IPC, bridge nodes, microservice graph prior art
- [Agent Overlay & ATC Patterns](04-agent-overlay.md) — ATC radar display patterns, trail persistence, conflict escalation, data blocks
- [Semantic Zoom](05-semantic-zoom.md) — 4-level progressive detail system (workspace → package → file → code)
- [Rendering Architecture](06-rendering-architecture.md) — 7-layer canvas stack, offscreen caching, WebWorker layout

## How This Maps to Phases

| Wiki Page | Informs Phase |
|-----------|--------------|
| Layout Algorithms | Phase 11 (WebWorker layout) |
| Cross-Language Boundaries | Phase 12 (IPC bridge nodes) |
| Semantic Zoom | Phase 13 (4-level zoom) |
| Rendering Architecture | Phase 14 (Offscreen canvas layers) |
| Agent Overlay | Phase 15 (ATC agent overlay) |
| Tool Survey (Louvain, temporal coupling) | Phase 16 (Typed edges + community detection) |
