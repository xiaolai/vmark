/**
 * Tests for terminal IME composition grace period.
 *
 * Validates the pattern used in createTerminalInstance.ts:
 * - composing stays true during grace period after compositionend
 * - onCompositionCommit fires with clean committed text after grace period
 * - onData is blocked during grace period (composing=true)
 * - new compositionstart cancels pending grace timer
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const GRACE_MS = 80;

/**
 * Minimal reproduction of the composition guard logic from createTerminalInstance.
 * Extracted here so we can test timing and state transitions without needing
 * a real xterm instance.
 */
function createCompositionGuard() {
  let composing = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let commitCallback: ((text: string) => void) | null = null;

  return {
    get composing() { return composing; },
    set onCompositionCommit(cb: ((text: string) => void) | null) { commitCallback = cb; },

    compositionStart() {
      composing = true;
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
    },

    compositionEnd(data: string) {
      graceTimer = setTimeout(() => {
        graceTimer = null;
        composing = false;
        if (data && commitCallback) {
          commitCallback(data);
        }
      }, GRACE_MS);
    },

    dispose() {
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
    },
  };
}

describe("terminal IME composition grace period", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("composing stays true during grace period after compositionend", () => {
    const guard = createCompositionGuard();
    guard.compositionStart();
    expect(guard.composing).toBe(true);

    guard.compositionEnd("claude");
    // Still composing during grace period
    expect(guard.composing).toBe(true);

    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(guard.composing).toBe(true);

    vi.advanceTimersByTime(1);
    expect(guard.composing).toBe(false);
  });

  it("fires onCompositionCommit with clean text after grace period", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("claude");

    // Not fired yet during grace period
    expect(commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("claude");
  });

  it("fires onCompositionCommit with CJK characters", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你好");

    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledWith("你好");
  });

  it("does not fire commit for empty composition (e.g., Escape cancel)", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("");

    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).not.toHaveBeenCalled();
    expect(guard.composing).toBe(false);
  });

  it("new compositionstart cancels pending grace timer", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("ni");

    // Start a new composition before grace expires
    vi.advanceTimersByTime(GRACE_MS / 2);
    guard.compositionStart();

    // Grace timer for "ni" should be cancelled
    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).not.toHaveBeenCalled();
    expect(guard.composing).toBe(true);

    // Now finish second composition
    guard.compositionEnd("你好");
    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("你好");
  });

  it("blocks onData-style forwarding during grace period", () => {
    const guard = createCompositionGuard();
    const ptyWrite = vi.fn();

    // Simulate the onData guard pattern from useTerminalSessions
    const onData = (data: string) => {
      if (guard.composing) return; // blocked
      ptyWrite(data);
    };

    guard.compositionStart();
    onData("cl"); // blocked during composition
    expect(ptyWrite).not.toHaveBeenCalled();

    guard.compositionEnd("claude");
    onData("cl au de"); // blocked during grace period
    expect(ptyWrite).not.toHaveBeenCalled();

    vi.advanceTimersByTime(GRACE_MS);
    // After grace, normal data passes through
    onData("hello");
    expect(ptyWrite).toHaveBeenCalledWith("hello");
  });
});
