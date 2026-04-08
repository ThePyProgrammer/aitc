import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Command Horizon Theme', () => {
  const themeCSS = fs.readFileSync(
    path.resolve(__dirname, '../styles/theme.css'),
    'utf-8'
  );

  it('defines primary color token', () => {
    expect(themeCSS).toContain('--color-primary: #8eff71');
  });

  it('defines surface color token', () => {
    expect(themeCSS).toContain('--color-surface: #0e0e0e');
  });

  it('defines headline font family', () => {
    expect(themeCSS).toContain("--font-headline: 'Space Grotesk'");
  });

  it('defines mono font family', () => {
    expect(themeCSS).toContain("--font-mono: 'JetBrains Mono'");
  });

  it('enforces zero border-radius', () => {
    expect(themeCSS).toContain('border-radius: 0');
  });
});
