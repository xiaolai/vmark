// @vitest-environment node
/**
 * Tests for autoPair tiptap extension — extension creation, plugin structure,
 * config reading, IME composition guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock settingsStore before importing the extension
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      markdown: {
        autoPairEnabled: true,
        autoPairCJKStyle: "off",
        autoPairCurlyQuotes: false,
        autoPairRightDoubleQuote: false,
      },
    })),
  },
}));

// Mock imeGuard
const mockIsProseMirrorComposing = vi.fn(() => false);
const mockIsProseMirrorInCompositionGrace = vi.fn(() => false);
const mockMarkProseMirrorCompositionEnd = vi.fn();
const mockIsImeKeyEvent = vi.fn(() => false);

vi.mock("@/utils/imeGuard", () => ({
  isProseMirrorComposing: (...args: unknown[]) => mockIsProseMirrorComposing(...args),
  isProseMirrorInCompositionGrace: (...args: unknown[]) => mockIsProseMirrorInCompositionGrace(...args),
  markProseMirrorCompositionEnd: (...args: unknown[]) => mockMarkProseMirrorCompositionEnd(...args),
  isImeKeyEvent: (...args: unknown[]) => mockIsImeKeyEvent(...args),
}));

// Mock handlers
const mockHandleTextInput = vi.fn(() => false);
const mockCreateKeyHandler = vi.fn(() => vi.fn(() => false));

vi.mock("../handlers", () => ({
  handleTextInput: (...args: unknown[]) => mockHandleTextInput(...args),
}));

vi.mock("../keyHandler", () => ({
  createKeyHandler: (...args: unknown[]) => mockCreateKeyHandler(...args),
}));

import { autoPairExtension } from "../tiptap";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Extension metadata
// ---------------------------------------------------------------------------

describe("autoPairExtension metadata", () => {
  it("has correct name", () => {
    expect(autoPairExtension.name).toBe("autoPair");
  });

  it("is an Extension (not a Node or Mark)", () => {
    expect(autoPairExtension.type).toBe("extension");
  });
});

// ---------------------------------------------------------------------------
// Plugin creation
// ---------------------------------------------------------------------------

describe("autoPairExtension addProseMirrorPlugins", () => {
  it("returns exactly one plugin", () => {
    const plugins = autoPairExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "autoPair",
      options: { getConfig: () => ({ enabled: true, includeCJK: false, includeCurlyQuotes: false, normalizeRightDoubleQuote: false }) },
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    expect(plugins).toHaveLength(1);
  });

  it("creates key handler with config getter on plugin creation", () => {
    autoPairExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "autoPair",
      options: { getConfig: () => ({ enabled: true, includeCJK: false, includeCurlyQuotes: false, normalizeRightDoubleQuote: false }) },
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    expect(mockCreateKeyHandler).toHaveBeenCalledTimes(1);
    expect(typeof mockCreateKeyHandler.mock.calls[0][0]).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Config reading from settings store
// ---------------------------------------------------------------------------

describe("autoPair config is INJECTED, not read from a store", () => {
  // These used to write the settings store and assert the plugin noticed —
  // they were testing the coupling that stopped it shipping standalone
  // (ADR-015). The host supplies `getConfig` now, so what matters here is that
  // the plugin ASKS, asks the injected getter, and asks it again per keystroke.
  const CONFIG = {
    enabled: true,
    includeCJK: false,
    includeCurlyQuotes: false,
    normalizeRightDoubleQuote: false,
  };

  function build(getConfig: () => unknown) {
    autoPairExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "autoPair",
      options: { getConfig },
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return mockCreateKeyHandler.mock.calls[0][0] as () => unknown;
  }

  it("passes the INJECTED getter through to the key handler", () => {
    expect(build(() => CONFIG)()).toEqual(CONFIG);
  });

  it("re-asks — a value captured at construction would freeze the answer", () => {
    let enabled = false;
    const getter = build(() => ({ ...CONFIG, enabled }));
    expect((getter() as { enabled: boolean }).enabled).toBe(false);
    enabled = true;
    expect((getter() as { enabled: boolean }).enabled).toBe(true);
  });

  it("falls back to a working default when the host supplies nothing", () => {
    // A standalone consumer with no settings layer must get a live plugin,
    // not a dead one.
    autoPairExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "autoPair",
      options: autoPairExtension.config.addOptions!.call({} as never),
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const getter = mockCreateKeyHandler.mock.calls[0][0] as () => { enabled: boolean };
    expect(getter().enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plugin props — IME guard behavior
// ---------------------------------------------------------------------------

describe("autoPair IME composition guard", () => {
  function getPluginProps() {
    const plugins = autoPairExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "autoPair",
      options: { getConfig: () => ({ enabled: true, includeCJK: false, includeCurlyQuotes: false, normalizeRightDoubleQuote: false }) },
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return (plugins[0] as { props: Record<string, unknown> }).props;
  }

  it("handleTextInput blocks during IME composing", () => {
    mockIsProseMirrorComposing.mockReturnValue(true);
    const props = getPluginProps();
    const handleTextInput = props.handleTextInput as (view: unknown, from: number, to: number, text: string) => boolean;
    const result = handleTextInput({}, 0, 0, "a");
    expect(result).toBe(false);
    expect(mockHandleTextInput).not.toHaveBeenCalled();
  });

  it("handleTextInput blocks during composition grace period", () => {
    mockIsProseMirrorComposing.mockReturnValue(false);
    mockIsProseMirrorInCompositionGrace.mockReturnValue(true);
    const props = getPluginProps();
    const handleTextInput = props.handleTextInput as (view: unknown, from: number, to: number, text: string) => boolean;
    const result = handleTextInput({}, 0, 0, "a");
    expect(result).toBe(false);
    expect(mockHandleTextInput).not.toHaveBeenCalled();
  });

  it("handleTextInput delegates to handler when not composing", () => {
    mockIsProseMirrorComposing.mockReturnValue(false);
    mockIsProseMirrorInCompositionGrace.mockReturnValue(false);
    mockHandleTextInput.mockReturnValue(true);
    const props = getPluginProps();
    const handleTextInput = props.handleTextInput as (view: unknown, from: number, to: number, text: string) => boolean;
    const result = handleTextInput({}, 0, 5, "(");
    expect(result).toBe(true);
    expect(mockHandleTextInput).toHaveBeenCalledWith({}, 0, 5, "(", expect.any(Object));
  });

  it("keydown blocks during IME key event", () => {
    mockIsImeKeyEvent.mockReturnValue(true);
    const props = getPluginProps();
    const handleDOMEvents = props.handleDOMEvents as { keydown: (view: unknown, event: unknown) => boolean };
    const result = handleDOMEvents.keydown({}, { keyCode: 229 });
    expect(result).toBe(false);
  });

  it("keydown delegates to keyHandler when not composing and not IME (line 80)", () => {
    mockIsProseMirrorComposing.mockReturnValue(false);
    mockIsProseMirrorInCompositionGrace.mockReturnValue(false);
    mockIsImeKeyEvent.mockReturnValue(false);
    const props = getPluginProps();
    const handleDOMEvents = props.handleDOMEvents as { keydown: (view: unknown, event: unknown) => boolean };
    const result = handleDOMEvents.keydown({}, { key: "Tab", keyCode: 9 });
    // The mockCreateKeyHandler returns a vi.fn(() => false), so keyHandler returns false
    expect(result).toBe(false);
  });

  it("keydown returns false when isComposingOrGrace returns true (composing branch, line ~79)", () => {
    // isComposingOrGrace = isProseMirrorComposing || isProseMirrorInCompositionGrace
    // This branch is distinct from the isImeKeyEvent branch
    mockIsProseMirrorComposing.mockReturnValue(true);
    mockIsProseMirrorInCompositionGrace.mockReturnValue(false);
    mockIsImeKeyEvent.mockReturnValue(false);
    const props = getPluginProps();
    const handleDOMEvents = props.handleDOMEvents as { keydown: (view: unknown, event: unknown) => boolean };
    const result = handleDOMEvents.keydown({}, { key: ")", keyCode: 41 });
    // isComposingOrGrace is true → returns false immediately, keyHandler not called
    expect(result).toBe(false);
    // The inner keyHandler (from createKeyHandler) should NOT be called
    const keyHandler = mockCreateKeyHandler.mock.results[0]?.value as ReturnType<typeof vi.fn> | undefined;
    if (keyHandler) {
      expect(keyHandler).not.toHaveBeenCalled();
    }
  });

  it("compositionend marks composition end", () => {
    const props = getPluginProps();
    const handleDOMEvents = props.handleDOMEvents as { compositionend: (view: unknown) => boolean };
    const mockView = {};
    const result = handleDOMEvents.compositionend(mockView);
    expect(result).toBe(false);
    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalledWith(mockView);
  });
});
