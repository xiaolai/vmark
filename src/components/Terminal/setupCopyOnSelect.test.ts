/**
 * Tests for setupCopyOnSelect — copy-on-select wiring for xterm.js
 * Terminal. Covers debounce coalescing, IME gating, settings gate,
 * selection re-check at flush time, clipboard error path, and cleanup.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockWriteText, mockClipboardWarn, mockSettings } = vi.hoisted(() => ({
  mockWriteText: vi.fn(),
  mockClipboardWarn: vi.fn(),
  mockSettings: { terminal: { copyOnSelect: true } },
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => mockWriteText(...args),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

vi.mock("@/utils/debug", () => ({
  clipboardWarn: (...args: unknown[]) => mockClipboardWarn(...args),
}));

import { setupCopyOnSelect } from "./setupCopyOnSelect";

interface MockTerminal {
  onSelectionChange: ReturnType<typeof vi.fn>;
  hasSelection: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
}

interface Wiring {
  term: MockTerminal;
  fireSelectionChange: () => void;
  dispose: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function setup(opts: {
  selection?: string;
  hasSelection?: boolean;
  isComposing?: boolean;
  /** When true, onSelectionChange returns undefined instead of a disposable. */
  disposableUndefined?: boolean;
}): Wiring {
  let handler: (() => void) | null = null;
  const dispose = vi.fn();
  const term: MockTerminal = {
    onSelectionChange: vi.fn((cb: () => void) => {
      handler = cb;
      return opts.disposableUndefined ? undefined : { dispose };
    }),
    hasSelection: vi.fn(() => opts.hasSelection ?? true),
    getSelection: vi.fn(() => opts.selection ?? ""),
  };
  const isComposing = vi.fn(() => opts.isComposing ?? false);
  const cleanup = setupCopyOnSelect({
    term: term as unknown as Parameters<typeof setupCopyOnSelect>[0]["term"],
    isComposing,
  });
  return {
    term,
    fireSelectionChange: () => handler?.(),
    dispose,
    cleanup,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockWriteText.mockReset();
  mockWriteText.mockResolvedValue(undefined);
  mockClipboardWarn.mockReset();
  mockSettings.terminal.copyOnSelect = true;
});

describe("setupCopyOnSelect", () => {
  it("copies trimmed selection to clipboard after the 150ms debounce", () => {
    const w = setup({ selection: "hello   ", hasSelection: true });
    w.fireSelectionChange();

    expect(mockWriteText).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(mockWriteText).toHaveBeenCalledTimes(1);
    expect(mockWriteText).toHaveBeenCalledWith("hello");

    w.cleanup();
  });

  it("coalesces rapid onSelectionChange events — final selection wins", () => {
    const w = setup({ selection: "ab", hasSelection: true });

    w.fireSelectionChange();
    vi.advanceTimersByTime(50);
    w.fireSelectionChange();
    vi.advanceTimersByTime(50);
    w.fireSelectionChange();
    vi.advanceTimersByTime(150);

    expect(mockWriteText).toHaveBeenCalledTimes(1);

    w.cleanup();
  });

  it("does NOT write or schedule when IME is composing", () => {
    const w = setup({ selection: "x", hasSelection: true, isComposing: true });
    w.fireSelectionChange();

    vi.advanceTimersByTime(500);
    expect(mockWriteText).not.toHaveBeenCalled();

    w.cleanup();
  });

  it("does NOT write when terminal.copyOnSelect setting is false", () => {
    mockSettings.terminal.copyOnSelect = false;
    const w = setup({ selection: "x", hasSelection: true });
    w.fireSelectionChange();

    vi.advanceTimersByTime(150);
    expect(mockWriteText).not.toHaveBeenCalled();

    w.cleanup();
  });

  it("re-checks hasSelection at flush — collapsed selection cancels write", () => {
    let hasSel = true;
    type Handler = () => void;
    let handler: Handler | null = null;
    const dispose = vi.fn();
    const term = {
      onSelectionChange: (cb: Handler) => {
        handler = cb;
        return { dispose };
      },
      hasSelection: () => hasSel,
      getSelection: () => "x",
    };
    const cleanup = setupCopyOnSelect({
      term: term as unknown as Parameters<typeof setupCopyOnSelect>[0]["term"],
      isComposing: () => false,
    });

    // Cast to satisfy TS narrowing — `handler` is assigned in the closure
    // above but TS treats it as `null` at the call site.
    (handler as Handler | null)?.();
    hasSel = false; // user collapsed the selection before the timer fires
    vi.advanceTimersByTime(150);

    expect(mockWriteText).not.toHaveBeenCalled();

    cleanup();
  });

  it("skips write when trimmed selection is empty (whitespace only)", () => {
    const w = setup({ selection: "    ", hasSelection: true });
    w.fireSelectionChange();
    vi.advanceTimersByTime(150);

    expect(mockWriteText).not.toHaveBeenCalled();

    w.cleanup();
  });

  it("swallows writeText rejection and logs via clipboardWarn", async () => {
    mockWriteText.mockRejectedValueOnce(new Error("Permission denied"));
    const w = setup({ selection: "x", hasSelection: true });
    w.fireSelectionChange();

    vi.advanceTimersByTime(150);
    // Let the rejected promise settle.
    await vi.runAllTimersAsync();

    expect(mockClipboardWarn).toHaveBeenCalledTimes(1);
    expect(mockClipboardWarn.mock.calls[0][0]).toContain("Clipboard write");

    w.cleanup();
  });

  it("cleanup clears a pending timer and calls subscription.dispose", () => {
    const w = setup({ selection: "x", hasSelection: true });
    w.fireSelectionChange();
    // Timer is scheduled but not yet fired.

    w.cleanup();
    vi.advanceTimersByTime(500);

    expect(mockWriteText).not.toHaveBeenCalled();
    expect(w.dispose).toHaveBeenCalledTimes(1);
  });

  it("cleanup is robust when onSelectionChange returned undefined (mock-style)", () => {
    const w = setup({
      selection: "x",
      hasSelection: true,
      disposableUndefined: true,
    });
    expect(() => w.cleanup()).not.toThrow();
  });
});
