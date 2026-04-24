// Phase 19.1 — collapsible Agent-tool (subagent) group.
// Renders the bracket formed by system/task_started … system/task_notification
// plus all intervening task_progress events as a single card. Visual language
// matches ToolUseCard's AGENT[TYPE] variant (left-secondary border when
// expanded) so a delegated subagent reads the same whether the user sees it
// via the parent tool_use row or via the lifecycle rollup.
//
// Phase 19.2 — children may now also include the sub-agent's tool_use rows
// (and orphan tool_result rows). The PROGRESS section renders them in
// chronological order: task_progress notes as compact "→ description" rows,
// tool_use events as nested ToolUseCards. tool_result rows are skipped — they
// already render inside their paired ToolUseCard's expanded body via the
// per-agent event lookup.
//
// Phase 19.3 — TaskGroupCard absorbs the parent Agent tool_use's content.
// selectTranscriptItems now removes the standalone Agent tool_use row when a
// matching task_started arrives, so this card is the unified representation.
// PROMPT renders the brief through MarkdownBody behind a SHOW_BRIEF toggle
// (matching AgentPreview's UX). RESULT looks up the parent's tool_result via
// the chat store and renders it through MarkdownBody, falling back to the
// task_notification.summary when the parent result hasn't arrived yet.

import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  useChatStore,
  selectToolUseWithResult,
  type AgentEvent,
} from '../../stores/chatStore';
import { ToolUseCard } from './ToolUseCard';
import { MarkdownBody } from './MarkdownBody';
import { extractText } from './ToolResultCard';

// Stable empty-array reference so the Zustand selector returns referentially
// stable arrays between updates when the agent has no events yet.
const EMPTY_EVENTS: readonly AgentEvent[] = Object.freeze([]);

// Inline pulse animation — the radar-pulse keyframe lives in animations.css
// and is applied here so we don't pollute the global theme tokens with a
// utility used in exactly one place.
const PULSE_STYLE = { animation: 'radar-pulse 1.5s ease-in-out infinite' };

function countWords(s: string): number {
  const t = s.trim();
  if (t === '') return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface TaskGroupCardProps {
  taskId: string;
  header: AgentEvent;
  children: AgentEvent[];
  footer: AgentEvent | null;
}

type TaskStartedData = {
  subtype?: string;
  task_id?: string;
  tool_use_id?: string;
  description?: string;
  task_type?: string;
  prompt?: string;
};

type TaskProgressData = {
  subtype?: string;
  task_id?: string;
  description?: string;
  last_tool_name?: string;
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number };
};

type TaskNotificationData = {
  subtype?: string;
  task_id?: string;
  status?: string;
  summary?: string;
  output_file?: string;
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number };
};

function readData<T>(event: AgentEvent | null): T | null {
  if (!event) return null;
  const payload = event.payloadJson as { data?: T } | null;
  return payload?.data ?? null;
}

type DotState = 'pending' | 'success' | 'error';

function footerState(footer: AgentEvent | null): DotState {
  if (!footer) return 'pending';
  const data = readData<TaskNotificationData>(footer);
  const status = data?.status ?? '';
  if (status === 'completed' || status === 'success') return 'success';
  if (status === 'error' || status === 'failed' || status === 'cancelled')
    return 'error';
  return 'pending';
}

function dotClass(state: DotState): string {
  switch (state) {
    case 'success':
      return 'bg-primary';
    case 'error':
      return 'bg-error';
    case 'pending':
    default:
      return 'bg-on-surface-variant/30';
  }
}

