## Pre-existing TypeScript errors (out of scope for Plan 09-04)

Discovered during Plan 04 verification:

- `src/views/Radar/forceCluster.ts` — uses d3-force `ClusterNode` without declaring x/y/vx/vy fields (the d3-force SimulationNodeDatum shape). Also `d3-force` module types not resolving.
- `src/views/Radar/__tests__/forceCluster.test.ts` — inherits the same ClusterNode shape problems.

These pre-date Plan 09-04 and are unrelated to ARSENAL. Flag for Phase 7 (Radar graph rewrite) owners.
