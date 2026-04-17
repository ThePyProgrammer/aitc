import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from '../ChatInput';
import { useChatStore } from '../../../stores/chatStore';

describe('ChatInput', () => {
  it('renders a textarea with the default placeholder', () => {
    render(<ChatInput agentId="claude-cc-001" />);
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/TYPE_MESSAGE_TO_CLAUDE-CC-001/);
    expect(textarea).toBeInTheDocument();
  });

  it('sends message on Enter (no shift) via chatStore.sendMessage', async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendSpy });

    render(<ChatInput agentId="claude-cc-001" />);
    const textarea = screen.getByPlaceholderText(/TYPE_MESSAGE_TO_/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // allow the async handler to settle
    await Promise.resolve();

    expect(sendSpy).toHaveBeenCalledWith('claude-cc-001', 'hello');
  });

  it('disabled state surfaces aria-disabled and tooltip', () => {
    render(
      <ChatInput
        agentId="codex-001"
        disabled
        disabledTooltip="CODEX does not support inbound."
      />,
    );
    const textarea = screen.getByPlaceholderText(/TYPE_MESSAGE_TO_/);
    expect(textarea).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('chat-input')).toHaveAttribute(
      'title',
      'CODEX does not support inbound.',
    );
  });
});
