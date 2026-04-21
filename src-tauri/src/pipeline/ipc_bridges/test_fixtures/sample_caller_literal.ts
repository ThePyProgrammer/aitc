// Phase 12 Wave 0 fixture — 5 invoke() shapes. 3 valid (literal), 1 variable-callee (SKIP), 1 in-comment (SKIP).
// Matches V-12-08, V-12-10.

import { invoke } from '@tauri-apps/api/core';

async function demo() {
    const a = await invoke('ping');                                      // valid
    const b = await invoke('start_watch', { repoRoot: '/tmp' });        // valid
    const c = await invoke('ping', { foo: 1 });                         // valid (duplicate ping caller)
    // const d = await invoke('should_be_skipped');                     // in-comment, SKIP
    const cmd = 'ping';
    const e = await invoke(cmd);                                         // variable-callee, SKIP (V-12-10)
}