// Phase 19.4 — derive the currently-running step for the live activity line
// in the collapsed card. Walks children backwards skipping tool_result rows
// (bookkeeping, not user-visible work) and returns:
//   - tool_use → "{TOOL_NAME} · {first 50 chars of primary input}"
//   - task_progress → progress.description
// `step` is the 1-based index counting only progress notes + tool_uses, so
// it matches what's surfaced in the spec strip's STEPS counter.
export function getCurrentActivity(
  children: AgentEvent[],
  state: DotState,
): { step: number; label: string } | null {
  let stepCount = 0;
  let lastIdx = -1;
  for (let i = 0; i < children.length; i++) {
    if (children[i]!.eventType === 'tool_result') continue;
    stepCount++;
    lastIdx = i;
  }
  if (lastIdx === -1) {
    // No work emitted yet — show INITIALIZING while pending so the user
    // sees activity the instant the group opens.
    return state === 'pending' ? { step: 0, label: 'INITIALIZING' } : null;
  }
  const last = children[lastIdx]!;
  if (last.eventType === 'tool_use') {
    const p = last.payloadJson as {
      tool_name?: string;
      tool_input?: Record<string, unknown>;
    } | null;
    const toolName = (p?.tool_name ?? 'TOOL').toUpperCase();
    const input = p?.tool_input ?? {};
    const raw = String(
      input.command ??
        input.file_path ??
        input.pattern ??
        input.url ??
        input.query ??
        '',
    );
    const summary = raw.split('\n')[0]!.slice(0, 50);
    return {
      step: stepCount,
      label: summary ? `${toolName} · ${summary}` : toolName,
    };
  }
  // task_progress system_note
  const d = readData<TaskProgressData>(last);
  return {
    step: stepCount,
    label: d?.description ?? '(in progress)',
  };
}

// Phase 19.4 — count the sub-agent's tool uses for the spec strip. Prefer
// the authoritative footer.usage.tool_uses when complete; while pending,
// walk progress notes backwards for the latest usage.tool_uses; final
// fallback is the locally-visible tool_use count.
function deriveToolsCount(
  children: AgentEvent[],
  footerData: TaskNotificationData | null,
): number {
  if (footerData?.usage?.tool_uses !== undefined) {
    return footerData.usage.tool_uses;
  }
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i]!;
    if (c.eventType === 'system_note') {
      const d = readData<TaskProgressData>(c);
      if (d?.usage?.tool_uses !== undefined) return d.usage.tool_uses;
    }
  }
  return children.filter((c) => c.eventType === 'tool_use').length;
}

// Phase 19.4 — live MM:SS clock. While `completedDurationMs` is undefined
// (subagent still running), tick once a second; once the footer arrives
// freeze on the authoritative value.
function useLiveDuration(
  startedAtIso: string,
  completedDurationMs?: number,
): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (completedDurationMs !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [completedDurationMs]);
  const ms =
    completedDurationMs ?? Math.max(0, now - Date.parse(startedAtIso));
  return formatDuration(ms);
}

