/**
 * createTerminalInstance — WebGL atlas-bounding & context-loss tests (#856)
 *
 * Lives in a separate file because the existing createTerminalInstance.test.ts
 * uses two competing inline `vi.mock("@xterm/addon-webgl")` calls; isolating
 * the new WebGL behavior here gives us a clean, single mock per file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted mocks ---

const {
  webglState,
  mockTerminalLog,
  mockSettingsGetState,
} = vi.hoisted(() => ({
  webglState: {
    instances: [] as Array<{
      onContextLoss: (cb: () => void) => unknown;
      onAddTextureAtlasCanvas: (cb: (canvas: HTMLCanvasElement) => void) => unknown;
      onRemoveTextureAtlasCanvas: (cb: (canvas: HTMLCanvasElement) => void) => unknown;
      clearTextureAtlas: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      contextLossHandlers: Array<() => void>;
      addAtlasHandlers: Array<(canvas: HTMLCanvasElement) => void>;
      removeAtlasHandlers: Array<(canvas: HTMLCanvasElement) => void>;
    }>,
    failConstruction: false,
  },
  mockTerminalLog: vi.fn(),
  mockSettingsGetState: vi.fn(() => ({
    appearance: { theme: "default" },
    terminal: { copyOnSelect: false },
  })),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("@/utils/debug", () => ({
  terminalLog: (...args: unknown[]) => mockTerminalLog(...args),
  clipboardWarn: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    _constructorOptions: Record<string, unknown>;
    constructor(options: Record<string, unknown> = {}) {
      this._constructorOptions = options;
    }
    loadAddon = vi.fn();
    // Public getter mirror of xterm's `get textarea()` (WI-1.1 fail-loud).
    textarea: HTMLTextAreaElement | undefined = undefined;
    open = vi.fn((container: HTMLElement) => {
      // Real xterm always creates the helper textarea in open().
      const ta = document.createElement("textarea");
      ta.className = "xterm-helper-textarea";
      container.appendChild(ta);
      this.textarea = ta;
      // Simulate the WebGL addon appending its render canvases.
      // The real WebGL renderer adds 2 canvases inside the .xterm-screen.
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      const c1 = document.createElement("canvas");
      const c2 = document.createElement("canvas");
      screen.appendChild(c1);
      screen.appendChild(c2);
      container.appendChild(screen);
    });
    dispose = vi.fn();
    onSelectionChange = vi.fn();
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => "");
    write = vi.fn();
    writeln = vi.fn();
    refresh = vi.fn();
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
  WebLinksAddon: class { dispose = vi.fn(); },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    contextLossHandlers: Array<() => void> = [];
    addAtlasHandlers: Array<(c: HTMLCanvasElement) => void> = [];
    removeAtlasHandlers: Array<(c: HTMLCanvasElement) => void> = [];
    clearTextureAtlas = vi.fn();
    dispose = vi.fn();

    constructor() {
      if (webglState.failConstruction) throw new Error("WebGL not supported");
      webglState.instances.push(this as unknown as (typeof webglState.instances)[number]);
    }

    onContextLoss(cb: () => void) {
      this.contextLossHandlers.push(cb);
      return { dispose: () => {} };
    }
    onAddTextureAtlasCanvas(cb: (c: HTMLCanvasElement) => void) {
      this.addAtlasHandlers.push(cb);
      return { dispose: () => {} };
    }
    onRemoveTextureAtlasCanvas(cb: (c: HTMLCanvasElement) => void) {
      this.removeAtlasHandlers.push(cb);
      return { dispose: () => {} };
    }
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => mockSettingsGetState() },
  themes: { default: { background: "#fff", foreground: "#000" } },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ createTab: vi.fn() }) },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ initDocument: vi.fn() }) },
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

vi.mock("./fileLinkProvider", () => ({
  createFileLinkProvider: vi.fn(() => ({ provideLinks: vi.fn() })),
}));

vi.mock("./terminalKeyHandler", () => ({
  createTerminalKeyHandler: vi.fn(() => () => true),
}));

vi.mock("@/theme", () => ({
  buildXtermThemeForId: () => ({ background: "#fff" }),
  drawBoldTextInBrightColorsForId: () => true,
}));

// --- Imports (after mocks) ---

import { createTerminalInstance } from "./createTerminalInstance";

// --- Helpers ---

/** Track every parent we mounted so afterEach can scrub them. */
const mountedParents: HTMLElement[] = [];
/** Track every instance so afterEach can dispose it. setupWebglRenderer keeps a
 *  module-level registry of live renderers (for the atlas-clear broadcast); an
 *  instance left undisposed would leak into the next test's broadcast. */
