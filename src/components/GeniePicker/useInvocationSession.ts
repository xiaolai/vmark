/**
 * One OPEN of the genie picker, as state an invocation can be checked against
 * (audit R2, #610/#611).
 *
 * Two things the picker could not previously say:
 *
 *   - WHICH open of the picker an invocation belongs to. Everything before
 *     `startProcessing` is awaited (`ensureProvider()` can reach the backend),
 *     so a user who cancels and reopens has a NEW session on screen when the
 *     old invocation settles — and `settleInvocation` closed it. `claim()`
 *     hands the invocation a predicate that is false once the session moves on.
 *   - WHICH suggestion the visible preview is showing. The stream runner
 *     discards the id `addSuggestion` returns, and the store focuses a new
 *     suggestion only when nothing is focused already — so
 *     `focusedSuggestionId` can still name an older, unrelated one, and Accept
 *     applied an edit the user never previewed. The store announces every add
 *     on `AI_SUGGESTION_EVENTS.ADDED`, the same channel the ProseMirror plugin
 *     listens on, so the picker can learn its own id without the runner
 *     reporting it.
 *
 * @coordinates-with src/components/GeniePicker/GeniePicker.tsx — the consumer
 * @coordinates-with src/components/GeniePicker/invocationLifecycle.ts — takes the claim
 * @coordinates-with src/stores/aiStore/suggestion.ts — emits the ADDED event
 * @module components/GeniePicker/useInvocationSession
 */
import { useCallback, useEffect, useRef } from "react";
import { useAiSuggestionStore } from "@/stores/aiStore";
import { useGeniePickerStore, type PickerMode } from "@/stores/geniePickerStore";
import { AI_SUGGESTION_EVENTS } from "@/plugins/aiSuggestion/types";

export interface InvocationSession {
  /** A claim on the CURRENT open, re-checked when an invocation settles. */
  claim: () => () => boolean;
  /** This session's suggestion id, cleared as it is handed over — it is acted on once. */
  takeSuggestionId: () => string | null;
  /** Drop this session's suggestion, if it created one. */
  rejectSuggestion: () => void;
}

export function useInvocationSession(isOpen: boolean): InvocationSession {
  const sessionRef = useRef(0);
  const suggestionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    sessionRef.current += 1;
    suggestionIdRef.current = null;
    const onAdded = (event: Event): void => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id === "string") suggestionIdRef.current = id;
    };
    window.addEventListener(AI_SUGGESTION_EVENTS.ADDED, onAdded);
    return () => window.removeEventListener(AI_SUGGESTION_EVENTS.ADDED, onAdded);
  }, [isOpen]);

  const claim = useCallback((): (() => boolean) => {
    const session = sessionRef.current;
    return () => sessionRef.current === session;
  }, []);

  const takeSuggestionId = useCallback((): string | null => {
    const id = suggestionIdRef.current;
    suggestionIdRef.current = null;
    return id;
  }, []);

  const rejectSuggestion = useCallback((): void => {
    const id = takeSuggestionId();
    if (id) useAiSuggestionStore.getState().rejectSuggestion(id);
  }, [takeSuggestionId]);

  return { claim, takeSuggestionId, rejectSuggestion };
}

/** The buttons that END a response mode, plus the outside-click dismissal. */
export interface ResponseActions {
  handleAccept: () => void;
  handleRetry: () => void;
  handleRejectPreview: () => void;
  handleCancelAi: () => void;
  handleDismiss: () => void;
}

/**
 * What every exit from a response mode has to do besides changing the mode.
 *
 * Accept applies THIS session's suggestion (audit R2, #611); Retry, Reject and
 * an outside-click dismissal drop it, since leaving it behind kept a
 * "rejected" edit live in the editor where it could still be accepted later
 * (#612/#622); and dismissing during processing cancels the invocation, which
 * otherwise kept streaming and produced a suggestion after the picker was gone
 * (#618). `cancelInvocation` is the HOOK's cancel — it unregisters the stream
 * listener and asks Rust to stop the provider, neither of which the invocation
 * store's own state reset does (#613).
 */
export function useResponseActions(
  mode: PickerMode,
  session: InvocationSession,
  cancelInvocation: () => void,
  handleClose: () => void,
): ResponseActions {
  const handleAccept = useCallback(() => {
    const id = session.takeSuggestionId();
    if (id) useAiSuggestionStore.getState().acceptSuggestion(id);
    handleClose();
  }, [session, handleClose]);

  const handleRetry = useCallback(() => {
    session.rejectSuggestion();
    useGeniePickerStore.getState().resetToInput();
  }, [session]);

  const handleRejectPreview = useCallback(() => {
    session.rejectSuggestion();
    handleClose();
  }, [session, handleClose]);

  const handleCancelAi = useCallback(() => {
    cancelInvocation();
    useGeniePickerStore.getState().resetToInput();
  }, [cancelInvocation]);

  const handleDismiss = useCallback(() => {
    if (mode === "processing") cancelInvocation();
    else session.rejectSuggestion();
    handleClose();
  }, [mode, cancelInvocation, session, handleClose]);

  return { handleAccept, handleRetry, handleRejectPreview, handleCancelAi, handleDismiss };
}
