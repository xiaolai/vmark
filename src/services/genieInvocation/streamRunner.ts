/**
 * Genie Stream Runner
 *
 * Purpose: Drives one AI genie invocation against the Rust backend —
 *   provider validation, invocation-lock acquisition, `ai:response` stream
 *   listening, and result application (direct auto-apply or suggestion).
 *   Extracted from useGenieInvocation.ts (module split).
 *
 * Key decisions:
 *   - Listener registration lives INSIDE the same try/catch as the invoke:
 *     if listen() rejects, the invocation must not be left stuck in
 *     processing state with the singleton lock held.
 *   - Stale-target guard (WI-0.9, C4): a tab switch mid-stream downgrades
 *     auto-apply to a suggestion scoped to the ORIGINATING tab.
 *   - Suggestion payloads for both paths come from one builder
 *     (buildSuggestionParams) so they cannot drift.
 *   - Where a finished result may LAND is `applyGenieResult.ts` (split for the
 *     file-size gate); this module owns the stream, that one owns the writes.
 *
 * @coordinates-with applyGenieResult.ts — the terminal-result half
 * @coordinates-with hooks/useGenieInvocation.ts — sole consumer
 * @coordinates-with providerValidation.ts — the pre-invoke provider checks
 * @coordinates-with stores/aiStore — invocation lock, provider config, suggestions
 * @module services/genieInvocation/streamRunner
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { GenieAction, AiResponseChunk } from "@/types/aiGenies";
import { useAiProviderStore, useAiInvocationStore } from "@/stores/aiStore";
import { validateProvider } from "./providerValidation";
import { useTabStore } from "@/stores/tabStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { errorMessage } from "@/utils/errorMessage";
import type { ExtractionResult } from "./extraction";
import { editorForTab, handleStreamDone } from "./applyGenieResult";
import {
  failInvocation,
  releaseListener,
  type ListenerRef,
  type RunContext,
} from "./streamRunnerContext";

/** Build the `ai:response` handler; accumulates chunks for this request only. */
function createChunkHandler(ctx: RunContext): (event: { payload: AiResponseChunk }) => void {
  let accumulated = "";
  return (event) => {
    const chunk = event.payload;
    if (chunk.requestId !== ctx.requestId) return;
    // …and that request must still be the ACTIVE one (audit #967). A payload id
    // match only proves the chunk belongs to THIS listener's request; a queued
    // frame delivered after a cancel, or after this run was superseded, would
    // otherwise finish, fail, or write state that now belongs to a newer
    // invocation. Everything below mutates shared state, so the check guards
    // the whole handler rather than each site.
    if (useAiInvocationStore.getState().requestId !== ctx.requestId) return;

    if (chunk.error) {
      failInvocation(chunk.error, ctx.requestId);
      releaseListener(ctx.listenerRef);
      return;
    }

    // Defend the AI-response boundary (WI-4.1, T2): a chunk that omits the
    // text field (e.g. a terminal done-frame) must not append the literal
    // string "undefined" to the accumulated result.
    const text = typeof chunk.chunk === "string" ? chunk.chunk : "";
    accumulated += text;

    // Everything below can throw — markdown parsing, transaction construction,
    // `view.dispatch`, a suggestion store write — and it runs in a Tauri EVENT
    // callback, which `runGenieStream`'s outer try/catch cannot reach (audit
    // #970). Unguarded, a throw skipped `releaseListener` and left the listener
    // registered with the singleton lock held: the picker sat in "processing"
    // and no further genie could start. Report it against THIS request and tear
    // the listener down, which is what every other terminal path does.
    try {
      useGeniePickerStore.getState().appendResponse(text);
      if (chunk.done) {
        handleStreamDone(ctx, accumulated);
        releaseListener(ctx.listenerRef);
      }
    } catch (error) {
      failInvocation(errorMessage(error), ctx.requestId);
      releaseListener(ctx.listenerRef);
    }
  };
}

export interface RunGenieStreamOptions {
  filledPrompt: string;
  extraction: ExtractionResult;
  /** `| undefined`: callers pass the genie's declared model, which may be none. */
  model?: string | undefined;
  action?: GenieAction | undefined;
  processingLabel?: string | undefined;
  /** Owned by the calling hook so cancel/unmount can tear the listener down. */
  listenerRef: ListenerRef;
  /**
   * `useAiInvocationStore.cancelEpoch` as it stood when the user asked for this
   * run — captured by the CALLER, before the awaits that precede registration
   * (audit #375). A cancel in between bumps it and this run never dispatches.
   */
  cancelEpoch?: number | undefined;
}

