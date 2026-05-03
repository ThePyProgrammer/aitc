import { describe, expect, it } from 'vitest';
import {
  CROSSFADE_HALF_BAND,
  SEMANTIC_ANCHORS,
  isFileDetailLevel,
  resolveSemanticZoom,
  semanticLabelForLevel,
} from '../semanticZoom';

describe('semanticZoom contract', () => {
  it('exports locked anchors and crossfade band', () => {
    expect(SEMANTIC_ANCHORS.workspaceToPackage).toBe(0.6);
    expect(SEMANTIC_ANCHORS.packageToFile).toBe(2);
    expect(SEMANTIC_ANCHORS.fileToCode).toBe(4);
    expect(CROSSFADE_HALF_BAND).toBe(0.10);
  });

  it('switches dominant levels at the locked anchors', () => {
    expect(resolveSemanticZoom(0.59).dominantLevel).toBe('workspace');
    expect(resolveSemanticZoom(0.6).dominantLevel).toBe('package');
    expect(resolveSemanticZoom(2).dominantLevel).toBe('file');
    expect(resolveSemanticZoom(4).dominantLevel).toBe('code');
  });

  it('maps levels to exact Command Horizon HUD labels', () => {
    expect(semanticLabelForLevel('workspace')).toBe('WORKSPACE');
    expect(semanticLabelForLevel('package')).toBe('PACKAGE');
    expect(semanticLabelForLevel('file')).toBe('FILE');
    expect(semanticLabelForLevel('code')).toBe('CODE');
  });

  it('uses full opacity outside crossfade bands', () => {
    expect(resolveSemanticZoom(0.4)).toMatchObject({
      dominantLevel: 'workspace',
      hitLevel: 'workspace',
      opacityByLevel: { workspace: 1, package: 0, file: 0, code: 0 },
    });
    expect(resolveSemanticZoom(1)).toMatchObject({
      dominantLevel: 'package',
      hitLevel: 'package',
      opacityByLevel: { workspace: 0, package: 1, file: 0, code: 0 },
    });
    expect(resolveSemanticZoom(3)).toMatchObject({
      dominantLevel: 'file',
      hitLevel: 'file',
      opacityByLevel: { workspace: 0, package: 0, file: 1, code: 0 },
    });
    expect(resolveSemanticZoom(4.2)).toMatchObject({
      dominantLevel: 'code',
      hitLevel: 'code',
      opacityByLevel: { workspace: 0, package: 0, file: 0, code: 1 },
    });
  });

  it('linearly crossfades over anchor ±0.10 and clamps opacities', () => {
    const beforePackage = resolveSemanticZoom(0.55).opacityByLevel;
    expect(beforePackage.workspace).toBeCloseTo(0.75);
    expect(beforePackage.package).toBeCloseTo(0.25);

    const packageFileStart = resolveSemanticZoom(1.9).opacityByLevel;
    expect(packageFileStart.package).toBe(1);
    expect(packageFileStart.file).toBe(0);

    const packageFileMid = resolveSemanticZoom(2).opacityByLevel;
    expect(packageFileMid.package).toBeCloseTo(0.5);
    expect(packageFileMid.file).toBeCloseTo(0.5);

    const packageFileEnd = resolveSemanticZoom(2.1).opacityByLevel;
    expect(packageFileEnd.package).toBe(0);
    expect(packageFileEnd.file).toBe(1);

    const afterPackage = resolveSemanticZoom(0.65).opacityByLevel;
    expect(afterPackage.workspace).toBeCloseTo(0.25);
    expect(afterPackage.package).toBeCloseTo(0.75);

    for (const opacity of Object.values(resolveSemanticZoom(3.95).opacityByLevel)) {
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });

  it('uses higher-detail hit dominance at exact opacity ties', () => {
    expect(resolveSemanticZoom(0.6).hitLevel).toBe('package');
    expect(resolveSemanticZoom(2).hitLevel).toBe('file');
    expect(resolveSemanticZoom(4).hitLevel).toBe('code');
  });

  it('identifies file-detail levels for downstream renderers', () => {
    expect(isFileDetailLevel('workspace')).toBe(false);
    expect(isFileDetailLevel('package')).toBe(false);
    expect(isFileDetailLevel('file')).toBe(true);
    expect(isFileDetailLevel('code')).toBe(true);
  });
});