const mountedInstances: Array<{ dispose: () => void }> = [];

function makeInstance(useWebGL = true) {
  const parentEl = document.createElement("div");
  document.body.appendChild(parentEl);
  mountedParents.push(parentEl);
  const instance = createTerminalInstance({
    parentEl,
    settings: {
      fontSize: 14,
      lineHeight: 1.2,
      cursorStyle: "block",
      cursorBlink: true,
      useWebGL,
      macOptionIsMeta: true,
    },
    ptyRef: { current: null },
    onSearch: vi.fn(),
  });
  mountedInstances.push(instance);
  return instance;
}

afterEach(() => {
  while (mountedInstances.length > 0) {
    const instance = mountedInstances.pop();
    try {
      instance?.dispose();
    } catch {
      // Tests that dispose explicitly leave a second dispose to no-op here.
    }
  }
  while (mountedParents.length > 0) {
    const parent = mountedParents.pop();
    if (parent && parent.parentNode) parent.parentNode.removeChild(parent);
  }
});

function lastWebglAddon() {
  return webglState.instances[webglState.instances.length - 1];
}

// --- Tests ---

describe("createTerminalInstance — never clears the shared atlas on its own", () => {
  beforeEach(() => {
    webglState.instances = [];
    webglState.failConstruction = false;
    vi.clearAllMocks();
  });

  // xterm shares ONE TextureAtlas between terminals whose configs match
  // (module-global CharAtlasCache), but clearTextureAtlas() repairs only the
  // CALLING renderer's model. A renderer that clears the atlas behind its
  // siblings' backs leaves them with texture coordinates into a repacked
  // atlas and a model whose "nothing changed" check never lets them repaint,
  // so they render other glyphs. Nothing may clear the atlas unprompted.
  it("does not subscribe to atlas page add/remove events", () => {
    makeInstance();
    const addon = lastWebglAddon();

    expect(addon.addAtlasHandlers).toHaveLength(0);
    expect(addon.removeAtlasHandlers).toHaveLength(0);
  });

  it("never calls clearTextureAtlas without an explicit resetDisplay", () => {
    makeInstance();
    const addon = lastWebglAddon();
    const canvas = document.createElement("canvas");

    // Even a flood of reported atlas pages must not trigger a clear.
    for (let i = 0; i < 32; i++) {
      addon.addAtlasHandlers.forEach((h) => h(canvas));
    }

    expect(addon.clearTextureAtlas).not.toHaveBeenCalled();
  });
});

