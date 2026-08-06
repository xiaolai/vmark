// WI-1.5 — shared toolbar/context-menu dispatch. After the structural merge
// this is a THIN layer over the executor's guarded mechanics
// (editorActionDispatch): these tests verify the delegation — origin capture
// for the requested surface, per-surface adapter routing, retry wiring, and
// the malformed-action boundary guard. The mechanics themselves (IME guard,
// tab ownership, read-only, deferred re-validation) are covered by
// runEditorAction.test.ts against the same shared dispatchers.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureOrigin: vi.fn((windowLabel: string, sourceMode: boolean) => ({
    windowLabel,
    tabId: "tab-1",
    sourceMode,
  })),
  dispatchAdapterToWysiwyg: vi.fn(() => true),
  dispatchAdapterToSource: vi.fn(() => true),
  dispatchWithRetry: vi.fn(
    (_label: string, _origin: unknown, _owner: unknown, dispatch: () => boolean) => {
      dispatch();
    },
  ),
  getEditorActionOwner: vi.fn(() => ({ owner: true })),
  getCurrentWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/services/editor/editorActionDispatch", () => ({
  captureOrigin: mocks.captureOrigin,
  dispatchAdapterToWysiwyg: mocks.dispatchAdapterToWysiwyg,
  dispatchAdapterToSource: mocks.dispatchAdapterToSource,
  dispatchWithRetry: mocks.dispatchWithRetry,
}));
vi.mock("@/services/editor/editorActionOwner", () => ({
  getEditorActionOwner: mocks.getEditorActionOwner,
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: mocks.getCurrentWindowLabel,
}));

import { dispatchEditorAction, buildSourceContext, buildWysiwygContext } from "./dispatch";
import { useEditorStore } from "@/stores/editorStore";
import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchEditorAction (guarded delegation)", () => {
  it("routes a plain action to the WYSIWYG guarded dispatcher via retry", () => {
    expect(dispatchEditorAction("bold", "wysiwyg")).toBe(true);
    expect(mocks.captureOrigin).toHaveBeenCalledWith("main", false);
    expect(mocks.dispatchWithRetry).toHaveBeenCalledWith(
      "bold (wysiwyg)",
      expect.objectContaining({ sourceMode: false }),
      expect.anything(),
      expect.any(Function),
    );
    expect(mocks.dispatchAdapterToWysiwyg).toHaveBeenCalledWith(
      "bold",
      expect.objectContaining({ windowLabel: "main", sourceMode: false }),
      expect.anything(),
    );
    expect(mocks.dispatchAdapterToSource).not.toHaveBeenCalled();
  });

  it("routes a source-surface action with a source-mode origin", () => {
    dispatchEditorAction("italic", "source");
    expect(mocks.captureOrigin).toHaveBeenCalledWith("main", true);
    expect(mocks.dispatchAdapterToSource).toHaveBeenCalledWith(
      "italic",
      expect.objectContaining({ sourceMode: true }),
      expect.anything(),
    );
    expect(mocks.dispatchAdapterToWysiwyg).not.toHaveBeenCalled();
  });

  it("passes heading:N through as the adapter action (level travels in the id)", () => {
    dispatchEditorAction("heading:3", "wysiwyg");
    expect(mocks.dispatchAdapterToWysiwyg).toHaveBeenCalledWith(
      "heading:3",
      expect.anything(),
      expect.anything(),
    );
  });

  it("rejects malformed heading actions without dispatching", () => {
    expect(dispatchEditorAction("heading:x", "wysiwyg")).toBe(false);
    expect(mocks.dispatchWithRetry).not.toHaveBeenCalled();
  });

  it("rejects unknown action ids at the boundary", () => {
    expect(dispatchEditorAction("mystery", "wysiwyg")).toBe(false);
    expect(mocks.dispatchWithRetry).not.toHaveBeenCalled();
  });
});

describe("context builders (snapshot providers)", () => {
  // The builders read through the `hostEditors` seam; bind the real store to
  // it so these exercise the wiring the app ships.
  beforeEach(bindPluginHostSettings);

  it("buildSourceContext reads the live editor state through the seam", () => {
    const fakeView = { state: { selection: { ranges: [] } } };
    const fakeContext = { hasSelection: true };
    useEditorStore.setState((s) => ({
      source: { ...s.source, editorView: fakeView as never, context: fakeContext as never },
    }));
    const ctx = buildSourceContext();
    expect(ctx.surface).toBe("source");
    expect(ctx.view).toBe(fakeView);
    expect(ctx.context).toBe(fakeContext);
  });

  it("buildWysiwygContext reads the live editor state through the seam", () => {
    const fakeEditor = { fake: true };
    useEditorStore.setState((s) => ({
      tiptap: { ...s.tiptap, editor: fakeEditor as never },
    }));
    const ctx = buildWysiwygContext();
    expect(ctx.surface).toBe("wysiwyg");
    expect(ctx.editor).toBe(fakeEditor);
  });
});
