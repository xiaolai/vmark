import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted mocks (available before vi.mock factories execute) ---

const { mockOpenUrl, mockTerminalLog, MockWebLinksAddon, mockWriteText, mockClipboardWarn, mockReadTextFile, mockStat, mockCreateTab, mockInitDocument, mockSettingsGetState, terminalFlags } = vi.hoisted(() => ({
  mockOpenUrl: vi.fn<(url: string) => Promise<void>>(),
  mockTerminalLog: vi.fn(),
  MockWebLinksAddon: vi.fn(),
  mockWriteText: vi.fn<(text: string) => Promise<void>>(),
  mockClipboardWarn: vi.fn(),
  mockReadTextFile: vi.fn<(path: string) => Promise<string>>(),
  mockStat: vi.fn<(path: string) => Promise<{ size: number }>>(),
  mockCreateTab: vi.fn(() => "tab-new"),
  mockInitDocument: vi.fn(),
  mockSettingsGetState: vi.fn(() => ({
    appearance: { theme: "default" },
    terminal: { copyOnSelect: false },
  })),
  terminalFlags: { createsTextarea: false },
}));

// --- Module mocks ---

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...(args as [string])),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => mockWriteText(...(args as [string])),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...(args as [string])),
  stat: (...args: unknown[]) => mockStat(...(args as [string])),
}));

vi.mock("@/utils/debug", () => ({
  terminalLog: (...args: unknown[]) => mockTerminalLog(...args),
  clipboardWarn: (...args: unknown[]) => mockClipboardWarn(...args),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    _constructorOptions: Record<string, unknown>;
    constructor(options: Record<string, unknown> = {}) {
      this._constructorOptions = options;
    }
    loadAddon = vi.fn();
    open = vi.fn((container: HTMLElement) => {
      if (terminalFlags.createsTextarea) {
        const textarea = document.createElement("textarea");
        textarea.className = "xterm-helper-textarea";
        container.appendChild(textarea);
      }
    });
    dispose = vi.fn();
    onSelectionChange = vi.fn();
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => "");
    attachCustomKeyEventHandler = vi.fn();
    registerLinkProvider = vi.fn();
    cols = 80;
    rows = 24;
    options = {};
    unicode = { activeVersion: "6" };
    buffer = { active: { getLine: vi.fn() } };
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class { fit = vi.fn(); dispose = vi.fn(); },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class { findNext = vi.fn(); findPrevious = vi.fn(); clearDecorations = vi.fn(); dispose = vi.fn(); },
}));

vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class { serialize = vi.fn(() => ""); dispose = vi.fn(); },
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: class { dispose = vi.fn(); },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: MockWebLinksAddon,
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => mockSettingsGetState(),
  },
  themes: {
    default: { background: "#ffffff", foreground: "#1a1a1a" },
    "night-owl": { background: "#011627", foreground: "#d6deeb", selection: "rgba(29,66,95,0.5)" },
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ createTab: mockCreateTab }) },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ initDocument: mockInitDocument }) },
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

const mockCreateFileLinkProvider = vi.fn(() => ({ provideLinks: vi.fn() }));
vi.mock("./fileLinkProvider", () => ({
  createFileLinkProvider: (...args: unknown[]) => mockCreateFileLinkProvider(...args),
}));

vi.mock("./terminalKeyHandler", () => ({
  createTerminalKeyHandler: vi.fn(() => () => true),
}));

// --- Imports ---

import { createTerminalInstance } from "./createTerminalInstance";

// --- Helpers ---

function makeInstance() {
  const parentEl = document.createElement("div");
  return createTerminalInstance({
    parentEl,
    settings: {
      fontSize: 14,
      lineHeight: 1.2,
      cursorStyle: "block",
      cursorBlink: true,
      useWebGL: false,
    },
    ptyRef: { current: null },
    onSearch: vi.fn(),
  });
}

// --- Tests ---

describe("createTerminalInstance link error handling", () => {
  let webLinkHandler: (event: MouseEvent, uri: string) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenUrl.mockResolvedValue(undefined);

    makeInstance();

    // Capture the handler passed to WebLinksAddon constructor
    webLinkHandler = MockWebLinksAddon.mock.calls[0][0];
  });

  it("logs error when openUrl rejects", async () => {
    mockOpenUrl.mockRejectedValueOnce(new Error("Sandbox denied"));

    webLinkHandler(new MouseEvent("click"), "https://example.com");

    // Wait for the dynamic import + openUrl promise chain to settle
    await vi.waitFor(() => {
      expect(mockTerminalLog).toHaveBeenCalledWith(
        "Failed to open URL:",
        "Sandbox denied",
      );
    });
  });

  it("logs error when openUrl rejects with non-Error value", async () => {
    mockOpenUrl.mockRejectedValueOnce("string error");

    webLinkHandler(new MouseEvent("click"), "https://example.com");

    await vi.waitFor(() => {
      expect(mockTerminalLog).toHaveBeenCalledWith(
        "Failed to open URL:",
        "string error",
      );
    });
  });
});

