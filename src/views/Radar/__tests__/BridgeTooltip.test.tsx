// Phase 12 Wave 3 target: BridgeTooltip hover content + clamp math.
// Analog: src/views/Radar/AgentTooltip.tsx chrome reuse (PATTERNS.md §BridgeTooltip).
// Witnesses: V-12-24 (command name + signature + handler + caller count).

import { describe, it } from 'vitest';

describe('BridgeTooltip', () => {
  it.todo('V-12-24: renders command name (headline, mono 12/700)');
  it.todo('V-12-24: renders signatureSummary (mono 10/400)');
  it.todo('V-12-24: renders HANDLER {handlerFile}:{handlerLine} row');
  it.todo('V-12-24: renders {callerCount}_CALLERS row (incl. 0_CALLERS dangling case)');
  it.todo('V-12-24: renders CHANNEL-BEARING cyan pill only when hasChannelArg=true');
  it.todo('V-12-24: renders DANGLING — NO CALLERS or NO HANDLER only for dangling bridges');
  it.todo('V-12-24: clamps left/top to viewport edges via AgentTooltip clamp math');
});
