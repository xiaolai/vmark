import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * scrollFreeze computes its WebKit gate at module load from
 * navigator.userAgent, so each test loads a fresh module instance
 * with a stubbed navigator (vi.resetModules + dynamic import).
 */
const WEBKIT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FREEZE_DURATION_MS = 250;

async function loadPlugins(userAgent: string): Promise<Plugin[]> {
  vi.resetModules();
  vi.stubGlobal("navigator", { userAgent });
  const mod = await import("./scrollFreeze");
  const addPlugins = (
    mod.tableScrollFreezeExtension as unknown as {
      config: { addProseMirrorPlugins: (this: unknown) => Plugin[] };
    }
  ).config.addProseMirrorPlugins;
  return addPlugins.call({});
}

/**
 * Scroll container stand-in. scrollTop lives as a prototype accessor
 * over a backing store, mimicking an element: freeze() shadows it with
 * an instance-level override, and unfreeze()'s `delete` falls back to
 * the prototype accessor (jsdom's real scrollTop is a layoutless no-op,
 * so a real element can't verify restored values).
 */
function createContainer(
  initial: number,
  rect = { top: 0, bottom: 500, left: 0, right: 800 }
) {
  let stored = initial;
  const proto = {};
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get: () => stored,
    set: (v: number) => {
      stored = v;
    },
  });
  const container = Object.create(proto) as HTMLElement;
  Object.defineProperty(container, "getBoundingClientRect", {
    value: () => rect,
  });
  return {
    container,
    getNative: () => stored,
    setNative: (v: number) => {
      stored = v;
    },
  };
}

/** Mock EditorView with a mutable "cursor in table" flag. */
function createView(options: {
  container: HTMLElement | null;
  inTable?: boolean;
  coords?: { top: number; bottom: number; left: number; right: number };
}) {
  let inTable = options.inTable ?? true;
  const coords = options.coords ?? { top: 100, bottom: 120, left: 50, right: 200 };

  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();

  const view = {
    state: {
      selection: {
        head: 10,
        get $head() {
          return {
            depth: 2,
            node: (d: number) => ({
              type: {
                name: d === 0 ? "doc" : d === 1 && inTable ? "table" : "paragraph",
              },
            }),
          };
        },
      },
    },
    dom: {
      closest: vi.fn((selector: string) =>
        selector === ".editor-content" ? options.container : null
      ),
      addEventListener,
      removeEventListener,
    },
    coordsAtPos: vi.fn(() => coords),
    someProp: vi.fn(() => undefined),
  };

  return {
    view: view as unknown as EditorView,
    addEventListener,
    removeEventListener,
    coordsAtPos: view.coordsAtPos,
    setInTable: (value: boolean) => {
      inTable = value;
    },
  };
}

/** Mouse event stand-in whose target resolves closest("table"). */
function tableMousedownEvent(insideTable: boolean): MouseEvent {
  return {
    target: {
      closest: (selector: string) => (selector === "table" && insideTable ? {} : null),
    },
  } as unknown as MouseEvent;
}

function getMousedownHandler(plugin: Plugin) {
  const props = plugin.props as unknown as {
    handleDOMEvents: { mousedown: (view: EditorView, event: MouseEvent) => boolean };
  };
  return props.handleDOMEvents.mousedown;
}

function getPluginView(plugin: Plugin, editorView: EditorView) {
  const viewFn = plugin.spec.view as (view: EditorView) => {
    update: (view: EditorView) => void;
    destroy: () => void;
  };
  return viewFn(editorView);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tableScrollFreezeExtension platform gate", () => {
  it("returns no plugins on non-WebKit engines (Chrome)", async () => {
    const plugins = await loadPlugins(CHROME_UA);
    expect(plugins).toHaveLength(0);
  });

  it("returns one plugin on WebKit (Safari / WKWebView)", async () => {
    const plugins = await loadPlugins(WEBKIT_UA);
    expect(plugins).toHaveLength(1);
  });
});

describe("mousedown freeze", () => {
  it("freezes scrollTop on mousedown inside a table (writes discarded)", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(100);
    const { view } = createView({ container });

    const result = getMousedownHandler(plugin)(view, tableMousedownEvent(true));

    expect(result).toBe(false); // never consumes the event
    container.scrollTop = 999; // WebKit's rogue caret-scroll
    expect(container.scrollTop).toBe(100);
  });

  it("does not freeze on mousedown outside a table", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(100);
    const { view } = createView({ container });

    expect(getMousedownHandler(plugin)(view, tableMousedownEvent(false))).toBe(false);

    container.scrollTop = 42;
    expect(container.scrollTop).toBe(42); // still writable
  });

  it("does not freeze when .editor-content container is missing", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { view } = createView({ container: null });

    expect(getMousedownHandler(plugin)(view, tableMousedownEvent(true))).toBe(false);
  });

  it("keeps the first baseline on repeated mousedowns while frozen", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(100);
    const { view } = createView({ container });
    const mousedown = getMousedownHandler(plugin);

    mousedown(view, tableMousedownEvent(true));
    container.scrollTop = 999; // discarded
    mousedown(view, tableMousedownEvent(true)); // freeze() no-ops while frozen

    expect(container.scrollTop).toBe(100);
  });
});