describe("createTerminalInstance basics", () => {
  it("creates a child container appended to parentEl", () => {
    const inst = makeInstance();
    expect(inst.container).toBeInstanceOf(HTMLDivElement);
    expect(inst.container.style.display).toBe("none");
  });

  it("exposes term, fitAddon, searchAddon, serializeAddon", () => {
    const inst = makeInstance();
    expect(inst.term).toBeDefined();
    expect(inst.fitAddon).toBeDefined();
    expect(inst.searchAddon).toBeDefined();
    expect(inst.serializeAddon).toBeDefined();
  });

  it("opens terminal in the container", () => {
    const inst = makeInstance();
    expect(inst.term.open).toHaveBeenCalledWith(inst.container);
  });

  it("sets unicode version to 11", () => {
    const inst = makeInstance();
    expect(inst.term.unicode.activeVersion).toBe("11");
  });

  it("attaches custom key event handler", () => {
    const inst = makeInstance();
    expect(inst.term.attachCustomKeyEventHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it("registers a link provider", () => {
    const inst = makeInstance();
    expect(inst.term.registerLinkProvider).toHaveBeenCalled();
  });

  it("registers selection change handler", () => {
    const inst = makeInstance();
    expect(inst.term.onSelectionChange).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe("createTerminalInstance dispose", () => {
  it("disposes the terminal on dispose()", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
    inst.dispose();
    expect(inst.term.dispose).toHaveBeenCalled();
  });

  it("removes container from parentEl on dispose()", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
    expect(parentEl.contains(inst.container)).toBe(true);
    inst.dispose();
    expect(parentEl.contains(inst.container)).toBe(false);
  });
});

describe("createTerminalInstance composing property", () => {
  it("starts with composing=false", () => {
    const inst = makeInstance();
    expect(inst.composing).toBe(false);
  });

  it("onCompositionCommit starts as null", () => {
    const inst = makeInstance();
    expect(inst.onCompositionCommit).toBeNull();
  });

  it("allows setting onCompositionCommit callback", () => {
    const inst = makeInstance();
    const cb = vi.fn();
    inst.onCompositionCommit = cb;
    expect(inst.onCompositionCommit).toBe(cb);
  });

  it("lastCommittedText starts as null", () => {
    const inst = makeInstance();
    expect(inst.lastCommittedText).toBeNull();
  });

  it("lastCommitTime starts at 0", () => {
    const inst = makeInstance();
    expect(inst.lastCommitTime).toBe(0);
  });
});

describe("createTerminalInstance with WebGL", () => {
  it("does not throw when WebGL is enabled", () => {
    vi.mock("@xterm/addon-webgl", () => ({
      WebglAddon: class {
        onContextLoss = vi.fn((cb: () => void) => cb);
        dispose = vi.fn();
      },
    }));

    const parentEl = document.createElement("div");
    expect(() =>
      createTerminalInstance({
        parentEl,
        settings: {
          fontSize: 14,
          lineHeight: 1.2,
          cursorStyle: "block",
          cursorBlink: true,
          useWebGL: true,
        },
        ptyRef: { current: null },
        onSearch: vi.fn(),
      })
    ).not.toThrow();
  });
});

describe("createTerminalInstance — macOptionIsMeta (#660)", () => {
  it("passes macOptionIsMeta: true to Terminal constructor for proper Option+Arrow handling", () => {
    const inst = makeInstance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((inst.term as any)._constructorOptions.macOptionIsMeta).toBe(true);
    inst.dispose();
  });
});

describe("createTerminalInstance — different settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts bar cursor style", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 12,
        lineHeight: 1.0,
        cursorStyle: "bar",
        cursorBlink: false,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
    expect(inst.term).toBeDefined();
    inst.dispose();
  });

  it("accepts underline cursor style", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 16,
        lineHeight: 1.5,
        cursorStyle: "underline",
        cursorBlink: true,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
    expect(inst.term).toBeDefined();
    inst.dispose();
  });
});

describe("createTerminalInstance — copy-on-select", () => {
  let selectionHandler: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenUrl.mockResolvedValue(undefined);

    const inst = makeInstance();

    // Capture the selection change handler
    selectionHandler = inst.term.onSelectionChange.mock.calls[0][0];
  });

  it("calls onSelectionChange handler without crashing", () => {
    // Default: copyOnSelect is false, hasSelection returns false
    expect(() => selectionHandler()).not.toThrow();
  });
});

