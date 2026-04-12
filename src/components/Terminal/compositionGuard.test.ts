/**
 * Tests for terminal IME composition grace period.
 *
 * This file tests the composition guard PATTERN in isolation using a minimal
 * reimplementation. The real wiring (xterm textarea → composition events →
 * onCompositionCommit → PTY write) is tested in createTerminalInstance.test.ts.
 *
 * Validates:
 * - composing stays true during grace period after compositionend
 * - onCompositionCommit fires with clean committed text after grace period
 * - ALL onData is blocked during grace period (#619) — no selective filtering
 * - new compositionstart cancels pending grace timer
 * - single non-ASCII chars (CJK brackets) flush immediately without grace period (#525)
 * - lastCommittedText / lastCommitTime enable onData deduplication (#525)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IME_COMPOSITION_GRACE_MS, IME_DEDUP_WINDOW_MS } from "./createTerminalInstance";

const GRACE_MS = IME_COMPOSITION_GRACE_MS;

/**
 * Minimal reproduction of the composition guard logic from createTerminalInstance.
 * Extracted here so we can test timing and state transitions without needing
 * a real xterm instance.
 */
function createCompositionGuard() {
  let composing = false;
  let inGracePeriod = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCommitText: string | null = null;
  let commitCallback: ((text: string) => void) | null = null;
  let lastCommittedText: string | null = null;
  let lastCommitTime = 0;

  return {
    get composing() { return composing; },
    get inGracePeriod() { return inGracePeriod; },
    get lastCommittedText() { return lastCommittedText; },
    get lastCommitTime() { return lastCommitTime; },
    set onCompositionCommit(cb: ((text: string) => void) | null) { commitCallback = cb; },

    compositionStart() {
      // Flush any pending committed text from a previous compositionend before
      // starting a new composition — prevents input loss in rapid back-to-back
      // IME commits (mirrors createTerminalInstance.ts flush logic).
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
        if (pendingCommitText && commitCallback) {
          lastCommittedText = pendingCommitText;
          lastCommitTime = Date.now();
          commitCallback(pendingCommitText);
        }
        pendingCommitText = null;
      }
      composing = true;
      inGracePeriod = false;
    },

    compositionEnd(data: string) {
      // Guard: if composing is already false, this is a spurious compositionend
      // fired without a preceding compositionstart (fcitx5+rime on Linux: #659).
      if (!composing && !inGracePeriod) return;

      // Single non-ASCII character (CJK punctuation/bracket) — flush immediately.
      // These don't trigger xterm's garbled space injection, so no grace period needed.
      // eslint-disable-next-line no-control-regex
      if (data && data.length === 1 && !/^[\x00-\x7F]$/.test(data)) {
        composing = false;
        inGracePeriod = false;
        if (graceTimer) {
          clearTimeout(graceTimer);
          graceTimer = null;
        }
        pendingCommitText = null;
        lastCommittedText = data;
        lastCommitTime = Date.now();
        if (commitCallback) {
          commitCallback(data);
        }
        return;
      }

      // Multi-char: use grace period as before.
      // Cancel any orphaned timer from a previous compositionend that fired
      // without a compositionstart in between (fcitx5+rime on Linux: #659).
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      pendingCommitText = data;
      inGracePeriod = true;
      graceTimer = setTimeout(() => {
        graceTimer = null;
        composing = false;
        inGracePeriod = false;
        if (pendingCommitText && commitCallback) {
          lastCommittedText = pendingCommitText;
          lastCommitTime = Date.now();
          commitCallback(pendingCommitText);
        }
        pendingCommitText = null;
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

  it("new compositionstart flushes pending text then starts new composition", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("ni");

    // Start a new composition before grace expires — flushes "ni" immediately
    vi.advanceTimersByTime(GRACE_MS / 2);
    guard.compositionStart();

    // "ni" should have been flushed immediately by compositionStart
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("ni");
    expect(guard.composing).toBe(true);

    // Now finish second composition
    guard.compositionEnd("你好");
    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledWith("你好");
  });

  it("blocks ALL onData during grace period — ASCII and CJK alike (#619)", () => {
    const guard = createCompositionGuard();
    const ptyWrite = vi.fn();

    // Simulate the onData guard pattern from useTerminalSessions.
    // ALL data is blocked during composition and grace period — no selective
    // filtering. The committed text is written directly via onCompositionCommit.
    const onData = (data: string) => {
      if (guard.composing) return; // blocked
      ptyWrite(data);
    };

    guard.compositionStart();
    onData("cl"); // blocked during active composition
    expect(ptyWrite).not.toHaveBeenCalled();

    guard.compositionEnd("claude");
    onData("cl au de"); // ASCII re-emission — blocked during grace period
    expect(ptyWrite).not.toHaveBeenCalled();

    vi.advanceTimersByTime(GRACE_MS);
    // After grace, normal data passes through
    onData("hello");
    expect(ptyWrite).toHaveBeenCalledWith("hello");
  });

  it("blocks CJK text re-emitted by xterm during grace period (#619)", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    const ptyWrite = vi.fn();
    guard.onCompositionCommit = commit;

    // Simulate the full onData guard from useTerminalSessions
    const onData = (data: string) => {
      if (guard.composing) return;
      if (
        guard.lastCommittedText &&
        Date.now() - guard.lastCommitTime < IME_DEDUP_WINDOW_MS &&
        (data === guard.lastCommittedText || guard.lastCommittedText.startsWith(data))
      ) {
        return;
      }
      ptyWrite(data);
    };

    // User types "你好世界" with Chinese IME
    guard.compositionStart();
    guard.compositionEnd("你好世界");

    // xterm re-emits the composed text via onData during grace period —
    // this was the root cause of duplication in #619
    onData("你好世界");
    expect(ptyWrite).not.toHaveBeenCalled();

    // Also block if xterm chunks the text as prefix segments
    onData("你好");
    expect(ptyWrite).not.toHaveBeenCalled();

    // Grace period expires — committed text written via onCompositionCommit
    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledWith("你好世界");

    // After grace, normal data flows
    onData("ls\n");
    expect(ptyWrite).toHaveBeenCalledWith("ls\n");
  });
});

