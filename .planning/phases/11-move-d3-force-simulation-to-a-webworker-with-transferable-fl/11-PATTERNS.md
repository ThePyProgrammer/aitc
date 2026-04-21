# Phase 11: d3-force WebWorker Relocation — Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 11 (7 create, 4 modify)
**Analogs found:** 10 / 11
**Scope:** `src/workers/**` new directory + hot-path refactor of `src/hooks/useGraphLayout.ts` and `src/views/Radar/RadarCanvas.tsx`.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/workers/graphSimCore.ts` (create) | service / pure-core module | event-driven (callback emitters) | `src/views/Radar/forceCluster.ts` | role-match (pure-data force module factory; no DOM/React) |
| `src/workers/graphSim.worker.ts` (create) | worker shim / adapter | message-passing (postMessage) | `src/hooks/usePipelineChannel.ts` | partial — precedent for thin message router exposing a pure downstream API |
| `src/workers/graphSimConfig.ts` (create) | config / constants module | static | `src/hooks/useGraphLayout.ts` lines 34–48 (constant block that gets EXTRACTED) | exact — the constants literally move verbatim |
| `src/workers/graphSimProtocol.ts` (create) | types / protocol module | type-only | `src/bindings.ts` FileEventKind/ResourceEvent (lines 694, 772) | exact — same discriminated-union `{ kind: "X" } \| …` idiom |
| `src/workers/__tests__/graphSimCore.test.ts` (create) | test / unit | synchronous driver | `src/views/Radar/__tests__/forceCluster.test.ts` | exact — pure-core unit test style |
| `src/workers/__tests__/graphSimBenchmark.test.ts` (create) | test / benchmark | PerformanceObserver + timing | none — new pattern | NO ANALOG (see §No Analog Found) |
| `src/workers/__tests__/bufferPool.test.ts` (create) | test / unit | synchronous state | `src/views/Radar/__tests__/forceCluster.test.ts` | role-match — pure-function state tests |
| `src/workers/__tests__/fixtures/tiny-graph.ts` (create) | test fixture | static data | `src/hooks/__tests__/useGraphLayout.test.ts` `seedGraph()` (lines 42–52) + `mulberry32()` (lines 32–40) | exact — port the helpers into a fixture file |
| `src/hooks/useGraphLayout.ts` (modify) | hook / Worker lifecycle client | message-passing + refs | `src/hooks/usePipelineChannel.ts` + `src/hooks/useClaudeResourcesChannel.ts` | exact (for Worker/Channel lifecycle shape) + self (hook return contract) |
| `src/hooks/__tests__/useGraphLayout.test.ts` (modify) | test / hook | mocked Worker + act() | Self (7 existing cases) | preserve structure; only reshape positions-read assertions |
| `src/views/Radar/RadarCanvas.tsx` (modify, hot path ~543-557) | component / Canvas 2D render | rAF read of refs | Self (`RadarCanvas.tsx` lines 543–557) | self-refactor — swap iteration shape, keep call sequence |
| `src/views/Radar/__tests__/RadarCanvas.test.tsx` (modify) | test / component | jsdom render + canvas spy | Self | preserve canvas-shim scaffolding |

---

## Pattern Assignments

### `src/workers/graphSimCore.ts` (pure-core factory module)

**Primary analog:** `src/views/Radar/forceCluster.ts` (factory returning an object with call signature + methods; no DOM; no React; no `self`; exports tuning constants for tests).

**Header comment pattern** (copy from `useGraphLayout.ts:1-14` / `forceCluster.ts:1-15`):
```typescript
// D-01..D-04, D-10..D-19, D-22, D-29: pure d3-force orchestration core.
// Factory returns { init, topology, updateConfig, pin, unpin, tick,
// returnBuffer, dispose } driven by callbacks (onTick/onSettled/onError)
// rather than postMessage — enables synchronous Vitest exercise per D-24.
//
// No references to self / postMessage / Worker / DOM — enforced by CI
// grep assertion. See 11-RESEARCH.md §Validation Architecture.
//
// Prior art: src/views/Radar/forceCluster.ts is the same zero-DOM factory
// idiom for a d3-force-integrated module.
```

**Imports pattern** (copy shape from `useGraphLayout.ts:16-27` — same d3-force surface the hook already wires; strip `react` + `zustand` imports):
```typescript
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import { forceCluster, forceClusterCollide, type ClusterNode } from '../views/Radar/forceCluster';
import {
  LINK_DISTANCE,
  CHARGE_THETA,
  CHARGE_DISTANCE_MAX,
  COLLIDE_RADIUS,
  ALPHA_DECAY,
  VELOCITY_DECAY,
  MAX_TICKS,
  FORCE_CONFIG_ALPHA,
  QUADTREE_REBUILD_TICK_INTERVAL,
} from './graphSimConfig';
import type { InitMessage, TopologyMessage, ForceConfig } from './graphSimProtocol';
```
The zustand / react / bindings imports that `useGraphLayout.ts` has today MUST NOT appear here (D-03).

**Factory export pattern** (copy from `forceCluster.ts:155-196`) — a factory returning an object literal with methods + a chainable setter:
```typescript
// Mirrors forceCluster() shape: no class, no `this`, closure-captured state.
export function makeGraphSimCore(
  cb: GraphSimCallbacks,
  opts?: { schedule?: (fn: () => void) => void },
): GraphSimCore {
  let sim: Simulation<SimNode, SimEdge> | null = null;
  let simNodes: SimNode[] = [];
  let ids: string[] = [];
  let sequence = 0;
  let paused = true;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  const schedule = opts?.schedule ?? ((fn) => { scheduled = setTimeout(fn, 0); });
  // … buffer pool state per Pattern 3 …

  function tickLoop() { /* … */ }

  return {
    init(msg) { /* … */ },
    topology(msg) { /* … */ },
    updateConfig(cfg) { /* … sim.alpha(FORCE_CONFIG_ALPHA).restart() … */ },
    pin(id, x, y) { /* … */ },
    unpin(id) { /* … */ },
    tick() { /* test-only synchronous single tick */ },
    returnBuffer(buf) { /* … */ },
    dispose() { /* sim?.stop(); … */ },
  };
}
```

**Simulation-construction pattern to port verbatim** (from `useGraphLayout.ts:119-140`, the ONE load-bearing block that moves into the core; only change is mapping the topology-message shape instead of `GraphNode[]`):
```typescript
const sim = forceSimulation<SimNode>(simNodes)
  .force('link', forceLink<SimNode, SimEdge>(simEdges)
    .id((n) => n.id).distance(LINK_DISTANCE).strength(cfg.linkStrength))
  .force('charge', forceManyBody<SimNode>()
    .strength(cfg.chargeStrength).theta(CHARGE_THETA).distanceMax(CHARGE_DISTANCE_MAX))
  .force('center', forceCenter(0, 0).strength(cfg.centerStrength))
  .force('collide', forceCollide(COLLIDE_RADIUS))
  .force('cluster', forceCluster().strength(cfg.clusterStrength))
  .force('clusterCollide', forceClusterCollide())
  .alphaDecay(ALPHA_DECAY)
  .velocityDecay(VELOCITY_DECAY)
  .stop();
