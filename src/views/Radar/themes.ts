// Phase 7 graph color theme system.
//
// GraphTheme is the contract every radar-graph color must come from. The
// THEMES catalog holds nine named palettes — phosphor-classic is the
// baseline/default; the others ship curated visual variants. RadarCanvas
// resolves the active theme each frame from radarStore.themeId and threads
// it through every draw function in GraphRenderer so no color is hardcoded.
//
// Spec: docs/superpowers/specs/2026-04-16-graph-color-themes-design.md
//
// v1 notes (spec §10):
//   • canvasBackground is a solid color — gradient fills are deferred.
//   • Star fields are deferred.
//   • clusterAccents hash is a simple `length * 31 + charCodeSum` (see
//     clusterAccentFor below).

export interface GraphTheme {
  /** Stable identifier used for localStorage + picker selection. */
  id: string;
  /** Human-readable display name shown in the theme picker. */
  name: string;
  /** Solid fill painted before the world transform each frame. */
  canvasBackground: string;
  /** Default node fill (no hover, no heat tint, no cluster accent). */
  nodeFill: string;
  /** Node fill when hovered. */
  nodeFillHover: string;
  /** Reserved fill for the "hottest" tier — not currently used by
   *  GraphRenderer because contention heat interpolates to error red, but
   *  the spec includes it for future hover/highest combos. */
  nodeFillHighest: string;
  /** Node stroke color (alpha baked in). */
  nodeStroke: string;
  /** Optional shadowColor applied to each node when set — drawNodes sets
   *  shadowBlur = 8 / zoom for a phosphor / plasma glow. */
  nodeGlow?: string;
  /** Edge stroke color (alpha baked in). */
  edgeStroke: string;
  /** Optional shadowColor applied to edges for synthwave / plasma glow. */
  edgeGlow?: string;
  /** Arrow head fill — typically brighter than edgeStroke. */
  arrowFill: string;
  /** Folder hull stroke color (alpha baked in). */
  hullStroke: string;
  /** Folder hull fill color (alpha baked in — very low alpha). */
  hullFill: string;
  /** Folder label color (alpha baked in). */
  folderLabelColor: string;
  /** File-name label color (visible at zoom ≥ 4). */
  fileLabelColor: string;
  /** Hex string used as the start of the heat-map ramp. */
  heatRampStart: string;
  /** Optional per-cluster accent hues. When set, drawNodes cycles through
   *  these per dirKey so each folder renders in a distinct color. Max 8. */
  clusterAccents?: string[];
}

// ───── Theme catalog (spec §2 A–I) ─────

const phosphorClassic: GraphTheme = {
  id: 'phosphor-classic',
  name: 'Phosphor Classic',
  canvasBackground: '#000000',
  nodeFill: '#0f1a0e',
  nodeFillHover: '#162015',
  nodeFillHighest: '#1e281c',
  nodeStroke: 'rgba(42, 77, 36, 0.6)',
  edgeStroke: 'rgba(42, 77, 36, 0.55)',
  arrowFill: 'rgba(42, 77, 36, 0.7)',
  hullStroke: 'rgba(42, 77, 36, 0.4)',
  hullFill: 'rgba(42, 77, 36, 0.05)',
  folderLabelColor: 'rgba(173, 170, 170, 0.6)',
  fileLabelColor: '#adaaaa',
  heatRampStart: '#0f1a0e',
};

const phosphorVivid: GraphTheme = {
  id: 'phosphor-vivid',
  name: 'Phosphor Vivid',
  canvasBackground: '#050d04',
  nodeFill: '#0a200a',
  nodeFillHover: '#133313',
  nodeFillHighest: '#1b4a1b',
  nodeStroke: 'rgba(60, 180, 50, 0.55)',
  edgeStroke: 'rgba(60, 180, 50, 0.55)',
  arrowFill: 'rgba(90, 220, 70, 0.7)',
  hullStroke: 'rgba(60, 180, 50, 0.4)',
  hullFill: 'rgba(60, 180, 50, 0.06)',
  folderLabelColor: 'rgba(90, 200, 70, 0.6)',
  fileLabelColor: '#5ecc4a',
  heatRampStart: '#0a200a',
};

