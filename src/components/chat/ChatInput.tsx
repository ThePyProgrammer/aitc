// Phase 10 — sticky input bound to chatStore (replaces the Phase 4 CommsHub
// ChatInput per D-21; the Phase 4 file is deleted in Plan 06). Preserves
// Phase 4 ergonomics: autosize 40→120px, Enter-to-send, Shift-Enter newline,
// secondary-caret blink. Adds disabled state + tooltip for read-only adapters.

import {
  useState,
  useRef,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { Send } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';

export interface ChatInputProps {
  agentId: string;
  disabled?: boolean;
  disabledTooltip?: string;
  placeholder?: string;
}

export function ChatInput({
  agentId,
  disabled = false,
  disabledTooltip,
  placeholder,
}: ChatInputProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const effectivePlaceholder =
    placeholder ?? `TYPE_MESSAGE_TO_${agentId.toUpperCase()}…`;

  const handleSend = useCallback(async () => {
    if (disabled) return;
    const trimmed = content.trim();
    if (!trimmed) return;

    await sendMessage(agentId, trimmed);
    setContent('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
  }, [content, agentId, sendMessage, disabled]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    const el = e.target;
    el.style.height = '40px';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  return (
    <div
      data-testid="chat-input"
      className={`flex items-end gap-2 border border-outline-variant/10 bg-[#000000] p-2 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      title={disabled ? disabledTooltip : undefined}
    >
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-disabled={disabled}
        placeholder={effectivePlaceholder}
        className="flex-1 resize-none bg-transparent font-mono text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none"
        style={{
          minHeight: '40px',
          maxHeight: '120px',
          caretColor: '#00cffc',
          animation: 'blink-cursor 1s step-end infinite',
        }}
        rows={1}
      />
      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={disabled}
        aria-label={`Send message to ${agentId}`}
        className={`shrink-0 p-2 transition-colors ${
          disabled
            ? 'text-on-surface-variant/40'
            : 'text-on-surface-variant hover:text-primary'
        }`}
      >
        <Send size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
