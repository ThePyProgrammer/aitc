// Phase 11 — shared tuning constants for the d3-force simulation core (D-29).
// Moved verbatim from src/hooks/useGraphLayout.ts:34-52 (Phase 7).
// Importable from the dedicated worker, graphSimCore, and tests
// without pulling in React, zustand, Tauri, or @tauri-apps/* (D-03).
// References: 11-CONTEXT.md D-29; 11-RESEARCH.md §Pattern 2.

// d3-force tuning constants. Exported for tests.
export const LINK_DISTANCE = 40;
export const LINK_STRENGTH = 0.3;
export const CHARGE_STRENGTH = -80;
export const CHARGE_THETA = 0.9;
export const CHARGE_DISTANCE_MAX = 300;
export const CENTER_STRENGTH = 0.05;
export const COLLIDE_RADIUS = 6;
export const ALPHA_DECAY = 0.04;
export const VELOCITY_DECAY = 0.5;
export const MAX_TICKS = 500;
export const REWARM_NODE_COUNT_THRESHOLD = 5;
export const REWARM_PERCENT_THRESHOLD = 0.01;
export const REWARM_ALPHA = 0.3;
export const REWARM_MAX_TICKS = 100;

// Previously a non-exported const at useGraphLayout.ts:52. Promoted to
// shared export because the worker core + tests both reference it.
export const FORCE_CONFIG_ALPHA = 0.35;

// New in Phase 11.
// D-16 — how often the main thread rebuilds its d3-quadtree from the
// incoming Float32Array during an active sim. Every 10th tick message
// ≈ 167ms at 60 tick/s. See 11-RESEARCH.md §Open Questions Q3.
export const QUADTREE_REBUILD_TICK_INTERVAL = 10;

// RESEARCH §Pitfall 1 — seeds simulation.randomSource(mulberry32(seed))
// so worker and tests produce byte-identical initial positions.
export const INITIAL_POSITION_SEED = 0x5eedf04c;