describe("createTerminalInstance — IME textarea not found", () => {
  it("logs warning when xterm-helper-textarea is not found", () => {
    // The default mock terminal doesn't create a real .xterm-helper-textarea
    // in the container, so the code path for textarea === null is exercised
    makeInstance();
    expect(mockTerminalLog).toHaveBeenCalledWith(
      expect.stringContaining("xterm-helper-textarea not found"),
    );
  });
});

describe("createTerminalInstance — file link provider callback", () => {
  it("registers file link provider with callback", () => {
    const inst = makeInstance();
    // registerLinkProvider is called with the file link provider
    expect(inst.term.registerLinkProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provideLinks: expect.any(Function) })
    );
    inst.dispose();
  });
});

describe("createTerminalInstance — dispose edge cases", () => {
  it("handles dispose when container already removed from DOM", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });

    // Manually remove container before dispose
    if (inst.container.parentElement) {
      inst.container.parentElement.removeChild(inst.container);
    }

    // Should not throw
    expect(() => inst.dispose()).not.toThrow();
  });

  it("calling dispose twice does not throw", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });

    inst.dispose();
    // Second dispose — container already removed
    expect(() => inst.dispose()).not.toThrow();
  });
});

// ==========================================
// Additional coverage tests
// ==========================================

describe("createTerminalInstance — IME composition with textarea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalFlags.createsTextarea = true;
  });

  afterEach(() => {
    terminalFlags.createsTextarea = false;
  });

  function makeInstanceWithTextarea() {
    const parentEl = document.createElement("div");
    return createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
  }

  it("sets composing=true on compositionstart", () => {
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    expect(inst.composing).toBe(false);

    textarea.dispatchEvent(new Event("compositionstart"));
    expect(inst.composing).toBe(true);

    inst.dispose();
  });

  it("clears grace timer on compositionstart if one is active", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;

    // Trigger compositionend to start grace timer
    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "hello" });
    textarea.dispatchEvent(compEnd);

    // Now trigger compositionstart before grace period ends
    textarea.dispatchEvent(new Event("compositionstart"));
    expect(inst.composing).toBe(true);

    // Advance past grace period — composing should still be true (timer was cleared)
    vi.advanceTimersByTime(100);
    expect(inst.composing).toBe(true);

    inst.dispose();
    vi.useRealTimers();
  });

  it("flushes pending committed text via onCompositionCommit on rapid back-to-back composition", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const commitCb = vi.fn();
    inst.onCompositionCommit = commitCb;

    // First composition: start → end with data
    textarea.dispatchEvent(new Event("compositionstart"));
    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "你好" });
    textarea.dispatchEvent(compEnd);

    // Immediately start another composition before grace period expires
    textarea.dispatchEvent(new Event("compositionstart"));

    // The pending text from the first composition should have been flushed
    expect(commitCb).toHaveBeenCalledWith("你好");

    inst.dispose();
    vi.useRealTimers();
  });

  it("fires onCompositionCommit after grace period with committed text", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const commitCb = vi.fn();
    inst.onCompositionCommit = commitCb;

    // Trigger compositionstart
    textarea.dispatchEvent(new Event("compositionstart"));
    expect(inst.composing).toBe(true);

    // Trigger compositionend with data
    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "claude" });
    textarea.dispatchEvent(compEnd);

    // Still composing during grace period
    expect(inst.composing).toBe(true);

    // Advance past grace period
    vi.advanceTimersByTime(80);
    expect(inst.composing).toBe(false);
    expect(commitCb).toHaveBeenCalledWith("claude");

    inst.dispose();
    vi.useRealTimers();
  });

  it("does not fire onCompositionCommit if committedText is empty", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const commitCb = vi.fn();
    inst.onCompositionCommit = commitCb;

    textarea.dispatchEvent(new Event("compositionstart"));

    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "" });
    textarea.dispatchEvent(compEnd);

    vi.advanceTimersByTime(80);
    expect(commitCb).not.toHaveBeenCalled();

    inst.dispose();
    vi.useRealTimers();
  });

  it("does not fire onCompositionCommit if callback is null", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    // onCompositionCommit stays null

    textarea.dispatchEvent(new Event("compositionstart"));

    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "test" });
    textarea.dispatchEvent(compEnd);

    vi.advanceTimersByTime(80);
    expect(inst.composing).toBe(false);

    inst.dispose();
    vi.useRealTimers();
  });

  it("removes composition listeners on dispose", () => {
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const removeSpy = vi.spyOn(textarea, "removeEventListener");

    inst.dispose();

    expect(removeSpy).toHaveBeenCalledWith("compositionstart", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("compositionend", expect.any(Function));
  });

  it("clears grace timer on dispose", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;

    // Trigger compositionend to start grace timer
    textarea.dispatchEvent(new Event("compositionstart"));
    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "x" });
    textarea.dispatchEvent(compEnd);

    // Dispose before grace period ends
    inst.dispose();

    // Advance timer — should not throw or set composing
    vi.advanceTimersByTime(100);

    vi.useRealTimers();
  });

  it("does not log textarea-not-found when textarea exists", () => {
    makeInstanceWithTextarea();
    expect(mockTerminalLog).not.toHaveBeenCalledWith(
      expect.stringContaining("xterm-helper-textarea not found"),
    );
  });

  it("flushes single CJK bracket immediately without grace period (#525)", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const commitCb = vi.fn();
    inst.onCompositionCommit = commitCb;

    textarea.dispatchEvent(new Event("compositionstart"));

    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "（" });
    textarea.dispatchEvent(compEnd);

    // Should fire immediately — no grace period
    expect(commitCb).toHaveBeenCalledTimes(1);
    expect(commitCb).toHaveBeenCalledWith("（");
    expect(inst.composing).toBe(false);
    expect(inst.inGracePeriod).toBe(false);

    inst.dispose();
    vi.useRealTimers();
  });

  it("sets lastCommittedText on immediate single-char flush (#525)", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const commitCb = vi.fn();
    inst.onCompositionCommit = commitCb;

    textarea.dispatchEvent(new Event("compositionstart"));

    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "】" });
    textarea.dispatchEvent(compEnd);

    expect(inst.lastCommittedText).toBe("】");
    expect(inst.lastCommitTime).toBeGreaterThan(0);

    inst.dispose();
    vi.useRealTimers();
  });

  it("sets lastCommittedText after grace period commit (#525)", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const commitCb = vi.fn();
    inst.onCompositionCommit = commitCb;

    textarea.dispatchEvent(new Event("compositionstart"));

    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "你好" });
    textarea.dispatchEvent(compEnd);

    vi.advanceTimersByTime(80);
    expect(inst.lastCommittedText).toBe("你好");
    expect(inst.lastCommitTime).toBeGreaterThan(0);

    inst.dispose();
    vi.useRealTimers();
  });

  it("uses grace period for multi-char CJK input (not immediate)", () => {
    vi.useFakeTimers();
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const commitCb = vi.fn();
    inst.onCompositionCommit = commitCb;

    textarea.dispatchEvent(new Event("compositionstart"));

    const compEnd = new Event("compositionend") as CompositionEvent;
    Object.defineProperty(compEnd, "data", { value: "你好" });
    textarea.dispatchEvent(compEnd);

    // Not fired immediately for multi-char
    expect(commitCb).not.toHaveBeenCalled();
    expect(inst.composing).toBe(true);

    vi.advanceTimersByTime(80);
    expect(commitCb).toHaveBeenCalledWith("你好");

    inst.dispose();
    vi.useRealTimers();
  });
});

