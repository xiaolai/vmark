/**
 * The page-side call of a journal command with no request key, for a
 * journey that reads the journal over IPC: the Rust command requires a
 * fresh `callId` (32 lowercase hex) and answers `{bind: {callId}, reply}`.
 * `BOUND_INVOKE_SNIPPET` defines `boundInvoke(command, args)` in the page;
 * it sends the id, checks the echo and returns the reply.
 */

export const BOUND_INVOKE_SNIPPET = `
  const boundInvoke = async (command, args) => {
    const callId = crypto.randomUUID().replace(/-/g, "");
    const r = await window.__TAURI__.core.invoke(command, { ...args, callId });
    if (r === null || typeof r !== "object" || r.bind?.callId !== callId || !("reply" in r)) {
      throw new Error(command + " answered another call");
    }
    return r.reply;
  };`;
