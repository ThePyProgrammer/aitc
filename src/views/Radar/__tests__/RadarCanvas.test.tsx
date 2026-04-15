// Wave 0 scaffold — Plan 04 implements these tests against the rewritten RadarCanvas.
// See: 07-VALIDATION.md, 07-RESEARCH.md §Validation Architecture
import { describe, it } from 'vitest';

describe.skip('RadarCanvas (graph mode) — Plan 04', () => {
  it('renders graph nodes at settled positions (VIZN-01)', () => {
    // Plan 04: render 100-node mock graph, assert node count drawn matches.
  });
  it('snaps agent dot to most-recently-touched node (D-17)', () => {
    // Plan 05: simulate FileEvent for agent A on file X, expect agent dot at file X position.
  });
  it('selected node gets 1px white outer stroke at 80% opacity (UI-SPEC §Color)', () => {
    // Plan 04
  });
});
