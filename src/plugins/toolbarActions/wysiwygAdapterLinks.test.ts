import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/plugins/shared/hostPopups", () => ({
  hostPopups: {
    openLinkPopup: vi.fn(),
    openLinkCreatePopup: vi.fn(),
    openWikiLinkPopup: vi.fn(),
    openHeadingPicker: vi.fn(),
    openMediaPopup: vi.fn(),
    anyLinkSurfaceOpen: vi.fn(() => false),
  },
}));

vi.mock("@/utils/headingSlug", () => ({
  extractHeadingsWithIds: vi.fn(() => []),
}));

vi.mock("@/utils/popupPosition", () => ({
  getBoundaryRects: vi.fn(() => ({ top: 0, left: 0, bottom: 500, right: 500 })),
  getViewportBounds: vi.fn(() => ({ top: 0, left: 0, bottom: 800, right: 600 })),
}));

import { insertWikiLink, insertBookmarkLink } from "./wysiwygAdapterLinks";
import { hostPopups } from "@/plugins/shared/hostPopups";
import { extractHeadingsWithIds } from "@/utils/headingSlug";
import type { WysiwygToolbarContext } from "./types";

function createMockView(opts?: { selectionFrom?: number; selectionTo?: number }) {
  const from = opts?.selectionFrom ?? 10;
  const to = opts?.selectionTo ?? 10;

  const _textNode = { text: "page", marks: [] };
  const wikiLinkType = {
    create: vi.fn((_attrs: Record<string, unknown>, children: unknown[]) => ({
      type: "wikiLink",
      attrs: _attrs,
      children,
    })),
  };

  const replaceSelectionWith = vi.fn().mockReturnThis();
  const addMark = vi.fn().mockReturnThis();
  const insert = vi.fn().mockReturnThis();

  return {
    state: {
      selection: { from, to, $from: { pos: from } },
      schema: {
        nodes: { wikiLink: wikiLinkType },
        marks: {
          link: {
            create: vi.fn((attrs: Record<string, unknown>) => ({ type: "link", attrs })),
          },
        },
        text: vi.fn((t: string, marks?: unknown[]) => ({ text: t, marks: marks ?? [] })),
      },
      doc: {
        textBetween: vi.fn(() => (from !== to ? "selected" : "")),
      },
      tr: { replaceSelectionWith, addMark, insert },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    coordsAtPos: vi.fn(() => ({ top: 100, left: 200, bottom: 120, right: 300 })),
    dom: {
      closest: vi.fn(() => null),
    },
  } as unknown as import("@tiptap/pm/view").EditorView;
}

function createContext(viewOpts?: Parameters<typeof createMockView>[0]): WysiwygToolbarContext {
  return {
    surface: "wysiwyg",
    view: createMockView(viewOpts),
    editor: null,
    context: null,
  };
}

describe("insertWikiLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const ctx = createContext();
    ctx.view = null;
    expect(insertWikiLink(ctx)).toBe(false);
  });

  it("returns false when wikiLink node type does not exist", () => {
    const ctx = createContext();
    (ctx.view!.state.schema.nodes as { wikiLink: unknown }).wikiLink = undefined;
    expect(insertWikiLink(ctx)).toBe(false);
  });

  it("inserts wiki link with default 'page' text when no selection", () => {
    const ctx = createContext({ selectionFrom: 10, selectionTo: 10 });

    const result = insertWikiLink(ctx);
    expect(result).toBe(true);
    expect(ctx.view!.state.schema.nodes.wikiLink.create).toHaveBeenCalledWith(
      { value: "page" },
      expect.anything()
    );
    expect(ctx.view!.dispatch).toHaveBeenCalled();
    expect(ctx.view!.focus).toHaveBeenCalled();
  });

  it("inserts wiki link with selected text as display text", () => {
    const ctx = createContext({ selectionFrom: 5, selectionTo: 13 });

    const result = insertWikiLink(ctx);
    expect(result).toBe(true);
    expect(ctx.view!.state.schema.nodes.wikiLink.create).toHaveBeenCalledWith(
      { value: "selected" },
      expect.anything()
    );
  });
});

describe("insertBookmarkLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const ctx = createContext();
    ctx.view = null;
    expect(insertBookmarkLink(ctx)).toBe(false);
  });

  it("returns false when no headings exist in document", () => {
    vi.mocked(extractHeadingsWithIds).mockReturnValue([]);
    const ctx = createContext();
    expect(insertBookmarkLink(ctx)).toBe(false);
  });

  it("opens heading picker when headings exist", () => {
    vi.mocked(extractHeadingsWithIds).mockReturnValue([
      { id: "intro", text: "Introduction", level: 1 },
    ] as never);

    const openPicker = vi.mocked(hostPopups.openHeadingPicker);
    openPicker.mockClear();

    const ctx = createContext();
    const result = insertBookmarkLink(ctx);

    expect(result).toBe(true);
    expect(openPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        headings: [{ id: "intro", text: "Introduction", level: 1 }],
        onSelect: expect.any(Function),
        anchorRect: expect.any(Object),
      })
    );
  });

  it("picker callback inserts link at cursor when no selection", () => {
    vi.mocked(extractHeadingsWithIds).mockReturnValue([
      { id: "intro", text: "Introduction", level: 1 },
    ] as never);

    const openPicker = vi.mocked(hostPopups.openHeadingPicker);
    openPicker.mockClear();

    const ctx = createContext({ selectionFrom: 10, selectionTo: 10 });
    insertBookmarkLink(ctx);

    // Get the callback passed to openPicker
    const callback = (openPicker.mock.calls[0][0] as { onSelect: unknown }).onSelect as (
      id: string,
      text: string
    ) => void;

    // Set up fresh view state for callback execution
    const view = ctx.view!;
    (view.state as { selection: { from: number; to: number } }).selection = { from: 10, to: 10 };

    callback("intro", "Introduction");

    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });

  it("picker callback applies link mark when selection exists", () => {
    vi.mocked(extractHeadingsWithIds).mockReturnValue([
      { id: "intro", text: "Introduction", level: 1 },
    ] as never);

    const openPicker = vi.mocked(hostPopups.openHeadingPicker);
    openPicker.mockClear();

    const ctx = createContext({ selectionFrom: 5, selectionTo: 15 });
    insertBookmarkLink(ctx);

    const callback = (openPicker.mock.calls[0][0] as { onSelect: unknown }).onSelect as (
      id: string,
      text: string
    ) => void;

    // View state with selection
    const view = ctx.view!;
    (view.state as { selection: { from: number; to: number } }).selection = { from: 5, to: 15 };

    callback("intro", "Introduction");

    expect(view.state.tr.addMark).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("uses viewport bounds when no editor-container found", () => {
    vi.mocked(extractHeadingsWithIds).mockReturnValue([
      { id: "h1", text: "Title", level: 1 },
    ] as never);

    const openPicker = vi.mocked(hostPopups.openHeadingPicker);
    openPicker.mockClear();

    const ctx = createContext();
    // dom.closest returns null (no container)
    insertBookmarkLink(ctx);

    expect(openPicker).toHaveBeenCalledWith(
      expect.objectContaining({ containerBounds: expect.any(Object) })
    );
  });
});
