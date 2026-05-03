# Phase 14: Multi-layer offscreen canvas rendering - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 14-multi-layer-offscreen-canvas-rendering-separate-static-graph
**Areas discussed:** Layer split, Invalidation, API fallback, Layer ownership

---

## Layer split

| Question | User's choice | Notes |
|----------|---------------|-------|
| What should count as the cached static graph layer? | You decide | Agent/trail animation must stay live. |
| Should the implementation expose named layers or feel like two layers? | You decide | Preserve roadmap's static graph + live agent boundary. |
| How should the existing DOM code-preview overlay be treated? | You decide | Preserve Phase 13 code-preview behavior. |
| Where should hover, selection, and conflict visuals live relative to the cache? | You decide | Hover/selection must remain instant. |

---

## Invalidation

| Question | User's choice | Notes |
|----------|---------------|-------|
| Which changes should invalidate cached static layers? | You decide | Claude defines cache-key contract. |
| Prioritize visual crispness during zoom or navigation smoothness? | Smoothness first | Reusing cached rasters during active pan/zoom is allowed. |
| How should cache behavior handle active graph simulation? | Bypass cache | Build/use position-dependent caches after simulation settles. |
| Should cache rebuilds be synchronous or scheduled? | You decide | Avoid frame spikes where possible. |

---

## API fallback

| Question | User's choice | Notes |
|----------|---------------|-------|
| What compatibility posture should Phase 14 take for OffscreenCanvas? | Progressive fallback | Prefer OffscreenCanvas when available; regular canvas buffers otherwise. |
| Move rendering work into a Worker or stay main-thread with offscreen buffers? | You decide | Must not widen into a worker-protocol rewrite unless clearly low-risk. |
| How should tests handle environments without OffscreenCanvas? | You decide | Planning must account for jsdom/WebView absence. |

---

## Layer ownership

| Question | User's choice | Notes |
|----------|---------------|-------|
| Where should layer-cache orchestration live? | You decide | Maintainability matters; RadarCanvas is already large. |
| Refactor existing draw functions or wrap them with caching? | You decide | Avoid broad renderer rewrites unless needed. |
| Add developer-facing diagnostics? | You decide | Reusing `radarPerfDebug` is allowed; no HUD required. |

---

## Claude's Discretion

- Exact static/live pass split beyond the hard boundary that agent/trail animation remains live.
- Internal buffer granularity: one static composite or multiple buffers.
- DOM code-preview treatment, as long as Phase 13 behavior remains intact.
- Cache-key shape, invalidation details, and rebuild scheduling.
- Whether rendering stays main-thread or uses Worker-based OffscreenCanvas after research.
- Module/file split and test strategy.
- Whether to extend `radarPerfDebug` with cache metrics.

## Deferred Ideas

None.