describe("unfreeze after timeout", () => {
  it("restores baseline and makes scrollTop writable again when cursor stays in table", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container, setNative } = createContainer(100);
    const { view } = createView({ container });

    getMousedownHandler(plugin)(view, tableMousedownEvent(true));
    setNative(777); // simulate native position drift while frozen

    vi.advanceTimersByTime(FREEZE_DURATION_MS);

    expect(container.scrollTop).toBe(100); // restored to baseline
    container.scrollTop = 300;
    expect(container.scrollTop).toBe(300); // writable again
  });

  it("stays frozen until the full freeze window elapses", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(100);
    const { view } = createView({ container });

    getMousedownHandler(plugin)(view, tableMousedownEvent(true));

    vi.advanceTimersByTime(FREEZE_DURATION_MS - 1);
    container.scrollTop = 999;
    expect(container.scrollTop).toBe(100); // still frozen

    vi.advanceTimersByTime(1);
    container.scrollTop = 999;
    expect(container.scrollTop).toBe(999); // unfrozen
  });

  it("applies vertical-only correction when cursor is off-screen after unfreeze", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    // Cursor below viewport: bottom 510 > rect.bottom 500 - default margin 5
    const { container } = createContainer(100);
    const { view } = createView({
      container,
      coords: { top: 480, bottom: 510, left: 50, right: 200 },
    });

    getMousedownHandler(plugin)(view, tableMousedownEvent(true));
    vi.advanceTimersByTime(FREEZE_DURATION_MS);

    // baseline (100) + (510 - (500 - 5)) = 115
    expect(container.scrollTop).toBe(115);
  });

  it("lets the native position stand when the cursor left the table", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container, setNative } = createContainer(100);
    const { view, setInTable, coordsAtPos } = createView({ container });

    getMousedownHandler(plugin)(view, tableMousedownEvent(true));
    setNative(500); // native scroll ended elsewhere
    setInTable(false); // cursor moved out of the table

    vi.advanceTimersByTime(FREEZE_DURATION_MS);

    expect(container.scrollTop).toBe(500); // no jump back to stale baseline
    expect(coordsAtPos).not.toHaveBeenCalled(); // no vertical correction either
  });
});

describe("plugin view lifecycle", () => {
  it("registers a capture-phase mousedown listener on the editor DOM", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(100);
    const { view, addEventListener } = createView({ container, inTable: false });

    getPluginView(plugin, view);

    expect(addEventListener).toHaveBeenCalledWith("mousedown", expect.any(Function), true);
  });

  it("freezes via the capture listener for table targets (resize handles path)", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(100);
    const { view, addEventListener } = createView({ container, inTable: false });

    getPluginView(plugin, view);
    const captureHandler = addEventListener.mock.calls[0][1] as (e: Event) => void;

    captureHandler(tableMousedownEvent(false) as unknown as Event);
    container.scrollTop = 42;
    expect(container.scrollTop).toBe(42); // non-table target: not frozen

    captureHandler(tableMousedownEvent(true) as unknown as Event);
    container.scrollTop = 999;
    expect(container.scrollTop).toBe(42); // frozen at baseline
  });

  it("freezes on PM update when selection lands in a table (keyboard nav)", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(200);
    const { view } = createView({ container, inTable: true });

    const pluginView = getPluginView(plugin, view);
    pluginView.update(view);

    container.scrollTop = 999;
    expect(container.scrollTop).toBe(200);
  });

  it("does not freeze on update when selection is outside tables", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(200);
    const { view } = createView({ container, inTable: false });

    const pluginView = getPluginView(plugin, view);
    pluginView.update(view);

    container.scrollTop = 999;
    expect(container.scrollTop).toBe(999);
  });

  it("does not crash on update when the scroll container is missing", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { view } = createView({ container: null, inTable: true });

    const pluginView = getPluginView(plugin, view);
    expect(() => pluginView.update(view)).not.toThrow();
  });

  it("restarts the freeze timer on repeated updates while still in table", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(100);
    const { view } = createView({ container, inTable: true });

    const pluginView = getPluginView(plugin, view);
    pluginView.update(view); // freeze at t=0, timer fires at 250

    vi.advanceTimersByTime(200);
    pluginView.update(view); // still in table: timer restarted, fires at 450

    vi.advanceTimersByTime(200); // t=400: original timer would have fired
    container.scrollTop = 999;
    expect(container.scrollTop).toBe(100); // still frozen

    vi.advanceTimersByTime(50); // t=450: restarted timer fires
    container.scrollTop = 999;
    expect(container.scrollTop).toBe(999); // unfrozen
  });

  it("destroy removes the capture listener, unfreezes, and cancels the pending timer", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { container } = createContainer(100);
    const { view, addEventListener, removeEventListener } = createView({
      container,
      inTable: true,
    });

    const pluginView = getPluginView(plugin, view);
    pluginView.update(view); // freeze + schedule unfreeze

    pluginView.destroy();

    const captureHandler = addEventListener.mock.calls[0][1];
    expect(removeEventListener).toHaveBeenCalledWith("mousedown", captureHandler, true);

    // Override removed: scrollTop writable immediately
    container.scrollTop = 777;
    expect(container.scrollTop).toBe(777);

    // Pending timer cancelled: no baseline restore fires later
    vi.advanceTimersByTime(FREEZE_DURATION_MS * 2);
    expect(container.scrollTop).toBe(777);
  });

  it("destroy is safe when nothing was ever frozen", async () => {
    const [plugin] = await loadPlugins(WEBKIT_UA);
    const { view } = createView({ container: null, inTable: false });

    const pluginView = getPluginView(plugin, view);
    expect(() => pluginView.destroy()).not.toThrow();
  });
});
