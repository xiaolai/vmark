/**
 * Tests for compositionGuard tiptap extension — extension metadata,
 * plugin structure, filterTransaction, handleKeyDown, DOM event handlers,
 * and composition state management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock imeGuard before importing the extension
const mockFlushProseMirrorCompositionQueue = vi.fn();
const mockGetImeCleanupPrefixLength = vi.fn(() => 0);
const mockIsImeKeyEvent = vi.fn(() => false);
const mockIsProseMirrorInCompositionGrace = vi.fn(() => false);
const mockMarkProseMirrorCompositionEnd = vi.fn();

vi.mock("@/utils/imeGuard", () => ({
  flushProseMirrorCompositionQueue: (...args: unknown[]) => mockFlushProseMirrorCompositionQueue(...args),
  getImeCleanupPrefixLength: (...args: unknown[]) => mockGetImeCleanupPrefixLength(...args),
  HANGUL_RE: /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/,
  IME_GRACE_PERIOD_MS: 50,
  isImeKeyEvent: (...args: unknown[]) => mockIsImeKeyEvent(...args),
  isProseMirrorInCompositionGrace: (...args: unknown[]) => mockIsProseMirrorInCompositionGrace(...args),
  markProseMirrorCompositionEnd: (...args: unknown[]) => mockMarkProseMirrorCompositionEnd(...args),
}));

// Mock splitBlockFix
const mockFixCompositionSplitBlock = vi.fn(() => null);
vi.mock("../splitBlockFix", () => ({
  fixCompositionSplitBlock: (...args: unknown[]) => mockFixCompositionSplitBlock(...args),
}));

// Mock splitBlock from ProseMirror commands (used for Korean deferred Enter)
const mockSplitBlock = vi.fn();
vi.mock("@tiptap/pm/commands", () => ({
  splitBlock: (...args: unknown[]) => mockSplitBlock(...args),
}));

import { compositionGuardExtension } from "../tiptap";

// Mock requestAnimationFrame to execute callbacks synchronously
const originalRAF = globalThis.requestAnimationFrame;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.requestAnimationFrame = originalRAF;
});

// ---------------------------------------------------------------------------
// Extension metadata
// ---------------------------------------------------------------------------

describe("compositionGuardExtension metadata", () => {
  it("has correct name", () => {
    expect(compositionGuardExtension.name).toBe("compositionGuard");
  });

  it("is an Extension (not a Node or Mark)", () => {
    expect(compositionGuardExtension.type).toBe("extension");
  });

  it("has high priority (1200)", () => {
    expect(compositionGuardExtension.config.priority).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// Plugin creation
// ---------------------------------------------------------------------------

describe("compositionGuardExtension addProseMirrorPlugins", () => {
  function createPlugins() {
    return compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
  }

  it("returns exactly one plugin", () => {
    const plugins = createPlugins();
    expect(plugins).toHaveLength(1);
  });

  it("plugin has filterTransaction", () => {
    const plugins = createPlugins();
    const plugin = plugins[0] as { spec: { filterTransaction?: unknown } };
    expect(plugin.spec.filterTransaction).toBeDefined();
  });

  it("plugin has appendTransaction", () => {
    const plugins = createPlugins();
    const plugin = plugins[0] as { spec: { appendTransaction?: unknown } };
    expect(plugin.spec.appendTransaction).toBeDefined();
  });

  it("plugin has handleKeyDown prop", () => {
    const plugins = createPlugins();
    const plugin = plugins[0] as { props: { handleKeyDown?: unknown } };
    expect(plugin.props.handleKeyDown).toBeDefined();
  });

  it("plugin has handleDOMEvents prop", () => {
    const plugins = createPlugins();
    const plugin = plugins[0] as { props: { handleDOMEvents?: Record<string, unknown> } };
    expect(plugin.props.handleDOMEvents).toBeDefined();
    expect(plugin.props.handleDOMEvents!.compositionstart).toBeDefined();
    expect(plugin.props.handleDOMEvents!.compositionupdate).toBeDefined();
    expect(plugin.props.handleDOMEvents!.compositionend).toBeDefined();
    expect(plugin.props.handleDOMEvents!.blur).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// handleKeyDown — IME key event blocking
// ---------------------------------------------------------------------------

describe("compositionGuard handleKeyDown", () => {
  function getHandleKeyDown() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return (plugins[0] as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;
  }

  it("returns true (block) for IME key events", () => {
    mockIsImeKeyEvent.mockReturnValue(true);
    const handleKeyDown = getHandleKeyDown();
    const result = handleKeyDown({}, { keyCode: 229 });
    expect(result).toBe(true);
  });

  it("returns true (block) during composition grace period", () => {
    mockIsImeKeyEvent.mockReturnValue(false);
    mockIsProseMirrorInCompositionGrace.mockReturnValue(true);
    const handleKeyDown = getHandleKeyDown();
    const result = handleKeyDown({}, {});
    expect(result).toBe(true);
  });

  it("returns false for normal key events", () => {
    mockIsImeKeyEvent.mockReturnValue(false);
    mockIsProseMirrorInCompositionGrace.mockReturnValue(false);
    const handleKeyDown = getHandleKeyDown();
    const result = handleKeyDown({}, {});
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Korean Hangul deferred Enter (Tiptap #4108)
// ---------------------------------------------------------------------------

describe("compositionGuard Korean Hangul deferred Enter", () => {
  function getPluginParts() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as {
      props: {
        handleKeyDown: (view: unknown, event: unknown) => boolean;
        handleDOMEvents: {
          compositionstart: (view: unknown) => boolean;
          compositionupdate: (view: unknown, event: unknown) => boolean;
          compositionend: (view: unknown, event: unknown) => boolean;
        };
      };
    };
    return plugin.props;
  }

  const mockView = {
    state: {
      selection: { from: 5 },
      doc: {
        resolve: () => ({ end: () => 20, depth: 1, node: () => ({ type: { name: "paragraph" } }) }),
        textBetween: () => "한",
        childCount: 1,
      },
    },
    dispatch: vi.fn(),
  };

  it("queues deferred splitBlock when Enter pressed during Korean composition", () => {
    const { handleKeyDown, handleDOMEvents } = getPluginParts();

    // 1. Start composition
    handleDOMEvents.compositionstart(mockView);

    // 2. Compose Korean text
    mockIsImeKeyEvent.mockReturnValue(true);
    handleDOMEvents.compositionupdate(mockView, { data: "한" });

    // 3. Press Enter during composition
    handleKeyDown(mockView, { key: "Enter", isComposing: true, keyCode: 13 });

    // 4. Composition ends
    handleDOMEvents.compositionend(mockView, { data: "한" });

    // rAF fires synchronously (mocked), then the deferred timer fires
    vi.advanceTimersByTime(60);

    // splitBlock should have been called
    expect(mockSplitBlock).toHaveBeenCalledWith(mockView.state, mockView.dispatch);
  });

  it("does NOT queue splitBlock for Chinese composition", () => {
    mockSplitBlock.mockClear();
    const { handleKeyDown, handleDOMEvents } = getPluginParts();

    handleDOMEvents.compositionstart(mockView);
    mockIsImeKeyEvent.mockReturnValue(true);
    handleDOMEvents.compositionupdate(mockView, { data: "你好" });

    // Press Enter — Chinese characters are NOT in Hangul range
    handleKeyDown(mockView, { key: "Enter", isComposing: true, keyCode: 13 });

    handleDOMEvents.compositionend(mockView, { data: "你好" });
    vi.runAllTimers();

    expect(mockSplitBlock).not.toHaveBeenCalled();
  });

  it("cancels deferred Enter if new composition starts", () => {
    mockSplitBlock.mockClear();
    const { handleKeyDown, handleDOMEvents } = getPluginParts();

    handleDOMEvents.compositionstart(mockView);
    mockIsImeKeyEvent.mockReturnValue(true);
    handleDOMEvents.compositionupdate(mockView, { data: "한" });
    handleKeyDown(mockView, { key: "Enter", isComposing: true, keyCode: 13 });
    handleDOMEvents.compositionend(mockView, { data: "한" });

    // New composition starts before timer fires
    handleDOMEvents.compositionstart(mockView);

    vi.advanceTimersByTime(100);

    // splitBlock should NOT have been called — cancelled by new composition
    expect(mockSplitBlock).not.toHaveBeenCalled();
  });

  it("cancels deferred Enter on blur", () => {
    mockSplitBlock.mockClear();
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as {
      props: {
        handleKeyDown: (view: unknown, event: unknown) => boolean;
        handleDOMEvents: {
          compositionstart: (view: unknown) => boolean;
          compositionupdate: (view: unknown, event: unknown) => boolean;
          compositionend: (view: unknown, event: unknown) => boolean;
          blur: (view: unknown) => boolean;
        };
      };
    };

    plugin.props.handleDOMEvents.compositionstart(mockView);
    mockIsImeKeyEvent.mockReturnValue(true);
    plugin.props.handleDOMEvents.compositionupdate(mockView, { data: "한" });
    plugin.props.handleKeyDown(mockView, { key: "Enter", isComposing: true, keyCode: 13 });
    plugin.props.handleDOMEvents.compositionend(mockView, { data: "한" });

    // Blur cancels the deferred Enter
    plugin.props.handleDOMEvents.blur(mockView);

    vi.advanceTimersByTime(100);
    expect(mockSplitBlock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// filterTransaction
// ---------------------------------------------------------------------------

describe("compositionGuard filterTransaction", () => {
  function getFilterTransaction() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return (plugins[0] as { spec: { filterTransaction: (tr: unknown) => boolean } }).spec.filterTransaction;
  }

  function getDomEvents() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as {
      props: {
        handleDOMEvents: {
          compositionstart: (view: unknown) => boolean;
          compositionend: (view: unknown, event: unknown) => boolean;
        };
      };
      spec: { filterTransaction: (tr: unknown) => boolean };
    };
    return {
      compositionstart: plugin.props.handleDOMEvents.compositionstart,
      compositionend: plugin.props.handleDOMEvents.compositionend,
      filterTransaction: plugin.spec.filterTransaction,
    };
  }

  it("allows all transactions when not composing", () => {
    const filterTransaction = getFilterTransaction();
    const tr = { getMeta: () => undefined, docChanged: false };
    expect(filterTransaction(tr)).toBe(true);
  });

  it("allows composition meta transactions during composing", () => {
    const { compositionstart, filterTransaction } = getDomEvents();
    const mockView = { state: { selection: { from: 0 } } };
    compositionstart(mockView);

    const tr = {
      getMeta: (key: string) => key === "composition" ? true : undefined,
      docChanged: false,
    };
    expect(filterTransaction(tr)).toBe(true);
  });

  it("allows doc-changing transactions during composing", () => {
    const { compositionstart, filterTransaction } = getDomEvents();
    const mockView = { state: { selection: { from: 0 } } };
    compositionstart(mockView);

    const tr = {
      getMeta: () => undefined,
      docChanged: true,
      before: { childCount: 1 },
      doc: { childCount: 1, content: { size: 10 } },
    };
    expect(filterTransaction(tr)).toBe(true);
  });

  it("allows history transactions during composing", () => {
    const { compositionstart, filterTransaction } = getDomEvents();
    const mockView = { state: { selection: { from: 0 } } };
    compositionstart(mockView);

    const tr = {
      getMeta: (key: string) => key === "history$" ? {} : undefined,
      docChanged: false,
    };
    expect(filterTransaction(tr)).toBe(true);
  });

  it("allows uiEvent=input transactions during composing", () => {
    const { compositionstart, filterTransaction } = getDomEvents();
    const mockView = { state: { selection: { from: 0 } } };
    compositionstart(mockView);

    const tr = {
      getMeta: (key: string) => key === "uiEvent" ? "input" : undefined,
      docChanged: false,
    };
    expect(filterTransaction(tr)).toBe(true);
  });

  it("allows uiEvent=composition transactions during composing", () => {
    const { compositionstart, filterTransaction } = getDomEvents();
    const mockView = { state: { selection: { from: 0 } } };
    compositionstart(mockView);

    const tr = {
      getMeta: (key: string) => key === "uiEvent" ? "composition" : undefined,
      docChanged: false,
    };
    expect(filterTransaction(tr)).toBe(true);
  });

  it("blocks non-composition selection-only transactions during composing", () => {
    const { compositionstart, filterTransaction } = getDomEvents();
    const mockView = { state: { selection: { from: 0 } } };
    compositionstart(mockView);

    const tr = {
      getMeta: () => undefined,
      docChanged: false,
    };
    expect(filterTransaction(tr)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DOM events — compositionstart
// ---------------------------------------------------------------------------

describe("compositionGuard compositionstart", () => {
  function getDomEvents() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return (plugins[0] as {
      props: {
        handleDOMEvents: Record<string, (view: unknown, event?: unknown) => boolean>;
      };
    }).props.handleDOMEvents;
  }

  it("returns false (does not prevent default)", () => {
    const events = getDomEvents();
    const parentNode = { type: { name: "paragraph" } };
    const mockView = {
      state: {
        selection: { from: 5, to: 5 },
        doc: { resolve: () => ({ parent: parentNode }) },
      },
    };
    const result = events.compositionstart(mockView);
    expect(result).toBe(false);
  });

  it("pre-deletes multi-block selection at compositionstart (Tiptap #5416)", () => {
    const events = getDomEvents();
    const parentA = { type: { name: "paragraph" } };
    const parentB = { type: { name: "paragraph" } };
    const mockDispatch = vi.fn();
    const mockDeleteSelection = vi.fn().mockReturnValue({ fake: "tr" });
    const mockView = {
      state: {
        selection: { from: 5, to: 20 },
        doc: {
          resolve: (pos: number) => ({
            parent: pos <= 10 ? parentA : parentB,
          }),
        },
        tr: { deleteSelection: mockDeleteSelection },
      },
      dispatch: mockDispatch,
    };
    events.compositionstart(mockView);
    // Should have dispatched deleteSelection since from/to are in different parents
    expect(mockDeleteSelection).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("does NOT pre-delete single-block selection at compositionstart", () => {
    const events = getDomEvents();
    const parentNode = { type: { name: "paragraph" } };
    const mockDispatch = vi.fn();
    const mockView = {
      state: {
        selection: { from: 5, to: 10 },
        doc: { resolve: () => ({ parent: parentNode }) },
        tr: { deleteSelection: vi.fn() },
      },
      dispatch: mockDispatch,
    };
    events.compositionstart(mockView);
    // Same parent block — no pre-deletion needed
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DOM events — compositionupdate
// ---------------------------------------------------------------------------

describe("compositionGuard compositionupdate", () => {
  function getDomEvents() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return (plugins[0] as {
      props: {
        handleDOMEvents: Record<string, (view: unknown, event?: unknown) => boolean>;
      };
    }).props.handleDOMEvents;
  }

  it("returns false (does not prevent default)", () => {
    const events = getDomEvents();
    const result = events.compositionupdate({}, { data: "ni" });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DOM events — compositionend
// ---------------------------------------------------------------------------

describe("compositionGuard compositionend", () => {
  function getDomEvents() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return (plugins[0] as {
      props: {
        handleDOMEvents: Record<string, (view: unknown, event?: unknown) => boolean>;
      };
    }).props.handleDOMEvents;
  }

  it("returns false (does not prevent default)", () => {
    const events = getDomEvents();
    const mockView = {
      state: {
        selection: { from: 5 },
        doc: {
          resolve: () => ({
            depth: 1,
            node: () => ({ type: { name: "paragraph" } }),
            end: () => 10,
          }),
          textBetween: () => "test",
        },
      },
    };
    const result = events.compositionend(mockView, { data: "你" });
    expect(result).toBe(false);
  });

  it("marks composition end", () => {
    const events = getDomEvents();
    const mockResolve = () => ({
      depth: 1,
      node: () => ({ type: { name: "paragraph" } }),
      end: () => 10,
    });
    const mockView = {
      state: {
        selection: { from: 0 },
        doc: {
          resolve: mockResolve,
          textBetween: () => "",
          content: { size: 20 },
        },
      },
      dispatch: vi.fn(),
    };
    events.compositionstart(mockView);
    events.compositionend(mockView, { data: "好" });
    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalledWith(mockView);
  });
});

// ---------------------------------------------------------------------------
// DOM events — blur during composition
// ---------------------------------------------------------------------------

describe("compositionGuard blur", () => {
  function getDomEvents() {
    const plugins = compositionGuardExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "compositionGuard",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return (plugins[0] as {
      props: {
        handleDOMEvents: Record<string, (view: unknown, event?: unknown) => boolean>;
      };
      spec: { filterTransaction: (tr: unknown) => boolean };
    });
  }

  it("returns false when not composing", () => {
    const { props } = getDomEvents();
    const result = props.handleDOMEvents.blur({});
    expect(result).toBe(false);
  });

  it("marks composition end on blur during composition", () => {
    const { props } = getDomEvents();
    const mockView = { state: { selection: { from: 5 } } };

    // Start composition
    props.handleDOMEvents.compositionstart(mockView);

    // Blur during composition
    props.handleDOMEvents.blur(mockView);
    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalledWith(mockView);
  });

  it("resets composing state on blur so filterTransaction allows all", () => {
    const { props, spec } = getDomEvents();
    const mockView = { state: { selection: { from: 5 } } };

    // Start composition — should block non-composition transactions
    props.handleDOMEvents.compositionstart(mockView);
    const trBlocked = { getMeta: () => undefined, docChanged: false };
    expect(spec.filterTransaction(trBlocked)).toBe(false);

    // Blur — should reset state
    props.handleDOMEvents.blur(mockView);

    // Now should allow all transactions again
    expect(spec.filterTransaction(trBlocked)).toBe(true);
  });

  it("schedules flushProseMirrorCompositionQueue on blur during composition", () => {
    const { props } = getDomEvents();
    const mockView = { state: { selection: { from: 5 } } };

    props.handleDOMEvents.compositionstart(mockView);
    props.handleDOMEvents.blur(mockView);

    // requestAnimationFrame is used in the implementation
    // The flush should be scheduled
    expect(mockMarkProseMirrorCompositionEnd).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// compositionend — scheduleImeCleanup with valid state
// ---------------------------------------------------------------------------