const phosphorCyan: GraphTheme = {
  id: 'phosphor-cyan',
  name: 'Phosphor Cyan',
  canvasBackground: '#040d12',
  nodeFill: '#0a1a1f',
  nodeFillHover: '#102830',
  nodeFillHighest: '#183848',
  nodeStroke: 'rgba(0, 180, 220, 0.5)',
  edgeStroke: 'rgba(0, 180, 220, 0.5)',
  arrowFill: 'rgba(0, 210, 240, 0.7)',
  hullStroke: 'rgba(0, 180, 220, 0.35)',
  hullFill: 'rgba(0, 180, 220, 0.05)',
  folderLabelColor: 'rgba(0, 200, 240, 0.55)',
  fileLabelColor: '#4db8cc',
  heatRampStart: '#0a1a1f',
};

const amberTerminal: GraphTheme = {
  id: 'amber-terminal',
  name: 'Amber Terminal',
  canvasBackground: '#0a0804',
  nodeFill: '#1a1408',
  nodeFillHover: '#252010',
  nodeFillHighest: '#3a3018',
  nodeStroke: 'rgba(200, 160, 50, 0.5)',
  edgeStroke: 'rgba(200, 160, 50, 0.5)',
  arrowFill: 'rgba(220, 180, 70, 0.7)',
  hullStroke: 'rgba(200, 160, 50, 0.35)',
  hullFill: 'rgba(200, 160, 50, 0.05)',
  folderLabelColor: 'rgba(220, 180, 60, 0.55)',
  fileLabelColor: '#b8943a',
  heatRampStart: '#1a1408',
};

const coolSlate: GraphTheme = {
  id: 'cool-slate',
  name: 'Cool Slate',
  canvasBackground: '#080a10',
  nodeFill: '#141820',
  nodeFillHover: '#1c2230',
  nodeFillHighest: '#242c40',
  nodeStroke: 'rgba(120, 140, 180, 0.45)',
  edgeStroke: 'rgba(120, 140, 180, 0.45)',
  arrowFill: 'rgba(150, 170, 210, 0.7)',
  hullStroke: 'rgba(120, 140, 180, 0.35)',
  hullFill: 'rgba(120, 140, 180, 0.05)',
  folderLabelColor: 'rgba(140, 160, 200, 0.55)',
  fileLabelColor: '#7888a8',
  heatRampStart: '#141820',
};

// v1: solid fallback in place of the spec's radial-gradient string.
// The mid-stop color gives a close visual approximation.
const synthwaveNebula: GraphTheme = {
  id: 'synthwave-nebula',
  name: 'Synthwave Nebula',
  canvasBackground: '#0a0515',
  nodeFill: '#1a0f28',
  nodeFillHover: '#2a1a3c',
  nodeFillHighest: '#3a2550',
  nodeStroke: 'rgba(255, 255, 255, 0.6)',
  nodeGlow: 'rgba(255, 107, 184, 0.5)',
  edgeStroke: 'rgba(255, 120, 220, 0.5)',
  edgeGlow: 'rgba(255, 120, 220, 0.4)',
  arrowFill: 'rgba(255, 140, 230, 0.8)',
  hullStroke: 'rgba(255, 80, 200, 0.55)',
  hullFill: 'rgba(255, 80, 200, 0.08)',
  folderLabelColor: 'rgba(255, 128, 204, 0.7)',
  fileLabelColor: '#ffb0dd',
  heatRampStart: '#1a0f28',
  clusterAccents: ['#ff6bb8', '#6bd8ff', '#c099ff', '#ffb84d', '#80ffd0', '#ff8080', '#b0ff88', '#ffd85a'],
};

const plasma: GraphTheme = {
  id: 'plasma',
  name: 'Plasma',
  canvasBackground: '#0a0510',
  nodeFill: '#201018',
  nodeFillHover: '#30182a',
  nodeFillHighest: '#40223c',
  nodeStroke: 'rgba(255, 255, 255, 0.5)',
  nodeGlow: 'rgba(255, 120, 140, 0.5)',
  edgeStroke: 'rgba(255, 160, 120, 0.5)',
  edgeGlow: 'rgba(255, 160, 120, 0.4)',
  arrowFill: 'rgba(255, 200, 140, 0.8)',
  hullStroke: 'rgba(255, 120, 80, 0.55)',
  hullFill: 'rgba(255, 120, 80, 0.08)',
  folderLabelColor: 'rgba(255, 180, 140, 0.7)',
  fileLabelColor: '#ffb0c0',
  heatRampStart: '#201018',
  clusterAccents: ['#ff5a80', '#ff9b5a', '#ffd85a', '#ff6bb8', '#ff80a0', '#ffa060', '#ffc080', '#ffe0a0'],
};

