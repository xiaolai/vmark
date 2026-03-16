/**
 * Tests for sourcePeekEditor — createCodeMirrorEditor and cleanupCMView.
 *
 * CodeMirror modules are dynamically imported; mocks intercept vi.importActual
 * so the lazy-load path is exercised.
 */

const mockDestroy = vi.fn();
const mockFocus = vi.fn();

// Capture keymap bindings and updateListener callback so tests can invoke them
let capturedKeymapBindings: Array<{ key: string; run: () => boolean }> = [];
let capturedUpdateListener: ((update: unknown) => void) | null = null;

vi.mock("@codemirror/state", () => ({
  EditorState: {
    create: vi.fn(() => ({ doc: { toString: () => "test" } })),
  },
}));

vi.mock("@codemirror/view", () => {
  class MockCMView {
    destroy = mockDestroy;
    focus = mockFocus;
    state = { doc: { toString: () => "test" } };
    constructor(public config: Record<string, unknown>) {}
  }
  (MockCMView as unknown as Record<string, unknown>).theme = vi.fn(() => ({}));
  (MockCMView as unknown as Record<string, unknown>).lineWrapping = {};
  (MockCMView as unknown as Record<string, unknown>).updateListener = {
    of: vi.fn((cb: (update: unknown) => void) => {
      capturedUpdateListener = cb;
      return {};
    }),
  };
  return {
    EditorView: MockCMView,
    keymap: {
      of: vi.fn((bindings: Array<{ key: string; run: () => boolean }>) => {
        capturedKeymapBindings = bindings;
        return {};
      }),
    },
  };
});

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: vi.fn(() => ({})),
  historyKeymap: [],
}));

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: vi.fn(() => ({})),
}));

vi.mock("@codemirror/language-data", () => ({
  languages: [],
}));

vi.mock("@codemirror/language", () => ({
  syntaxHighlighting: vi.fn(() => ({})),
}));

