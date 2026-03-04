/**
 * AI Invocation Store
 *
 * Purpose: Singleton concurrency guard for AI genie invocations. Prevents
 *   multiple genies from running simultaneously — tryStart() returns false
 *   if an invocation is already in progress. Also tracks elapsed time,
 *   error state, and a brief success flash for status bar display.
 *
 * Key decisions:
 *   - requestId tracks which invocation is active for cancel/cleanup matching.
 *   - elapsedSeconds counts up via 1s interval while AI is running.
 *   - error stores failure message; cleared via dismissError().
 *   - showSuccess is true for 3s after successful finish.
 *   - hasActiveStatus is derived: true when running, error present, or showSuccess.
 *   - Shared by both GeniePicker UI and useGenieShortcuts keyboard trigger
 *     to ensure a single source of truth for "is AI busy" state.
 *
 * @coordinates-with GeniePicker component — checks isRunning before invoking
 * @coordinates-with useGenieShortcuts.ts — checks isRunning before invoking
 * @coordinates-with StatusBar — reads hasActiveStatus for auto-show
 * @module stores/aiInvocationStore
 */

import { create } from "zustand";

interface AiInvocationState {
  isRunning: boolean;
  requestId: string | null;
  elapsedSeconds: number;
  error: string | null;
  showSuccess: boolean;
  hasActiveStatus: boolean;
}

interface AiInvocationActions {
  /** Try to start an invocation. Returns false if already running. */
  tryStart: (requestId: string) => boolean;
  /** Mark invocation as finished successfully. Shows brief success flash. */
  finish: () => void;
  /** Cancel the current invocation and reset all state. */
  cancel: () => void;
  /** Set an error message. Stops the invocation. */
  setError: (message: string) => void;
  /** Dismiss the current error. */
  dismissError: () => void;
}

const initialState: AiInvocationState = {
  isRunning: false,
  requestId: null,
  elapsedSeconds: 0,
  error: null,
  showSuccess: false,
  hasActiveStatus: false,
};

let elapsedInterval: ReturnType<typeof setInterval> | null = null;
let successTimeout: ReturnType<typeof setTimeout> | null = null;

function clearTimers() {
  if (elapsedInterval !== null) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }
  if (successTimeout !== null) {
    clearTimeout(successTimeout);
    successTimeout = null;
  }
}

export const useAiInvocationStore = create<AiInvocationState & AiInvocationActions>(
  (set, get) => ({
    ...initialState,

    tryStart: (requestId) => {
      if (get().isRunning) return false;
      clearTimers();
      set({
        isRunning: true,
        requestId,
        elapsedSeconds: 0,
        error: null,
        showSuccess: false,
        hasActiveStatus: true,
      });
      elapsedInterval = setInterval(() => {
        set((s) => ({ elapsedSeconds: s.elapsedSeconds + 1 }));
      }, 1000);
      return true;
    },

    finish: () => {
      if (!get().isRunning) return;
      clearTimers();
      set({
        isRunning: false,
        requestId: null,
        elapsedSeconds: 0,
        error: null,
        showSuccess: true,
        hasActiveStatus: true,
      });
      successTimeout = setTimeout(() => {
        set({ showSuccess: false, hasActiveStatus: false });
      }, 3000);
    },

    cancel: () => {
      clearTimers();
      set(initialState);
    },

    setError: (message) => {
      clearTimers();
      set({
        isRunning: false,
        requestId: null,
        elapsedSeconds: 0,
        error: message,
        showSuccess: false,
        hasActiveStatus: true,
      });
    },

    dismissError: () => {
      if (!get().error) return;
      set({ error: null, hasActiveStatus: false });
    },
  })
);
