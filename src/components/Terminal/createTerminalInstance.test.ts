import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted mocks (available before vi.mock factories execute) ---

const { mockOpenUrl, mockTerminalLog, MockWebLinksAddon, mockWriteText, mockClipboardWarn, mockReadTextFile, mockStat, mockCreateTab, mockInitDocument, mockSettingsGetState, terminalFlags, webglFlags } = vi.hoisted(() => ({
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
  // Default true — a real xterm always creates the helper textarea in open().
  // The `false` case is used only by the deliberate fail-loud test.
  terminalFlags: { createsTextarea: true },
  // WebGL addon behaviour, chosen per test. Two `vi.mock("@xterm/addon-webgl")`
  // calls used to sit INSIDE separate `it()` blocks; Vitest hoists them both to
  // module scope, so only one factory could ever win and the other test was not
  // exercising the path its name claimed. One top-level mock reading a mutable
  // flag makes each test's intent explicit and real.
  webglFlags: { throwOnConstruct: false, constructCount: 0 },
}));

// --- Module mocks ---

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      webglFlags.constructCount += 1;
      if (webglFlags.throwOnConstruct) throw new Error("WebGL not supported");
    }
    onContextLoss = vi.fn((cb: () => void) => cb);
    onAddTextureAtlasCanvas = vi.fn();
    onRemoveTextureAtlasCanvas = vi.fn();
    clearTextureAtlas = vi.fn();
    dispose = vi.fn();
  },
}));

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
    // Public getter mirror of xterm's `get textarea()`. Real xterm always
    // creates it during open(); `createsTextarea:false` models the fail-loud case.
    textarea: HTMLTextAreaElement | undefined = undefined;
    open = vi.fn((container: HTMLElement) => {
      if (terminalFlags.createsTextarea) {
        const textarea = document.createElement("textarea");
        textarea.className = "xterm-helper-textarea";
        container.appendChild(textarea);
        this.textarea = textarea;
      }
    });
    dispose = vi.fn();
    onSelectionChange = vi.fn();
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => "");
    write = vi.fn();
    writeln = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    registerLinkProvider = vi.fn();
    parser = { registerOscHandler: vi.fn() };
    registerMarker = vi.fn(() => ({ line: 0, onDispose: vi.fn(), dispose: vi.fn() }));
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
  useDocumentStore: { getState: () => ({ ingestExternalContent: mockInitDocument }) },
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
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
      macOptionIsMeta: true,
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

  it("exposes term, fitAddon, searchAddon, getCwd", () => {
    const inst = makeInstance();
    expect(inst.term).toBeDefined();
    expect(inst.fitAddon).toBeDefined();
    expect(inst.searchAddon).toBeDefined();
    expect(inst.getCwd).toBeTypeOf("function");
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
        macOptionIsMeta: true,
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
        macOptionIsMeta: true,
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
});

// Mutable module-scope test state shared by every WebGL describe.
// vi.clearAllMocks() does NOT reset it, so without a TOP-LEVEL reset the
// failure test leaves throwOnConstruct=true and constructCount accumulating,
// making later WebGL tests order-dependent — the same "test that lies" class
// this mock consolidation set out to fix.
beforeEach(() => {
  webglFlags.throwOnConstruct = false;
  webglFlags.constructCount = 0;
});

describe("createTerminalInstance with WebGL", () => {
  it("does not throw when WebGL is enabled", () => {

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
          macOptionIsMeta: true,
        },
        ptyRef: { current: null },
        onSearch: vi.fn(),
      })
    ).not.toThrow();
  });
});

describe("createTerminalInstance — minimumContrastRatio", () => {
  it("enables WCAG AA contrast auto-correction (bgCyan+black on light themes)", () => {
    const inst = makeInstance();
    expect((inst.term as any)._constructorOptions.minimumContrastRatio).toBe(4.5);
    inst.dispose();
  });
});

describe("createTerminalInstance — macOptionIsMeta (#660)", () => {
  it("passes macOptionIsMeta: true from settings by default", () => {
    const inst = makeInstance();
    expect((inst.term as any)._constructorOptions.macOptionIsMeta).toBe(true);
    inst.dispose();
  });

  it("passes macOptionIsMeta: false when setting is disabled", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
        macOptionIsMeta: false,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
    expect((inst.term as any)._constructorOptions.macOptionIsMeta).toBe(false);
    inst.dispose();
  });
});

describe("createTerminalInstance — screenReaderMode (G3/WI-3.1)", () => {
  it("passes screenReaderMode from settings to the xterm constructor", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
        macOptionIsMeta: true,
        screenReaderMode: true,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
    expect((inst.term as any)._constructorOptions.screenReaderMode).toBe(true);
    inst.dispose();
  });
});

