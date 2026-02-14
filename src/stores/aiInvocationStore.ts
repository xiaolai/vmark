/**
 * AI Invocation Store
 *
 * Purpose: Singleton concurrency guard for AI genie invocations. Prevents
 *   multiple genies from running simultaneously — tryStart() returns false
 *   if an invocation is already in progress.
 *
 * Key decisions:
 *   - requestId tracks which invocation is active for cancel/cleanup matching.
 *   - Shared by both GeniePicker UI and useGenieShortcuts keyboard trigger
 *     to ensure a single source of truth for "is AI busy" state.
 *
 * @coordinates-with GeniePicker component — checks isRunning before invoking
 * @coordinates-with useGenieShortcuts.ts — checks isRunning before invoking
 * @module stores/aiInvocationStore
 */

import { create } from "zustand";

interface AiInvocationState {
  isRunning: boolean;
  requestId: string | null;
}

interface AiInvocationActions {
  /** Try to start an invocation. Returns false if already running. */
  tryStart: (requestId: string) => boolean;
  /** Mark invocation as finished. */
  finish: () => void;
  /** Cancel the current invocation and reset state. */
  cancel: () => void;
}

const initialState: AiInvocationState = {
  isRunning: false,
  requestId: null,
};

export const useAiInvocationStore = create<AiInvocationState & AiInvocationActions>(
  (set, get) => ({
    ...initialState,

    tryStart: (requestId) => {
      if (get().isRunning) return false;
      set({ isRunning: true, requestId });
      return true;
    },

    finish: () => {
      set(initialState);
    },

    cancel: () => {
      set(initialState);
    },
  })
);
