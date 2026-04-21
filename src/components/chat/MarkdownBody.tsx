// Phase 19 — markdown renderer for assistant_text content (D-03).
// Delegated from AssistantTextCard; scope is STRICTLY assistant-generated
// markdown. User messages, system notes, and tool events stay plain.
//
// Pattern:
// - react-markdown + remark-gfm for parsing / GFM (tables, task-lists, autolinks)
// - rehype-sanitize for XSS mitigation on the markdown tree (Pitfall 4 —
//   the CodeBlock component emits its own shiki HTML via
//   dangerouslySetInnerHTML OUTSIDE the sanitized tree because highlightLines
//   already HTML-escapes the token content per Phase 5 T-05-07).
// - useSyntaxHighlight (Phase 5 singleton) for fenced-code highlighting.
// - @user mentions re-wear Phase 10 D-23 styling via a custom text-node
//   renderer on paragraphs / list items / etc.
// - StreamingCursor trails during streaming (Phase 10 D-17 pulse).

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useSyntaxHighlight, highlightLines } from '../../hooks/useSyntaxHighlight';
import { StreamingCursor } from './StreamingCursor';

export interface MarkdownBodyProps {
  content: string;
  streaming?: boolean;
}

// Word-bounded @user regex — mirrors parser.rs is_awaiting_user_mention
// and the pre-Phase-19 AssistantTextCard.renderContent tokenizer.
const AT_USER_RE = /(^|\W)(@user)(?=\W|$)/g;

function tokenizeAtUser(input: string): ReactNode[] {
  if (!input) return [];
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  AT_USER_RE.lastIndex = 0;
  while ((match = AT_USER_RE.exec(input)) !== null) {
    const leading = match[1] ?? '';
    const mentionStart = match.index + leading.length;
    if (mentionStart > cursor) {
      parts.push(input.slice(cursor, mentionStart));
    }
    parts.push(
      <span key={`mention-${key++}`} className="text-secondary font-bold">
        @user
      </span>,
    );
    cursor = mentionStart + '@user'.length;
  }
  if (cursor < input.length) {
    parts.push(input.slice(cursor));
  }
  return parts;
}

// Recursively map a React children tree, tokenizing @user in string nodes.
// Non-string children pass through unchanged — this intentionally only
// rewrites the top-level text nodes react-markdown hands us. Deeper
// nesting (e.g. @user inside **bold**) gets left alone; if that becomes a
// real UX requirement, extend this into a proper rehype text-visitor.
function mapChildrenWithAtUser(children: ReactNode): ReactNode {
  if (typeof children === 'string') {
    return tokenizeAtUser(children);
  }
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === 'string' ? (
        <span key={`atu-${i}`}>{tokenizeAtUser(c)}</span>
      ) : (
        c
      ),
    );
  }
  return children;
}

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
}

function CodeBlock({ className, children }: CodeBlockProps) {
  const { highlighter } = useSyntaxHighlight();
  const source = String(children ?? '').replace(/\n$/, '');
  const match = /language-(\w+)/.exec(className ?? '');
  const isInline = !match;
  const lang = match?.[1] ?? 'text';

  // Fenced block — try shiki; fall back to plain <pre><code> on any
  // failure (Pitfall 5 — broken fence during streaming).
  // NOTE: useMemo is invoked unconditionally (inline code also uses it)
  // to satisfy the Rules of Hooks; the inline path simply ignores the
  // result.
  const lines = useMemo(() => {
    if (!highlighter || source === '' || isInline) return null;
    try {
      return highlightLines(highlighter, source, lang);
    } catch {
      return null;
    }
  }, [highlighter, source, lang, isInline]);

  // Inline code (backtick-wrapped without fence) — no shiki, just a
  // subtle monospace pill.
  if (isInline) {
    return (
      <code className="font-mono text-xs bg-surface-container/40 px-1 rounded-sm">
        {source}
      </code>
    );
  }

  if (!lines) {
    return (
      <pre
        className="bg-surface-container-lowest p-3 overflow-auto font-mono text-xs leading-5"
        data-lang={lang}
      >
        <code>{source}</code>
      </pre>
    );
  }

  return (
    <pre
      className="bg-surface-container-lowest p-3 overflow-auto font-mono text-xs leading-5"
      data-lang={lang}
    >
      {lines.map((html, i) => (
        <div
          key={i}
          dangerouslySetInnerHTML={{ __html: html === '' ? '&nbsp;' : html }}
        />
      ))}
    </pre>
  );
}

export function MarkdownBody({ content, streaming = false }: MarkdownBodyProps) {
  return (
    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none font-mono">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          code: (codeProps) => (
            <CodeBlock className={codeProps.className}>
              {codeProps.children}
            </CodeBlock>
          ),
          // @user tokenization happens at text-container boundaries.
          p: ({ children }) => <p>{mapChildrenWithAtUser(children)}</p>,
          li: ({ children }) => <li>{mapChildrenWithAtUser(children)}</li>,
          td: ({ children }) => <td>{mapChildrenWithAtUser(children)}</td>,
        }}
      >
        {content}
      </Markdown>
      {streaming && <StreamingCursor />}
    </div>
  );
}