describe("createTerminalInstance — scrollback (G7/WI-4.2)", () => {
  it("passes scrollback from settings to the xterm constructor", () => {
    const parentEl = document.createElement("div");
    const inst = createTerminalInstance({
      parentEl,
      settings: {
        fontSize: 14,
        lineHeight: 1.2,
        cursorStyle: "block",
        cursorBlink: true,
        useWebGL: false,
        macOptionIsMeta: true,
        scrollback: 10000,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
    expect((inst.term as any)._constructorOptions.scrollback).toBe(10000);
    inst.dispose();
  });

  it("clamps an out-of-range scrollback (corrupt persisted state, audit-fix)", () => {
    const mk = (scrollback: number) => {
      const inst = createTerminalInstance({
        parentEl: document.createElement("div"),
        settings: {
          fontSize: 14,
          lineHeight: 1.2,
          cursorStyle: "block",
          cursorBlink: true,
          useWebGL: false,
          macOptionIsMeta: true,
          screenReaderMode: false,
          scrollback,
        },
        ptyRef: { current: null },
        onSearch: vi.fn(),
      });
      const v = (inst.term as unknown as { _constructorOptions: { scrollback: number } })
        ._constructorOptions.scrollback;
      inst.dispose();
      return v;
    };
    expect(mk(5_000_000)).toBe(200_000); // extreme → capped
    expect(mk(0)).toBe(100); // too small → floored
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
        macOptionIsMeta: true,
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
        macOptionIsMeta: true,
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
  // WI-1.1 replaced the old silent `terminalLog` no-op with a fail-loud throw
  // (dev) / persistent error (prod). The deliberate-absent throw is asserted in
  // the "fail-loud on missing helper textarea" suite below; here we just lock in
  // that the old silent-log path is gone.
  afterEach(() => {
    terminalFlags.createsTextarea = true;
  });

  it("does not silently log the old 'not found' message", () => {
    terminalFlags.createsTextarea = false;
    expect(() => makeInstance()).toThrow(/textarea/i);
    expect(mockTerminalLog).not.toHaveBeenCalledWith(
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
        macOptionIsMeta: true,
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
        macOptionIsMeta: true,
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

describe("createTerminalInstance — IME wiring (Channel Ownership)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalFlags.createsTextarea = true;
  });
  afterEach(() => {
    terminalFlags.createsTextarea = true;
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
        macOptionIsMeta: true,
      },
      ptyRef: { current: null },
      onSearch: vi.fn(),
    });
  }

  // Detailed IME commit behavior lives in setupImeCompositionGate.test.ts (jsdom)
  // and setupImeCompositionGate.webkit.test.ts (real WebKit). Here we only verify
  // createTerminalInstance WIRES the gate handle correctly.

  it("tracks composition via the container listener (gate)", () => {
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    expect(inst.composing).toBe(false);

    // Gate listens on the CONTAINER (capture) — a bubbling compositionstart reaches it.
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(inst.composing).toBe(true);

    // compositionend commits synchronously (no grace) and clears composing.
    textarea.value = "你好";
    textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "你好", bubbles: true }));
    expect(inst.composing).toBe(false);
    inst.dispose();
  });

  it("delivers the committed text via onCompositionCommit", () => {
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    const commitCb = vi.fn();
    inst.onCompositionCommit = commitCb;

    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    textarea.value = "你好";
    textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "你好", bubbles: true }));

    expect(commitCb).toHaveBeenCalledExactlyOnceWith("你好");
    inst.dispose();
  });

  it("stops tracking composition after dispose", () => {
    const inst = makeInstanceWithTextarea();
    const textarea = inst.container.querySelector(".xterm-helper-textarea")!;
    inst.dispose();
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(inst.composing).toBe(false);
  });
});

// WI-1.1 — fail loud when the public term.textarea getter resolves to nothing,
// instead of the old silent no-op that disabled the entire IME layer.
describe("createTerminalInstance — fail-loud on missing helper textarea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalFlags.createsTextarea = false; // open() creates no textarea
    mockSettingsGetState.mockReturnValue({
      appearance: { theme: "default" },
      terminal: {},
    });
  });
  afterEach(() => {
    terminalFlags.createsTextarea = true;
  });

  it("throws in dev when term.textarea is absent after open()", () => {
    const parentEl = document.createElement("div");
    expect(() =>
      createTerminalInstance({
        parentEl,
        settings: {
          fontSize: 14,
          lineHeight: 1.2,
          cursorStyle: "block",
          cursorBlink: true,
          useWebGL: false,
          macOptionIsMeta: true,
        },
        ptyRef: { current: null },
        onSearch: vi.fn(),
      }),
    ).toThrow(/textarea/i);
  });
});