describe("single non-ASCII char immediate flush (#525 — CJK brackets)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes single CJK bracket immediately without grace period", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("（");

    // Should fire immediately — no grace period
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("（");
    expect(guard.composing).toBe(false);
    expect(guard.inGracePeriod).toBe(false);
  });

  it("flushes single CJK character immediately", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你");

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("你");
    expect(guard.composing).toBe(false);
  });

  it("does NOT flush single ASCII char immediately (uses grace period)", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("a");

    // Should NOT fire immediately — single ASCII goes through grace period
    expect(commit).not.toHaveBeenCalled();
    expect(guard.composing).toBe(true);

    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledWith("a");
  });

  it("uses grace period for multi-char CJK input", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你好");

    // Multi-char — should NOT fire immediately
    expect(commit).not.toHaveBeenCalled();
    expect(guard.composing).toBe(true);

    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledWith("你好");
  });

  it("sets lastCommittedText and lastCommitTime on immediate flush", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    const beforeTime = Date.now();
    guard.compositionStart();
    guard.compositionEnd("）");

    expect(guard.lastCommittedText).toBe("）");
    expect(guard.lastCommitTime).toBeGreaterThanOrEqual(beforeTime);
  });

  it("handles various CJK brackets: 【、】、「、」", () => {
    const brackets = ["【", "】", "「", "」", "《", "》", "、"];
    for (const bracket of brackets) {
      const guard = createCompositionGuard();
      const commit = vi.fn();
      guard.onCompositionCommit = commit;

      guard.compositionStart();
      guard.compositionEnd(bracket);

      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(bracket);
      expect(guard.composing).toBe(false);

      guard.dispose();
    }
  });
});

