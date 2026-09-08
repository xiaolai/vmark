/**
 * The genie stream's shared vocabulary — the run context and the one way a run
 * reports failure. Its own module so `streamRunner.ts` (which drives the
 * stream) and `applyGenieResult.ts` (which decides where the result may land)
 * can both depend on it without either importing the other.
 *
 * @module services/genieInvocation/streamRunnerContext
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { GenieAction } from "@/types/aiGenies";
import { useAiInvocationStore } from "@/stores/aiStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import type { ExtractionResult } from "./extraction";

/** Mutable holder for the active stream unlisten fn (owned by the hook). */
export interface ListenerRef {
  current: UnlistenFn | null;
}

/** Tear down the stream listener if one is registered. */
export function releaseListener(ref: ListenerRef): void {
  /* v8 ignore start -- ref cleanup timing depends on async listen resolution */
  if (ref.current) {
    ref.current();
    ref.current = null;
  }
  /* v8 ignore stop */
}

/**
 * Surface an invocation failure in both the picker and the status stores,
 * scoped to the request it belongs to (audit #974/#999). A rejection from an
 * old, cancelled request used to fail whatever was running NOW.
 */
export function failInvocation(message: string, requestId?: string): void {
  useGeniePickerStore.getState().setPickerError(message);
  useAiInvocationStore.getState().setError(message, requestId);
}

export interface RunContext {
  requestId: string;
  tabId: string;
  windowLabel: string;
  extraction: ExtractionResult;
  action: GenieAction;
  listenerRef: ListenerRef;
  /**
   * The originating document's ProseMirror node when the run started, or null
   * when no bound editor could be found. ProseMirror replaces the doc node on
   * every change, so identity IS the revision (audit #965).
   */
  docAtStart: ProseMirrorNode | null;
}

/** What the auto-approve path did with a result. */
export type ApplyOutcome =
  /** Written into the live editor. */
  | "applied"
  /** Not written; keep it as a suggestion against the originating tab. */
  | "suggest"
  /** Reported as an invocation failure; the caller must do nothing further. */
  | "failed";
