// @vitest-environment node
/**
 * Tests for wireSessionInput under Channel Ownership (single writer per
 * keystroke). The legacy dual-writer dedup (Path A/B, grace window, echo token)
 * was removed in WI-4b, so this covers only: IME commit → PTY, onData → PTY,
 * the composing guard, and press-any-key-to-restart.
 */
import { describe, it, expect, vi } from "vitest";
import { wireSessionInput, type SessionInputState } from "./terminalSessionInputWiring";
import type { TerminalInstance } from "./createTerminalInstance";

function makeEntry() {
  let onDataCb: ((data: string) => void) | null = null;
  let onCommit: ((text: string) => void) | null = null;
  const writeMock = vi.fn();
  const clearMock = vi.fn();
  const noteMock = vi.fn();
  const pty = { write: writeMock } as unknown as SessionInputState["pty"];
  const instance = {
    term: {
      onData: (cb: (data: string) => void) => {
        onDataCb = cb;
        return { dispose: () => {} };
      },
      clear: clearMock,
    },
    composing: false,
    get onCompositionCommit() { return onCommit; },
    set onCompositionCommit(v: ((text: string) => void) | null) { onCommit = v; },
    noteExternalWrite: noteMock,
  } as unknown as TerminalInstance;
  const entry: SessionInputState = { instance, pty, shellExited: false };
  return {
    entry,
    writeMock,
    clearMock,
    noteMock,
    fireOnData: (data: string) => onDataCb?.(data),
    fireCommit: (text: string) => onCommit?.(text),
  };
}

describe("wireSessionInput — single-writer contract", () => {
  it("writes an IME commit straight to the PTY", () => {
    const { entry, writeMock, fireCommit } = makeEntry();
    wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });
    fireCommit("你好");
    expect(writeMock).toHaveBeenCalledExactlyOnceWith("你好");
  });

  it("passes onData keystrokes through to the PTY", () => {
    const { entry, writeMock, fireOnData } = makeEntry();
    wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });
    fireOnData("c");
    fireOnData("o");
    expect(writeMock).toHaveBeenNthCalledWith(1, "c");
    expect(writeMock).toHaveBeenNthCalledWith(2, "o");
  });

  it("drops onData while a composition is active (the commit path delivers it)", () => {
    const { entry, writeMock, fireOnData } = makeEntry();
    (entry.instance as { composing: boolean }).composing = true;
    wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell: () => {} });
    fireOnData("x");
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("does not write when the entry has been removed", () => {
    const { entry, writeMock, fireOnData, fireCommit } = makeEntry();
    let live: SessionInputState | undefined = entry;
    wireSessionInput({ sessionId: "s1", getEntry: () => live, startShell: () => {} });
    live = undefined;
    fireOnData("x");
    fireCommit("你");
    expect(writeMock).not.toHaveBeenCalled();
  });

  describe("press-any-key-to-restart after shell exit", () => {
    it("an onData chunk respawns the shell and does not write", () => {
      const { entry, writeMock, clearMock, fireOnData } = makeEntry();
      entry.pty = null;
      entry.shellExited = true;
      const startShell = vi.fn();
      wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell });
      fireOnData("\r");
      expect(startShell).toHaveBeenCalledWith("s1");
      expect(entry.shellExited).toBe(false);
      expect(clearMock).toHaveBeenCalled();
      expect(writeMock).not.toHaveBeenCalled();
    });

    it("an IME commit respawns the shell and does not replay the text", () => {
      const { entry, writeMock, fireCommit } = makeEntry();
      entry.pty = null;
      entry.shellExited = true;
      const startShell = vi.fn();
      wireSessionInput({ sessionId: "s1", getEntry: () => entry, startShell });
      fireCommit("你好");
      expect(startShell).toHaveBeenCalledWith("s1");
      expect(entry.shellExited).toBe(false);
      expect(writeMock).not.toHaveBeenCalled();
    });
  });
});

// WI-13 — the gate's insert ownership derives from writes the wiring ACTUALLY
// forwarded. A suppressed onData (mid-composition) must not be reported, or a
// keystroke xterm never delivered would be treated as already written.
describe("wireSessionInput — write reporting (WI-13)", () => {
  it("reports a forwarded onData to the gate", () => {
    const { entry, fireOnData, noteMock, writeMock } = makeEntry();
    wireSessionInput({ sessionId: "s", getEntry: () => entry, startShell: vi.fn() });
    fireOnData("a");
    expect(writeMock).toHaveBeenCalledWith("a");
    expect(noteMock).toHaveBeenCalledWith("a");
  });

  it("does NOT report an onData suppressed by an active composition", () => {
    const { entry, fireOnData, noteMock, writeMock } = makeEntry();
    (entry.instance as { composing: boolean }).composing = true;
    wireSessionInput({ sessionId: "s", getEntry: () => entry, startShell: vi.fn() });
    fireOnData("a");
    expect(writeMock).not.toHaveBeenCalled();
    expect(noteMock).not.toHaveBeenCalled();
  });

  it("does not report when there is no PTY to write to", () => {
    const { entry, fireOnData, noteMock } = makeEntry();
    entry.pty = null;
    wireSessionInput({ sessionId: "s", getEntry: () => entry, startShell: vi.fn() });
    fireOnData("a");
    expect(noteMock).not.toHaveBeenCalled();
  });
});
