// Audit fix — partial construction must not leak.
//
// createTerminalInstance acquires a DOM container, an xterm instance, an IME
// gate, a WebGL renderer and several handlers, one at a time. Any of those
// steps can throw (a missing helper textarea in dev, an addon rejecting the
// terminal, an xterm call failing). Before this, a throw left the container
// in the DOM and the xterm instance alive — one leak per failed session.
//
// The construction steps run for real — helper-textarea resolution, the IME
// gate, the WebGL renderer. Faults are injected at the xterm boundary: a
// terminal method that throws part-way through setup, and a dispose that
// throws during rollback.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const xterm = vi.hoisted(() => ({
  failAt: null as null | "attachCustomKeyEventHandler" | "onBell",
  failDispose: false,
  dispose: vi.fn(),
  opened: [] as Array<{ container: HTMLElement; textarea: HTMLTextAreaElement }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    element = document.createElement("div");
    textarea: HTMLTextAreaElement | undefined = undefined;
    parser = { registerOscHandler: vi.fn(), registerEscHandler: vi.fn(() => ({ dispose: vi.fn() })), registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })) };
    // Floating-prompt subscriptions (setupFloatingPrompt).
    onScroll = vi.fn(() => ({ dispose: vi.fn() }));
    onWriteParsed = vi.fn(() => ({ dispose: vi.fn() }));
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onCursorMove = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    scrollToBottom = vi.fn();
    unicode = { activeVersion: "11" };
    buffer = { active: { viewportY: 0, length: 0, getLine: () => null }, onBufferChange: vi.fn(() => ({ dispose: vi.fn() })) };
    modes = { bracketedPasteMode: false };
    rows = 24;
    dispose = () => {
      xterm.dispose();
      if (xterm.failDispose) throw new Error("cleanup also failed");
    };
    loadAddon = vi.fn();
    // Real xterm creates its helper textarea inside the container on open().
    open = vi.fn((container: HTMLElement) => {
      const textarea = document.createElement("textarea");
      container.appendChild(textarea);
      this.textarea = textarea;
      xterm.opened.push({ container, textarea });
    });
    refresh = vi.fn();
    onBell = vi.fn(() => {
      if (xterm.failAt === "onBell") throw new Error("the real failure");
    });
    onTitleChange = vi.fn();
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    attachCustomKeyEventHandler = vi.fn(() => {
      if (xterm.failAt === "attachCustomKeyEventHandler") throw new Error("the real failure");
    });
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
vi.mock("./setupWebLinks", () => ({ setupWebLinks: vi.fn() }));
vi.mock("./setupFileLinks", () => ({ setupFileLinks: vi.fn() }));
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

function build(parentEl: HTMLElement, onBell?: () => void) {
  return createTerminalInstance({
    parentEl,
    settings: SETTINGS,
    ptyRef: { current: null },
    onSearch: vi.fn(),
    ...(onBell ? { onBell } : {}),
  });
}

/** Listeners added to and removed from the terminal's container, by identity. */
function trackContainerListeners() {
  const add = vi.spyOn(EventTarget.prototype, "addEventListener");
  const remove = vi.spyOn(EventTarget.prototype, "removeEventListener");
  return {
    /** Event types still listened for on the last-opened container. */
    live(): string[] {
      const container = xterm.opened.at(-1)?.container;
      const added = add.mock.contexts.flatMap((ctx, i) =>
        ctx === container ? [{ type: String(add.mock.calls[i][0]), fn: add.mock.calls[i][1] }] : [],
      );
      const removed = remove.mock.contexts.flatMap((ctx, i) =>
        ctx === container ? [remove.mock.calls[i][1]] : [],
      );
      return added.filter((e) => !removed.includes(e.fn)).map((e) => e.type);
    },
  };
}

describe("createTerminalInstance rollback (audit fix)", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    xterm.failAt = null;
    xterm.failDispose = false;
    xterm.opened.length = 0;
    parent = document.createElement("div");
    document.body.appendChild(parent);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    parent.remove();
  });

  it("leaves the container mounted on success, with the IME gate attached", () => {
    const listeners = trackContainerListeners();
    const instance = build(parent);
    expect(parent.children).toHaveLength(1);
    expect(listeners.live()).toEqual(
      expect.arrayContaining(["compositionstart", "compositionend", "input"]),
    );
    instance.dispose();
    expect(parent.children).toHaveLength(0);
    expect(listeners.live()).toEqual([]);
  });

  it("removes the container when a later setup step throws", () => {
    xterm.failAt = "attachCustomKeyEventHandler";

    expect(() => build(parent)).toThrow("the real failure");
    expect(parent.children).toHaveLength(0);
  });

  it("disposes the terminal when a later setup step throws", () => {
    xterm.failAt = "attachCustomKeyEventHandler";

    expect(() => build(parent)).toThrow();
    expect(xterm.dispose).toHaveBeenCalledTimes(1);
  });

  it("releases an EARLIER resource when a LATER one throws", () => {
    // The IME gate is acquired before the key handler is attached; its
    // container listeners must come off again.
    const listeners = trackContainerListeners();
    xterm.failAt = "attachCustomKeyEventHandler";

    expect(() => build(parent)).toThrow();
    expect(xterm.opened).toHaveLength(1);
    expect(listeners.live()).toEqual([]);
  });

  it("propagates the original error rather than a rollback error", () => {
    xterm.failAt = "onBell";
    xterm.failDispose = true;

    // A throwing release step must not mask what actually went wrong…
    expect(() => build(parent, vi.fn())).toThrow("the real failure");
    // …and must not stop the remaining releases.
    expect(parent.children).toHaveLength(0);
  });

  it("does not leak across repeated failures", () => {
    const listeners = trackContainerListeners();
    xterm.failAt = "attachCustomKeyEventHandler";
    for (let i = 0; i < 5; i++) {
      expect(() => build(parent)).toThrow();
      expect(listeners.live()).toEqual([]);
    }
    expect(parent.children).toHaveLength(0);
    expect(xterm.dispose).toHaveBeenCalledTimes(5);
  });

  it("dispose is idempotent", () => {
    const instance = build(parent);
    instance.dispose();
    expect(() => instance.dispose()).not.toThrow();
    expect(parent.children).toHaveLength(0);
    expect(xterm.dispose).toHaveBeenCalledTimes(1);
  });
});
