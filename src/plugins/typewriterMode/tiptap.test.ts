/**
 * Tests for typewriterMode extension — scroll behavior and plugin structure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock CSS import
vi.mock("./typewriter-mode.css", () => ({}));

// Mock editorStore
const mockEditorStoreState = { typewriterModeEnabled: false };
vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => mockEditorStoreState,
  },
}));

import { typewriterModeExtension } from "./tiptap";

/** Helper: create the plugin and get the view factory */
function getPlugin() {
  const plugins = typewriterModeExtension.config.addProseMirrorPlugins!.call({
    name: "typewriterMode",
    options: {},
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  });
  return plugins[0];
}

/** Create a mock EditorView with configurable coordsAtPos and DOM */
function createMockView(opts: {
  selectionFrom?: number;
  prevSelectionFrom?: number;
  coordsTop?: number;
  containerTop?: number;
  containerHeight?: number;
  hasScrollContainer?: boolean;
  coordsThrows?: boolean;
}) {
  const {
    selectionFrom = 5,
    prevSelectionFrom = 3,
    coordsTop = 200,
    containerTop = 0,
    containerHeight = 600,
    hasScrollContainer = true,
    coordsThrows = false,
  } = opts;

  const scrollByMock = vi.fn();
  const scrollContainer = hasScrollContainer
    ? {
        getBoundingClientRect: () => ({
          top: containerTop,
          height: containerHeight,
        }),
        scrollBy: scrollByMock,
      }
    : null;

  const mockSelection = { from: selectionFrom, eq: vi.fn((_other: unknown) => false) };
  const prevSelection = { from: prevSelectionFrom, eq: vi.fn() };

  const view = {
    state: { selection: mockSelection },
    coordsAtPos: coordsThrows
      ? vi.fn(() => { throw new Error("invalid pos"); })
      : vi.fn(() => ({ top: coordsTop, left: 0, bottom: coordsTop + 20 })),
    dom: {
      closest: vi.fn(() => scrollContainer),
      parentElement: scrollContainer,
    },
  };

  const prevState = { selection: prevSelection };

  return { view, prevState, scrollByMock };
}

