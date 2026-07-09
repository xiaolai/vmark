// WI-1.4 — menu action routing: adapter actions dispatch to the shared
// helper and refocus the editor; clipboard routes to the bridge; link
// commands copy/remove/edit against the snapshot's link state.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchEditorAction: vi.fn(() => true),
  runClipboardCommand: vi.fn(async () => undefined),
  focusEditorSurface: vi.fn(),
  writeText: vi.fn(async () => undefined),
  runOrQueueCodeMirrorAction: vi.fn((_view: unknown, action: () => void) => action()),
}));

vi.mock("@/plugins/toolbarActions/dispatch", () => ({
  dispatchEditorAction: mocks.dispatchEditorAction,
}));
vi.mock("@/utils/imeGuard", () => ({
  runOrQueueCodeMirrorAction: mocks.runOrQueueCodeMirrorAction,
}));
vi.mock("./clipboardBridge", () => ({
  runClipboardCommand: mocks.runClipboardCommand,
  focusEditorSurface: mocks.focusEditorSurface,
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: mocks.writeText }));

import { runEditorMenuItem } from "./runMenuAction";
import { useEditorStore } from "@/stores/editorStore";
import { usePopupStore } from "@/stores/popupStore";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

function snapshot(overrides: Partial<EditorContextMenuSnapshot> = {}): EditorContextMenuSnapshot {
  return {
    surface: "wysiwyg",
    selectionEmpty: true,
    inCodeBlock: false,
    headingLevel: null,
    listType: null,
    inBlockquote: false,
    link: null,
    formatPolicy: { paragraphFormatting: true, insertBlockActions: true },
    activeActions: [],
    disabledActions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runEditorMenuItem", () => {
  it("dispatches adapter actions on the snapshot surface and refocuses", async () => {
    await runEditorMenuItem({ type: "adapter", action: "bold" }, snapshot({ surface: "source" }));
    expect(mocks.dispatchEditorAction).toHaveBeenCalledWith("bold", "source");
    expect(mocks.focusEditorSurface).toHaveBeenCalledWith("source");
  });

  it("routes source adapter actions through the IME queue when a view exists (WI-3.2)", async () => {
    const sourceView = { fake: true };
    useEditorStore.setState((s) => ({
      source: { ...s.source, editorView: sourceView as never },
    }));
    await runEditorMenuItem({ type: "adapter", action: "italic" }, snapshot({ surface: "source" }));
    expect(mocks.runOrQueueCodeMirrorAction).toHaveBeenCalledWith(sourceView, expect.any(Function));
    expect(mocks.dispatchEditorAction).toHaveBeenCalledWith("italic", "source");
    useEditorStore.setState((s) => ({ source: { ...s.source, editorView: null } }));
  });

  it("routes clipboard commands to the bridge", async () => {
    await runEditorMenuItem({ type: "clipboard", command: "paste" }, snapshot());
    expect(mocks.runClipboardCommand).toHaveBeenCalledWith("paste", "wysiwyg");
    expect(mocks.dispatchEditorAction).not.toHaveBeenCalled();
  });

  it("copyLink writes the resolved href to the clipboard", async () => {
    await runEditorMenuItem(
      { type: "link", command: "copyLink" },
      snapshot({ link: { href: "https://example.com" } })
    );
    expect(mocks.writeText).toHaveBeenCalledWith("https://example.com");
  });

  it("copyLink no-ops on unresolved targets", async () => {
    await runEditorMenuItem({ type: "link", command: "copyLink" }, snapshot({ link: { href: null } }));
    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it("removeLink dispatches the unlink adapter action", async () => {
    await runEditorMenuItem(
      { type: "link", command: "removeLink" },
      snapshot({ surface: "source", link: { href: "x" } })
    );
    expect(mocks.dispatchEditorAction).toHaveBeenCalledWith("unlink", "source");
  });

  /** Fake view whose doc contains one text node spanning [8, 14) carrying
   *  a link mark. `nodesBetween` mirrors ProseMirror's contract closely
   *  enough for the same-link coverage check. */
  function editLinkView(opts: { href?: string | null; nodeFrom?: number; nodeTo?: number } = {}) {
    const { href = "https://example.com", nodeFrom = 8, nodeTo = 14 } = opts;
    const linkType = {
      isInSet: (marks: unknown[]) => (marks.length > 0 ? marks[0] : undefined),
    };
    const marks = href === null ? [] : [{ attrs: { href } }];
    return {
      coordsAtPos: vi.fn(() => ({ top: 10, bottom: 20, left: 30, right: 40 })),
      state: {
        doc: {
          content: { size: 100 },
          nodesBetween: (from: number, to: number, cb: (node: unknown, pos: number) => boolean) => {
            const start = Math.max(from, nodeFrom);
            if (start < Math.min(to, nodeTo)) {
              cb({ isText: true, marks, nodeSize: nodeTo - nodeFrom }, nodeFrom);
            }
          },
        },
        schema: { marks: { link: linkType } },
      },
    };
  }

  it("editLink opens the link popup anchored at the link range", async () => {
    const view = editLinkView();
    useEditorStore.setState((s) => ({ tiptap: { ...s.tiptap, editorView: view as never } }));
    const openSpy = vi.spyOn(usePopupStore.getState(), "linkOpenPopup");

    await runEditorMenuItem(
      { type: "link", command: "editLink" },
      snapshot({ link: { href: "https://example.com", from: 8, to: 14 } })
    );

    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ href: "https://example.com", linkFrom: 8, linkTo: 14 })
    );
    openSpy.mockRestore();
  });

  it("editLink no-ops without a link range", async () => {
    const openSpy = vi.spyOn(usePopupStore.getState(), "linkOpenPopup");
    await runEditorMenuItem(
      { type: "link", command: "editLink" },
      snapshot({ link: { href: "https://example.com" } })
    );
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("editLink no-ops when the range is out of bounds (doc changed under the menu)", async () => {
    const view = editLinkView();
    view.state.doc.content.size = 10;
    useEditorStore.setState((s) => ({ tiptap: { ...s.tiptap, editorView: view as never } }));
    const openSpy = vi.spyOn(usePopupStore.getState(), "linkOpenPopup");
    await runEditorMenuItem(
      { type: "link", command: "editLink" },
      snapshot({ link: { href: "https://example.com", from: 8, to: 14 } })
    );
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("editLink no-ops when the link mark is gone from the range", async () => {
    const view = editLinkView({ href: null });
    useEditorStore.setState((s) => ({ tiptap: { ...s.tiptap, editorView: view as never } }));
    const openSpy = vi.spyOn(usePopupStore.getState(), "linkOpenPopup");
    await runEditorMenuItem(
      { type: "link", command: "editLink" },
      snapshot({ link: { href: "https://example.com", from: 8, to: 14 } })
    );
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("editLink no-ops when the link only partially covers the stale range", async () => {
    // Link mark now spans [8, 11) but the snapshot claims [8, 14) — the
    // doc changed under the open menu; the popup must not rewrite [8, 14).
    const view = editLinkView({ nodeTo: 11 });
    useEditorStore.setState((s) => ({ tiptap: { ...s.tiptap, editorView: view as never } }));
    const openSpy = vi.spyOn(usePopupStore.getState(), "linkOpenPopup");
    await runEditorMenuItem(
      { type: "link", command: "editLink" },
      snapshot({ link: { href: "https://example.com", from: 8, to: 14 } })
    );
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("editLink no-ops when the range now carries a different href", async () => {
    const view = editLinkView({ href: "https://other.example" });
    useEditorStore.setState((s) => ({ tiptap: { ...s.tiptap, editorView: view as never } }));
    const openSpy = vi.spyOn(usePopupStore.getState(), "linkOpenPopup");
    await runEditorMenuItem(
      { type: "link", command: "editLink" },
      snapshot({ link: { href: "https://example.com", from: 8, to: 14 } })
    );
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