/**
 * Run one genie prompt against the active provider, streaming the response
 * into the picker and applying the terminal result. Resolves once the invoke
 * returns (the stream listener outlives it until the done-frame arrives).
 *
 * Resolves TRUE only when the request actually reached the provider (audit
 * #730). Provider validation, the invocation lock, the cancel check and a
 * rejected invoke each resolve false: a caller recording "the user ran this"
 * has no other way to tell a dispatched run from a refused one, and recording
 * it up front made a genie the app never invoked its most-recent entry.
 */
export async function runGenieStream(options: RunGenieStreamOptions): Promise<boolean> {
  const { filledPrompt, extraction, model, action = "replace", processingLabel, listenerRef, cancelEpoch } = options;

  const validated = validateProvider(useAiProviderStore.getState());
  if (!validated) return false;
  const { provider, restConfig, cliInfo } = validated;

  // Generate unique request ID
  const requestId = crypto.randomUUID();

  // Capture current tab ID for suggestion scoping. NO SENTINEL (audit #972):
  // `"unknown"` is not a tab, and every downstream consumer treats it as one —
  // `editorForTab("unknown")` finds nothing, so an auto-apply run fails with
  // "editor unavailable", and a preview run files its suggestion against a tab
  // id that can never be activated, where the user can neither see it nor
  // reject it. Refuse before the lock is taken, so the picker is not left
  // holding a run that had nowhere to land.
  const windowLabel = getCurrentWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel];
  if (!tabId) {
    toast.error(i18n.t("dialog:toast.genieEditorUnavailable"));
    return false;
  }

  // Acquire the invocation lock — and, with it, refuse a run the user already
  // cancelled while it was still working its way here (audit #375).
  if (!useAiInvocationStore.getState().tryStart(requestId, cancelEpoch)) {
    return false; // Already running, or cancelled before it could register
  }

  // Signal picker to show processing state (after lock acquired to avoid stale UI)
  /* v8 ignore start -- all callers pass a truthy label; guard is defensive */
  if (processingLabel) {
    useGeniePickerStore.getState().startProcessing(processingLabel);
  }
  /* v8 ignore stop */

  // The originating document as it stands NOW, so a same-tab edit during the
  // stream can be detected before the captured range is written (audit #965).
  const docAtStart = editorForTab(tabId)?.state.doc ?? null;
  const ctx: RunContext = {
    requestId,
    tabId,
    windowLabel,
    extraction,
    action,
    listenerRef,
    docAtStart,
  };

  // This request's OWN unlisten (audit #974). `listenerRef` is shared with the
  // hook and with every later run, so releasing it by reference tore down
  // whatever listener happened to be in it — including a newer request's.
  let own: UnlistenFn | null = null;
  const releaseOwn = () => {
    if (!own) return;
    if (listenerRef.current === own) listenerRef.current = null;
    own();
    own = null;
  };

  try {
    // Listener registration sits INSIDE the try: if listen() rejects, the
    // invocation must fail loudly (error state + lock release) instead of
    // sticking in processing/running forever.
    own = await listen<AiResponseChunk>("ai:response", createChunkHandler(ctx));
    listenerRef.current = own;

    // The `listen()` round-trip is another window in which Cancel can land, and
    // the cancel it issues names a request id Rust has not seen yet — so it is
    // a no-op there and only THIS check stops the dispatch (audit #375). What
    // remains unclosed is narrower and needs a backend tombstone: a cancel that
    // arrives after `invoke` is on the wire but before Rust registers the token.
    if (useAiInvocationStore.getState().requestId !== requestId) {
      releaseOwn();
      return false;
    }

    // cliPath: resolved CLI path (used on Windows for .cmd/.bat shims)
    await invoke("run_ai_prompt", {
      requestId,
      provider,
      prompt: filledPrompt,
      model: model ?? restConfig?.model ?? null,
      apiKey: restConfig?.apiKey ?? null,
      endpoint: restConfig?.endpoint ?? null,
      cliPath: cliInfo?.path ?? null,
    });
    return true;
  } catch (e) {
    // Both halves are request-scoped (audit #974). A rejection arriving after
    // the user cancelled and started another run used to fail the NEW request's
    // store and tear down its listener, because the failure path reached for
    // the shared ref and the shared store rather than its own.
    releaseOwn();
    // …and the PICKER is shared too (audit #975). `failInvocation` scopes only
    // its store write; its `setPickerError` is unconditional. Cancelling makes
    // `run_ai_prompt` reject — that is what cancellation looks like from here —
    // so reporting it painted "Cancelled" into the picker as a failure the user
    // had just asked for, or onto whatever run started after it. A rejection
    // that no longer owns the invocation has nobody to report to.
    if (useAiInvocationStore.getState().requestId === requestId) {
      failInvocation(errorMessage(e), requestId);
    }
    return false;
  }
}
