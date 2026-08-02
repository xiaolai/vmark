import { describe, it, expect, vi, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

// Mock stores and utils before importing
// The picker is opened through the `hostPopups` seam now.
const mockOpenPicker = vi.fn();
let mockAnySurfaceOpen = false;
vi.mock("@/plugins/shared/hostPopups", () => ({
  hostPopups: {
    openHeadingPicker: (...a: unknown[]) => mockOpenPicker(...a),
    anyLinkSurfaceOpen: () => mockAnySurfaceOpen,
  },
}));

const mockExtractHeadingsWithIds = vi.fn();
vi.mock("@/utils/headingSlug", () => ({
  extractHeadingsWithIds: (...args: unknown[]) =>
    mockExtractHeadingsWithIds(...args),
}));

vi.mock("@/utils/popupPosition", () => ({
  getBoundaryRects: vi.fn(() => ({
    top: 0,
    left: 0,
    bottom: 800,
    right: 600,
  })),
  getViewportBounds: vi.fn(() => ({
    top: 0,
    left: 0,
    bottom: 800,
    right: 600,
  })),
}));

const { handleBookmarkLinkShortcut } = await import(
  "./bookmarkLinkCommand"
);

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+", toDOM: () => ["div", 0] },
    paragraph: { content: "inline*", toDOM: () => ["p", 0] },
    text: { group: "inline", inline: true },
  },
  marks: {
    link: {
      attrs: { href: { default: "" } },
      toDOM: (mark) => ["a", { href: mark.attrs.href }, 0],
    },
  },
});

const mockCoords = { top: 100, bottom: 120, left: 200, right: 210 };

function createView(text: string, from: number, to?: number): EditorView {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  let state = EditorState.create({ doc, schema });
  state = state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, from, to ?? from)
    )
  );
  const container = document.createElement("div");
  const view = new EditorView(container, { state });
  // Mock coordsAtPos since jsdom has no layout engine
  view.coordsAtPos = vi.fn(() => mockCoords);
  return view;
}

describe("handleBookmarkLinkShortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnySurfaceOpen = false;
    mockExtractHeadingsWithIds.mockReturnValue([
      { id: "heading-1", text: "First Heading", level: 1 },
      { id: "heading-2", text: "Second Heading", level: 2 },
    ]);
  });

  it("returns true when heading picker is already open (blocks re-entry)", () => {
    mockAnySurfaceOpen = true;

    const view = createView("hello", 2);
    const result = handleBookmarkLinkShortcut(view);
    expect(result).toBe(true);
    expect(mockOpenPicker).not.toHaveBeenCalled();
    view.destroy();
  });

  it("returns false when no headings exist in the document", () => {
    mockExtractHeadingsWithIds.mockReturnValue([]);

    const view = createView("hello", 2);
    const result = handleBookmarkLinkShortcut(view);
    expect(result).toBe(false);
    expect(mockOpenPicker).not.toHaveBeenCalled();
    view.destroy();
  });

  it("opens heading picker when headings exist", () => {
    const view = createView("hello", 2);
    const result = handleBookmarkLinkShortcut(view);
    expect(result).toBe(true);
    expect(mockOpenPicker).toHaveBeenCalledWith({
      headings: [
        { id: "heading-1", text: "First Heading", level: 1 },
        { id: "heading-2", text: "Second Heading", level: 2 },
      ],
      onSelect: expect.any(Function),
      anchorRect: expect.any(Object),
      containerBounds: expect.any(Object),
    });
    view.destroy();
  });

  it("captures selected text for link text", () => {
    const view = createView("hello world", 1, 6); // "hello" selected
    handleBookmarkLinkShortcut(view);

    // Get the callback passed to openPicker
    const callback = (mockOpenPicker.mock.calls[0][0] as { onSelect: unknown }).onSelect as (
      id: string,
      text: string
    ) => void;

    // Invoke the callback (simulates user picking a heading)
    callback("heading-1", "First Heading");

    // The link should use the selected text
    const linkMark = view.state.doc.resolve(2).marks().find((m) => m.type.name === "link");
    expect(linkMark).toBeDefined();
    expect(linkMark!.attrs.href).toBe("#heading-1");
    view.destroy();
  });

  it("inserts heading text as link when no selection", () => {
    const view = createView("hello world", 6, 6); // collapsed cursor
    handleBookmarkLinkShortcut(view);

    const callback = (mockOpenPicker.mock.calls[0][0] as { onSelect: unknown }).onSelect as (
      id: string,
      text: string
    ) => void;
    callback("heading-2", "Second Heading");

    // Should have inserted "Second Heading" as a link
    expect(view.state.doc.textContent).toContain("Second Heading");

    // Find the link mark on the inserted text
    let foundLink = false;
    view.state.doc.descendants((node) => {
      if (node.isText && node.text?.includes("Second Heading")) {
        const link = node.marks.find((m) => m.type.name === "link");
        if (link) {
          expect(link.attrs.href).toBe("#heading-2");
          foundLink = true;
        }
      }
    });
    expect(foundLink).toBe(true);
    view.destroy();
  });

  it("does nothing in callback if schema has no link mark", () => {
    // Schema without link mark
    const noLinkSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+", toDOM: () => ["div", 0] },
        paragraph: { content: "text*", toDOM: () => ["p", 0] },
        text: { inline: true },
      },
    });
    const doc = noLinkSchema.node("doc", null, [
      noLinkSchema.node("paragraph", null, [noLinkSchema.text("hello")]),
    ]);
    const state = EditorState.create({ doc, schema: noLinkSchema });
    const container = document.createElement("div");
    const view = new EditorView(container, { state });
    view.coordsAtPos = vi.fn(() => mockCoords);

    handleBookmarkLinkShortcut(view);

    const callback = (mockOpenPicker.mock.calls[0][0] as { onSelect: unknown }).onSelect as (
      id: string,
      text: string
    ) => void;
    // Should not throw, just return early
    callback("heading-1", "First Heading");
    expect(view.state.doc.textContent).toBe("hello");
    view.destroy();
  });

  it("passes extracted headings to the picker", () => {
    const headings = [
      { id: "intro", text: "Introduction", level: 1 },
      { id: "summary", text: "Summary", level: 2 },
      { id: "conclusion", text: "Conclusion", level: 2 },
    ];
    mockExtractHeadingsWithIds.mockReturnValue(headings);

    const view = createView("hello", 2);
    handleBookmarkLinkShortcut(view);

    expect(mockOpenPicker).toHaveBeenCalledWith(
      expect.objectContaining({ headings, onSelect: expect.any(Function) })
    );
    view.destroy();
  });
});