```
Load-bearing differences from the analog:
1. DO NOT register `sim.on('tick', …)` or `sim.on('end', …)` — they never fire from manual `.tick()` (see RESEARCH Pitfall 6). Emit `onTick`/`onSettled` directly from `tickLoop`.
2. Initial-position seeding (`(Math.random() - 0.5) * 200` at `useGraphLayout.ts:107-108`) MOVES IN HERE. Prefer `sim.randomSource(mulberry32(INITIAL_POSITION_SEED))` per RESEARCH §Don't Hand-Roll for byte-determinism.

**Fast-settle pattern to port verbatim** (from `useGraphLayout.ts:145-150`):
```typescript
if (fastSettle) {
  for (let i = 0; i < MAX_TICKS && sim.alpha() > sim.alphaMin(); i++) {
    sim.tick();
  }
}
```

**Pin/unpin pattern** — adapt from `radarStore.pinNode`/`unpinNode` (lines 257-285) but operate on `simNodes[idx]` directly (worker-local mutation, NOT store mutation):
```typescript
function pin(id: string, x: number, y: number): void {
  const i = idIndex.get(id);
  if (i === undefined) return;
  const n = simNodes[i];
  n.fx = x; n.fy = y; n.x = x; n.y = y;
  if (paused) { sim!.alpha(FORCE_CONFIG_ALPHA).restart(); resumeTickLoop(); }
}
function unpin(id: string): void {
  const i = idIndex.get(id);
  if (i === undefined) return;
  simNodes[i].fx = null; simNodes[i].fy = null;
}
```

**Error pattern** — there is no prior analog for worker-side error reporting; use the pattern the research prescribes:
```typescript
try { sim.tick(); } catch (err) {
  cb.onError({
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  paused = true;
}
```

---

### `src/workers/graphSim.worker.ts` (thin postMessage router shim, ≤~50 LOC)

**Primary analog:** `src/hooks/usePipelineChannel.ts` + `src/hooks/useClaudeResourcesChannel.ts` — same "thin adapter that wires a message source's `onmessage` into a downstream pure API" shape. The worker shim is to the main-thread hook what these Channel hooks are to the Zustand store.

**Header + triple-slash reference pattern** (copy the Phase-tagging style from `useClaudeResourcesChannel.ts:1-10`; add the `webworker` lib reference that Phase 11 newly needs — no prior codebase analog for that directive):
```typescript
// Phase 11 — dedicated-worker shim for d3-force relocation (D-01, D-02, D-23).
// Thin (~50 LOC) postMessage router + buffer pool. All orchestration lives
// in graphSimCore.ts so the shim has minimal testable logic (D-22/D-23).
/// <reference lib="webworker" />
```

**Structure pattern** (adopt the file-scoped `const ctx = self as …`; `ctx.onmessage = (evt) => { switch(m.type) { … } }` idiom — same shape as the `Channel<T>.onmessage` assignment in `usePipelineChannel.ts:22-26`):
```typescript
// Copied conceptually from usePipelineChannel.ts:22-26 — one side-effect
// assignment installs a typed message handler.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

const core = makeGraphSimCore(
  {
    onTick: (m) => ctx.postMessage({ type: 'tick', ...m } satisfies WorkerOut,
                                    { transfer: [m.positions.buffer] }),
    onSettled: (m) => ctx.postMessage({ type: 'settled', ...m } satisfies WorkerOut,
                                       { transfer: [m.positions.buffer] }),
    onError: (m) => ctx.postMessage({ type: 'error', ...m } satisfies WorkerOut),
  },
  { schedule: (fn) => setTimeout(fn, 0) },   // D-13 rationale per RESEARCH Pattern 2
);

ctx.onmessage = (evt: MessageEvent<WorkerIn>) => {
  const m = evt.data;
  switch (m.type) {
    case 'init':         core.init(m); break;
    case 'topology':     core.topology(m); break;
    case 'updateConfig': core.updateConfig(m.config); break;
    case 'pin':          core.pin(m.id, m.x, m.y); break;
    case 'unpin':        core.unpin(m.id); break;
    case 'returnBuffer': core.returnBuffer(m.buffer); break;
    case 'dispose':      core.dispose(); ctx.close(); break;
    default: { const _exhaustive: never = m; void _exhaustive; }
  }
};
```

**Exhaustiveness-check pattern** — no prior codebase use; adopt the `never` assignment idiom recommended by RESEARCH §Don't Hand-Roll. Copy into `useGraphLayout.ts`'s `onmessage` for `WorkerOut` switch too.

**Imports allowlist (D-03)** — verify via CI grep; only these are allowed:
```typescript
import { makeGraphSimCore } from './graphSimCore';
import type { WorkerIn, WorkerOut } from './graphSimProtocol';
```
No `zustand`, no `@tauri-apps/*`, no `react`, no `../bindings`, no `../stores/*`.

---

### `src/workers/graphSimConfig.ts` (shared tuning constants)

**Primary analog:** the constant block at the top of `src/hooks/useGraphLayout.ts:34-52`. The file literally extracts those lines unchanged and re-exports them.

**Pattern** (copy from `useGraphLayout.ts:34-52` verbatim, add the new `QUADTREE_REBUILD_TICK_INTERVAL` from RESEARCH §Open Question 3 + the `INITIAL_POSITION_SEED` from RESEARCH §Pitfall 1):
```typescript
// D-29: tuning constants for the force simulation, importable by the worker,
// the graphSimCore, and tests — without pulling in React or zustand.
// Moved verbatim from src/hooks/useGraphLayout.ts:34-52 (Phase 7).

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
export const FORCE_CONFIG_ALPHA = 0.35;

// New in Phase 11.
export const QUADTREE_REBUILD_TICK_INTERVAL = 10;   // D-16; RESEARCH Open Question 3
export const INITIAL_POSITION_SEED = 0x5EED_F0RCE;   // RESEARCH Pitfall 1
```

**Import-site update (useGraphLayout.ts):** the hook's current `export const`s at lines 34-48 become `import` lines that re-export from `./graphSimConfig` — preserves existing test imports at `useGraphLayout.test.ts:15-23`.

---

### `src/workers/graphSimProtocol.ts` (discriminated-union message types)

**Primary analog:** `src/bindings.ts` lines 634 / 672 / 694 / 772 — the `{ kind: "X"; … } | { kind: "Y"; … }` pattern used throughout tauri-specta-generated types.

**Pattern** (adopt the bindings.ts discriminated-union style but use `type` as the discriminator for consistency with the message-protocol convention in RESEARCH §Pattern 2, and because `kind` is already overloaded in `FileEventKind`):
```typescript
// D-10, D-11 — discriminated-union message types for the worker protocol.
// Convention follows src/bindings.ts FileEventKind style (line 694):
// each member is `{ type: 'X'; … }` — exhaustively switchable.

import type { ForceConfig } from '../stores/radarStore';

export interface InitMessage {
  type: 'init';
  sequence: number;
  nodes: { id: string; dirKey: string; dirDepth: number; fx?: number | null; fy?: number | null }[];
  edges: { source: string; target: string; kind: string }[];
  config: ForceConfig;
  alpha: number;
  fastSettle: boolean;
}

export interface TopologyMessage {
  type: 'topology';
  sequence: number;
  nodes: InitMessage['nodes'];
  edges: InitMessage['edges'];
  config: ForceConfig;
}

export type WorkerIn =
  | InitMessage
  | TopologyMessage
  | { type: 'updateConfig'; config: ForceConfig }
  | { type: 'pin'; id: string; x: number; y: number }
  | { type: 'unpin'; id: string }
  | { type: 'returnBuffer'; buffer: ArrayBuffer }
  | { type: 'dispose' };

export type WorkerOut =
  | { type: 'tick'; positions: Float32Array; alpha: number; sequence: number }
  | { type: 'settled'; positions: Float32Array; alpha: number; sequence: number }
  | { type: 'error'; message: string; stack?: string };

export type { ForceConfig };
```

**Import-ForceConfig note:** `ForceConfig` is currently defined in `radarStore.ts`. The worker MUST NOT import from `../stores/*` (D-03). Re-export through `graphSimProtocol.ts` as shown above and verify the re-export triggers no transitive zustand import — if `radarStore.ts` top-level imports zustand, move `ForceConfig` into `graphSimProtocol.ts` outright and re-export from `radarStore.ts` in the other direction. The planner should confirm this during Wave 0.

---

### `src/workers/__tests__/graphSimCore.test.ts` (unit tests)

**Primary analog:** `src/views/Radar/__tests__/forceCluster.test.ts` — same "pure-core, synchronous, no React harness" shape.

**Imports + mulberry32 pattern** (copy verbatim from `forceCluster.test.ts:9-28`):
```typescript
import { describe, it, expect } from 'vitest';
import { makeGraphSimCore } from '../graphSimCore';
import type { InitMessage } from '../graphSimProtocol';
import { tinyGraph } from './fixtures/tiny-graph';

// mulberry32 seeded RNG — keeps layout tests deterministic
// per 07-RESEARCH §Validation Determinism (lines 900-907).
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
```

**Describe-block + test-case pattern** (copy shape from `forceCluster.test.ts:30-134`):
```typescript
describe('graphSimCore (worker pure core) — Phase 11', () => {
  it('init builds sim and fast-settles synchronously before first onTick (D-19)', () => {
    const ticks: { alpha: number; sequence: number }[] = [];
    const core = makeGraphSimCore({
      onTick: (m) => ticks.push({ alpha: m.alpha, sequence: m.sequence }),
      onSettled: () => {},
      onError: () => { throw new Error('unexpected'); },
    });
    core.init({ type: 'init', sequence: 1, ...tinyGraph, alpha: 1, fastSettle: true });
    // Synchronous MAX_TICKS bound — at 50-node graph alpha cools well before 500.
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('tick() emits Float32Array via onTick callback (D-05)', () => { /* … */ });
  it('settled fires once alpha <= alphaMin (D-15)', () => { /* … */ });
  it('updateConfig alpha-restarts to FORCE_CONFIG_ALPHA (D-10)', () => { /* … */ });
  it('pin sets fx/fy on named node; unpin clears (D-20, D-21)', () => { /* … */ });
  it('returnBuffer re-enters pool (D-06)', () => { /* … */ });
  it('sequence counter bumps on topology; stale callbacks dropped on main', () => { /* … */ });
  it('detached-buffer: after onTick transfers, byteLength===0 until returnBuffer', () => { /* … */ });
  it('backpressure: with 2 outstanding, worker uses spare then skips transfer (D-09, D-34)', () => { /* … */ });
  it('zero DOM references: module loads in plain Node without self/Worker globals', () => { /* … */ });
});
```

**CI isolation assertion** (new pattern, not in existing tests — but a common `grep` gate in `*.test.ts` files is used in `src/__tests__/bindings.sync.test.ts` style if it exists):
```typescript
it('graphSimCore source has no self/postMessage/Worker references (D-22, D-24)', async () => {
  const src = await import('node:fs/promises').then(fs =>
    fs.readFile(new URL('../graphSimCore.ts', import.meta.url), 'utf8'));
  expect(src).not.toMatch(/\b(self|postMessage|onmessage|new Worker)\b/);
});
```

---

### `src/workers/__tests__/graphSimBenchmark.test.ts` (gated perf benchmark)

**Primary analog:** NONE in codebase. This is a new test-category. The shape below is derived entirely from RESEARCH §Performance Benchmark Harness.

**Gating pattern** (from RESEARCH §Performance Benchmark Harness — `describe.skipIf` keeps it out of the default-green CI gate):
```typescript
// Phase 11 D-31..D-34 — acceptance-criterion perf harness.
// Gated behind BENCH=1 to keep `npm run test` fast; developers opt in when profiling.
// No codebase analog — new pattern. See 11-RESEARCH.md §Performance Benchmark Harness.

