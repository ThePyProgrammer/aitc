// Phase 7 Plan 05 — CometTrail pure functions + Canvas render helpers.
//
// Addresses D-14 (400ms ease-out-cubic head travel), D-15 (per-agent color),
// D-16 (100% for 2s, linear fade to 0 over 8s; gone at 10s), D-17 (agent-dot
// pulse), D-18 (per-agent FIFO cap of 10 + age cull).
//
// All lifecycle math is isolated here as side-effect-free functions so the
// RadarCanvas rAF loop can call them deterministically and so the Plan 05
// unit tests can verify timing / FIFO semantics without spinning up a
// canvas. Constants are the single source of truth (verified by
// CometTrail.test.ts in this plan).

import type { ActiveTrail } from '../../stores/radarStore';
import { getAgentColor } from '../../stores/radarStore';

// ─────── Constants (UI-SPEC §Motion + §Sizing, D-14/D-16/D-17/D-18) ───────

/** D-14: head animates source→target over 400ms. */
export const COMET_TRAVEL_MS = 400;

/** D-16: trail opacity stays at 100% for this initial phase. */
export const TRAIL_FULL_OPACITY_MS = 2000;

/** D-16: trail linearly fades from 100%→0% over this phase. */
export const TRAIL_FADE_DURATION_MS = 8000;

/** D-16: total lifespan = full-opacity + fade (10_000ms). */
export const TRAIL_TOTAL_LIFESPAN_MS =
  TRAIL_FULL_OPACITY_MS + TRAIL_FADE_DURATION_MS;

/** D-18: per-agent FIFO cap. */
export const MAX_TRAILS_PER_AGENT = 10;

// UI-SPEC §Sizing — comet head + tail + agent dot + pulse rings.
export const COMET_HEAD_RADIUS = 4;
export const COMET_HEAD_GLOW_RADIUS = 7;
export const COMET_TAIL_WIDTH_HEAD = 2;
export const COMET_TAIL_WIDTH_OLDEST = 0.5;
export const COMET_TAIL_SEGMENTS = 6;
export const AGENT_DOT_RADIUS = 6;
export const AGENT_PULSE_RING_1_MAX = 12;
export const AGENT_PULSE_RING_2_MAX = 20;
export const AGENT_PULSE_CYCLE_MS = 2000;
export const AGENT_PULSE_RING_2_DELAY_MS = 500;
/** UI-SPEC: stops pulsing when no events for 30s. */
export const AGENT_IDLE_MS = 30_000;

// ─────── Easing ───────

/**
 * D-14 ease-out-cubic: `1 - (1 - t)^3` with t clamped to [0, 1].
 * At t=0.5 this evaluates to 0.875 (verified in CometTrail.test.ts).
 */
export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

// ─────── Head position interpolation ───────

export function interpolateHead(
  trail: ActiveTrail,
  now: number,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
): { x: number; y: number } {
  const rawT = (now - trail.startTs) / COMET_TRAVEL_MS;
  const eased = easeOutCubic(rawT);
  return {
    x: fromPos.x + (toPos.x - fromPos.x) * eased,
    y: fromPos.y + (toPos.y - fromPos.y) * eased,
  };
}

// ─────── D-16 opacity curve ───────

/**
 * Opacity as a function of age in ms:
 *   [0, 2000)      → 1.0
 *   [2000, 10000)  → linear fade 1.0 → 0.0
 *   [10000, ∞)     → 0.0 (expired)
 *   negative age   → 0.0 (defensive; trails never render before their start)
 */
export function trailOpacity(ageMs: number): number {
  if (ageMs < 0) return 0;
  if (ageMs >= TRAIL_TOTAL_LIFESPAN_MS) return 0;
  if (ageMs < TRAIL_FULL_OPACITY_MS) return 1;
  const fadeProgress =
    (ageMs - TRAIL_FULL_OPACITY_MS) / TRAIL_FADE_DURATION_MS;
  return Math.max(0, 1 - fadeProgress);
}

// ─────── Tail segment sampling ───────

export interface TailSegment {
  x: number;
  y: number;
  alpha: number;
  width: number;
}

/**
 * Samples `segments` points along the eased trajectory. i=0 is the oldest
 * (tail end, lowest alpha + narrowest width). i=segments-1 is the head-side
 * (highest alpha + widest width = COMET_TAIL_WIDTH_HEAD).
 *
 * Returns [] when the trail has exceeded TRAIL_TOTAL_LIFESPAN_MS so callers
 * can rely on `length === 0` as an "expired" signal.
 */
export function sampleTailSegments(
  trail: ActiveTrail,
  now: number,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  segments: number = COMET_TAIL_SEGMENTS,
): TailSegment[] {
  const ageMs = now - trail.startTs;
  if (ageMs >= TRAIL_TOTAL_LIFESPAN_MS) return [];
  const baseAlpha = trailOpacity(ageMs);
  const headT = Math.max(0, Math.min(1, ageMs / COMET_TRAVEL_MS));
  const headEased = easeOutCubic(headT);
  const out: TailSegment[] = [];
  const denom = segments - 1 || 1;
  for (let i = 0; i < segments; i++) {
    const frac = i / denom; // 0 = oldest, 1 = head.
    const segT = frac * headEased;
    const x = fromPos.x + (toPos.x - fromPos.x) * segT;
    const y = fromPos.y + (toPos.y - fromPos.y) * segT;
    const segAlpha = baseAlpha * frac;
    const segWidth =
      COMET_TAIL_WIDTH_OLDEST +
      (COMET_TAIL_WIDTH_HEAD - COMET_TAIL_WIDTH_OLDEST) * frac;
    out.push({ x, y, alpha: segAlpha, width: segWidth });
  }
  return out;
}

