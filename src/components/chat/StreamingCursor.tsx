// Phase 10 — 2px-wide primary bar with the `blink-cursor` animation.
// Rendered as the terminal character of a streaming AssistantTextCard.

export function StreamingCursor() {
  return (
    <span
      data-testid="streaming-cursor"
      className="inline-block h-5 w-[2px] bg-primary align-text-bottom ml-0.5"
      style={{ animation: 'blink-cursor 1s step-end infinite' }}
      aria-hidden="true"
    />
  );
}
