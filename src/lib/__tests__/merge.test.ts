import { describe, it, expect } from 'vitest';
import { computeMerge, buildMergedContent, type MergeHunk } from '../merge';

describe('computeMerge', () => {
  it('returns all clean hunks when A and B are identical', () => {
    const base = 'line1\nline2\nline3';
    const a = 'line1\nline2\nline3';
    const b = 'line1\nline2\nline3';

    const hunks = computeMerge(base, a, b);

    expect(hunks.length).toBeGreaterThanOrEqual(1);
    expect(hunks.every((h) => h.type === 'clean')).toBe(true);
    // No conflict hunks
    expect(hunks.filter((h) => h.type === 'conflict')).toHaveLength(0);
  });

  it('returns clean merged result when A and B modify different non-overlapping lines', () => {
    const base = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10';
    const a = '1\n2\nA3\n4\n5\n6\n7\n8\n9\n10';
    const b = '1\n2\n3\n4\n5\n6\nB7\n8\n9\n10';

    const hunks = computeMerge(base, a, b);

    // diff3Merge auto-merges non-overlapping edits into clean hunks
    expect(hunks.every((h) => h.type === 'clean')).toBe(true);
    // The merged content should contain both changes
    const allLines = hunks.flatMap((h) => h.aLines);
    expect(allLines).toContain('A3');
    expect(allLines).toContain('B7');
  });

  it('returns conflict hunk when A and B both modify the same line', () => {
    const base = 'line1\nline2\nline3\nline4\nline5';
    const a = 'line1\nline2\nmodified-by-A\nline4\nline5';
    const b = 'line1\nline2\nmodified-by-B\nline4\nline5';

    const hunks = computeMerge(base, a, b);

    const conflicts = hunks.filter((h) => h.type === 'conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].aLines).toContain('modified-by-A');
    expect(conflicts[0].bLines).toContain('modified-by-B');
    expect(conflicts[0].baseLines).toContain('line3');
  });

  it('assigns sequential indexes and tracks line positions', () => {
    const base = 'a\nb\nc';
    const a = 'a\nX\nc';
    const b = 'a\nY\nc';

    const hunks = computeMerge(base, a, b);

    // Each hunk should have an index
    hunks.forEach((h, i) => {
      expect(h.index).toBe(i);
    });
    // startLine should be non-negative
    hunks.forEach((h) => {
      expect(h.startLine).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('buildMergedContent', () => {
  it('produces merged text from all-clean hunks', () => {
    const hunks: MergeHunk[] = [
      { index: 0, type: 'clean', baseLines: ['a', 'b'], aLines: ['a', 'b'], bLines: ['a', 'b'], startLine: 0, endLine: 1 },
      { index: 1, type: 'clean', baseLines: ['c'], aLines: ['c'], bLines: ['c'], startLine: 2, endLine: 2 },
    ];
    const resolutions = new Map<number, 'a' | 'b' | 'custom'>();
    const customEdits = new Map<number, string>();

    const result = buildMergedContent(hunks, resolutions, customEdits);
    expect(result).toBe('a\nb\nc');
  });

  it('uses agent A lines when resolution is "a"', () => {
    const hunks: MergeHunk[] = [
      { index: 0, type: 'conflict', baseLines: ['old'], aLines: ['new-A'], bLines: ['new-B'], startLine: 0, endLine: 0 },
    ];
    const resolutions = new Map<number, 'a' | 'b' | 'custom'>([[0, 'a']]);
    const customEdits = new Map<number, string>();

    const result = buildMergedContent(hunks, resolutions, customEdits);
    expect(result).toBe('new-A');
  });

  it('uses agent B lines when resolution is "b"', () => {
    const hunks: MergeHunk[] = [
      { index: 0, type: 'conflict', baseLines: ['old'], aLines: ['new-A'], bLines: ['new-B'], startLine: 0, endLine: 0 },
    ];
    const resolutions = new Map<number, 'a' | 'b' | 'custom'>([[0, 'b']]);
    const customEdits = new Map<number, string>();

    const result = buildMergedContent(hunks, resolutions, customEdits);
    expect(result).toBe('new-B');
  });

  it('uses custom edit content when resolution is "custom"', () => {
    const hunks: MergeHunk[] = [
      { index: 0, type: 'conflict', baseLines: ['old'], aLines: ['new-A'], bLines: ['new-B'], startLine: 0, endLine: 0 },
    ];
    const resolutions = new Map<number, 'a' | 'b' | 'custom'>([[0, 'custom']]);
    const customEdits = new Map<number, string>([[0, 'my-custom-edit']]);

    const result = buildMergedContent(hunks, resolutions, customEdits);
    expect(result).toBe('my-custom-edit');
  });

  it('falls back to baseLines for unresolved conflict hunks', () => {
    const hunks: MergeHunk[] = [
      { index: 0, type: 'conflict', baseLines: ['original'], aLines: ['new-A'], bLines: ['new-B'], startLine: 0, endLine: 0 },
    ];
    const resolutions = new Map<number, 'a' | 'b' | 'custom'>();
    const customEdits = new Map<number, string>();

    const result = buildMergedContent(hunks, resolutions, customEdits);
    expect(result).toBe('original');
  });
});
