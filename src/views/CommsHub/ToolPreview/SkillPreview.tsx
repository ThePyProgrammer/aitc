/**
 * SkillPreview — INPUT renderer for the `Skill` tool.
 *
 * Skill loads a slash-command's instructions inline into the current turn
 * (it is not a sub-conversation). Input shape: { skill, args? }. The skill
 * name lives in the collapsed-row label upstream (SKILL[NAME]); this body
 * just surfaces `args` if present, since args is the only field the
 * collapsed row truncates.
 *
 * No collapse toggle — args is always short (a phrase, a path, a few
 * words). Falls back to NO_ARGS when missing or empty.
 */
import type { ToolPreviewProps } from './registry';
import { parseToolInput } from './helpers';

export function SkillPreview({ toolInputJson }: ToolPreviewProps) {
  const input = parseToolInput(toolInputJson) ?? {};
  const args = typeof input.args === 'string' ? input.args.trim() : '';

  if (args === '') {
    return (
      <section role="region" aria-label="Skill arguments" data-tool-preview="skill">
        <p className="font-mono text-xs text-on-surface-variant/60">NO_ARGS</p>
      </section>
    );
  }

  return (
    <section role="region" aria-label="Skill arguments" data-tool-preview="skill">
      <dl className="grid grid-cols-[120px_1fr] gap-y-1">
        <dt className="font-headline text-[10px] font-normal uppercase tracking-widest text-on-surface-variant py-1 border-b border-outline-variant/15">
          ARGS
        </dt>
        <dd
          className="font-mono text-xs font-bold py-1 border-b border-outline-variant/15 break-words"
          title={args}
        >
          {args}
        </dd>
      </dl>
    </section>
  );
}
SkillPreview.displayName = 'SkillPreview';