export function TaskGroupCard({
  taskId,
  header,
  children,
  footer,
}: TaskGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [briefShown, setBriefShown] = useState(false);

  const headerData = useMemo(
    () => readData<TaskStartedData>(header),
    [header],
  );
  const footerData = useMemo(
    () => readData<TaskNotificationData>(footer),
    [footer],
  );
  const state = footerState(footer);

  // Phase 19.3 — look up the parent Agent tool_result by tool_use_id so we
  // can render the full sub-agent response inline. The parent tool_use row
  // is removed from top-level items by selectTranscriptItems, so this card
  // is the only place its content surfaces. Falls back to footer summary
  // when no result has arrived yet.
  const parentToolUseId = headerData?.tool_use_id;
  const agentEvents = useChatStore(
    (s) => s.eventsByAgent[header.agentId] ?? EMPTY_EVENTS,
  );
  const parentResult = useMemo(() => {
    if (!parentToolUseId) return null;
    return selectToolUseWithResult(agentEvents, parentToolUseId).toolResult;
  }, [agentEvents, parentToolUseId]);
  const parentResultBody = useMemo(() => {
    if (!parentResult) return '';
    const payload = parentResult.payloadJson as { content?: unknown } | null;
    return extractText(payload?.content);
  }, [parentResult]);
  const briefWords = useMemo(
    () => countWords(headerData?.prompt ?? ''),
    [headerData?.prompt],
  );

  // Phase 19.4 — collapsed-row spec strip + live activity line. Pending
  // groups need a 1s clock tick; completed ones freeze on the authoritative
  // duration_ms from the notification.
  const currentActivity = useMemo(
    () => getCurrentActivity(children, state),
    [children, state],
  );
  const toolsCount = useMemo(
    () => deriveToolsCount(children, footerData),
    [children, footerData],
  );
  const durationLabel = useLiveDuration(
    header.createdAt,
    footerData?.usage?.duration_ms,
  );
  const isPending = state === 'pending';

  const description =
    headerData?.description && headerData.description.length > 0
      ? headerData.description
      : footerData?.summary ?? `task ${taskId.slice(0, 8)}`;
  // Step count = progress notes + sub-agent tool_uses. tool_result rows are
  // bookkeeping and don't add a user-visible step.
  const childCount = useMemo(
    () =>
      children.filter(
        (c) =>
          c.eventType === 'system_note' || c.eventType === 'tool_use',
      ).length,
    [children],
  );

  return (
    <motion.div
      layout
      data-testid="task-group-card"
      data-task-id={taskId}
      data-task-state={state}
      // Persistent secondary left accent + subtle bg tint so a subagent
      // group reads distinctly from neutral tool rows, even when collapsed.
      className="bg-surface-container-lowest rounded-sm mx-5 my-1.5 border-l-2 border-secondary"
      transition={{ duration: 0.12, ease: 'easeOut' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        data-pending={isPending || undefined}
        className="w-full flex flex-col gap-1.5 px-5 py-3.5 text-left bg-secondary/5 hover:bg-secondary/10 transition-colors"
        aria-expanded={expanded}
      >
        {/* Identity row */}
        <div className="flex items-center gap-3 w-full">
          <Bot
            size={16}
            strokeWidth={1.5}
            className="text-secondary shrink-0"
            style={isPending ? PULSE_STYLE : undefined}
            data-testid="task-bot-icon"
            aria-hidden="true"
          />
          <span className="font-headline text-[11px] font-bold uppercase tracking-widest text-secondary shrink-0">
            SUBAGENT_TASK
          </span>
          <span className="text-on-surface-variant/40 shrink-0 font-mono text-xs">
            ·
          </span>
          <span className="flex-1 truncate font-mono text-sm text-on-surface">
            {description}
          </span>
          <span
            data-testid="task-status-dot"
            data-status={state}
            className={`shrink-0 w-2 h-2 rounded-full ${dotClass(state)}`}
            style={isPending ? PULSE_STYLE : undefined}
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
        </div>
        {/* Live activity row + spec strip. pl-7 aligns the activity text
            with the description above (Bot icon is 16px + 12px gap = 28px). */}
        <div className="flex items-center gap-3 w-full pl-7">
          <span
            data-testid="task-current-activity"
            className="flex-1 min-w-0 font-mono text-xs text-on-surface-variant/70"
          >
            <AnimatePresence mode="wait" initial={false}>
              {currentActivity && (
                <motion.span
                  key={currentActivity.label}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="block truncate"
                >
                  <span className="text-on-surface-variant/40">
                    → STEP {currentActivity.step} ·{' '}
                  </span>
                  {currentActivity.label}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span
            data-testid="task-spec-strip"
            className="shrink-0 font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/50 flex items-center gap-1.5"
          >
            <span>
              {childCount} {childCount === 1 ? 'STEP' : 'STEPS'}
            </span>
            <span className="text-on-surface-variant/30">·</span>
            <span>
              {toolsCount} {toolsCount === 1 ? 'TOOL' : 'TOOLS'}
            </span>
            <span className="text-on-surface-variant/30">·</span>
            <span className="font-mono">{durationLabel}</span>
          </span>
        </div>
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
            <div className="px-5 pb-4 pt-4 bg-surface-container-lowest border-t border-secondary/20 space-y-5">
              {headerData?.prompt && (
                <section data-testid="task-prompt-section">
                  <button
                    type="button"
                    onClick={() => setBriefShown((v) => !v)}
                    aria-expanded={briefShown}
                    className="flex items-center gap-1.5 font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 hover:text-on-surface transition-colors"
                  >
                    {briefShown ? (
                      <ChevronDown
                        size={11}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        size={11}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    )}
                    <span>{briefShown ? 'HIDE_BRIEF' : 'SHOW_BRIEF'}</span>
                    <span className="text-on-surface-variant/50">
                      ({briefWords} {briefWords === 1 ? 'word' : 'words'})
                    </span>
                    {headerData.task_type && (
                      <span className="text-on-surface-variant/50">
                        {' · '}
                        {headerData.task_type}
                      </span>
                    )}
                  </button>
                  {briefShown && (
                    <div className="mt-3" data-testid="task-brief-body">
                      <MarkdownBody content={headerData.prompt} />
                    </div>
                  )}
                </section>
              )}

              {childCount > 0 && (
                <section data-testid="task-progress-section">
                  <h4 className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 mb-2">
                    PROGRESS
                  </h4>
                  <div className="font-mono text-xs text-on-surface-variant/80 space-y-1 -mx-5">
                    {children.map((c) => {
                      // Sub-agent tool calls — render as a nested ToolUseCard
                      // so the user sees the same chrome inside the group as
                      // outside. ToolUseCard pairs its result via the per-agent
                      // events lookup, which still finds the row regardless of
                      // grouping. The wrapping `-mx-5` on the parent counters
                      // the section's px-5 so the card's own `mx-5 my-1.5`
                      // produces normal spacing rather than double-inset.
                      if (c.eventType === 'tool_use') {
                        return (
                          <div
                            key={c.id}
                            data-testid="task-nested-tool-use"
                          >
                            <ToolUseCard event={c} />
                          </div>
                        );
                      }
                      // tool_results are bookkeeping — already paired in their
                      // tool_use's expanded body. Skip from visible render.
                      if (c.eventType === 'tool_result') return null;
                      // task_progress note → compact arrow row, restored to
                      // section-content alignment via px-5.
                      const d = readData<TaskProgressData>(c);
                      return (
                        <div
                          key={c.id}
                          data-testid="task-progress-row"
                          className="flex items-center gap-2 px-5"
                        >
                          <span className="text-on-surface-variant/40 shrink-0">
                            →
                          </span>
                          <span className="truncate">
                            {d?.description ?? '(no description)'}
                          </span>
                          {d?.last_tool_name && (
                            <span className="text-on-surface-variant/50 shrink-0">
                              · {d.last_tool_name}
                            </span>
                          )}
                          {typeof d?.usage?.total_tokens === 'number' && (
                            <span className="text-on-surface-variant/40 shrink-0">
                              · {d.usage.total_tokens} tok
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {footer ? (
                <section data-testid="task-result-section">
                  <h4 className="flex items-center gap-2 font-headline text-[10px] uppercase tracking-widest mb-2">
                    <span
                      className={
                        state === 'error'
                          ? 'text-error'
                          : 'text-on-surface-variant/70'
                      }
                    >
                      RESULT
                    </span>
                    <span
                      className={`shrink-0 w-1.5 h-1.5 rounded-full ${dotClass(state)}`}
                      aria-hidden="true"
                    />
                    {footerData?.status && (
                      <span
                        className={
                          state === 'error'
                            ? 'text-error'
                            : 'text-on-surface-variant/60'
                        }
                      >
                        {footerData.status.toUpperCase()}
                      </span>
                    )}
                  </h4>
                  {parentResultBody !== '' ? (
                    <div
                      data-testid="task-result-body"
                      className={`max-h-[640px] overflow-y-auto max-w-full mb-2 ${
                        state === 'error' ? 'text-error' : ''
                      }`}
                    >
                      <MarkdownBody content={parentResultBody} />
                    </div>
                  ) : (
                    footerData?.summary && (
                      <div
                        data-testid="task-result-summary-fallback"
                        className="font-mono text-xs text-on-surface mb-2"
                      >
                        {footerData.summary}
                      </div>
                    )
                  )}
                  {footerData?.usage && (
                    <div className="font-mono text-[11px] text-on-surface-variant/50">
                      {typeof footerData.usage.total_tokens === 'number' && (
                        <>{footerData.usage.total_tokens} tokens</>
                      )}
                      {typeof footerData.usage.tool_uses === 'number' && (
                        <> · {footerData.usage.tool_uses} tool uses</>
                      )}
                      {typeof footerData.usage.duration_ms === 'number' && (
                        <> · {footerData.usage.duration_ms}ms</>
                      )}
                    </div>
                  )}
                </section>
              ) : (
                <section
                  data-testid="task-inflight-section"
                  className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/50"
                >
                  RUNNING…
                </section>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
