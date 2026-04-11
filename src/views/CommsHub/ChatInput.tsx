import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';
import { Send } from 'lucide-react';
import { useCommsStore } from '../../stores/commsStore';

interface ChatInputProps {
  agentId: string;
}

export function ChatInput({ agentId }: ChatInputProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useCommsStore((s) => s.sendMessage);

  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed) return;

    await sendMessage(agentId, trimmed);
    setContent('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
  }, [content, agentId, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = '40px';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  return (
    <div className="flex items-end gap-2 border border-outline-variant/10 bg-[#000000] p-2">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="TYPE_COMMAND_OR_QUERY..."
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
        onClick={handleSend}
        aria-label="Send message"
        className="shrink-0 p-2 text-on-surface-variant hover:text-primary transition-colors"
      >
        <Send size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