describe("createTerminalInstance — copy-on-select with copyOnSelect enabled", () => {
  let selectionHandler: () => void;
  let termInst: ReturnType<typeof createTerminalInstance>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    terminalFlags.createsTextarea = true;
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
        macOptionIsMeta: true,
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
        macOptionIsMeta: true,
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
    webglFlags.throwOnConstruct = true;

    const parentEl = document.createElement("div");
    // "does not throw" alone would also pass if the addon were never
    // constructed at all, so assert below that the throwing path really ran.
    expect(() =>
      createTerminalInstance({
        parentEl,
        settings: {
          fontSize: 14,
          lineHeight: 1.2,
          cursorStyle: "block",
          cursorBlink: true,
          useWebGL: true,
          macOptionIsMeta: true,
        },
        ptyRef: { current: null },
        onSearch: vi.fn(),
      })
    ).not.toThrow();
    // Proves the fallback was exercised, not skipped: the addon really was
    // constructed and really did throw.
    expect(webglFlags.constructCount).toBe(1);
  });
});

describe("createTerminalInstance — file link callback", () => {
  let fileLinkCallback: (filePath: string) => void;
  let termInst: ReturnType<typeof makeInstance>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({ size: 1024 }); // Small file
    mockReadTextFile.mockResolvedValue("# Hello");
    mockCreateTab.mockReturnValue("tab-new");

    termInst = makeInstance();

    // Capture the file link callback passed to createFileLinkProvider
    fileLinkCallback = mockCreateFileLinkProvider.mock.calls[0][1];
  });

  it("reads file and creates tab on file link click", async () => {
    fileLinkCallback("/path/to/file.md");

    await vi.waitFor(() => {
      expect(mockReadTextFile).toHaveBeenCalledWith("/path/to/file.md");
      expect(mockCreateTab).toHaveBeenCalledWith("main", "/path/to/file.md");
      expect(mockInitDocument).toHaveBeenCalledWith("tab-new", "# Hello", "disk-open", { filePath: "/path/to/file.md" });
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
    expect(termInst.term.writeln).toHaveBeenCalledWith(
      "\x1b[33m[File too large: 20MB, max 10MB]\x1b[0m",
    );
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("fails closed when stat rejects (no readTextFile, surfaces warning)", async () => {
    mockStat.mockRejectedValueOnce(new Error("stat failed"));

    fileLinkCallback("/path/to/file.md");

    await vi.waitFor(() => {
      expect(mockTerminalLog).toHaveBeenCalledWith(
        "stat failed for file link:",
        "/path/to/file.md",
        "stat failed",
      );
    });
    expect(termInst.term.writeln).toHaveBeenCalledWith(
      "\x1b[33m[Cannot open file: stat failed]\x1b[0m",
    );
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("stringifies non-Error stat rejection", async () => {
    mockStat.mockRejectedValueOnce("unknown stat error");

    fileLinkCallback("/path/to/file.md");

    await vi.waitFor(() => {
      expect(mockTerminalLog).toHaveBeenCalledWith(
        "stat failed for file link:",
        "/path/to/file.md",
        "unknown stat error",
      );
    });
    expect(mockReadTextFile).not.toHaveBeenCalled();
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
      // Opened as the parsed/normalized href (bare domain gains a trailing /).
      expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/");
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

  it("opens OSC 8 hyperlinks via the allowlisted linkHandler (WI-4.2, audit-fix)", async () => {
    mockOpenUrl.mockResolvedValue(undefined);
    const inst = makeInstance();
    const linkHandler = (inst.term.options as {
      linkHandler?: { activate: (e: MouseEvent, uri: string) => void };
    }).linkHandler;
    expect(linkHandler).toBeDefined();
    linkHandler!.activate(new MouseEvent("click"), "https://osc8.example.com");
    await vi.waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith("https://osc8.example.com/");
    });
  });

  it("blocks unsafe OSC 8 schemes via the linkHandler (WI-4.2, audit-fix)", () => {
    const inst = makeInstance();
    const linkHandler = (inst.term.options as {
      linkHandler?: { activate: (e: MouseEvent, uri: string) => void };
    }).linkHandler;
    linkHandler!.activate(new MouseEvent("click"), "javascript:alert(1)");
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("caches opener import across multiple clicks", async () => {
    mockOpenUrl.mockResolvedValue(undefined);

    webLinkHandler(new MouseEvent("click"), "https://first.com");
    webLinkHandler(new MouseEvent("click"), "https://second.com");

    await vi.waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith("https://first.com/");
      expect(mockOpenUrl).toHaveBeenCalledWith("https://second.com/");
    });
  });
});