describe("createTerminalInstance — copy-on-select with copyOnSelect enabled", () => {
  let selectionHandler: () => void;
  let termInst: ReturnType<typeof createTerminalInstance>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    terminalFlags.createsTextarea = false;
    mockSettingsGetState.mockReturnValue({
      appearance: { theme: "default" },
      terminal: { copyOnSelect: true },
    });
    mockWriteText.mockResolvedValue(undefined);

    const parentEl = document.createElement("div");
    termInst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });

    selectionHandler = termInst.term.onSelectionChange.mock.calls[0][0];
  });

  afterEach(() => {
    vi.useRealTimers();
    mockSettingsGetState.mockReturnValue({
      appearance: { theme: "default" },
      terminal: { copyOnSelect: false },
    });
  });

  it("copies selection to clipboard when copyOnSelect is enabled", () => {
    vi.mocked(termInst.term.hasSelection).mockReturnValue(true);
    vi.mocked(termInst.term.getSelection).mockReturnValue("selected text\n");

    selectionHandler();
    vi.advanceTimersByTime(150);

    expect(mockWriteText).toHaveBeenCalledWith("selected text");
  });

  it("does not copy whitespace-only selection (trimEnd yields empty)", () => {
    vi.mocked(termInst.term.hasSelection).mockReturnValue(true);
    vi.mocked(termInst.term.getSelection).mockReturnValue("\n\n");

    selectionHandler();
    vi.advanceTimersByTime(150);

    // "\n\n".trimEnd() === "" which is falsy, so writeText is not called
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it("does not copy when hasSelection is false", () => {
    vi.mocked(termInst.term.hasSelection).mockReturnValue(false);

    selectionHandler();
    vi.advanceTimersByTime(150);

    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it("debounces rapid selection changes", () => {
    vi.mocked(termInst.term.hasSelection).mockReturnValue(true);
    vi.mocked(termInst.term.getSelection).mockReturnValue("first");

    selectionHandler();
    vi.advanceTimersByTime(50); // Not yet fired

    // Second selection change resets the timer
    vi.mocked(termInst.term.getSelection).mockReturnValue("second");
    selectionHandler();
    vi.advanceTimersByTime(150);

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    expect(mockWriteText).toHaveBeenCalledWith("second");
  });

  it("logs warning when clipboard write fails", async () => {
    vi.mocked(termInst.term.hasSelection).mockReturnValue(true);
    vi.mocked(termInst.term.getSelection).mockReturnValue("text");
    mockWriteText.mockRejectedValueOnce(new Error("Clipboard denied"));

    selectionHandler();
    vi.advanceTimersByTime(150);

    await vi.waitFor(() => {
      expect(mockClipboardWarn).toHaveBeenCalledWith(
        "Clipboard write failed:",
        "Clipboard denied",
      );
    });
  });

  it("logs non-Error clipboard failure as string", async () => {
    vi.mocked(termInst.term.hasSelection).mockReturnValue(true);
    vi.mocked(termInst.term.getSelection).mockReturnValue("text");
    mockWriteText.mockRejectedValueOnce("string error");

    selectionHandler();
    vi.advanceTimersByTime(150);

    await vi.waitFor(() => {
      expect(mockClipboardWarn).toHaveBeenCalledWith(
        "Clipboard write failed:",
        "string error",
      );
    });
  });

  it("dispose clears pending copy-on-select timer", () => {
    vi.mocked(termInst.term.hasSelection).mockReturnValue(true);
    vi.mocked(termInst.term.getSelection).mockReturnValue("text");

    selectionHandler(); // Starts the debounce timer
    termInst.dispose(); // Should clear it
    vi.advanceTimersByTime(150);

    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it("does not copy when selection is cleared before debounce fires", () => {
    vi.mocked(termInst.term.hasSelection).mockReturnValue(true);
    vi.mocked(termInst.term.getSelection).mockReturnValue("text");

    selectionHandler(); // Starts the debounce timer

    // Selection cleared before timer fires
    vi.mocked(termInst.term.hasSelection).mockReturnValue(false);
    vi.advanceTimersByTime(150);

    expect(mockWriteText).not.toHaveBeenCalled();
  });
});

describe("createTerminalInstance — dark theme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsGetState.mockReturnValue({
      appearance: { theme: "night-owl" },
      terminal: { copyOnSelect: false },
    });
  });

  afterEach(() => {
    mockSettingsGetState.mockReturnValue({
      appearance: { theme: "default" },
      terminal: { copyOnSelect: false },
    });
  });

  it("creates instance with dark theme scrollbar colors", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
    // If it gets here without throwing, dark theme path was exercised
    expect(inst.term).toBeDefined();
    inst.dispose();
  });
});