import { describe, it, expect } from 'vitest';
import { makeGraphSimCore } from '../graphSimCore';
import { seedGraph, mulberry32 } from './fixtures/tiny-graph';

describe.skipIf(!process.env.BENCH)('graphSimCore — perf harness (D-31..D-34)', () => {
  it('settles 5k nodes with zero >50ms long tasks on main', () => {
    // Frame-bracket synthetic measurement (jsdom has no Long Task API).
    const rng = mulberry32(1);
    const nodes = seedGraph(5000, 'src', rng);
    // … drive core synchronously, time each tick() via performance.now() …
    // Assert: max single-tick time < 50ms; 95p < 5ms.
  });
  it('worker drives ≥30 effective ticks/sec at 5k (D-33)', () => { /* … */ });
  it('in-flight transfer count stays ≤2 under steady state (D-34)', () => { /* … */ });
});
```

---

### `src/workers/__tests__/bufferPool.test.ts` (unit tests)

**Primary analog:** `src/views/Radar/__tests__/forceCluster.test.ts` — pure-function state tests with no React harness.

**Pattern:** if the buffer pool is extracted as a named export from `graphSimCore.ts` (`createBufferPool(n: number)`), tests look like:
```typescript
import { describe, it, expect } from 'vitest';
import { createBufferPool } from '../graphSimCore';  // or from a sub-module

