// Phase 12 Wave 0 fixture — 3 commands.xxx() shapes. 2 direct + 1 aliased import (SKIP per D-05).
// Matches V-12-09.

import { commands } from '../bindings';
import { commands as C } from '../other-bindings';

export function Demo() {
    const handle = async () => {
        const r1 = await commands.ping();              // valid typed
        const r2 = await commands.startWatch('/tmp');  // valid typed
        const r3 = await C.aliasedCall();              // aliased import, SKIP (deferred per D-05)
    };
    return <div>demo</div>;
}
