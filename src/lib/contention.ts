/**
 * Contention score computation and color mapping for the heat map overlay.
 *
 * Score formula: 70% conflict frequency + 30% write agent count.
 * Color gradient follows Command Horizon design system:
 *   green (0-0.3) -> amber (0.3-0.7) -> red (0.7-1.0)
 */

/**
 * Compute a contention score in the range [0, 1].
 *
 * @param conflictCount - Number of conflicts for this file/region
 * @param writeAgentCount - Number of distinct agents writing to this file/region
 * @param maxConflicts - Maximum possible conflicts (normalization ceiling)
 * @param maxAgents - Maximum possible agents (normalization ceiling)
 * @returns Contention score between 0 and 1
 */
export function computeContentionScore(
  conflictCount: number,
  writeAgentCount: number,
  maxConflicts: number,
  maxAgents: number,
): number {
  const conflictNorm = maxConflicts > 0 ? conflictCount / maxConflicts : 0;
  const writeNorm = maxAgents > 1 ? Math.max(0, (writeAgentCount - 1) / (maxAgents - 1)) : 0;
  return Math.min(1.0, conflictNorm * 0.7 + writeNorm * 0.3);
}

/**
 * Map a contention score to an RGBA color string for the heat map overlay.
 *
 * Uses Command Horizon design system colors:
 * - Green (142, 255, 113) for low contention (0-0.3)
 * - Amber (255, 209, 111) for moderate contention (0.3-0.7)
 * - Red (255, 115, 81) for high contention (0.7-1.0)
 * - Transparent for zero contention
 *
 * @param score - Contention score in [0, 1]
 * @returns CSS rgba() color string
 */
export function contentionToColor(score: number): string {
  if (score === 0) {
    return 'rgba(0, 0, 0, 0)';
  }

  if (score <= 0.3) {
    const alpha = (score / 0.3) * 0.25;
    return `rgba(142, 255, 113, ${alpha})`;
  }

  if (score <= 0.7) {
    const alpha = 0.15 + ((score - 0.3) / 0.4) * 0.2;
    return `rgba(255, 209, 111, ${alpha})`;
  }

  const alpha = 0.2 + ((score - 0.7) / 0.3) * 0.25;
  return `rgba(255, 115, 81, ${alpha})`;
}
