import { describe, it, expect, vi } from "vitest";
import { handleTableScrollToSelection } from "./scrollGuard";

/**
 * Creates a mock EditorView for testing handleTableScrollToSelection.
 *
 * @param options.inTable - Whether the selection head is inside a table node
 * @param options.coords - Viewport coordinates returned by coordsAtPos
 * @param options.containerRect - Bounding rect of .editor-content
 * @param options.scrollTop - Initial scrollTop of .editor-content
 * @param options.hasContainer - Whether .editor-content exists in DOM
 * @param options.coordsThrows - Whether coordsAtPos should throw
 * @param options.scrollMargin - Value for someProp("scrollMargin"); number or {top,bottom,...} object
 * @param options.tableDepth - Depth of the table node (for nested tables)
 */
function createMockView(options: {
  inTable?: boolean;
  coords?: { top: number; bottom: number; left: number; right: number };
  containerRect?: { top: number; bottom: number; left: number; right: number };
  scrollTop?: number;
  hasContainer?: boolean;
  coordsThrows?: boolean;
  scrollMargin?: unknown;
  tableDepth?: number;
} = {}) {
  const {
    inTable = false,
    coords = { top: 100, bottom: 120, left: 50, right: 200 },
    containerRect = { top: 0, bottom: 500, left: 0, right: 800 },
    scrollTop = 0,
    hasContainer = true,
    coordsThrows = false,
    scrollMargin,
    tableDepth = 1,
  } = options;

  // Build ancestor node chain for $head.node(d)
  const depth = inTable ? tableDepth + 1 : 1; // +1 for doc level
  const nodeAtDepth = (d: number) => ({
    type: {
      name: d === tableDepth && inTable ? "table" : d === 0 ? "doc" : "paragraph",
    },
  });

  const container = hasContainer
    ? {
        getBoundingClientRect: () => containerRect,
        scrollTop,
      }
    : null;

  const view = {
    state: {
      selection: {
        head: 10,
        $head: {
          depth,
          node: nodeAtDepth,
        },
      },
    },
    dom: {
      closest: vi.fn((selector: string) => {
        if (selector === ".editor-content") return container;
        return null;
      }),
    },
    coordsAtPos: coordsThrows
      ? vi.fn(() => { throw new Error("Position out of range"); })
      : vi.fn(() => coords),
    someProp: vi.fn((prop: string) => {
      if (prop === "scrollMargin") return scrollMargin;
      return undefined;
    }),
  };

  return { view: view as unknown as Parameters<typeof handleTableScrollToSelection>[0], container };
}

describe("handleTableScrollToSelection", () => {
  it("returns false when cursor is in a paragraph (not a table)", () => {
    const { view } = createMockView({ inTable: false });
    expect(handleTableScrollToSelection(view)).toBe(false);
  });

  it("returns true when cursor is in a table", () => {
    const { view } = createMockView({ inTable: true });
    expect(handleTableScrollToSelection(view)).toBe(true);
  });

  it("scrolls down when cursor is below viewport", () => {
    const { view, container } = createMockView({
      inTable: true,
      coords: { top: 480, bottom: 510, left: 50, right: 200 },
      containerRect: { top: 0, bottom: 500, left: 0, right: 800 },
      scrollTop: 100,
    });

    handleTableScrollToSelection(view);

    // cursor bottom (510) > container bottom (500) - margin (5) = 495
    // scrollTop += 510 - 495 = 15
    expect(container!.scrollTop).toBe(115);
  });

  it("scrolls up when cursor is above viewport", () => {
    const { view, container } = createMockView({
      inTable: true,
      coords: { top: 2, bottom: 22, left: 50, right: 200 },
      containerRect: { top: 10, bottom: 500, left: 0, right: 800 },
      scrollTop: 200,
    });

    handleTableScrollToSelection(view);

    // cursor top (2) < container top (10) + margin (5) = 15
    // scrollTop -= 15 - 2 = 13
    expect(container!.scrollTop).toBe(187);
  });

  it("does not change scrollTop when cursor is already visible", () => {
    const { view, container } = createMockView({
      inTable: true,
      coords: { top: 100, bottom: 120, left: 50, right: 200 },
      containerRect: { top: 0, bottom: 500, left: 0, right: 800 },
      scrollTop: 50,
    });

    handleTableScrollToSelection(view);

    expect(container!.scrollTop).toBe(50);
  });

  it("returns false when .editor-content is not found", () => {
    const { view } = createMockView({ inTable: true, hasContainer: false });
    expect(handleTableScrollToSelection(view)).toBe(false);
  });

  it("returns false when coordsAtPos throws", () => {
    const { view } = createMockView({ inTable: true, coordsThrows: true });
    expect(handleTableScrollToSelection(view)).toBe(false);
  });

  it("returns true for nested table (cursor at inner table depth)", () => {
    const { view } = createMockView({ inTable: true, tableDepth: 3 });
    expect(handleTableScrollToSelection(view)).toBe(true);
  });

  it("returns true for cursor in empty table cell", () => {
    // Empty cell still has a position inside the table
    const { view } = createMockView({ inTable: true });
    expect(handleTableScrollToSelection(view)).toBe(true);
  });

  it("uses numeric scrollMargin from view props", () => {
    const { view, container } = createMockView({
      inTable: true,
      coords: { top: 480, bottom: 510, left: 50, right: 200 },
      containerRect: { top: 0, bottom: 500, left: 0, right: 800 },
      scrollTop: 100,
      scrollMargin: 20,
    });

    handleTableScrollToSelection(view);

    // cursor bottom (510) > container bottom (500) - margin (20) = 480
    // scrollTop += 510 - 480 = 30
    expect(container!.scrollTop).toBe(130);
  });

  it("uses object-shaped scrollMargin {top, bottom}", () => {
    const { view, container } = createMockView({
      inTable: true,
      coords: { top: 2, bottom: 22, left: 50, right: 200 },
      containerRect: { top: 10, bottom: 500, left: 0, right: 800 },
      scrollTop: 200,
      scrollMargin: { top: 15, bottom: 25 },
    });

    handleTableScrollToSelection(view);

    // cursor top (2) < container top (10) + topMargin (15) = 25
    // scrollTop -= 25 - 2 = 23
    expect(container!.scrollTop).toBe(177);
  });

  it("preserves scrollMargin of 0 (does not fall back to default)", () => {
    const { view, container } = createMockView({
      inTable: true,
      coords: { top: 480, bottom: 501, left: 50, right: 200 },
      containerRect: { top: 0, bottom: 500, left: 0, right: 800 },
      scrollTop: 100,
      scrollMargin: 0,
    });

    handleTableScrollToSelection(view);

    // margin is 0, so threshold is exactly 500
    // cursor bottom (501) > 500 - 0 = 500
    // scrollTop += 501 - 500 + 0 = 1
    expect(container!.scrollTop).toBe(101);
  });
});
