// Phase 10 — `tool_use` inline row (D-13, D-16).
// Quiet single-line row that blends with the transcript flow. Collapsed:
//   TOOL · {TOOL_NAME} {summary} [→ APPROVAL_{id}]   ▾
// Click to expand — renders the Phase 8 ToolPreview registry body below.
//
// Style match: codey's full-width row pattern. No bubble chrome, no
// self-start/max-width; the row fills the panel edge-to-edge so tool events
// don't visually compete with assistant/user text.

import { useState, useCallback, useMemo } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FilePen,
  FilePlus,
  Files,
  FolderOpen,
  Globe,
  NotebookPen,
  Plug,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import type { AgentEvent } from '../../stores/chatStore';
import {
  useChatStore,
  selectToolUseWithResult,
} from '../../stores/chatStore';
import { ToolPreview } from '../../views/CommsHub/ToolPreview';
import { extractText } from './ToolResultCard';
import { MarkdownBody } from './MarkdownBody';

export interface ToolUseCardProps {
  event: AgentEvent;
}

// Stable empty-array reference for the useChatStore selector so Zustand's
// Object.is equality returns true when an agent has no events yet (otherwise
// every render would allocate a fresh `[]` and thrash the subscription).
const EMPTY_EVENTS: readonly AgentEvent[] = Object.freeze([]);

// Phase 19 D-02.1 — per-tool summary dispatcher. Returns a structured
// {primary, secondary?} so the collapsed row can render a scan-line like
// `path/to/file · 3 hunks` instead of a single raw string. Full detail
// remains in the expanded ToolPreview registry body (Phase 8 contract).
interface ToolSummary {
  primary: string;
  secondary?: string;
}

function deriveSummary(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
): ToolSummary {
  if (!toolInput) return { primary: '' };
  const filePath = toolInput.file_path as string | undefined;
  switch (toolName) {
    case 'Edit':
      return { primary: filePath ?? '', secondary: '1 hunk' };
    case 'MultiEdit': {
      const edits = toolInput.edits as unknown[] | undefined;
      const n = Array.isArray(edits) ? edits.length : 0;
      return {
        primary: filePath ?? '',
        secondary: `${n} ${n === 1 ? 'hunk' : 'hunks'}`,
      };
    }
    case 'Write': {
      const body = String(toolInput.content ?? '');
      const lines = body === '' ? 0 : body.split('\n').length;
      return {
        primary: filePath ?? '',
        secondary: `${lines} ${lines === 1 ? 'line' : 'lines'}`,
      };
    }
    case 'Read':
      return { primary: filePath ?? '' };
    case 'Bash':
      return { primary: String(toolInput.command ?? '') };
    case 'Grep':
    case 'Glob':
      return { primary: String(toolInput.pattern ?? '') };
    case 'WebFetch':
    case 'WebSearch': {
      const url = String(toolInput.url ?? '');
      try {
        const u = new URL(url);
        return { primary: u.host, secondary: u.pathname };
      } catch {
        return { primary: url };
      }
    }
    case 'Task': {
      const description = toolInput.description as string | undefined;
      if (description && description.length > 0) {
        return { primary: description };
      }
      // Fallback: first ~60 chars of the brief so the row isn't empty.
      const prompt = String(toolInput.prompt ?? '');
      return { primary: prompt.slice(0, 60) };
    }
    case 'Skill': {
      // skill name lives in the label (SKILL[NAME]); primary surfaces args.
      const args = toolInput.args as string | undefined;
      return { primary: args ?? '' };
    }
    default:
      return {
        primary: String(
          filePath ??
            (toolInput.command as string | undefined) ??
            (toolInput.pattern as string | undefined) ??
            (toolInput.url as string | undefined) ??
            '',
        ),
      };
  }
}

// Phase 19 D-02.2 / D-02.4 — map a paired tool_result to a status-dot
// Per-tool Lucide icon so users can scan the transcript without reading
// the small-caps tool-name label. Core Claude Code tools mapped to
// their semantic analog; `mcp__*` tools → Plug (integration indicator);
// everything else (unknown / malformed / null) → Wrench as a neutral
// "some tool" fallback.
const TOOL_ICONS: Record<string, LucideIcon> = {
  Edit: FilePen,
  MultiEdit: Files,
  Write: FilePlus,
  NotebookEdit: NotebookPen,
  Read: Eye,
  LS: FolderOpen,
  Grep: Search,
  Glob: FolderOpen,
  Bash: Terminal,
  WebFetch: Download,
  WebSearch: Globe,
  Task: Bot,
  Skill: Sparkles,
};

function toolIconFor(name: string | null | undefined): LucideIcon {
  if (!name) return Wrench;
  if (name.startsWith('mcp__')) return Plug;
  return TOOL_ICONS[name] ?? Wrench;
}

