/**
 * Phase 8 Plan 05: ToolBadge — per-tool identity badge rendered alongside
 * UrgencyBadge on ApprovalRequestCard and in RequestDetail header.
 *
 * Color / label / icon mapping is locked by 08-UI-SPEC §"Color — Tool Badge"
 * (D-14): write-class tools → primary phosphor; Bash → tertiary amber;
 * Read-class → on-surface-variant; MCP/WebFetch/WebSearch/Task/Unknown →
 * secondary cyan. Purely presentational (role="img").
 */
import { motion } from 'motion/react';
import {
  Edit3,
  FilePlus,
  BookOpen,
  Terminal,
  Eye,
  FolderOpen,
  Search,
  SearchCode,
  Globe,
  ListTodo,
  Plug,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';

type Style = {
  label: string;
  Icon: LucideIcon;
  textClass: string;
  bgClass: string;
  borderClass: string;
};

const WRITE_STYLE: Style = {
  label: '',
  Icon: Edit3,
  textClass: 'text-primary',
  bgClass: 'bg-primary/10',
  borderClass: 'border-primary/20',
};
const BASH_STYLE: Style = {
  label: 'BASH',
  Icon: Terminal,
  textClass: 'text-tertiary',
  bgClass: 'bg-tertiary/10',
  borderClass: 'border-tertiary/20',
};
const READONLY_STYLE: Style = {
  label: '',
  Icon: Eye,
  textClass: 'text-on-surface-variant',
  bgClass: 'bg-on-surface-variant/10',
  borderClass: 'border-on-surface-variant/20',
};
const WEB_STYLE: Style = {
  label: '',
  Icon: Globe,
  textClass: 'text-secondary',
  bgClass: 'bg-secondary/10',
  borderClass: 'border-secondary/20',
};

function resolveStyle(toolName: string): Style {
  switch (toolName) {
    case 'Edit':
      return { ...WRITE_STYLE, label: 'EDIT', Icon: Edit3 };
    case 'MultiEdit':
      return { ...WRITE_STYLE, label: 'MULTI-EDIT', Icon: Edit3 };
    case 'Write':
      return { ...WRITE_STYLE, label: 'WRITE', Icon: FilePlus };
    case 'NotebookEdit':
      return { ...WRITE_STYLE, label: 'NOTEBOOK', Icon: BookOpen };
    case 'Bash':
      return BASH_STYLE;
    case 'Read':
      return { ...READONLY_STYLE, label: 'READ', Icon: Eye };
    case 'LS':
      return { ...READONLY_STYLE, label: 'LS', Icon: FolderOpen };
    case 'Grep':
      return { ...READONLY_STYLE, label: 'GREP', Icon: Search };
    case 'Glob':
      return { ...READONLY_STYLE, label: 'GLOB', Icon: SearchCode };
    case 'WebFetch':
      return { ...WEB_STYLE, label: 'WEBFETCH', Icon: Globe };
    case 'WebSearch':
      return { ...WEB_STYLE, label: 'WEBSEARCH', Icon: Globe };
    case 'Task':
      return { ...WEB_STYLE, label: 'TASK', Icon: ListTodo };
    default:
      if (toolName.startsWith('mcp__'))
        return { ...WEB_STYLE, label: 'MCP', Icon: Plug };
      return { ...WEB_STYLE, label: 'UNKNOWN', Icon: HelpCircle };
  }
}

/**
 * Resolve the short badge label for a tool name. Exported so ApprovalActions
 * can render the DontAskAgainCheckbox label `DON'T_ASK_AGAIN_THIS_SESSION_FOR_{LABEL}`
 * without duplicating the switch.
 */
export function toolLabelFor(toolName: string | null): string | null {
  if (!toolName) return null;
  return resolveStyle(toolName).label;
}

export interface ToolBadgeProps {
  toolName: string | null;
}

export function ToolBadge({ toolName }: ToolBadgeProps) {
  if (!toolName) return null;
  const { label, Icon, textClass, bgClass, borderClass } = resolveStyle(toolName);
  return (
    <motion.span
      data-tool-badge={toolName}
      role="img"
      aria-label={`${toolName} tool`}
      className={`inline-flex items-center gap-1 h-5 px-2 py-[2px] border ${bgClass} ${borderClass} ${textClass}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <Icon className="w-3 h-3" strokeWidth={1.5} aria-hidden="true" />
      <span className="font-headline text-[10px] font-normal uppercase tracking-widest leading-[1.4]">
        {label}
      </span>
    </motion.span>
  );
}
