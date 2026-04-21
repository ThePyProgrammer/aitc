// Phase 11 — buffer pool unit tests (D-06, D-09, D-34, RESEARCH Pitfall T-4).
// Wave 1 replaces Wave 0's it.todo markers with real assertions.
// References: 11-PATTERNS.md §bufferPool.test.ts; 11-VALIDATION.md.

import { describe, it, expect } from 'vitest';
import { createBufferPool } from '../graphSimCore';

describe('bufferPool — Phase 11 (D-06, D-09, D-34)', () => {
  it('eagerly allocates 3 buffers of Float32Array(N*2)', () => {
    const pool = createBufferPool(20);
    expect(pool.totalAllocated()).toBe(3);
    expect(pool.outstandingCount()).toBe(0);
  });

  it('acquire() returns Float32Array with byteLength = N*2*4 and increments outstanding', () => {
    const pool = createBufferPool(20);
    const b = pool.acquire();
    expect(b).not.toBeNull();
    expect(b!.byteLength).toBe(20 * 2 * 4);
    expect(pool.outstandingCount()).toBe(1);
  });

  it('caps at 3 outstanding; 4th acquire() returns null (D-09, D-34)', () => {
    const pool = createBufferPool(20);
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(pool.outstandingCount()).toBe(3);
    expect(pool.acquire()).toBeNull();
  });

  it('returnBuffer re-wraps correct-size ArrayBuffer into pool (D-06)', () => {
    const pool = createBufferPool(20);
    const b = pool.acquire()!;
    const ab = b.buffer;
    const ok = pool.returnBuffer(ab);
    expect(ok).toBe(true);
    expect(pool.outstandingCount()).toBe(0);
    const b2 = pool.acquire();
    expect(b2).not.toBeNull();
  });

  it('returnBuffer rejects wrong-size buffers and allocates replacement (ASVS V5)', () => {
    const pool = createBufferPool(20);
    pool.acquire();
    const bogus = new ArrayBuffer(8); // not 20*2*4 = 160
    const ok = pool.returnBuffer(bogus);
    expect(ok).toBe(false);
    // outstanding decremented, pool invariant still 3 total.
    expect(pool.outstandingCount()).toBe(0);
    expect(pool.totalAllocated()).toBe(3);
  });
});