// ─────── Cull expired + per-agent FIFO cap ───────

/**
 * D-16 + D-18: drop trails older than `maxAgeMs`, then keep at most
 * `capPerAgent` per agent (keeping the newest by `startTs`). Return value is
 * sorted by `startTs` ascending for stable render order.
 */
export function cullExpiredTrails(
  trails: ActiveTrail[],
  now: number,
  capPerAgent: number = MAX_TRAILS_PER_AGENT,
  maxAgeMs: number = TRAIL_TOTAL_LIFESPAN_MS,
): ActiveTrail[] {
  const fresh = trails.filter((t) => now - t.startTs < maxAgeMs);
  const byAgent = new Map<string, ActiveTrail[]>();
  for (const t of fresh) {
    const arr = byAgent.get(t.agentId) ?? [];
    arr.push(t);
    byAgent.set(t.agentId, arr);
  }
  const out: ActiveTrail[] = [];
  for (const arr of byAgent.values()) {
    arr.sort((a, b) => a.startTs - b.startTs); // oldest → newest
    out.push(...arr.slice(-capPerAgent));        // keep newest N
  }
  out.sort((a, b) => a.startTs - b.startTs);
  return out;
}

// ─────── Canvas render: comet trails (z-order steps 9-10) ───────

/**
 * Renders each trail as:
 *   (a) a gradient-stroked polyline along the eased trajectory (tail)
 *   (b) a filled head circle + radial-gradient glow while ageMs ≤ 400
 *
 * Uses `positions.get(fromPath/toPath)` to resolve endpoints — trails whose
 * endpoints have been evicted from the graph (rare, but possible while the
 * graph re-settles) are silently skipped.
 */
export function drawCometTrails(
  ctx: CanvasRenderingContext2D,
  trails: ActiveTrail[],
  positions: Map<string, { x: number; y: number }>,
  now: number,
  zoom: number,
): void {
  for (const trail of trails) {
    const fromPos = positions.get(trail.fromPath);
    const toPos = positions.get(trail.toPath);
    if (!fromPos || !toPos) continue;
    const color = getAgentColor(trail.agentId);

    // (a) Tail — gradient stroke polyline.
    const tail = sampleTailSegments(trail, now, fromPos, toPos);
    if (tail.length >= 2) {
      for (let i = 0; i < tail.length - 1; i++) {
        const seg = tail[i];
        const next = tail[i + 1];
        const avgAlpha = (seg.alpha + next.alpha) / 2;
        if (avgAlpha <= 0) continue;
        ctx.globalAlpha = avgAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = ((seg.width + next.width) / 2) / zoom;
        ctx.beginPath();
        ctx.moveTo(seg.x, seg.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // (b) Head — only while head is still travelling along the edge.
    const ageMs = now - trail.startTs;
    if (ageMs >= 0 && ageMs <= COMET_TRAVEL_MS) {
      const head = interpolateHead(trail, now, fromPos, toPos);
      const headOpacity = trailOpacity(ageMs);
      if (headOpacity > 0) {
        ctx.globalAlpha = headOpacity;
        const glowR = COMET_HEAD_GLOW_RADIUS / zoom;
        const glowGrad = ctx.createRadialGradient(
          head.x,
          head.y,
          0,
          head.x,
          head.y,
          glowR,
        );
        glowGrad.addColorStop(0, `${color}66`); // ~40% center
        glowGrad.addColorStop(1, `${color}00`);
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(head.x, head.y, glowR, 0, Math.PI * 2);
        ctx.fill();
        // Solid head.
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(head.x, head.y, COMET_HEAD_RADIUS / zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}

// ─────── Canvas render: agent dots + pulse rings (z-order step 11) ───────

export interface AgentDotState {
  agentId: string;
  x: number;
  y: number;
  lastEventTs: number;
}

/**
 * D-17: center dot + two pulse rings (2s cycle, ring 2 delayed 0.5s). When
 * idle > AGENT_IDLE_MS, the rings are suppressed; the center dot remains so
 * the agent's last-known position stays visible.
 */
export function drawAgentDots(
  ctx: CanvasRenderingContext2D,
  dots: AgentDotState[],
  now: number,
  zoom: number,
): void {
  for (const dot of dots) {
    const color = getAgentColor(dot.agentId);
    const idle = now - dot.lastEventTs > AGENT_IDLE_MS;
    if (!idle) {
      const cyclePhase1 =
        (now % AGENT_PULSE_CYCLE_MS) / AGENT_PULSE_CYCLE_MS;
      const cyclePhase2 =
        ((now + AGENT_PULSE_CYCLE_MS - AGENT_PULSE_RING_2_DELAY_MS) %
          AGENT_PULSE_CYCLE_MS) /
        AGENT_PULSE_CYCLE_MS;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / zoom;
      const r1 =
        (AGENT_DOT_RADIUS +
          (AGENT_PULSE_RING_1_MAX - AGENT_DOT_RADIUS) * cyclePhase1) /
        zoom;
      ctx.globalAlpha = 0.3 * (1 - cyclePhase1);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, r1, 0, Math.PI * 2);
      ctx.stroke();
      const r2 =
        (AGENT_DOT_RADIUS +
          (AGENT_PULSE_RING_2_MAX - AGENT_DOT_RADIUS) * cyclePhase2) /
        zoom;
      ctx.globalAlpha = 0.2 * (1 - cyclePhase2);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, r2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Center dot — always drawn (last-known position persists on idle).
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, AGENT_DOT_RADIUS / zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}