describe('bufferPool — Phase 11 D-06/D-09/D-34', () => {
  it('acquires fresh buffer, marks detached after transfer simulation', () => { /* … */ });
  it('returnBuffer re-wraps ArrayBuffer into pool', () => { /* … */ });
  it('caps at 3 allocations; extra acquires return null', () => { /* … */ });
  it('validates buf.byteLength === N*2*4 before re-wrapping (security §V5)', () => { /* … */ });
});
```

No prior analog for ArrayBuffer transfer simulation; emulate by calling `structuredClone(buf, { transfer: [buf] })` to detach in a test env.

---

### `src/workers/__tests__/fixtures/tiny-graph.ts` (test fixture)

**Primary analog:** `src/hooks/__tests__/useGraphLayout.test.ts:32-76` — the file-local `mulberry32`, `seedGraph`, `withSeededRandom`, `setStoreGraph`, `mutateStoreGraph` helpers. Phase 11 shares the `mulberry32`/`seedGraph` helpers between three new test files, so they belong in a fixture module.

**Pattern** (extract verbatim from `useGraphLayout.test.ts:32-52` — copy into fixture, export):
```typescript
// Phase 11 — shared test fixtures. Extracted from
// src/hooks/__tests__/useGraphLayout.test.ts:32-52 (Phase 7 Plan 03).
// Deterministic seeded graph ≤50 nodes; keeps each vitest run <100ms.
import type { InitMessage } from '../../graphSimProtocol';

