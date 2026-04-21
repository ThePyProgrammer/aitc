/**
 * Phase 8 Plan 05: Shared helpers for the per-tool ToolPreview renderers
 * and the ApprovalRequestCard preview line. Keeps tool_input parsing and
 * language inference in one place so every renderer applies the same
 * defensive contract (JSON-string OR object OR null).
 */

export interface ToolInputLike {
  [k: string]: unknown;
}

/** Parse backend `tool_input_json` field which may arrive as a JSON string
 *  (SQLite TEXT column) or a pre-parsed object (Tauri event payload). */
export function parseToolInput(json: unknown): ToolInputLike | null {
  if (!json) return null;
  if (typeof json === 'string') {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object') return parsed as ToolInputLike;
      return null;
    } catch {
      return null;
    }
  }
  if (typeof json === 'object') return json as ToolInputLike;
  return null;
}

export type PreviewGlyphColor = 'primary' | 'error' | 'tertiary' | 'variant';

export interface PreviewLine {
  glyph: string;
  content: string;
  glyphColor: PreviewGlyphColor;
}

/** Derive the single-line preview shown under the file path on
 *  ApprovalRequestCard. D-14 rules:
 *   - Edit/MultiEdit → "+ <first 50 chars of new_string>"
 *   - Write           → "+ <first 50 chars of content>"
 *   - NotebookEdit    → "+ <first 50 chars of new_source>"
 *   - Bash            → "$ <first 60 chars of command>"
 *   - Anything else (Read/LS/Grep/Glob/WebFetch/WebSearch/Task/Unknown) → em-dash only
 */
export function derivePreviewLine(
  toolName: string | null,
  toolInputJson: unknown,
): PreviewLine {
  if (!toolName) return { glyph: '—', content: '', glyphColor: 'variant' };
  const input = parseToolInput(toolInputJson);
  if (!input) return { glyph: '—', content: '', glyphColor: 'variant' };

  const firstLine = (s: string) => s.split('\n')[0] ?? '';
  const trim50 = (s: string) => firstLine(s).slice(0, 50);
  const trim60 = (s: string) => firstLine(s).slice(0, 60);

  switch (toolName) {
    case 'Edit':
    case 'MultiEdit': {
      // Prefer top-level new_string; for MultiEdit, fall back to edits[0].new_string.
      const edits = input.edits;
      const multiNewStr =
        Array.isArray(edits) && edits.length > 0 && edits[0]
          ? (edits[0] as Record<string, unknown>).new_string
          : undefined;
      const newStr = (input.new_string ?? multiNewStr ?? '') as string;
      return { glyph: '+', content: trim50(String(newStr)), glyphColor: 'primary' };
    }
    case 'Write': {
      const content = (input.content ?? '') as string;
      return { glyph: '+', content: trim50(String(content)), glyphColor: 'primary' };
    }
    case 'NotebookEdit': {
      const ns = (input.new_source ?? '') as string;
      return { glyph: '+', content: trim50(String(ns)), glyphColor: 'primary' };
    }
    case 'Bash': {
      const cmd = (input.command ?? '') as string;
      return { glyph: '$', content: trim60(String(cmd)), glyphColor: 'tertiary' };
    }
    default:
      // Read/LS/Grep/Glob/WebFetch/WebSearch/Task on protected paths: em-dash per D-14.
      return { glyph: '—', content: '', glyphColor: 'variant' };
  }
}

/**
 * Infer the shiki language ID from a file path extension.
 * Returns a language ID that matches `useSyntaxHighlight`'s loaded grammars
 * (typescript, javascript, rust, json, css, html, python) — anything else
 * maps to 'text' (same fallback used by `detectLanguage` in useSyntaxHighlight).
 */
export function inferLanguage(filePath: string | null): string {
  if (!filePath) return 'text';
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    default:
      return 'text';
  }
}
