// Phase 11 — discriminated-union message types for the d3-force Worker
// protocol (D-10, D-11). Convention follows src/bindings.ts FileEventKind
// style (line 694): each member `{ type: 'X'; ... }` — exhaustively
// switchable with a `const _exhaustive: never = msg;` guard.
// References: 11-CONTEXT.md D-10/D-11; 11-RESEARCH.md §Pattern 4.

// ForceConfig is the user-facing tuning quartet (center / cluster / link /
// charge strength). The worker MUST NOT transitively import zustand (D-03),
// and src/stores/radarStore.ts imports `zustand` at module scope — so the
// canonical-for-worker `ForceConfig` is declared locally here. Main-thread
// code continues to use the radarStore definition; Wave 2's shim will
// translate at the postMessage boundary. Shapes must stay structurally
// identical (verified in Task 2 via grep of radarStore.ts:66-72 at plan
// time — 2026-04-17).
export interface ForceConfig {
  centerStrength: number;
  clusterStrength: number;
  linkStrength: number;
  chargeStrength: number;
}

export interface InitMessage {
  type: 'init';
  sequence: number;
  nodes: {
    id: string;
    dirKey: string;
    dirDepth: number;
    fx?: number | null;
    fy?: number | null;
  }[];
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

export type WorkerIn = // see CI acceptance grep "type WorkerIn = "
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