export function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedGraph(
  nodeCount: number,
  dirKey = 'src/foo',
): InitMessage['nodes'] {
  const out: InitMessage['nodes'] = [];
  for (let i = 0; i < nodeCount; i++) {
    out.push({
      id: `${dirKey}/n${i}.ts`,
      dirKey,
      dirDepth: dirKey.split('/').length,
    });
  }
  return out;
}

export const tinyGraph = {
  nodes: seedGraph(20),
  edges: [] as InitMessage['edges'],
  config: { centerStrength: 0.05, clusterStrength: 0.08, linkStrength: 0.3, chargeStrength: -80 },
};
```

Once this fixture exists, **delete** the duplicate helpers from `useGraphLayout.test.ts:32-52` and import from this fixture (keeps the test suite DRY; reduces risk of future drift).

---

### `src/hooks/useGraphLayout.ts` (MODIFY — becomes Worker lifecycle client)

**Primary analog:** `src/hooks/usePipelineChannel.ts` + `src/hooks/useClaudeResourcesChannel.ts` — canonical "hook owns an async message source, wires `onmessage`, exposes imperative actions, cleans up in effect return". Phase 11's Worker is structurally the same as their `Channel<T>`.

**Self-preservation contract:** the return type `UseGraphLayoutResult` stays identical (see `useGraphLayout.ts:64-72`). Only `simNodesRef.current`'s *internal* shape changes from `SimNode[]` to `{ ids: string[]; positions: Float32Array; idIndex: Map<string, number> }`. Because `simNodesRef` is a `MutableRefObject`, the exported type needs a parametric update but `RadarCanvas.tsx` reads it through TypeScript — the compiler will catch every mismatched usage.

**Worker construction pattern** (adapt `usePipelineChannel.ts:21-32` — the `useEffect(() => { const ch = new Channel(); ch.onmessage = …; ref.current = ch; return () => { ref.current = null; }; }, [])` skeleton):
```typescript
// Analog: src/hooks/usePipelineChannel.ts:21-32 — same lifecycle skeleton.
// The Worker is to this hook what Channel<FileEventBatch> is to usePipelineChannel.
useEffect(() => {
  // D-02: Vite literal-inline pattern — new URL must be in the constructor arg.
  const worker = new Worker(
    new URL('../workers/graphSim.worker.ts', import.meta.url),
    { type: 'module' },
  );
  workerRef.current = worker;

  worker.onmessage = (evt: MessageEvent<WorkerOut>) => { /* router */ };
  worker.onerror = (e) => { console.error('[graphSim.worker]', e); };

  return () => {
    worker.onmessage = null;
    worker.onerror = null;
    try { worker.postMessage({ type: 'dispose' }); } catch { /* ignore */ }
    worker.terminate();
    workerRef.current = null;
  };
}, []);  // empty deps — worker lifetime = hook lifetime (NOT graph lifetime)
```

**Imperative-action pattern** (adapt from `useClaudeResourcesChannel.ts:32-48` — `useCallback` wrapping an action that sends to the channel):
```typescript
const postInit = useCallback((nodes: GraphNode[], edges: GraphEdge[], cfg: ForceConfig) => {
  topologySeqRef.current++;
  workerRef.current?.postMessage({
    type: 'init',
    sequence: topologySeqRef.current,
    nodes: nodes.map(n => ({ id: n.id, dirKey: n.dirKey, dirDepth: n.dirDepth, fx: n.fx, fy: n.fy })),
    edges: edges.map(e => ({
      source: typeof e.source === 'string' ? e.source : e.source.id,
      target: typeof e.target === 'string' ? e.target : e.target.id,
      kind: e.kind,
    })),
    config: cfg,
    alpha: 1,
    fastSettle: true,
  });
}, []);
```

**Effect-to-postMessage pattern** — the existing `useEffect` at `useGraphLayout.ts:209-215` (initial build) becomes a `postInit(…)` side-effect; `useEffect` at lines 218-226 (rewarm) becomes a `postTopology(…)` call; `useEffect` at lines 231-254 (force-config change) becomes a `worker.postMessage({ type: 'updateConfig', config })` call. Keep the rewarm-threshold `shouldRewarm(currentIds)` function (`useGraphLayout.ts:193-206`) on main — it gates whether to post `topology`.

**`onmessage` router pattern** — no exact codebase analog for the protocol-switch; use the same exhaustive-`never` guard as the worker shim:
```typescript
worker.onmessage = (evt: MessageEvent<WorkerOut>) => {
  const msg = evt.data;
  // D-12 sequence guard
  if ((msg.type === 'tick' || msg.type === 'settled') &&
      msg.sequence < topologySeqRef.current) {
    // Stale — return buffer, drop positions.
    workerRef.current?.postMessage(
      { type: 'returnBuffer', buffer: msg.positions.buffer },
      { transfer: [msg.positions.buffer] });
    return;
  }
  switch (msg.type) {
    case 'tick': { /* update simNodesRef; rebuild quadtree every N; markDirty */ break; }
    case 'settled': { /* rebuild quadtree; commitSettledPositions; isSimulatingRef=false */ break; }
    case 'error': { console.error('[graphSim]', msg.message, msg.stack); break; }
    default: { const _exhaustive: never = msg; void _exhaustive; }
  }
};
```

**Pin/unpin subscription pattern** — wire `radarStore`'s `pinnedNodeIds` Set changes (or intercept `pinNode`/`unpinNode` at the action level). Adopt the `useRadarStore.subscribe` idiom; there's no exact analog, but RadarCanvas uses `useShallow` for render-time subscription. For action proxying, use an effect:
```typescript
// On store pin changes, post pin/unpin to the worker.
useEffect(() => {
  const unsub = useRadarStore.subscribe((s, prev) => {
    const added = [...s.pinnedNodeIds].filter(id => !prev.pinnedNodeIds.has(id));
    const removed = [...prev.pinnedNodeIds].filter(id => !s.pinnedNodeIds.has(id));
    for (const id of added) {
      const n = s.graphNodes.find(x => x.id === id);
      if (n && n.fx != null && n.fy != null)
        workerRef.current?.postMessage({ type: 'pin', id, x: n.fx, y: n.fy });
    }
    for (const id of removed) {
      workerRef.current?.postMessage({ type: 'unpin', id });
    }
  });
  return unsub;
}, []);
```

**Commit-settled pattern to preserve** (from `useGraphLayout.ts:170-182` — moves into the `onmessage('settled')` branch):
```typescript
// Inside case 'settled':
const finalPositions = new Map<string, { x: number; y: number }>();
const { ids } = simNodesRef.current;
for (let i = 0; i < ids.length; i++) {
  finalPositions.set(ids[i], { x: msg.positions[i*2], y: msg.positions[i*2+1] });
}
quadtreeRef.current = quadtree<{ id: string; x: number; y: number }>()
  .x(n => n.x).y(n => n.y)
  .addAll(Array.from(finalPositions, ([id, p]) => ({ id, ...p })));
