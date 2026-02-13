import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTerminalKeyHandler, type KeyHandlerCallbacks } from "./terminalKeyHandler";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "tauri-pty";

vi.mock("tauri-pty", () => ({ spawn: vi.fn() }));

function makeTerm(overrides: Partial<Terminal> = {}): Terminal {
  return {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  } as unknown as Terminal;
}

function makeEvent(
  key: string,
  meta = true,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    type: "keydown",
    key,
    metaKey: meta,
    ctrlKey: false,
    isComposing: false,
    keyCode: 0,
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("createTerminalKeyHandler", () => {
  let callbacks: KeyHandlerCallbacks;
  let ptyRef: React.RefObject<IPty | null>;
  let mockPty: { write: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = { onSearch: vi.fn() };
    mockPty = { write: vi.fn() };
    ptyRef = { current: mockPty as unknown as IPty };
  });

  it("copies selection on Cmd+C when selection exists", () => {
    const term = makeTerm({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => "hello"),
    });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("c"));

    expect(result).toBe(false);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(term.clearSelection).toHaveBeenCalled();
  });

  it("passes through Cmd+C for SIGINT when no selection", () => {
    const term = makeTerm({ hasSelection: vi.fn(() => false) });
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("c"));

    expect(result).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("pastes clipboard on Cmd+V", async () => {
    vi.mocked(readText).mockResolvedValue("pasted");
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("v"));

    expect(result).toBe(false);
    // Wait for async paste
    await vi.waitFor(() => {
      expect(mockPty.write).toHaveBeenCalledWith("pasted");
    });
  });

  it("clears terminal on Cmd+K", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("k"));

    expect(result).toBe(false);
    expect(term.clear).toHaveBeenCalled();
  });

  it("triggers search callback on Cmd+F", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("f"));

    expect(result).toBe(false);
    expect(callbacks.onSearch).toHaveBeenCalled();
  });

  it("passes through unhandled keys", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    expect(handler(makeEvent("a"))).toBe(true);
    expect(handler(makeEvent("z"))).toBe(true);
  });

  it("passes through IME composition events (isComposing)", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    // Cmd+V during IME composition should NOT trigger paste
    const result = handler(makeEvent("v", true, { isComposing: true }));
    expect(result).toBe(true);
    expect(readText).not.toHaveBeenCalled();
  });

  it("passes through IME keyCode 229 events", () => {
    const term = makeTerm();
    const handler = createTerminalKeyHandler(term, ptyRef, callbacks);
    const result = handler(makeEvent("v", true, { keyCode: 229 }));
    expect(result).toBe(true);
    // Should not trigger paste
    expect(readText).not.toHaveBeenCalled();
  });
});
