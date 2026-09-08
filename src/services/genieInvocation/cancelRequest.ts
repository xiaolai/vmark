/**
 * cancelGenieRequest — ask Rust to stop a streaming AI request (audit #375).
 *
 * Purpose: the frontend's cancel used to drop its `ai:response` listener and
 *   reset the store while the provider ran on to completion. `cancel_ai_prompt`
 *   fires the token `run_ai_prompt` registered under this request id, which
 *   kills a CLI child or drops the in-flight REST request.
 *
 * Key decisions:
 *   - Fire-and-forget. The caller resets its local state regardless; awaiting
 *     Rust here would make a cancel wait on the thing it is cancelling.
 *   - A rejection is LOGGED through commandErrorMessage, never thrown: the
 *     command is typed, so its rejection is a plain object that `String()`
 *     would render as "[object Object]". Rust treats an id that is no longer
 *     in flight as a successful no-op, so a rejection here is a real fault.
 *   - And a real fault is SHOWN, not only logged (audit #375, round 3): the
 *     provider is still running and still billing, which is exactly the thing
 *     the user pressed Cancel to stop. `genieWarn` reaches the log file, which
 *     nobody reads mid-session, so the message also lands in the invocation
 *     store's error — Rust localizes it, so no new i18n key is involved.
 *   - ALWAYS shown, on one surface or the other (audit #958). Round 3 dropped
 *     the message whenever a newer invocation had started, to protect that
 *     run's `isRunning` — which silenced the report in the case where a
 *     provider left running matters MOST. The store carries it while idle; a
 *     toast carries it otherwise, because a toast is request-independent and
 *     cannot overwrite the newer run's state.
 *
 * @coordinates-with hooks/useGenieInvocation.ts — calls this from cancel()
 * @coordinates-with streamRunner.ts — mints the request id run_ai_prompt is keyed by
 * @module services/genieInvocation/cancelRequest
 */

import { invoke } from "@tauri-apps/api/core";
import { commandErrorMessage } from "@/services/commands/commandError";
import { useAiInvocationStore } from "@/stores/aiStore";
import { imeToast as toast } from "@/services/ime/imeToast";
import { genieWarn } from "@/utils/debug";

/** Ask Rust to cancel the streaming request `requestId`; never rejects. */
export function cancelGenieRequest(requestId: string): void {
  // Which run the store slot belongs to, taken NOW (audit #959). See below.
  const startEpoch = useAiInvocationStore.getState().startEpoch;
  void invoke("cancel_ai_prompt", { requestId }).catch((err: unknown) => {
    const message = commandErrorMessage(err);
    genieWarn(`cancel_ai_prompt(${requestId}) rejected:`, message);
    // A refused cancel means the provider is very likely still running — and
    // still billing. The log file is not a surface a user reads mid-session, so
    // put it in the status the Cancel button lives beside. Rust localizes its
    // own message, so this needs no key of its own.
    //
    // The status line can only carry it while nothing else is running: the
    // rejection is asynchronous, and a NEW invocation started since must not be
    // knocked out of `isRunning` by an error belonging to the request before it.
    //
    // `isRunning` alone is an ABA read (audit #959): a newer invocation that
    // started AND finished while this rejection was in flight leaves the store
    // idle again, and the error would then overwrite that run's success flash
    // with a failure belonging to the request before it. `startEpoch` moves on
    // every start and survives `cancel()`, so an unchanged one is what makes
    // "still my slot" a fact rather than a guess.
    const state = useAiInvocationStore.getState();
    if (!state.isRunning && state.startEpoch === startEpoch) {
      state.setError(message);
      return;
    }
    // But it must still be SEEN (audit #958), whether the newer run is still
    // going or already done. Suppressing it entirely to protect the singleton
    // was the wrong trade: a refused cancel means a provider request the user
    // stopped is still running, and still billing, which is exactly what they
    // need to know — and the newer invocation makes that MORE likely to
    // matter, not less. A toast is request-independent, so it reports without
    // touching the state the newer run owns.
    toast.error(message);
  });
}