vi.mock("@/plugins/codemirror", () => ({
  codeHighlightStyle: {},
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createCodeMirrorEditor, cleanupCMView } from "./sourcePeekEditor";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";

/** Flush the async initCMEditor promise so the CM view is mounted. */
async function flushCMInit(): Promise<void> {
  // Lazy-loaded modules resolve via Promise.all inside loadCMModules,
  // then initCMEditor continues after that. Need multiple microtask
  // ticks for the full async chain to settle.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// cleanupCMView
// ---------------------------------------------------------------------------

describe("cleanupCMView", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    cleanupCMView();
    vi.clearAllMocks();
  });

  it("does not throw when no CM view exists", () => {
    expect(() => cleanupCMView()).not.toThrow();
  });

  it("destroys CM view after createCodeMirrorEditor was called", async () => {
    const noop = () => {};
    createCodeMirrorEditor("test", noop, noop, noop);
    await flushCMInit();
    cleanupCMView();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("calling cleanupCMView twice does not throw", async () => {
    const noop = () => {};
    createCodeMirrorEditor("test", noop, noop, noop);
    await flushCMInit();
    cleanupCMView();
    expect(() => cleanupCMView()).not.toThrow();
  });

  it("only calls destroy once on double cleanup", async () => {
    const noop = () => {};
    createCodeMirrorEditor("test", noop, noop, noop);
    await flushCMInit();
    cleanupCMView();
    const destroyCount = mockDestroy.mock.calls.length;
    cleanupCMView();
    expect(mockDestroy.mock.calls.length).toBe(destroyCount);
  });
});

// ---------------------------------------------------------------------------
// createCodeMirrorEditor
// ---------------------------------------------------------------------------

describe("createCodeMirrorEditor", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    cleanupCMView();
    vi.clearAllMocks();
  });

  it("returns an HTMLElement synchronously", () => {
    const noop = () => {};
    const el = createCodeMirrorEditor("# Hello", noop, noop, noop);
    expect(el).toBeInstanceOf(HTMLElement);
  });

  it("returned element has correct class", () => {
    const noop = () => {};
    const el = createCodeMirrorEditor("test", noop, noop, noop);
    expect(el.className).toBe("source-peek-inline-editor");
  });

  it("creates CMState with provided markdown", async () => {
    const noop = () => {};
    createCodeMirrorEditor("# My Content", noop, noop, noop);
    await flushCMInit();
    expect(CMState.create).toHaveBeenCalledWith(
      expect.objectContaining({ doc: "# My Content" })
    );
  });

  it("destroys previous CM view when creating a new one", async () => {
    const noop = () => {};
    createCodeMirrorEditor("first", noop, noop, noop);
    await flushCMInit();
    createCodeMirrorEditor("second", noop, noop, noop);
    await flushCMInit();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("creates a theme with CMView.theme", async () => {
    const noop = () => {};
    createCodeMirrorEditor("test", noop, noop, noop);
    await flushCMInit();
    expect((CMView as unknown as Record<string, ReturnType<typeof vi.fn>>).theme).toHaveBeenCalled();
  });

  it("configures markdown language support", async () => {
    const noop = () => {};
    createCodeMirrorEditor("test", noop, noop, noop);
    await flushCMInit();
    expect(markdownLang).toHaveBeenCalled();
  });

  it("configures syntax highlighting", async () => {
    const noop = () => {};
    createCodeMirrorEditor("test", noop, noop, noop);
    await flushCMInit();
    expect(syntaxHighlighting).toHaveBeenCalled();
  });

  it("configures history extension", async () => {
    const noop = () => {};
    createCodeMirrorEditor("test", noop, noop, noop);
    await flushCMInit();
    expect(history).toHaveBeenCalled();
  });

  it("creates container as parent for CMView", () => {
    const noop = () => {};
    const el = createCodeMirrorEditor("test", noop, noop, noop);
    expect(el.tagName).toBe("DIV");
  });

  it("handleSave keymap binding calls onSave and returns true", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const onUpdate = vi.fn();

    createCodeMirrorEditor("test", onSave, onCancel, onUpdate);
    await flushCMInit();

    // Find the Mod-Enter binding in captured keymap bindings
    const saveBinding = capturedKeymapBindings.find((b) => b.key === "Mod-Enter");
    expect(saveBinding).toBeDefined();

    const result = saveBinding!.run();
    expect(result).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("handleCancel keymap binding calls onCancel and returns true", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const onUpdate = vi.fn();

    createCodeMirrorEditor("test", onSave, onCancel, onUpdate);
    await flushCMInit();

    // Find the Escape binding in captured keymap bindings
    const cancelBinding = capturedKeymapBindings.find((b) => b.key === "Escape");
    expect(cancelBinding).toBeDefined();

    const result = cancelBinding!.run();
    expect(result).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("updateListener calls onUpdate when docChanged is true", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const onUpdate = vi.fn();

    createCodeMirrorEditor("initial text", onSave, onCancel, onUpdate);
    await flushCMInit();

    expect(capturedUpdateListener).not.toBeNull();

    // Simulate a document change update
    capturedUpdateListener!({
      docChanged: true,
      state: { doc: { toString: () => "updated text" } },
    });

    expect(onUpdate).toHaveBeenCalledWith("updated text");
  });

  it("updateListener does not call onUpdate when docChanged is false", async () => {
    const onUpdate = vi.fn();
    const noop = () => {};

    createCodeMirrorEditor("test", noop, noop, onUpdate);
    await flushCMInit();

    capturedUpdateListener!({
      docChanged: false,
      state: { doc: { toString: () => "test" } },
    });

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("focuses the CM view via requestAnimationFrame", async () => {
    vi.useFakeTimers();
    const noop = () => {};
    createCodeMirrorEditor("test", noop, noop, noop);

    // Flush the async init (fakeTimers require manual advancement of setTimeout)
    await vi.advanceTimersByTimeAsync(0);

    // requestAnimationFrame callback fires after flush
    vi.runAllTimers();

    expect(mockFocus).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