useRadarStore.getState().commitSettledPositions(finalPositions);
isSimulatingRef.current = false;
```
Note: `quadtreeRef` type widens slightly — the quadtree no longer holds a `SimNode` (which has `dirKey`/`dirDepth`). Verify consumers at the hit-test call sites in `RadarCanvas.tsx` only need `{id,x,y}`.

---

### `src/hooks/__tests__/useGraphLayout.test.ts` (MODIFY)

**Primary analog:** self (`useGraphLayout.test.ts:1-290`) — 7 cases must survive.

**Mock-Worker pattern** (per RESEARCH §Pattern 7 — no codebase analog; adopt as prescribed). Place in the test file's top-level `beforeEach`:
```typescript
// RESEARCH §Pattern 7 — mock Worker constructor with sync graphSimCore.
beforeEach(() => {
  vi.stubGlobal('Worker', class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    private core = makeGraphSimCore({
      onTick: (m) => this.dispatch({ type: 'tick', ...m }),
      onSettled: (m) => this.dispatch({ type: 'settled', ...m }),
      onError: (m) => this.dispatch({ type: 'error', ...m }),
    }, { schedule: (fn) => fn() });   // synchronous in tests
    postMessage(msg: WorkerIn) {
      switch (msg.type) {
        case 'init': this.core.init(msg); break;
        case 'topology': this.core.topology(msg); break;
        case 'updateConfig': this.core.updateConfig(msg.config); break;
        case 'pin': this.core.pin(msg.id, msg.x, msg.y); break;
        case 'unpin': this.core.unpin(msg.id); break;
        case 'returnBuffer': this.core.returnBuffer(msg.buffer); break;
        case 'dispose': this.core.dispose(); break;
      }
    }
    terminate() { this.core.dispose(); }
    private dispatch(data: WorkerOut) { this.onmessage?.({ data } as MessageEvent<WorkerOut>); }
  });
});
```

**Test preservation:** keep `withSeededRandom`, `setStoreGraph`, `mutateStoreGraph` helpers — they're orthogonal to the Worker move. The 7 existing cases' assertions about `s.settledAt`, `s.graphNodes[i].x`, `quadtreeRef.current.find(…)` all survive because the hook's **observable** contract stays identical.

**One adjustment:** the "deterministic settle" case at lines 193-265 currently has a 50-world-unit tolerance workaround for Math.random drift. If the planner adopts `randomSource(mulberry32(INITIAL_POSITION_SEED))` in `graphSimCore`, tighten to < 0.01 world-units (byte-determinism). If not, keep the existing 50-unit tolerance.

---

### `src/views/Radar/RadarCanvas.tsx` hot path ~543-557 (MODIFY)

**Self-analog:** exact same lines, new iteration shape per RESEARCH §Pattern 5 / Example C.

**Current code** (`RadarCanvas.tsx:543-558`):
```typescript
const simulating = isSimulatingRef.current;
let liveNodes = s.graphNodes;
let livePositions = s.positions;
if (simulating && simNodesRef.current.length > 0) {
  liveNodes = simNodesRef.current as typeof s.graphNodes;
  simPositionMap.clear();
  for (const n of simNodesRef.current) {
    if (n.x !== undefined && n.y !== undefined) {
      simPositionMap.set(n.id, { x: n.x, y: n.y });
    }
  }
  livePositions = simPositionMap;
}
```

**New code** (per RESEARCH Example C):
```typescript
const simulating = isSimulatingRef.current;
let liveNodes = s.graphNodes;   // keeps dirKey/dirDepth metadata (unchanged)
let livePositions = s.positions;
const live = simNodesRef.current;   // { ids, positions: Float32Array, idIndex }
if (simulating && live.positions.byteLength > 0) {
  simPositionMap.clear();
  const { ids, positions } = live;
  for (let i = 0; i < ids.length; i++) {
    const p = xyPool[i] ?? (xyPool[i] = { x: 0, y: 0 });
    p.x = positions[i * 2];
    p.y = positions[i * 2 + 1];
    simPositionMap.set(ids[i], p);
  }
  livePositions = simPositionMap;
  // liveNodes STAYS s.graphNodes — no more `as typeof s.graphNodes` cast-lie;
  // drawFolderHulls/drawNodes consume metadata from graphNodes while
  // position-readers use livePositions. Signatures unchanged (D-26).
}
```

**`xyPool` declaration** — add near other file-scoped mutable scratch (near `simPositionMap` declaration, which lives in component state). Allocate lazily; cap length at current graph size:
```typescript
const xyPool = useRef<{ x: number; y: number }[]>([]).current;
```

**Call-site contract preservation (D-26):** `drawEdges`, `drawArrowHeads`, `drawNodes`, `drawFolderHulls`, `drawFileLabels`, `drawSelectedNode`, `drawCometTrails`, `drawAgentDots`, `drawConflictPulses` all keep their current signatures. Verify no consumer reads `liveNodes[i].x` — they should all go through `livePositions.get(id)`.

---

### `src/views/Radar/__tests__/RadarCanvas.test.tsx` (MODIFY)

**Self-analog:** `RadarCanvas.test.tsx:1-80` — keep the canvas-shim scaffolding, Path2D polyfill, ResizeObserver shim, rAF coercion.

**Adjustments:** if any tests poke into `simNodesRef.current[0].x` or treat it as an array, they need to consume the new `{ids, positions, idIndex}` shape. Grep for `simNodesRef` in the test file — if no references, no change needed; otherwise refactor per the hot-path pattern above.

The Worker mock from `useGraphLayout.test.ts` automatically applies here too (stubbed globally), provided the `beforeEach` is invoked in this file too (or extracted to `test-setup.ts`).

---

## Shared Patterns

### Authentication / Authorization
N/A — Phase 11 is frontend-only, same-origin, no network surface.

### Discriminated-Union Message Protocol (shared across worker/main/tests)

**Source:** `src/bindings.ts` lines 634, 672, 694, 772 (tauri-specta convention).

**Apply to:** `graphSimProtocol.ts`, the `switch(msg.type)` in `graphSim.worker.ts` + `useGraphLayout.ts` `onmessage`, and the mock `postMessage` in `useGraphLayout.test.ts`. Enforce exhaustiveness via `const _exhaustive: never = msg;` default-branch guard — compile-time catch of protocol drift.

### Seeded-PRNG Determinism in Tests

**Source:** `src/hooks/__tests__/useGraphLayout.test.ts:32-64` (`mulberry32`, `withSeededRandom`) + `src/views/Radar/__tests__/forceCluster.test.ts:20-28` (same `mulberry32`).

**Apply to:** `src/workers/__tests__/fixtures/tiny-graph.ts` (extract), `graphSimCore.test.ts`, `bufferPool.test.ts`, `graphSimBenchmark.test.ts`. When `graphSimCore` uses `sim.randomSource(mulberry32(INITIAL_POSITION_SEED))`, the fixture's helper is what tests use to assert byte-determinism.

### Hot-Path Refs Over Store Subscriptions

**Source:** `src/hooks/useGraphLayout.ts:74-80` — `simNodesRef`, `quadtreeRef`, `isSimulatingRef`, `markDirtyRef`. RadarCanvas reads these at 60fps without triggering React renders.

**Apply to:** the refactored `useGraphLayout.ts` MUST preserve this ref-exposure shape. DO NOT put positions/Float32Array in the Zustand store (except for settled positions via `commitSettledPositions`, which are low-frequency per D-28). The buffer pool is hook-local state; the Worker ref is hook-local; the sequence counter is hook-local.

### Pure-Factory-Returning-Object Idiom

**Source:** `src/views/Radar/forceCluster.ts:155-196` — `forceCluster()`/`forceClusterCollide()` factories returning callable objects with chainable setters + `initialize`.

**Apply to:** `makeGraphSimCore(cb, opts) → GraphSimCore`. No classes, no `this`-binding gotchas, closure-captured state. Matches the project's existing "factory returns object literal with methods" convention.

### React Effect Cleanup for External Resource

**Source:** `src/hooks/usePipelineChannel.ts:21-32` + `src/hooks/useClaudeResourcesChannel.ts:19-30` — `useEffect(() => { const ch = new Channel(); ref.current = ch; return () => { ref.current = null; }; }, [])`.

**Apply to:** the Worker-lifecycle `useEffect` in `useGraphLayout.ts`. Strictly empty deps. Always `worker.terminate()` in cleanup (StrictMode double-mount invariant). Also `postMessage({type:'dispose'})` before terminate so the worker gets a chance to stop its setTimeout loop cleanly.

### File-Header Convention

**Source:** All existing files in `src/hooks/` and `src/views/Radar/` — each file starts with `// Phase N <name> — <brief>.` or `// D-XX, D-YY: <summary>.` + references to planning docs.

