// Phase 11.1 — rAF coalescer for input bursts (D-01, D-06).
//
// Generic merge-and-flush rAF coalescer. Wheel events (D-01) and the
// viewport→store writeback (D-06) both follow the shape: "many events
// per frame, one effect per frame." This hook owns one pending-ref and
// one rAF handle; the caller provides `merge(prev)` to combine new input
// with any pending state, and `flush(pending)` to apply once per frame.
//
// On unmount: cancels the pending rAF and nulls the accumulator so no
// stray flush fires on a dead component (D-04 discipline).

import { useCallback, useEffect, useRef } from 'react';

export function useRafCoalesced<T>(
  flush: (pending: T) => void,
): (merge: (prev: T | null) => T) => void {
  const pendingRef = useRef<T | null>(null);
  const rafRef = useRef<number | null>(null);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = null;
    },
    [],
  );
  return useCallback((merge) => {
    pendingRef.current = merge(pendingRef.current);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p !== null) flushRef.current(p);
      });
    }
  }, []);
}
