// Phase 19.1 — collapsible Task-tool (subagent) group.
// Renders the bracket formed by system/task_started … system/task_notification
// plus all intervening task_progress events as a single card. Visual language
// matches ToolUseCard's AGENT[TYPE] variant (left-secondary border when
// expanded) so a delegated subagent reads the same whether the user sees it
// via the parent tool_use row or via the lifecycle rollup.

import { useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { AgentEvent } from '../../stores/chatStore';

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

export function TaskGroupCard({
  taskId,
  header,
  children,
  footer,
}: TaskGroupCardProps) {
  const [expanded, setExpanded] = useState(false);

  const headerData = useMemo(
    () => readData<TaskStartedData>(header),
    [header],
  );
  const footerData = useMemo(
    () => readData<TaskNotificationData>(footer),
    [footer],
  );
  const state = footerState(footer);

  const description =
    headerData?.description && headerData.description.length > 0
      ? headerData.description
      : footerData?.summary ?? `task ${taskId.slice(0, 8)}`;
  const childCount = children.length;

  return (
    <motion.div
      layout
      data-testid="task-group-card"
      data-task-id={taskId}
      data-task-state={state}
      className="bg-surface-container-lowest rounded-sm mx-5 my-1.5"
      transition={{ duration: 0.12, ease: 'easeOut' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-container-low transition-colors"
        aria-expanded={expanded}
      >
        <Bot
          size={14}
          strokeWidth={1.5}
          className="text-on-surface-variant shrink-0"
          aria-hidden="true"
        />
        <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant shrink-0">
          SUBAGENT_TASK
        </span>
        <span className="text-on-surface-variant/40 shrink-0 font-mono text-xs">
          ·
        </span>
        <span className="flex-1 truncate font-mono text-xs text-on-surface">
          {description}
          {childCount > 0 && (
            <>
              {' · '}
              <span className="text-on-surface-variant/60">
                {childCount} {childCount === 1 ? 'step' : 'steps'}
              </span>
            </>
          )}
        </span>
        <span
          data-testid="task-status-dot"
          data-status={state}
          className={`shrink-0 w-2 h-2 rounded-full ${dotClass(state)}`}
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
            <div className="px-5 pb-4 pt-4 bg-surface-container-lowest border-l-2 border-secondary space-y-5">
              {headerData?.prompt && (
                <section data-testid="task-prompt-section">
                  <h4 className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 mb-2">
                    PROMPT
                    {headerData.task_type && (
                      <>
                        {' · '}
                        <span className="text-on-surface-variant/50">
                          {headerData.task_type}
                        </span>
                      </>
                    )}
                  </h4>
                  <pre className="whitespace-pre-wrap font-mono text-xs text-on-surface-variant/80 max-h-[200px] overflow-y-auto">
                    {headerData.prompt}
                  </pre>
                </section>
              )}

              {children.length > 0 && (
                <section data-testid="task-progress-section">
                  <h4 className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 mb-2">
                    PROGRESS
                  </h4>
                  <ul className="font-mono text-xs text-on-surface-variant/80 space-y-1">
                    {children.map((c) => {
                      const d = readData<TaskProgressData>(c);
                      return (
                        <li
                          key={c.id}
                          data-testid="task-progress-row"
                          className="flex items-center gap-2"
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
                        </li>
                      );
                    })}
                  </ul>
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
                  {footerData?.summary && (
                    <div className="font-mono text-xs text-on-surface mb-2">
                      {footerData.summary}
                    </div>
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