**Apply to:** every new file under `src/workers/`. Pattern:
```
// Phase 11 — <module purpose> (D-XX, D-YY, ...).
// <one-paragraph what/why>
// References: 11-CONTEXT.md D-XX; 11-RESEARCH.md §Pattern N.
```

### Validation / Input Sanitization (ASVS V5)

**Source:** No direct codebase analog (Phase 2 pipeline ingestion is currently unchecked). Adopt the new pattern per RESEARCH §Security Domain.

**Apply to:** worker-side `returnBuffer` validation — `if (buf.byteLength !== N * 2 * 4) { /* drop, allocate replacement */ }`. Also apply to `topology`/`init` — reject messages where `nodes.length === 0` or where node-id collisions exist in the `idIndex` build.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/workers/__tests__/graphSimBenchmark.test.ts` | test / benchmark | PerformanceObserver + timing | No prior `PerformanceObserver` or `BENCH=1` gated benchmark harness exists in the codebase. Planner should adopt the shape from RESEARCH §Performance Benchmark Harness. New testing pattern for the project. |

---

## Metadata

**Analog search scope:**
- `src/hooks/**/*.ts` (8 files; useGraphLayout, usePipelineChannel, useClaudeResourcesChannel, useCanvasZoomPan)
- `src/views/Radar/**/*.{ts,tsx}` (forceCluster, RadarCanvas, GraphRenderer, CometTrail, RadarMinimap, HeatMapOverlay, themes, ForceConfigPanel, and their tests)
- `src/stores/radarStore.ts` (contract for pin/unpin/commitSettledPositions/forceConfig)
- `src/bindings.ts` (discriminated-union type convention, lines 634/672/694/772)
- `src/test-setup.ts` + `vitest.config.ts` (test env shape)
- `vite.config.ts` + `tsconfig.json` (bundler + lib surface)

**Files scanned:** ~35 source files, ~8 test files.

**Pattern extraction date:** 2026-04-17.

**Key cross-file invariants preserved:**
1. `UseGraphLayoutResult` return shape (hook→RadarCanvas contract).
2. `commitSettledPositions` / `pinNode` / `unpinNode` / `forceConfig` store slots (hook↔store contract).
3. `drawEdges` / `drawArrowHeads` / `drawNodes` / `drawFolderHulls` / `drawFileLabels` / `drawSelectedNode` signatures (hook↔renderer contract).
4. `quadtreeRef.current.find(x, y, r?)` hit-test API (RadarCanvas mousemove consumer).
5. File-header phase-tagging convention (all new files).
6. `mulberry32` determinism helper (single source of truth via `fixtures/tiny-graph.ts`).
