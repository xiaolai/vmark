/**
 * Tests for wireSessionInput dedup paths.
 *
 * Path A (#525): chunked re-emission of segments of the committed string.
 * Path B (#948): Linux + WebKitGTK re-emits the committed text 1–2× in
 * a single chunk, sometimes concatenated as whole-integer multiples
 * ("你好" then "你好" — or one chunk "你好你好").
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { wireSessionInput, type SessionInputState } from "./terminalSessionInputWiring";
import type { TerminalInstance } from "./createTerminalInstance";

function makeEntry(committedText: string | null, lastCommitTime: number) {
  let onDataCb: ((data: string) => void) | null = null;
  const writeMock = vi.fn();
  const pty = { write: writeMock } as unknown as SessionInputState["pty"];
  const instance: TerminalInstance = {
    term: {
      onData: (cb: (data: string) => void) => {
        onDataCb = cb;
        return { dispose: () => {} };
      },
      clear: () => {},
    } as unknown as TerminalInstance["term"],
    composing: false,
    inGracePeriod: false,
    onCompositionCommit: null,
    lastCommittedText: committedText,
    lastCommitTime,
    fitAddon: {} as TerminalInstance["fitAddon"],
    searchAddon: {} as TerminalInstance["searchAddon"],
    container: {} as TerminalInstance["container"],
    resetDisplay: () => {},
    getCwd: () => null,
    getCommands: () => [],
    isShellBusy: () => false,
    dispose: () => {},
  };
  const entry: SessionInputState = {
    instance,
    pty,
    shellExited: false,
    lastSeenCommitTime: 0,
    lastCommittedConsumed: 0,
  };
  return {
    entry,
    writeMock,
    fireOnData: (data: string) => {
      if (onDataCb) onDataCb(data);
    },
  };
}

describe("wireSessionInput — dedup paths", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("path A: suppresses chunked re-emission across segments of the committed string", () => {
    const { entry, writeMock, fireOnData } = makeEntry("你好世界", Date.now());
    wireSessionInput({
      sessionId: "s1",
      getEntry: () => entry,
      startShell: () => {},
    });

    fireOnData("你好");
    fireOnData("世界");

    expect(writeMock).not.toHaveBeenCalled();
  });

  it("path B: suppresses a single full re-emit of the committed text", () => {
    const { entry, writeMock, fireOnData } = makeEntry("你好", Date.now());
    wireSessionInput({
      sessionId: "s1",
      getEntry: () => entry,
      startShell: () => {},
    });

    // First arrival is suppressed by the existing path A (remainder === data).
    fireOnData("你好");
    // Second arrival (Linux fcitx5 re-emit) — path A's remainder is now
    // empty; path B catches the full-repetition.
    fireOnData("你好");

    expect(writeMock).not.toHaveBeenCalled();
  });

  it("path B: suppresses a doubled re-emit in one chunk (\"你好你好\")", () => {
    const { entry, writeMock, fireOnData } = makeEntry("你好", Date.now());
    wireSessionInput({
      sessionId: "s1",
      getEntry: () => entry,
      startShell: () => {},
    });

    fireOnData("你好你好");

    expect(writeMock).not.toHaveBeenCalled();
  });

  it("path B: does NOT suppress text that is not a whole-integer multiple", () => {
    const { entry, writeMock, fireOnData } = makeEntry("你好", Date.now());
    wireSessionInput({
      sessionId: "s1",
      getEntry: () => entry,
      startShell: () => {},
    });

    fireOnData("你好世");

    expect(writeMock).toHaveBeenCalledWith("你好世");
  });

  it("path B: does NOT suppress a same-multiple-length string that differs in content", () => {
    const { entry, writeMock, fireOnData } = makeEntry("你好", Date.now());
    wireSessionInput({
      sessionId: "s1",
      getEntry: () => entry,
      startShell: () => {},
    });

    // 4 chars (clean multiple of 2) but content does not equal "你好你好".
    fireOnData("你好世界");

    expect(writeMock).toHaveBeenCalledWith("你好世界");
  });

  it("does not dedup once the post-grace window has elapsed", () => {
    const { entry, writeMock, fireOnData } = makeEntry("你好", Date.now());
    wireSessionInput({
      sessionId: "s1",
      getEntry: () => entry,
      startShell: () => {},
    });

    vi.advanceTimersByTime(1000);
    fireOnData("你好");

    expect(writeMock).toHaveBeenCalledWith("你好");
  });

  it("treats an IME commit after shell exit as the press-any-key respawn signal", () => {
    const { entry, writeMock, fireOnData } = makeEntry(null, 0);
    entry.pty = null;
    entry.shellExited = true;
    let onCommit: ((text: string) => void) | null = null;
    // Capture the callback the wiring assigns.
    Object.defineProperty(entry.instance, "onCompositionCommit", {
      set(v) {
        onCommit = v;
      },
      get() {
        return onCommit;
      },
      configurable: true,
    });
    const startShell = vi.fn();
    wireSessionInput({
      sessionId: "s1",
      getEntry: () => entry,
      startShell,
    });

    expect(onCommit).toBeTypeOf("function");
    onCommit!("你好");

    expect(startShell).toHaveBeenCalledWith("s1");
    expect(entry.shellExited).toBe(false);
    // Text is intentionally not written or replayed.
    expect(writeMock).not.toHaveBeenCalled();
    void fireOnData;
  });

  describe("cross-path echo dedup (onData + plain-input forward, same keydown)", () => {
    it("skips the forward when onData just wrote the SAME non-ASCII char (no double)", () => {
      // macOS Pinyin "！": xterm's onData fires first and writes it, then our
      // plain-input forward fires for the same char — which must be suppressed.
      const { entry, writeMock, fireOnData } = makeEntry(null, 0);
      wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });

      fireOnData("！"); // xterm onData → write #1
      entry.instance.onCompositionCommit!("！"); // forward for same char → skipped

      expect(writeMock).toHaveBeenCalledTimes(1);
      expect(writeMock).toHaveBeenCalledWith("！");
    });

    it("writes a forward that has no preceding onData (e.g. \"？\")", () => {
      const { entry, writeMock } = makeEntry(null, 0);
      wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });

      entry.instance.onCompositionCommit!("？");

      expect(writeMock).toHaveBeenCalledWith("？");
    });

    it("consumes the echo so a LATER same-char forward is NOT suppressed", () => {
      const { entry, writeMock, fireOnData } = makeEntry(null, 0);
      wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });

      fireOnData("！"); // write #1, records echo
      entry.instance.onCompositionCommit!("！"); // skipped, consumes echo
      entry.instance.onCompositionCommit!("！"); // no fresh onData → write #2

      expect(writeMock).toHaveBeenCalledTimes(2);
    });

    it("an ASCII keystroke does not suppress a later IME forward", () => {
      const { entry, writeMock, fireOnData } = makeEntry(null, 0);
      wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });

      fireOnData("c"); // ASCII → not recorded as an echo
      entry.instance.onCompositionCommit!("！"); // written (no matching echo)

      expect(writeMock).toHaveBeenNthCalledWith(1, "c");
      expect(writeMock).toHaveBeenNthCalledWith(2, "！");
    });

    it("clears the echo after the dispatch — a later same-char forward is written", async () => {
      const { entry, writeMock, fireOnData } = makeEntry(null, 0);
      wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });

      fireOnData("！"); // write #1, records echo (microtask clear queued)
      await Promise.resolve(); // dispatch drains → token cleared
      entry.instance.onCompositionCommit!("！"); // no live echo → written

      expect(writeMock).toHaveBeenCalledTimes(2);
    });

    it("does NOT suppress a char typed right after pasting the same char (Codex audit)", async () => {
      // Paste "！" arrives via onData; typing "！" a moment later must not be
      // eaten. The echo token is scoped to the paste's dispatch, not a 150ms
      // window, so the later keystroke sees a cleared token.
      const { entry, writeMock, fireOnData } = makeEntry(null, 0);
      wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });

      fireOnData("！"); // paste → write #1, records echo
      await Promise.resolve(); // paste dispatch drains → token cleared
      entry.instance.onCompositionCommit!("！"); // typed later → written (#2)

      expect(writeMock).toHaveBeenCalledTimes(2);
    });
  });

  it("passes regular keystrokes through to the PTY when no commit is pending", () => {
    const { entry, writeMock, fireOnData } = makeEntry(null, 0);
    wireSessionInput({
      sessionId: "s1",
      getEntry: () => entry,
      startShell: () => {},
    });

    fireOnData("c");
    fireOnData("o");

    expect(writeMock).toHaveBeenNthCalledWith(1, "c");
    expect(writeMock).toHaveBeenNthCalledWith(2, "o");
  });
});