describe("createTerminalInstance — WebGL failure fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsGetState.mockReturnValue({
      appearance: { theme: "default" },
      terminal: { copyOnSelect: false },
    });
  });

  it("falls back silently when WebGL addon throws on load", () => {
    vi.mock("@xterm/addon-webgl", () => ({
      WebglAddon: class {
        constructor() {
          throw new Error("WebGL not supported");
        }
      },
    }));

    const parentEl = document.createElement("div");
    expect(() =>
      createTerminalInstance({
        parentEl,
        settings: {
          fontSize: 14,
          lineHeight: 1.2,
          cursorStyle: "block",
          cursorBlink: true,
          useWebGL: true,
        },
        ptyRef: { current: null },
        onSearch: vi.fn(),
      })
    ).not.toThrow();
  });
});

describe("createTerminalInstance — file link callback", () => {
  let fileLinkCallback: (filePath: string) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({ size: 1024 }); // Small file
    mockReadTextFile.mockResolvedValue("# Hello");
    mockCreateTab.mockReturnValue("tab-new");

    makeInstance();

    // Capture the file link callback passed to createFileLinkProvider
    fileLinkCallback = mockCreateFileLinkProvider.mock.calls[0][1];
  });

  it("reads file and creates tab on file link click", async () => {
    fileLinkCallback("/path/to/file.md");

    await vi.waitFor(() => {
      expect(mockReadTextFile).toHaveBeenCalledWith("/path/to/file.md");
      expect(mockCreateTab).toHaveBeenCalledWith("main", "/path/to/file.md");
      expect(mockInitDocument).toHaveBeenCalledWith("tab-new", "# Hello", "/path/to/file.md");
    });
  });

  it("logs error when readTextFile fails", async () => {
    mockReadTextFile.mockRejectedValueOnce(new Error("Permission denied"));

    fileLinkCallback("/path/to/secret.md");

    await vi.waitFor(() => {
      expect(mockTerminalLog).toHaveBeenCalledWith(
        "File not readable:",
        "Permission denied",
      );
    });
  });

  it("logs non-Error readTextFile failure as string", async () => {
    mockReadTextFile.mockRejectedValueOnce("unknown fs error");

    fileLinkCallback("/path/to/file.md");

    await vi.waitFor(() => {
      expect(mockTerminalLog).toHaveBeenCalledWith(
        "File not readable:",
        "unknown fs error",
      );
    });
  });

  it("blocks files exceeding size limit", async () => {
    mockStat.mockResolvedValueOnce({ size: 20 * 1024 * 1024 }); // 20 MB

    fileLinkCallback("/path/to/huge.bin");

    await vi.waitFor(() => {
      expect(mockTerminalLog).toHaveBeenCalledWith(
        "File too large to open in editor:",
        "/path/to/huge.bin",
        "(20MB)",
      );
    });
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("proceeds when stat fails (falls through to readTextFile)", async () => {
    mockStat.mockRejectedValueOnce(new Error("stat failed"));

    fileLinkCallback("/path/to/file.md");

    await vi.waitFor(() => {
      expect(mockReadTextFile).toHaveBeenCalledWith("/path/to/file.md");
    });
  });
});