describe("createTerminalInstance — resetDisplay broadcasts to sibling terminals", () => {
  beforeEach(() => {
    webglState.instances = [];
    webglState.failConstruction = false;
    vi.clearAllMocks();
  });

  it("clears every other live terminal's model, not just its own", () => {
    const a = makeInstance();
    const b = makeInstance();
    const [addonA, addonB] = webglState.instances;

    a.resetDisplay();

    // A wipes the SHARED atlas plus its own model; B must be told to drop its
    // model too. B's clearTextureAtlas early-returns on the now-empty atlas
    // and only performs the local model clear it needs.
    expect(addonA.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(addonB.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(b.term.refresh).toHaveBeenCalledWith(0, b.term.rows - 1);
  });

  it("notifies itself exactly once", () => {
    const a = makeInstance();
    const addonA = lastWebglAddon();

    a.resetDisplay();

    expect(addonA.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it("does not notify a terminal that has been disposed", () => {
    const a = makeInstance();
    const b = makeInstance();
    const [, addonB] = webglState.instances;

    b.dispose();
    addonB.clearTextureAtlas.mockClear();

    a.resetDisplay();

    expect(addonB.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it("finishes the broadcast even if a sibling throws mid-dispose", () => {
    const a = makeInstance();
    makeInstance();
    makeInstance();
    const [, addonB, addonC] = webglState.instances;
    addonB.clearTextureAtlas.mockImplementationOnce(() => {
      throw new Error("disposed");
    });

    expect(() => a.resetDisplay()).not.toThrow();
    expect(addonC.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it("a WebGL-disabled terminal neither broadcasts to nor is touched by WebGL peers", () => {
    const dom = makeInstance(/* useWebGL */ false);
    const webgl = makeInstance();
    const addon = lastWebglAddon();

    // No atlas is involved, so a DOM-renderer terminal must not clear anyone.
    dom.resetDisplay();
    expect(addon.clearTextureAtlas).not.toHaveBeenCalled();

    // And it must not break a real broadcast either.
    expect(() => webgl.resetDisplay()).not.toThrow();
    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });
});

describe("createTerminalInstance — WebGL context loss handling (#856)", () => {
  beforeEach(() => {
    webglState.instances = [];
    webglState.failConstruction = false;
    vi.clearAllMocks();
  });

  it("disposes the addon when the addon's onContextLoss callback fires", () => {
    makeInstance();
    const addon = lastWebglAddon();

    addon.contextLossHandlers.forEach((h) => h());

    expect(addon.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the addon when a DOM webglcontextlost event fires on a canvas", () => {
    const inst = makeInstance();
    const addon = lastWebglAddon();

    const canvas = inst.container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    canvas!.dispatchEvent(new Event("webglcontextlost"));

    expect(addon.dispose).toHaveBeenCalledTimes(1);
  });

  it("only disposes once even if both addon and DOM events fire", () => {
    const inst = makeInstance();
    const addon = lastWebglAddon();

    addon.contextLossHandlers.forEach((h) => h());
    const canvas = inst.container.querySelector("canvas");
    canvas!.dispatchEvent(new Event("webglcontextlost"));

    expect(addon.dispose).toHaveBeenCalledTimes(1);
  });

  it("logs a debug message on context loss", () => {
    makeInstance();
    lastWebglAddon().contextLossHandlers.forEach((h) => h());

    expect(mockTerminalLog).toHaveBeenCalledWith(
      expect.stringContaining("WebGL context lost"),
    );
  });

  it("survives addon.dispose throwing during context loss handling", () => {
    makeInstance();
    const addon = lastWebglAddon();
    addon.dispose.mockImplementationOnce(() => { throw new Error("already disposed"); });

    expect(() => {
      addon.contextLossHandlers.forEach((h) => h());
    }).not.toThrow();
  });

  it("a sibling's atlas clear degrades to a plain refresh after context loss", () => {
    const lost = makeInstance();
    const other = makeInstance();
    const [addonLost] = webglState.instances;

    addonLost.contextLossHandlers.forEach((h) => h());
    addonLost.clearTextureAtlas.mockClear();
    (lost.term.refresh as unknown as ReturnType<typeof vi.fn>).mockClear();

    // The addon is gone and the DOM renderer has taken over, so the broadcast
    // must reach this terminal as a viewport refresh and nothing more.
    expect(() => other.resetDisplay()).not.toThrow();
    expect(addonLost.clearTextureAtlas).not.toHaveBeenCalled();
    expect(lost.term.refresh).toHaveBeenCalledWith(0, lost.term.rows - 1);
  });

  it("DOM webglcontextlost listeners are removed when the instance disposes", () => {
    const inst = makeInstance();
    const addon = lastWebglAddon();
    const canvas = inst.container.querySelector("canvas") as HTMLCanvasElement;

    inst.dispose();
    addon.dispose.mockClear();

    // After dispose, the listener should be gone — firing the event
    // should not call dispose again.
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(addon.dispose).not.toHaveBeenCalled();
  });

  it("rebinds webglcontextlost listener when xterm replaces a canvas later", async () => {
    const inst = makeInstance();
    const addon = lastWebglAddon();

    // Simulate xterm replacing its render canvas with a new one
    const newCanvas = document.createElement("canvas");
    inst.container.appendChild(newCanvas);

    // MutationObserver delivers asynchronously — wait one microtask
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // The new canvas should now also trigger context-loss handling
    newCanvas.dispatchEvent(new Event("webglcontextlost"));
    expect(addon.dispose).toHaveBeenCalledTimes(1);
  });

  it("rebinds when a canvas is added inside a wrapper element", async () => {
    const inst = makeInstance();
    const addon = lastWebglAddon();

    const wrapper = document.createElement("div");
    const newCanvas = document.createElement("canvas");
    wrapper.appendChild(newCanvas);
    inst.container.appendChild(wrapper);

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    newCanvas.dispatchEvent(new Event("webglcontextlost"));
    expect(addon.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the MutationObserver on instance dispose", async () => {
    const inst = makeInstance();
    const addon = lastWebglAddon();

    inst.dispose();
    addon.dispose.mockClear();

    // After instance dispose, late-added canvases should NOT be bound
    const lateCanvas = document.createElement("canvas");
    inst.container.appendChild(lateCanvas);

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    lateCanvas.dispatchEvent(new Event("webglcontextlost"));
    expect(addon.dispose).not.toHaveBeenCalled();
  });

  it("does nothing on construction failure (no instance recorded)", () => {
    webglState.failConstruction = true;

    expect(() => makeInstance()).not.toThrow();
    expect(webglState.instances).toHaveLength(0);
  });

  it("skips WebGL setup entirely when useWebGL is false", () => {
    makeInstance(/* useWebGL */ false);
    expect(webglState.instances).toHaveLength(0);
  });
});

describe("createTerminalInstance — resetDisplay (#856)", () => {
  beforeEach(() => {
    webglState.instances = [];
    webglState.failConstruction = false;
    vi.clearAllMocks();
  });

  it("calls clearTextureAtlas and refreshes the viewport when WebGL is active", () => {
    const inst = makeInstance();
    const addon = lastWebglAddon();

    inst.resetDisplay();

    expect(addon.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(inst.term.refresh).toHaveBeenCalledWith(0, inst.term.rows - 1);
  });

  it("only refreshes the viewport when WebGL is disabled (DOM renderer path)", () => {
    const inst = makeInstance(/* useWebGL */ false);

    expect(() => inst.resetDisplay()).not.toThrow();
    expect(inst.term.refresh).toHaveBeenCalledWith(0, inst.term.rows - 1);
  });

  it("only refreshes the viewport after WebGL context loss has disposed the addon", () => {
    const inst = makeInstance();
    const addon = lastWebglAddon();

    addon.contextLossHandlers.forEach((h) => h());
    addon.clearTextureAtlas.mockClear();

    inst.resetDisplay();

    // Addon was nulled on context loss — clearTextureAtlas must NOT be called
    expect(addon.clearTextureAtlas).not.toHaveBeenCalled();
    expect(inst.term.refresh).toHaveBeenCalledWith(0, inst.term.rows - 1);
  });

  it("survives term.refresh throwing (term mid-dispose)", () => {
    const inst = makeInstance();
    (inst.term.refresh as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("term disposed");
    });

    expect(() => inst.resetDisplay()).not.toThrow();
  });

  it("clamps refresh range to row 0 when term.rows is 0", () => {
    const inst = makeInstance();
    Object.defineProperty(inst.term, "rows", { value: 0, configurable: true });

    inst.resetDisplay();

    expect(inst.term.refresh).toHaveBeenCalledWith(0, 0);
  });
});
