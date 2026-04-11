/**
 * 3-way merge computation using node-diff3.
 *
 * Wraps diff3Merge to produce structured MergeHunk[] that the merge UI
 * can render with per-hunk resolution controls.
 */
import { diff3Merge } from 'node-diff3';

export interface MergeHunk {
  index: number;
  type: 'conflict' | 'clean';
  baseLines: string[];
  aLines: string[];
  bLines: string[];
  startLine: number;
  endLine: number;
}

/**
 * Compute a 3-way merge between base, agent A, and agent B versions of a file.
 *
 * @param base  - Original file content
 * @param agentA - Agent A's version
 * @param agentB - Agent B's version
 * @returns Array of MergeHunk describing clean and conflict regions
 */
export function computeMerge(base: string, agentA: string, agentB: string): MergeHunk[] {
  const baseLines = base.split('\n');
  const aLines = agentA.split('\n');
  const bLines = agentB.split('\n');

  const regions = diff3Merge(aLines, baseLines, bLines);
  const hunks: MergeHunk[] = [];
  let lineIndex = 0;

  for (const region of regions) {
    if ('ok' in region) {
      const lines = region.ok as string[];
      hunks.push({
        index: hunks.length,
        type: 'clean',
        baseLines: lines,
        aLines: lines,
        bLines: lines,
        startLine: lineIndex,
        endLine: lineIndex + lines.length - 1,
      });
      lineIndex += lines.length;
    } else if ('conflict' in region) {
      const conflict = region.conflict as {
        a: string[];
        aIndex: number;
        o: string[];
        oIndex: number;
        b: string[];
        bIndex: number;
      };
      const maxLen = Math.max(conflict.a.length, conflict.o.length, conflict.b.length);
      hunks.push({
        index: hunks.length,
        type: 'conflict',
        baseLines: conflict.o,
        aLines: conflict.a,
        bLines: conflict.b,
        startLine: lineIndex,
        endLine: lineIndex + maxLen - 1,
      });
      lineIndex += maxLen;
    }
  }

  return hunks;
}

/**
 * Build merged file content from hunks and resolution choices.
 *
 * @param hunks - MergeHunk array from computeMerge
 * @param resolutions - Map of hunk index -> resolution choice
 * @param customEdits - Map of hunk index -> custom edit text (used when resolution is 'custom')
 * @returns Merged file content as a single string
 */
export function buildMergedContent(
  hunks: MergeHunk[],
  resolutions: Map<number, 'a' | 'b' | 'custom'>,
  customEdits: Map<number, string>,
): string {
  const allLines: string[] = [];

  for (const hunk of hunks) {
    if (hunk.type === 'clean') {
      allLines.push(...hunk.aLines);
    } else {
      const resolution = resolutions.get(hunk.index);
      if (resolution === 'a') {
        allLines.push(...hunk.aLines);
      } else if (resolution === 'b') {
        allLines.push(...hunk.bLines);
      } else if (resolution === 'custom') {
        const custom = customEdits.get(hunk.index);
        if (custom != null) {
          allLines.push(...custom.split('\n'));
        } else {
          allLines.push(...hunk.baseLines);
        }
      } else {
        // No resolution yet - fall back to base
        allLines.push(...hunk.baseLines);
      }
    }
  }

  return allLines.join('\n');
}
