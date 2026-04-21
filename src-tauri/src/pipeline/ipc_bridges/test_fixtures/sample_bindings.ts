// Phase 12 Wave 0 fixture — mirrors src/bindings.ts tauri-specta shape.
// 3 commands: 1 fire-and-forget, 1 channel-bearing, 1 dangling (no handler, no callers).

export const commands = {
async ping() : Promise<null> {
    return await TAURI_INVOKE("ping");
},
async startWatch(repoRoot: string, channel: TAURI_CHANNEL<FileEventBatch>) : Promise<Result<Worktree[], string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("start_watch", { repoRoot, channel }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async danglingCommand(unusedArg: string) : Promise<string> {
    return await TAURI_INVOKE("dangling_command", { unusedArg });
},
}
