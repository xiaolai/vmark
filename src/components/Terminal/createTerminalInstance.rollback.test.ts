// Audit fix — partial construction must not leak.
//
// createTerminalInstance acquires a DOM container, an xterm instance, an IME
// gate, a WebGL renderer and several handlers, one at a time. Any of those
// steps can throw (a missing helper textarea in dev, an addon rejecting the
// terminal, a WebGL context failure). Before this, a throw left the container
// in the DOM and the xterm instance alive — one leak per failed session.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSetupWebgl, mockSetupIme, mockDispose } = vi.hoisted(() => ({
  mockSetupWebgl: vi.fn(),
  mockSetupIme: vi.fn(),
  mockDispose: vi.fn(),
}));

vi.mock("./setupWebglRenderer", () => ({
  setupWebglRenderer: mockSetupWebgl,
  ATLAS_PAGE_LIMIT: 4,
}));
vi.mock("./setupImeCompositionGate", () => ({
  setupImeCompositionGate: mockSetupIme,
  createNoopImeHandle: () => ({
    composing: false,
    onCompositionCommit: null,
    cleanup: vi.fn(),
  }),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    element = document.createElement("div");
    parser = { registerOscHandler: vi.fn() };
    unicode = { activeVersion: "11" };
    buffer = { active: { viewportY: 0, length: 0, getLine: () => null } };
    modes = { bracketedPasteMode: false };
    dispose = mockDispose;
    loadAddon = vi.fn();
    open = vi.fn();
    onBell = vi.fn();
    onTitleChange = vi.fn();
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    attachCustomKeyEventHandler = vi.fn();
    registerMarker = vi.fn(() => null);
    write = vi.fn();
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// The real addons expect a real terminal/DOM; this test is about the rollback
// stack, not about them.
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("./resolveHelperTextarea", () => ({
  resolveHelperTextarea: () => document.createElement("textarea"),
}));
vi.mock("./setupWebLinks", () => ({ setupWebLinks: vi.fn() }));
vi.mock("./setupFileLinks", () => ({ setupFileLinks: vi.fn() }));
vi.mock("./setupOsc", () => ({
  setupOsc7: () => ({ getCwd: () => null }),
  setupOsc133: () => ({
    getCommands: () => [],
    isRunning: () => false,
    setOnIdle: vi.fn(),
  }),
  scrollToAdjacentCommand: vi.fn(),
}));
vi.mock("@/theme", () => ({ buildXtermThemeForId: () => ({}), drawBoldTextInBrightColorsForId: () => true }));

import { createTerminalInstance } from "./createTerminalInstance";

const SETTINGS = {
  fontSize: 13,
  lineHeight: 1.2,
  cursorStyle: "bar" as const,
  cursorBlink: true,
  useWebGL: true,
  macOptionIsMeta: true,
  screenReaderMode: false,
  minimumContrastRatio: 4.5,
  scrollback: 5000,
  osc52Clipboard: true,
  themeId: "paper" as never,
};

function build(parentEl: HTMLElement) {
  return createTerminalInstance({
    parentEl,
    settings: SETTINGS,
    ptyRef: { current: null },
    onSearch: vi.fn(),
  });
}

describe("createTerminalInstance rollback (audit fix)", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    parent = document.createElement("div");
    document.body.appendChild(parent);
    mockSetupIme.mockReturnValue({
      composing: false,
      onCompositionCommit: null,
      cleanup: vi.fn(),
    });
    mockSetupWebgl.mockReturnValue({ cleanup: vi.fn(), resetDisplay: vi.fn() });
  });

  afterEach(() => {
    parent.remove();
  });

  it("leaves the container mounted on success", () => {
    const instance = build(parent);
    expect(parent.children).toHaveLength(1);
    instance.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it("removes the container when a later setup step throws", () => {
    mockSetupWebgl.mockImplementation(() => {
      throw new Error("WebGL context creation failed");
    });

    expect(() => build(parent)).toThrow("WebGL context creation failed");
    expect(parent.children).toHaveLength(0);
  });

  it("disposes the terminal when a later setup step throws", () => {
    mockSetupWebgl.mockImplementation(() => {
      throw new Error("WebGL context creation failed");
    });

    expect(() => build(parent)).toThrow();
    expect(mockDispose).toHaveBeenCalled();
  });

  it("releases an EARLIER resource when a LATER one throws", () => {
    // The IME gate is acquired before the WebGL renderer; its cleanup must run.
    const imeCleanup = vi.fn();
    mockSetupIme.mockReturnValue({
      composing: false,
      onCompositionCommit: null,
      cleanup: imeCleanup,
    });
    mockSetupWebgl.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => build(parent)).toThrow();
    expect(imeCleanup).toHaveBeenCalled();
  });

  it("propagates the original error rather than a rollback error", () => {
    mockSetupIme.mockReturnValue({
      composing: false,
      onCompositionCommit: null,
      cleanup: () => {
        throw new Error("cleanup also failed");
      },
    });
    mockSetupWebgl.mockImplementation(() => {
      throw new Error("the real failure");
    });

    // A throwing release step must not mask what actually went wrong…
    expect(() => build(parent)).toThrow("the real failure");
    // …and must not stop the remaining releases.
    expect(parent.children).toHaveLength(0);
  });

  it("does not leak across repeated failures", () => {
    mockSetupWebgl.mockImplementation(() => {
      throw new Error("boom");
    });
    for (let i = 0; i < 5; i++) {
      expect(() => build(parent)).toThrow();
    }
    expect(parent.children).toHaveLength(0);
  });

  it("dispose is idempotent", () => {
    const instance = build(parent);
    instance.dispose();
    expect(() => instance.dispose()).not.toThrow();
    expect(parent.children).toHaveLength(0);
  });
});