describe("back-to-back compositionend without compositionstart (#659 — fcitx5+rime)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels orphaned timer when compositionend fires twice without compositionstart", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("一");
    // Second compositionend without compositionstart (fcitx5+rime behavior)
    guard.compositionEnd("一");

    vi.advanceTimersByTime(GRACE_MS);
    // Must commit exactly once — orphaned timer from first compositionEnd must not fire
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("一");
  });

  it("drops subsequent compositionend with accumulated text (already committed)", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你");
    // fcitx5 fires again with accumulated text — but "你" was already committed.
    // Committing "你好" would produce "你你好" in PTY, so it must be dropped.
    guard.compositionEnd("你好");

    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("你");
  });

  it("drops all spurious compositionend events after the first commit", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("一");
    // Spurious events with accumulated text — all dropped
    guard.compositionEnd("一一");
    guard.compositionEnd("一一一");

    vi.advanceTimersByTime(GRACE_MS * 2);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("一");
  });
});

describe("chunked onData re-emission dedup (#768)", () => {
  const DEDUP_WINDOW_MS = IME_DEDUP_WINDOW_MS;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mirrors the dedup guard in useTerminalSessions.ts, including the
   * consumed-prefix pointer that advances as chunks are absorbed.
   * This enables matching suffix chunks when xterm splits a commit
   * like "你好世界" into "你好" + "世界" across two onData calls.
   */
  function makeOnData(guard: ReturnType<typeof createCompositionGuard>, ptyWrite: (d: string) => void) {
    let lastSeenCommitTime = 0;
    let consumed = 0;
    return (data: string) => {
      if (guard.composing) return;
      const lastText = guard.lastCommittedText;
      const lastTime = guard.lastCommitTime;
      if (lastText && Date.now() - lastTime < DEDUP_WINDOW_MS) {
        if (lastSeenCommitTime !== lastTime) {
          lastSeenCommitTime = lastTime;
          consumed = 0;
        }
        const remainder = lastText.slice(consumed);
        if (data.length > 0 && (remainder === data || remainder.startsWith(data))) {
          consumed += data.length;
          return;
        }
      }
      ptyWrite(data);
    };
  }

  it("blocks both prefix and suffix chunks of a split re-emission", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    const ptyWrite = vi.fn();
    guard.onCompositionCommit = commit;

    // Full commit "你好世界" fires via onCompositionCommit after grace.
    guard.compositionStart();
    guard.compositionEnd("你好世界");
    vi.advanceTimersByTime(GRACE_MS);
    expect(commit).toHaveBeenCalledWith("你好世界");

    // xterm then re-emits the same text chunked across two onData calls.
    const onData = makeOnData(guard, ptyWrite);
    vi.advanceTimersByTime(10);
    onData("你好");
    onData("世界");

    // PTY must receive ZERO writes — both chunks absorbed by the pointer.
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("still allows unrelated text after a chunked re-emission is consumed", () => {
    const guard = createCompositionGuard();
    const ptyWrite = vi.fn();
    // commitCallback must be set — the guard only records lastCommittedText
    // when there is a commit sink to notify.
    guard.onCompositionCommit = vi.fn();

    guard.compositionStart();
    guard.compositionEnd("你好");
    vi.advanceTimersByTime(GRACE_MS);

    const onData = makeOnData(guard, ptyWrite);
    vi.advanceTimersByTime(10);
    onData("你");
    onData("好");
    // Full committed text consumed — subsequent unrelated data must pass.
    onData("ls\n");
    expect(ptyWrite).toHaveBeenCalledTimes(1);
    expect(ptyWrite).toHaveBeenCalledWith("ls\n");
  });

  it("resets consumed pointer when a new commit arrives", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    const ptyWrite = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你好");
    vi.advanceTimersByTime(GRACE_MS);

    const onData = makeOnData(guard, ptyWrite);
    vi.advanceTimersByTime(5);
    onData("你"); // consume prefix of first commit

    // New commit — pointer should reset so first chunk of new commit is blocked.
    guard.compositionStart();
    guard.compositionEnd("世界");
    vi.advanceTimersByTime(GRACE_MS);

    onData("世界");
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("does not dedup when data is longer than remainder", () => {
    const guard = createCompositionGuard();
    const ptyWrite = vi.fn();
    guard.onCompositionCommit = vi.fn();

    guard.compositionStart();
    guard.compositionEnd("你好");
    vi.advanceTimersByTime(GRACE_MS);

    const onData = makeOnData(guard, ptyWrite);
    vi.advanceTimersByTime(10);
    onData("你"); // consumed by pointer, remainder becomes "好"
    // Data longer than remainder — don't absorb, pass to PTY.
    onData("好世界");
    expect(ptyWrite).toHaveBeenCalledTimes(1);
    expect(ptyWrite).toHaveBeenCalledWith("好世界");
  });
});

describe("WeChat IME onData dedup (#525)", () => {
  const DEDUP_WINDOW_MS = IME_DEDUP_WINDOW_MS;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets lastCommittedText/lastCommitTime after grace period commit", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你好");

    vi.advanceTimersByTime(GRACE_MS);

    expect(guard.lastCommittedText).toBe("你好");
    expect(guard.lastCommitTime).toBeGreaterThan(0);
  });

  it("dedup guard blocks late onData matching committed text within window", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    const ptyWrite = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你好");
    vi.advanceTimersByTime(GRACE_MS);

    // Simulate the onData dedup guard from useTerminalSessions
    const onData = (data: string) => {
      if (
        guard.lastCommittedText &&
        Date.now() - guard.lastCommitTime < DEDUP_WINDOW_MS &&
        (data === guard.lastCommittedText || guard.lastCommittedText.startsWith(data))
      ) {
        return; // deduped
      }
      ptyWrite(data);
    };

    // Late onData arrives 50ms after commit — within dedup window
    vi.advanceTimersByTime(50);
    onData("你好");
    expect(ptyWrite).not.toHaveBeenCalled();

    // Prefix chunk also blocked
    onData("你");
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("dedup guard allows onData with non-prefix text", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    const ptyWrite = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你好");
    vi.advanceTimersByTime(GRACE_MS);

    const onData = (data: string) => {
      if (
        guard.lastCommittedText &&
        Date.now() - guard.lastCommitTime < DEDUP_WINDOW_MS &&
        (data === guard.lastCommittedText || guard.lastCommittedText.startsWith(data))
      ) {
        return;
      }
      ptyWrite(data);
    };

    vi.advanceTimersByTime(50);
    onData("世界");
    expect(ptyWrite).toHaveBeenCalledWith("世界");
  });

  it("dedup guard allows onData after dedup window expires", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    const ptyWrite = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你好");
    vi.advanceTimersByTime(GRACE_MS);

    const onData = (data: string) => {
      if (
        guard.lastCommittedText &&
        Date.now() - guard.lastCommitTime < DEDUP_WINDOW_MS &&
        (data === guard.lastCommittedText || guard.lastCommittedText.startsWith(data))
      ) {
        return;
      }
      ptyWrite(data);
    };

    // Wait past the dedup window
    vi.advanceTimersByTime(DEDUP_WINDOW_MS + 10);
    onData("你好");
    expect(ptyWrite).toHaveBeenCalledWith("你好");
  });

  it("sets lastCommittedText on compositionStart flush", () => {
    const guard = createCompositionGuard();
    const commit = vi.fn();
    guard.onCompositionCommit = commit;

    guard.compositionStart();
    guard.compositionEnd("你好");

    // Start new composition before grace expires — flushes "你好"
    vi.advanceTimersByTime(GRACE_MS / 2);
    guard.compositionStart();

    expect(guard.lastCommittedText).toBe("你好");
    expect(guard.lastCommitTime).toBeGreaterThan(0);
  });
});
