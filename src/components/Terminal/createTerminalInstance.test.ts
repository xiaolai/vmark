import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks (available before vi.mock factories execute) ---

const { mockOpenUrl, mockTerminalLog, MockWebLinksAddon } = vi.hoisted(() => ({
  mockOpenUrl: vi.fn<(url: string) => Promise<void>>(),
  mockTerminalLog: vi.fn(),
  MockWebLinksAddon: vi.fn(),
}));

// --- Module mocks ---

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...(args as [string])),
}));

vi.mock("@/utils/debug", () => ({
  terminalLog: (...args: unknown[]) => mockTerminalLog(...args),
  clipboardWarn: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    loadAddon = vi.fn();
    open = vi.fn();
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
    getState: () => ({
      appearance: { theme: "default" },
      terminal: { copyOnSelect: false },
    }),
  },
  themes: {
    default: { background: "#ffffff", foreground: "#1a1a1a" },
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ createTab: vi.fn() }) },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ initDocument: vi.fn() }) },
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

vi.mock("./fileLinkProvider", () => ({
  createFileLinkProvider: vi.fn(() => ({ provideLinks: vi.fn() })),
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