// color + state keyword. No paired result yet → grey (pending); is_error
// true → red; anything else → green (success). is_error narrowing is
// strict-boolean so malformed payloads fall through as success rather
// than spoofing a red dot (T-19-04-05).
function statusDotClass(toolResult: AgentEvent | null): {
  color: string;
  state: 'pending' | 'success' | 'error';
} {
  if (!toolResult) {
    return { color: 'bg-on-surface-variant/30', state: 'pending' };
  }
  const isErr =
    ((toolResult.payloadJson as { is_error?: boolean } | null) ?? {})
      .is_error === true;
  return isErr
    ? { color: 'bg-error', state: 'error' }
    : { color: 'bg-primary', state: 'success' };
}

export function ToolUseCard({ event }: ToolUseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const payload =
    (event.payloadJson as {
      tool_name?: string;
      tool_input?: Record<string, unknown>;
      tool_use_id?: string;
    } | null) ?? {};
  const toolName = payload.tool_name ?? null;
  const toolInput = payload.tool_input ?? {};
  const summary = deriveSummary(toolName ?? undefined, payload.tool_input);
  const approvalId = event.approvalRequestId;
  const isAgent = toolName === 'Task';
  const isSkill = toolName === 'Skill';
  // Special-cased labels:
  //   Task  → AGENT[SUBAGENT_TYPE]   ("delegated sub-conversation")
  //   Skill → SKILL[SKILL_NAME]      ("inline-loaded slash-command")
  // Each falls back to a plain unparameterized label if the relevant
  // identifier field is missing or non-string.
  const displayLabel = (() => {
    if (isAgent) {
      const sub = toolInput.subagent_type;
      return typeof sub === 'string' && sub.length > 0
        ? `AGENT[${sub.toUpperCase()}]`
        : 'AGENT';
    }
    if (isSkill) {
      const name = toolInput.skill;
      return typeof name === 'string' && name.length > 0
        ? `SKILL[${name.toUpperCase()}]`
        : 'SKILL';
    }
    return (toolName ?? 'UNKNOWN').toUpperCase();
  })();

  // Phase 19 D-02.2 — pull the paired tool_result (if any) from the store.
  // Events are partitioned per-agent, so the scan is bounded by the visible
  // page (INITIAL_LIMIT = 50). We select the per-agent events array directly
  // (which is referentially stable between store updates thanks to Zustand's
  // shallow-copy-on-write pattern) and memoize the pair lookup — selecting a
  // freshly-built object inside the selector would break useSyncExternalStore's
  // Object.is equality and trigger an infinite render loop.
  const toolUseId = payload.tool_use_id ?? '';
  const agentId = event.agentId;
  const agentEvents = useChatStore((s) => s.eventsByAgent[agentId] ?? EMPTY_EVENTS);
  const paired = useMemo(
    () => selectToolUseWithResult(agentEvents, toolUseId),
    [agentEvents, toolUseId],
  );
  const dot = statusDotClass(paired.toolResult);
  const Icon = toolIconFor(toolName);

  const handleApprovalClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (approvalId != null) {
        navigate(`/comms?tab=requests&request=${approvalId}`);
      }
    },
    [approvalId, navigate],
  );

  // Per-variant accent. AGENT (Task) shares the SUBAGENT_TASK green with
  // TaskGroupCard; SKILL gets the amber tertiary. Other tools stay neutral.
  // Accent is persistent on the outer wrapper so the tool category is
  // readable at a glance without expanding, not just on the expanded body.
  const variant: 'agent' | 'skill' | 'plain' = isAgent
    ? 'agent'
    : isSkill
      ? 'skill'
      : 'plain';
  const outerAccentClass =
    variant === 'agent'
      ? 'border-l-2 border-secondary'
      : variant === 'skill'
        ? 'border-l-2 border-tertiary'
        : '';
  const headerBgClass =
    variant === 'agent'
      ? 'bg-secondary/5 hover:bg-secondary/10'
      : variant === 'skill'
        ? 'bg-tertiary/5 hover:bg-tertiary/10'
        : 'hover:bg-surface-container-low';
  const iconColorClass =
    variant === 'agent'
      ? 'text-secondary'
      : variant === 'skill'
        ? 'text-tertiary'
        : 'text-on-surface-variant';
  const labelColorClass = iconColorClass;

  return (
    <motion.div
      layout
      data-testid="tool-use-card"
      className={`bg-surface-container-lowest rounded-sm mx-5 my-1.5 ${outerAccentClass}`}
      transition={{ duration: 0.12, ease: 'easeOut' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${headerBgClass}`}
        aria-expanded={expanded}
      >
        <Icon
          size={14}
          strokeWidth={1.5}
          className={`${iconColorClass} shrink-0`}
          aria-hidden="true"
        />
        <span
          className={`font-headline text-[10px] uppercase tracking-widest ${labelColorClass} shrink-0`}
        >
          {displayLabel}
        </span>
        <span className="text-on-surface-variant/40 shrink-0 font-mono text-xs">
          ·
        </span>
        <span className="flex-1 truncate font-mono text-xs text-on-surface">
          {summary.primary}
          {summary.secondary && (
            <>
              {' · '}
              <span className="text-on-surface-variant/60">
                {summary.secondary}
              </span>
            </>
          )}
        </span>
        <span
          data-testid="tool-status-dot"
          data-status={dot.state}
          className={`shrink-0 w-2 h-2 rounded-full ${dot.color}`}
          aria-hidden="true"
        />
        {expanded ? (
          <ChevronUp
            size={12}
            strokeWidth={1.5}
            className="text-on-surface-variant/60 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <ChevronDown
            size={12}
            strokeWidth={1.5}
            className="text-on-surface-variant/60 shrink-0"
            aria-hidden="true"
          />
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              className={
                isAgent
                  ? 'px-5 pb-4 pt-4 bg-surface-container-lowest border-t border-secondary/20'
                  : isSkill
                    ? 'px-5 pb-4 pt-4 bg-surface-container-lowest border-t border-tertiary/20'
                    : 'px-5 pb-4 pt-4 bg-surface-container-lowest border-t border-outline'
              }
            >
              {approvalId != null && (
                <div className="flex justify-end mb-3">
                  <button
                    type="button"
                    onClick={handleApprovalClick}
                    className="font-headline text-[10px] tracking-widest uppercase text-secondary hover:underline"
                  >
                    → APPROVAL_{approvalId}
                  </button>
                </div>
              )}
              <section className="mb-5">
                <h4 className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 mb-2">
                  INPUT
                </h4>
                <ToolPreview
                  toolName={toolName ?? ''}
                  toolInputJson={toolInput}
                  filePath={
                    (toolInput.file_path as string | undefined) ?? null
                  }
                  requestId={approvalId ?? 0}
                />
              </section>
              {paired.toolResult &&
                !isSkill &&
                (isAgent ? (
                  <AgentResultSection event={paired.toolResult} />
                ) : (
                  <ToolResultSection event={paired.toolResult} />
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// OUTPUT section for delegated agent (Task) results. Same header chrome as
// ToolResultSection but the body renders through MarkdownBody — agent
// replies are prose-shaped (headings, lists, code refs) and a flat <pre>
// destroys that. Cap is taller (640px) than the generic ToolResultSection
// (200px) because agent reports legitimately run long.
function AgentResultSection({ event }: { event: AgentEvent }) {
  const payload =
    (event.payloadJson as {
      content?: unknown;
      is_error?: boolean;
    } | null) ?? {};
  const body = extractText(payload.content);
  const isError = payload.is_error === true;
  return (
    <section data-testid="tool-result-section" data-result-variant="agent">
      <h4 className="flex items-center gap-2 font-headline text-[10px] uppercase tracking-widest mb-2">
        <span
          className={isError ? 'text-error' : 'text-on-surface-variant/70'}
        >
          OUTPUT
        </span>
        <span
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${
            isError ? 'bg-error' : 'bg-primary'
          }`}
          aria-hidden="true"
        />
        {isError && <span className="text-error">ERROR</span>}
      </h4>
      <div
        className={`max-h-[640px] overflow-y-auto max-w-full ${
          isError ? 'text-error' : ''
        }`}
      >
        <MarkdownBody content={body} />
      </div>
    </section>
  );
}

// OUTPUT section rendered inside the expanded body when a paired
// tool_result is available. Sectioned header with an inline status dot +
// optional ERROR suffix; body is extractText'd, scrollable on overflow.
function ToolResultSection({ event }: { event: AgentEvent }) {
  const payload =
    (event.payloadJson as {
      content?: unknown;
      is_error?: boolean;
    } | null) ?? {};
  const body = extractText(payload.content);
  const isError = payload.is_error === true;
  return (
    <section data-testid="tool-result-section">
      <h4 className="flex items-center gap-2 font-headline text-[10px] uppercase tracking-widest mb-2">
        <span
          className={isError ? 'text-error' : 'text-on-surface-variant/70'}
        >
          OUTPUT
        </span>
        <span
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${
            isError ? 'bg-error' : 'bg-primary'
          }`}
          aria-hidden="true"
        />
        {isError && <span className="text-error">ERROR</span>}
      </h4>
      <pre
        className={`whitespace-pre-wrap max-h-[200px] overflow-y-auto max-w-full py-1 font-mono text-xs ${
          isError ? 'text-error' : 'text-on-surface-variant/80'
        }`}
      >
        {body}
      </pre>
    </section>
  );
}
