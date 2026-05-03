import { describe, it, expect } from 'vitest';
import {
  SEMANTIC_ANCHORS,
  CROSSFADE_HALF_BAND,
  resolveSemanticZoom,
  semanticLabelForLevel,
} from '../semanticZoom';

describe('semantic zoom resolver — Phase 13 Wave 0', () => {
  it('locks semantic anchors at 0.6, 2, and 4 (D-01)', () => {
    expect(SEMANTIC_ANCHORS).toEqual({ package: 0.6, file: 2, code: 4 });
    expect(resolveSemanticZoom(0.59).dominantLevel).toBe('workspace');
    expect(resolveSemanticZoom(0.6).dominantLevel).toBe('package');
    expect(resolveSemanticZoom(2).dominantLevel).toBe('file');
    expect(resolveSemanticZoom(4).dominantLevel).toBe('code');
  });

  it('maps semantic levels to Command Horizon HUD labels (D-04)', () => {
    expect(semanticLabelForLevel('workspace')).toBe('WORKSPACE');
    expect(semanticLabelForLevel('package')).toBe('PACKAGE');
    expect(semanticLabelForLevel('file')).toBe('FILE');
    expect(semanticLabelForLevel('code')).toBe('CODE');
  });

  it('crossfades linearly across the zoom 2 band and clamps outside it (D-02)', () => {
    expect(CROSSFADE_HALF_BAND).toBe(0.10);

    const before = resolveSemanticZoom(2 - CROSSFADE_HALF_BAND - 0.01);
    expect(before.opacities.file).toBe(1);
    expect(before.opacities.code).toBe(0);

    const start = resolveSemanticZoom(1.9);
    expect(start.opacities.package).toBe(1);
    expect(start.opacities.file).toBe(0);

    const midpoint = resolveSemanticZoom(2);
    expect(midpoint.opacities.package).toBeCloseTo(0.5);
    expect(midpoint.opacities.file).toBeCloseTo(0.5);

    const end = resolveSemanticZoom(2.1);
    expect(end.opacities.package).toBe(0);
    expect(end.opacities.file).toBe(1);

    const after = resolveSemanticZoom(2 + CROSSFADE_HALF_BAND + 0.01);
    expect(after.opacities.file).toBe(1);
    expect(after.opacities.package).toBe(0);
  });

  it('uses the higher-detail representation for hitLevel at an exact opacity tie (D-03)', () => {
    const packageFileTie = resolveSemanticZoom(2);
    expect(packageFileTie.opacities.package).toBeCloseTo(0.5);
    expect(packageFileTie.opacities.file).toBeCloseTo(0.5);
    expect(packageFileTie.hitLevel).toBe('file'); // higher-detail tie break per UI-SPEC line 157

    const fileCodeTie = resolveSemanticZoom(4);
    expect(fileCodeTie.opacities.file).toBeCloseTo(0.5);
    expect(fileCodeTie.opacities.code).toBeCloseTo(0.5);
    expect(fileCodeTie.hitLevel).toBe('code'); // higher-detail tie break per UI-SPEC line 157
  });
});
