import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from '../ChatInput';
import { useChatStore } from '../../../stores/chatStore';

describe('ChatInput', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

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

  it('Shift+Enter does NOT send', async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendSpy });

    render(<ChatInput agentId="a" />);
    const textarea = screen.getByPlaceholderText(/TYPE_MESSAGE_TO_/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    await Promise.resolve();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter also sends', async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendSpy });

    render(<ChatInput agentId="a" />);
    const textarea = screen.getByPlaceholderText(/TYPE_MESSAGE_TO_/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hey' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await Promise.resolve();
    expect(sendSpy).toHaveBeenCalledWith('a', 'hey');
  });

  it('Escape on non-empty clears the text', () => {
    render(<ChatInput agentId="a" />);
    const textarea = screen.getByPlaceholderText(/TYPE_MESSAGE_TO_/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'draft' } });
    expect(textarea.value).toBe('draft');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(textarea.value).toBe('');
  });

  it('empty content does NOT call sendMessage', async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendSpy });

    render(<ChatInput agentId="a" />);
    const textarea = screen.getByPlaceholderText(/TYPE_MESSAGE_TO_/) as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await Promise.resolve();
    expect(sendSpy).not.toHaveBeenCalled();
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
    expect(textarea).toBeDisabled();
    expect(screen.getByTestId('chat-input')).toHaveAttribute(
      'title',
      'CODEX does not support inbound.',
    );
  });

  it('disabled state does NOT call sendMessage on Enter', async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage: sendSpy });

    render(<ChatInput agentId="a" disabled />);
    const textarea = screen.getByPlaceholderText(/TYPE_MESSAGE_TO_/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'blocked' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await Promise.resolve();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
