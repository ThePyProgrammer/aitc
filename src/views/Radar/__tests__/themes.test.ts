// Phase 7 graph color theme catalog tests.
//
// Two responsibilities:
//   1. Catalog integrity — every theme in THEME_ORDER resolves, every
//      required field is a non-empty string, heatRampStart parses as a
//      hex color, clusterAccents (if present) are ≤ 8 valid hex entries.
//   2. resolveTheme / clusterAccentFor behaviour contract.

import { describe, it, expect } from 'vitest';
import {
  THEMES,
  THEME_ORDER,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  resolveTheme,
  clusterAccentFor,
  type GraphTheme,
} from '../themes';

const REQUIRED_KEYS: Array<keyof GraphTheme> = [
  'id',
  'name',
  'canvasBackground',
  'nodeFill',
  'nodeFillHover',
  'nodeFillHighest',
  'nodeStroke',
  'edgeStroke',
  'arrowFill',
  'hullStroke',
  'hullFill',
  'folderLabelColor',
  'fileLabelColor',
  'heatRampStart',
];

const HEX_RE = /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/;

describe('themes catalog', () => {
  it('ships 9 themes and phosphor-classic is the default', () => {
    expect(THEME_ORDER.length).toBe(9);
    expect(DEFAULT_THEME_ID).toBe('phosphor-classic');
    expect(THEMES[DEFAULT_THEME_ID]).toBeDefined();
  });

  it('exports the expected localStorage key so the store and UI agree', () => {
    expect(THEME_STORAGE_KEY).toBe('aitc:graphTheme');
  });

  for (const id of [
    'phosphor-classic',
    'phosphor-vivid',
    'phosphor-cyan',
    'amber-terminal',
    'cool-slate',
    'synthwave-nebula',
    'plasma',
    'electric-ice',
    'stellar-forge',
  ]) {
    it(`'${id}' defines every required field as a non-empty string`, () => {
      const theme = THEMES[id];
      expect(theme).toBeDefined();
      expect(theme.id).toBe(id);
      for (const key of REQUIRED_KEYS) {
        const value = theme[key];
        expect(typeof value).toBe('string');
        expect((value as string).length).toBeGreaterThan(0);
      }
    });

    it(`'${id}' heatRampStart is a 3- or 6-digit hex color`, () => {
      expect(THEMES[id].heatRampStart).toMatch(HEX_RE);
    });
  }

  it('bright themes ship clusterAccents with ≤ 8 hex entries', () => {
    const bright = ['synthwave-nebula', 'plasma', 'electric-ice', 'stellar-forge'];
    for (const id of bright) {
      const accents = THEMES[id].clusterAccents;
      expect(accents, `${id} should ship clusterAccents`).toBeDefined();
      expect(accents!.length).toBeGreaterThan(0);
      expect(accents!.length).toBeLessThanOrEqual(8);
      for (const c of accents!) {
        expect(c).toMatch(HEX_RE);
      }
    }
  });

  it('dark / muted themes do NOT define clusterAccents', () => {
    const nonBright = [
      'phosphor-classic',
      'phosphor-vivid',
      'phosphor-cyan',
      'amber-terminal',
      'cool-slate',
    ];
    for (const id of nonBright) {
      expect(THEMES[id].clusterAccents).toBeUndefined();
    }
  });

  it('synthwave / plasma / electric-ice / stellar-forge have nodeGlow', () => {
    for (const id of ['synthwave-nebula', 'plasma', 'electric-ice', 'stellar-forge']) {
      expect(THEMES[id].nodeGlow, `${id} should have nodeGlow`).toBeDefined();
      expect(THEMES[id].edgeGlow, `${id} should have edgeGlow`).toBeDefined();
    }
  });

  it('phosphor-classic tokens match the pre-refactor palette (regression guard)', () => {
    const t = THEMES['phosphor-classic'];
    expect(t.canvasBackground).toBe('#000000');
    expect(t.nodeFill).toBe('#0f1a0e');
    expect(t.nodeFillHover).toBe('#162015');
    expect(t.nodeStroke).toBe('rgba(42, 77, 36, 0.6)');
    expect(t.edgeStroke).toBe('rgba(42, 77, 36, 0.55)');
    expect(t.arrowFill).toBe('rgba(42, 77, 36, 0.7)');
    expect(t.hullStroke).toBe('rgba(42, 77, 36, 0.4)');
    expect(t.hullFill).toBe('rgba(42, 77, 36, 0.05)');
    expect(t.heatRampStart).toBe('#0f1a0e');
  });
});

describe('resolveTheme', () => {
  it('returns the matching theme for a valid id', () => {
    expect(resolveTheme('plasma').id).toBe('plasma');
  });
  it('falls back to the default for an unknown id', () => {
    expect(resolveTheme('nope').id).toBe(DEFAULT_THEME_ID);
  });
  it('falls back for null / undefined / empty strings', () => {
    expect(resolveTheme(null).id).toBe(DEFAULT_THEME_ID);
    expect(resolveTheme(undefined).id).toBe(DEFAULT_THEME_ID);
    expect(resolveTheme('').id).toBe(DEFAULT_THEME_ID);
  });
});

describe('clusterAccentFor', () => {
  const accents = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'];

  it('returns an entry from the provided accent list', () => {
    const result = clusterAccentFor('src/views/Radar', accents);
    expect(accents).toContain(result);
  });

  it('is deterministic — same input → same output', () => {
    expect(clusterAccentFor('src/foo', accents)).toBe(
      clusterAccentFor('src/foo', accents),
    );
  });

  it('returns an empty string when accents is empty', () => {
    expect(clusterAccentFor('anything', [])).toBe('');
  });

  it('distributes across accents for many dirKeys (smoke)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(clusterAccentFor(`dir/${i}`, accents));
    }
    // Smoke test — not strict uniformity, just that the hash isn't stuck.
    expect(seen.size).toBeGreaterThan(1);
  });
});