const electricIce: GraphTheme = {
  id: 'electric-ice',
  name: 'Electric Ice',
  canvasBackground: '#020814',
  nodeFill: '#ffffff',
  nodeFillHover: '#f0f8ff',
  nodeFillHighest: '#e0e8ff',
  nodeStroke: 'rgba(128, 232, 255, 0.7)',
  nodeGlow: 'rgba(128, 232, 255, 0.6)',
  edgeStroke: 'rgba(180, 230, 255, 0.6)',
  edgeGlow: 'rgba(180, 230, 255, 0.5)',
  arrowFill: 'rgba(220, 245, 255, 0.9)',
  hullStroke: 'rgba(100, 220, 255, 0.55)',
  hullFill: 'rgba(100, 220, 255, 0.08)',
  folderLabelColor: 'rgba(192, 240, 255, 0.75)',
  fileLabelColor: '#c0f0ff',
  heatRampStart: '#020814',
  clusterAccents: ['#80e8ff', '#a8b8ff', '#d0a0ff', '#ff80d0', '#80ffd0', '#ffdd80', '#80c0ff', '#ffffff'],
};

const stellarForge: GraphTheme = {
  id: 'stellar-forge',
  name: 'Stellar Forge',
  canvasBackground: '#020600',
  nodeFill: '#0a2010',
  nodeFillHover: '#143820',
  nodeFillHighest: '#205030',
  nodeStroke: 'rgba(142, 255, 113, 0.65)',
  nodeGlow: 'rgba(142, 255, 113, 0.6)',
  edgeStroke: 'rgba(170, 255, 130, 0.6)',
  edgeGlow: 'rgba(170, 255, 130, 0.5)',
  arrowFill: 'rgba(200, 255, 150, 0.8)',
  hullStroke: 'rgba(142, 255, 113, 0.55)',
  hullFill: 'rgba(142, 255, 113, 0.08)',
  folderLabelColor: 'rgba(176, 255, 136, 0.75)',
  fileLabelColor: '#c0ffa0',
  heatRampStart: '#0a2010',
  clusterAccents: ['#8eff71', '#e0ff5a', '#70ffbc', '#a0ff80', '#c0ff60', '#60ff90', '#80ffa0', '#b0ff70'],
};

/** Registry mapping theme id → theme. Lookup order also drives the picker. */
export const THEMES: Record<string, GraphTheme> = {
  'phosphor-classic': phosphorClassic,
  'phosphor-vivid': phosphorVivid,
  'phosphor-cyan': phosphorCyan,
  'amber-terminal': amberTerminal,
  'cool-slate': coolSlate,
  'synthwave-nebula': synthwaveNebula,
  plasma,
  'electric-ice': electricIce,
  'stellar-forge': stellarForge,
};

/** Display order for the ThemePicker — groups phosphors, terminals, and bright themes. */
export const THEME_ORDER: readonly string[] = [
  'phosphor-classic',
  'phosphor-vivid',
  'phosphor-cyan',
  'amber-terminal',
  'cool-slate',
  'synthwave-nebula',
  'plasma',
  'electric-ice',
  'stellar-forge',
];

export const DEFAULT_THEME_ID = 'phosphor-classic';

/** localStorage key for persisting the picked theme. */
export const THEME_STORAGE_KEY = 'aitc:graphTheme';

/**
 * Resolve a theme id to a theme, falling back silently to phosphor-classic
 * when the id is missing from the catalog. This is the only lookup path —
 * store and canvas both go through it so an invalid persisted id never
 * crashes the render loop.
 */
export function resolveTheme(id: string | null | undefined): GraphTheme {
  if (id && Object.prototype.hasOwnProperty.call(THEMES, id)) {
    return THEMES[id];
  }
  return THEMES[DEFAULT_THEME_ID];
}

/**
 * Deterministic hash used by drawNodes to pick a per-cluster accent. Spec
 * §10 prescribes a simple `length * 31 + charCodeSum` scheme. The hash
 * is stable across sessions for the same dirKey and avoids importing
 * heavier primitives.
 */
export function clusterAccentFor(
  dirKey: string,
  accents: readonly string[],
): string {
  if (accents.length === 0) return '';
  let sum = 0;
  for (let i = 0; i < dirKey.length; i++) sum += dirKey.charCodeAt(i);
  const h = (dirKey.length * 31 + sum) | 0;
  return accents[Math.abs(h) % accents.length];
}