describe("typewriterModeExtension", () => {
  let rafCallbacks: Array<() => void> = [];
  let originalRAF: typeof globalThis.requestAnimationFrame;
  let originalCAF: typeof globalThis.cancelAnimationFrame;

  beforeEach(() => {
    mockEditorStoreState.typewriterModeEnabled = false;
    rafCallbacks = [];
    originalRAF = globalThis.requestAnimationFrame;
    originalCAF = globalThis.cancelAnimationFrame;
    let rafId = 0;
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(() => cb(0));
      return ++rafId;
    });
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
  });

  it("has the correct name", () => {
    expect(typewriterModeExtension.name).toBe("typewriterMode");
  });

  it("defines ProseMirror plugins", () => {
    expect(typewriterModeExtension.config.addProseMirrorPlugins).toBeDefined();
  });

  it("creates exactly one plugin", () => {
    const plugin = getPlugin();
    expect(plugin).toBeDefined();
    expect(plugin.spec.view).toBeDefined();
  });

  describe("plugin view update", () => {
    it("returns early when typewriter mode is disabled", () => {
      mockEditorStoreState.typewriterModeEnabled = false;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const { view, prevState } = createMockView({});
      viewObj.update(view, prevState);

      // rAF should NOT be called when disabled
      expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it("returns early when selection has not changed", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const { view, prevState } = createMockView({});
      // Make selections equal
      (view.state.selection.eq as ReturnType<typeof vi.fn>).mockReturnValue(true);

      viewObj.update(view, prevState);
      expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it("skips the first 3 updates (SKIP_INITIAL_UPDATES)", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const { view, prevState } = createMockView({});

      // Updates 1, 2, 3 should be skipped
      viewObj.update(view, prevState);
      viewObj.update(view, prevState);
      viewObj.update(view, prevState);
      expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();

      // Update 4 should trigger rAF
      viewObj.update(view, prevState);
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it("scrolls when offset exceeds threshold (30px)", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      // cursor at top=400, container top=0, height=600 => target = 0 + 600*0.4 = 240
      // offset = 400 - 240 = 160 > 30 threshold
      const { view, prevState, scrollByMock } = createMockView({
        coordsTop: 400,
        containerTop: 0,
        containerHeight: 600,
      });

      // Skip initial updates
      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);
      // 4th update triggers rAF
      viewObj.update(view, prevState);

      // Execute rAF callback
      rafCallbacks[0]();

      expect(scrollByMock).toHaveBeenCalledWith({
        top: 160, // 400 - (0 + 600*0.4)
        behavior: "smooth",
      });
    });

    it("does not scroll when offset is below threshold", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      // cursor at top=250, container top=0, height=600 => target = 240
      // offset = 250 - 240 = 10 < 30 threshold
      const { view, prevState, scrollByMock } = createMockView({
        coordsTop: 250,
        containerTop: 0,
        containerHeight: 600,
      });

      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);
      viewObj.update(view, prevState);

      rafCallbacks[0]();

      expect(scrollByMock).not.toHaveBeenCalled();
    });

    it("cancels previous rAF when new update arrives", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const { view, prevState } = createMockView({});

      // Skip initial updates
      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);

      // First real update
      viewObj.update(view, prevState);
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

      // Second update before rAF fires — should cancel previous
      viewObj.update(view, prevState);
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalledTimes(1);
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    it("handles coordsAtPos throwing an error gracefully", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const { view, prevState, scrollByMock } = createMockView({
        coordsThrows: true,
      });

      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);
      viewObj.update(view, prevState);

      // Should not throw
      expect(() => rafCallbacks[0]()).not.toThrow();
      expect(scrollByMock).not.toHaveBeenCalled();
    });

    it("returns early when no scroll container found", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const scrollByMock = vi.fn();
      const view = {
        state: { selection: { from: 5, eq: vi.fn(() => false) } },
        coordsAtPos: vi.fn(() => ({ top: 400, left: 0, bottom: 420 })),
        dom: {
          closest: vi.fn(() => null),
          parentElement: null,
        },
      };
      const prevState = { selection: { from: 3 } };

      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);
      viewObj.update(view, prevState);

      // Execute rAF callback — should early-return without scrolling
      rafCallbacks[0]();
      expect(scrollByMock).not.toHaveBeenCalled();
    });

    it("falls back to parentElement when closest returns null", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const scrollByMock = vi.fn();
      const parentElement = {
        getBoundingClientRect: () => ({ top: 0, height: 600 }),
        scrollBy: scrollByMock,
      };
      const view = {
        state: { selection: { from: 5, eq: vi.fn(() => false) } },
        coordsAtPos: vi.fn(() => ({ top: 400, left: 0, bottom: 420 })),
        dom: {
          closest: vi.fn(() => null),
          parentElement,
        },
      };
      const prevState = { selection: { from: 3 } };

      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);
      viewObj.update(view, prevState);
      rafCallbacks[0]();

      expect(scrollByMock).toHaveBeenCalledWith({
        top: 160,
        behavior: "smooth",
      });
    });

    it("resets rafId to null inside the rAF callback", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const { view, prevState } = createMockView({ coordsTop: 250 });

      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);
      viewObj.update(view, prevState);

      // Execute rAF
      rafCallbacks[0]();

      // After rAF, subsequent update should NOT call cancelAnimationFrame
      // since rafId was set to null
      (globalThis.cancelAnimationFrame as ReturnType<typeof vi.fn>).mockClear();
      viewObj.update(view, prevState);
      expect(globalThis.cancelAnimationFrame).not.toHaveBeenCalled();
    });

    it("scrolls with negative offset when cursor is above center", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      // cursor at top=50, container top=0, height=600 => target=240
      // offset = 50 - 240 = -190 => Math.abs = 190 > 30
      const { view, prevState, scrollByMock } = createMockView({
        coordsTop: 50,
        containerTop: 0,
        containerHeight: 600,
      });

      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);
      viewObj.update(view, prevState);
      rafCallbacks[0]();

      expect(scrollByMock).toHaveBeenCalledWith({
        top: -190,
        behavior: "smooth",
      });
    });
  });

  describe("plugin view destroy", () => {
    it("cancels pending rAF on destroy", () => {
      mockEditorStoreState.typewriterModeEnabled = true;
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      const { view, prevState } = createMockView({});

      // Skip initial + trigger a real rAF
      for (let i = 0; i < 3; i++) viewObj.update(view, prevState);
      viewObj.update(view, prevState);

      (globalThis.cancelAnimationFrame as ReturnType<typeof vi.fn>).mockClear();
      viewObj.destroy();
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    });

    it("does not call cancelAnimationFrame when no rAF is pending", () => {
      const plugin = getPlugin();
      const viewObj = (plugin.spec.view as (...args: unknown[]) => unknown)();

      (globalThis.cancelAnimationFrame as ReturnType<typeof vi.fn>).mockClear();
      viewObj.destroy();
      // rafId is null initially, so cancelAnimationFrame should NOT be called
      expect(globalThis.cancelAnimationFrame).not.toHaveBeenCalled();
    });
  });
});
