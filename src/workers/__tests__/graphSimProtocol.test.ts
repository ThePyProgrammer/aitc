// Phase 11 — graphSimProtocol type tests (D-10, D-11).
// Exhaustive-switch assertion via `const _exhaustive: never = m;` — any
// new WorkerIn / WorkerOut variant without a case here fails TS compile.
// References: 11-PATTERNS.md §graphSimProtocol.ts.

import { describe, it, expect } from 'vitest';
import type { WorkerIn, WorkerOut } from '../graphSimProtocol';

function assertExhaustiveIn(m: WorkerIn): string {
  switch (m.type) {
    case 'init': return 'init';
    case 'topology': return 'topology';
    case 'updateConfig': return 'updateConfig';
    case 'pin': return 'pin';
    case 'unpin': return 'unpin';
    case 'returnBuffer': return 'returnBuffer';
    case 'dispose': return 'dispose';
    default: {
      const _exhaustive: never = m;
      void _exhaustive;
      return 'impossible';
    }
  }
}

function assertExhaustiveOut(m: WorkerOut): string {
  switch (m.type) {
    case 'tick': return 'tick';
    case 'settled': return 'settled';
    case 'error': return 'error';
    default: {
      const _exhaustive: never = m;
      void _exhaustive;
      return 'impossible';
    }
  }
}

describe('graphSimProtocol — Phase 11 (D-10, D-11)', () => {
  it('WorkerIn switch is exhaustive (compile time)', () => {
    expect(assertExhaustiveIn({ type: 'dispose' })).toBe('dispose');
  });
  it('WorkerOut switch is exhaustive (compile time)', () => {
    expect(assertExhaustiveOut({ type: 'error', message: 'x' })).toBe('error');
  });
});
