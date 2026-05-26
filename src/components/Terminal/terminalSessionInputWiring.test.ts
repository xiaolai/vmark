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
    serializeAddon: {} as TerminalInstance["serializeAddon"],
    container: {} as TerminalInstance["container"],
    resetDisplay: () => {},
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