describe("createTerminalInstance — resolveMonoFont fallback", () => {
  it("falls back to default mono font when CSS var is empty", () => {
    // getComputedStyle returns empty for --font-mono in jsdom
    const inst = makeInstance();
    // If it doesn't throw, the fallback path was taken
    expect(inst.term).toBeDefined();
    inst.dispose();
  });
});

describe("createTerminalInstance — web link opener plugin load failure", () => {
  let webLinkHandler: (event: MouseEvent, uri: string) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    makeInstance();
    webLinkHandler = MockWebLinksAddon.mock.calls[0][0];
  });

  it("opens safe URL schemes (https)", async () => {
    mockOpenUrl.mockResolvedValue(undefined);
    webLinkHandler(new MouseEvent("click"), "https://example.com");

    await vi.waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com");
    });
  });

  it("blocks unsafe URL schemes (javascript:)", () => {
    webLinkHandler(new MouseEvent("click"), "javascript:alert(1)");

    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(mockTerminalLog).toHaveBeenCalledWith(
      "Blocked unsafe URL scheme:",
      "javascript:",
      "javascript:alert(1)",
    );
  });

  it("blocks file: URL scheme", () => {
    webLinkHandler(new MouseEvent("click"), "file:///etc/passwd");

    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(mockTerminalLog).toHaveBeenCalledWith(
      "Blocked unsafe URL scheme:",
      "file:",
      "file:///etc/passwd",
    );
  });

  it("skips invalid URLs silently", () => {
    webLinkHandler(new MouseEvent("click"), "not-a-valid-url");

    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(mockTerminalLog).not.toHaveBeenCalledWith(
      expect.stringContaining("Blocked"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("caches opener import across multiple clicks", async () => {
    mockOpenUrl.mockResolvedValue(undefined);

    webLinkHandler(new MouseEvent("click"), "https://first.com");
    webLinkHandler(new MouseEvent("click"), "https://second.com");

    await vi.waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith("https://first.com");
      expect(mockOpenUrl).toHaveBeenCalledWith("https://second.com");
    });
  });
});
