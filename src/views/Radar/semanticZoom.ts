export type SemanticLevel = 'workspace' | 'package' | 'file' | 'code';

export const SEMANTIC_ANCHORS = {
  workspaceToPackage: 0.6,
  packageToFile: 2,
  fileToCode: 4,
} as const;

export const CROSSFADE_HALF_BAND = 0.10;

const LEVELS: SemanticLevel[] = ['workspace', 'package', 'file', 'code'];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function emptyOpacity(): Record<SemanticLevel, number> {
  return {
    workspace: 0,
    package: 0,
    file: 0,
    code: 0,
  };
}

export function semanticLabelForLevel(level: SemanticLevel): 'WORKSPACE' | 'PACKAGE' | 'FILE' | 'CODE' {
  switch (level) {
    case 'workspace':
      return 'WORKSPACE';
    case 'package':
      return 'PACKAGE';
    case 'file':
      return 'FILE';
    case 'code':
      return 'CODE';
  }
}

function baseDominantLevel(zoom: number): SemanticLevel {
  if (zoom < SEMANTIC_ANCHORS.workspaceToPackage) return 'workspace';
  if (zoom < SEMANTIC_ANCHORS.packageToFile) return 'package';
  if (zoom < SEMANTIC_ANCHORS.fileToCode) return 'file';
  return 'code';
}

function applyCrossfade(
  opacityByLevel: Record<SemanticLevel, number>,
  zoom: number,
  anchor: number,
  lower: SemanticLevel,
  higher: SemanticLevel,
): boolean {
  const start = anchor - CROSSFADE_HALF_BAND;
  const end = anchor + CROSSFADE_HALF_BAND;
  if (zoom < start || zoom > end) return false;

  const t = clamp01((zoom - start) / (end - start));
  opacityByLevel[lower] = 1 - t;
  opacityByLevel[higher] = t;
  return true;
}

function moreDetailedLevel(a: SemanticLevel, b: SemanticLevel): SemanticLevel {
  return LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;
}

function opacityDominantLevel(opacityByLevel: Record<SemanticLevel, number>): SemanticLevel {
  let best: SemanticLevel = 'workspace';
  for (const level of LEVELS) {
    const opacity = opacityByLevel[level];
    const bestOpacity = opacityByLevel[best];
    if (opacity > bestOpacity || (opacity === bestOpacity && opacity === 0.5)) {
      best = moreDetailedLevel(level, best);
    }
  }
  return best;
}

export function resolveSemanticZoom(zoom: number): {
  dominantLevel: SemanticLevel;
  hitLevel: SemanticLevel;
  opacityByLevel: Record<SemanticLevel, number>;
} {
  const safeZoom = Number.isFinite(zoom) ? zoom : 1;
  const opacityByLevel = emptyOpacity();
  let crossfading = false;

  crossfading = applyCrossfade(
    opacityByLevel,
    safeZoom,
    SEMANTIC_ANCHORS.workspaceToPackage,
    'workspace',
    'package',
  ) || crossfading;
  crossfading = applyCrossfade(
    opacityByLevel,
    safeZoom,
    SEMANTIC_ANCHORS.packageToFile,
    'package',
    'file',
  ) || crossfading;
  crossfading = applyCrossfade(
    opacityByLevel,
    safeZoom,
    SEMANTIC_ANCHORS.fileToCode,
    'file',
    'code',
  ) || crossfading;

  if (!crossfading) {
    opacityByLevel[baseDominantLevel(safeZoom)] = 1;
  }

  for (const level of LEVELS) {
    opacityByLevel[level] = clamp01(opacityByLevel[level]);
  }

  const hitLevel = opacityDominantLevel(opacityByLevel);
  return {
    dominantLevel: hitLevel,
    hitLevel,
    opacityByLevel,
  };
}

export function isFileDetailLevel(level: SemanticLevel): boolean {
  return level === 'file' || level === 'code';
}
