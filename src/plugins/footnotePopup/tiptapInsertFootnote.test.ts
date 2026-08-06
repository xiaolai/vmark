/**
 * Footnote Insertion Tests
 *
 * Tests for insertFootnoteAndOpenPopup including:
 * - Inserting reference + renumbering
 * - Finding nearest reference
 * - Opening popup via store
 * - Edge cases: missing node types, empty doc
 */

import { bindHostPopups } from "@/plugins/shared/hostPopups";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOpenPopup = vi.fn();

// Opening the footnote editor is asked of the HOST now (ADR-015): the toolbar
// action lives in another plugin, so routing it through an extension option
// would move the coupling rather than remove it.
bindHostPopups({ openFootnotePopup: (r) => mockOpenPopup(r) });

// Mock createRenumberTransaction and getDefinitionInfo
const mockCreateRenumberTransaction = vi.fn();
const mockGetDefinitionInfo = vi.fn();
vi.mock("./tiptapCleanup", () => ({
  createRenumberTransaction: (...args: unknown[]) => mockCreateRenumberTransaction(...args),
  getDefinitionInfo: (...args: unknown[]) => mockGetDefinitionInfo(...args),
}));

import { insertFootnoteAndOpenPopup } from "./tiptapInsertFootnote";

function createMockEditor(options: {
  hasRefType?: boolean;
  hasDefType?: boolean;
  selectionTo?: number;
} = {}) {
  const { hasRefType = true, hasDefType = true, selectionTo = 5 } = options;

  const refCreate = vi.fn((attrs: Record<string, unknown>) => ({
    type: { name: "footnote_reference" },
    attrs,
  }));
  const defCreate = vi.fn();

  const schema = {
    nodes: {
      footnote_reference: hasRefType ? { create: refCreate } : undefined,
      footnote_definition: hasDefType ? { create: defCreate } : undefined,
    },
  };

  const insertFn = vi.fn().mockReturnThis();
  const tr = { insert: insertFn };

  const state = {
    schema,
    selection: { to: selectionTo },
    tr,
  };

  const dispatchFn = vi.fn();

  // After dispatch, view.state should be updated for the second read
  const postDispatchDoc = {
    descendants: vi.fn((callback: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => boolean | void) => {
      // Simulate a doc with a footnote_reference at position near selectionTo
      callback(
        { type: { name: "footnote_reference" }, attrs: { label: "1" } },
        selectionTo
      );
    }),
  };

  const postDispatchState = {
    ...state,
    doc: postDispatchDoc,
  };

  // Track dispatch calls to swap state
  let dispatchCallCount = 0;
  const view = {
    state,
    dispatch: vi.fn(() => {
      dispatchCallCount++;
      // After first dispatch (insert), update view.state
      if (dispatchCallCount === 1) {
        view.state = postDispatchState as typeof view.state;
      }
    }),
    dom: {
      querySelector: vi.fn(() => null),
    },
  };

  return {
    editor: { state, view } as unknown as Parameters<typeof insertFootnoteAndOpenPopup>[0],
    view,
    refCreate,
    dispatchFn,
  };
}

describe("insertFootnoteAndOpenPopup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRenumberTransaction.mockReturnValue(null);
    mockGetDefinitionInfo.mockReturnValue([]);
  });

  it("does nothing when footnote_reference type is missing", () => {
    const { editor, view } = createMockEditor({ hasRefType: false });
    insertFootnoteAndOpenPopup(editor);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when footnote_definition type is missing", () => {
    const { editor, view } = createMockEditor({ hasDefType: false });
    insertFootnoteAndOpenPopup(editor);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("inserts a reference with _new_ label at selection position", () => {
    const { editor, view, refCreate } = createMockEditor();
    insertFootnoteAndOpenPopup(editor);

    expect(refCreate).toHaveBeenCalledWith({ label: "_new_" });
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("dispatches renumber transaction when one is created", () => {
    const mockTr = { docChanged: true };
    mockCreateRenumberTransaction.mockReturnValue(mockTr);

    const { editor, view } = createMockEditor();
    insertFootnoteAndOpenPopup(editor);

    // First dispatch: insert, second dispatch: renumber
    expect(view.dispatch).toHaveBeenCalledTimes(2);
    expect(view.dispatch).toHaveBeenLastCalledWith(mockTr);
  });

  it("skips renumber dispatch when createRenumberTransaction returns null", () => {
    mockCreateRenumberTransaction.mockReturnValue(null);

    const { editor, view } = createMockEditor();
    insertFootnoteAndOpenPopup(editor);

    // Only the insert dispatch
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  it("calls getDefinitionInfo to find definition position", () => {
    mockGetDefinitionInfo.mockReturnValue([{ label: "1", pos: 20, size: 10 }]);

    const { editor } = createMockEditor();
    insertFootnoteAndOpenPopup(editor);

    expect(mockGetDefinitionInfo).toHaveBeenCalled();
  });

  it("uses requestAnimationFrame to open popup after DOM update", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    mockGetDefinitionInfo.mockReturnValue([{ label: "1", pos: 20, size: 10 }]);

    const { editor } = createMockEditor();
    insertFootnoteAndOpenPopup(editor);

    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it("opens popup when ref element is found in DOM", () => {
    const mockRect = { top: 100, left: 200, width: 20, height: 16 };
    const mockRefEl = {
      getBoundingClientRect: () => mockRect,
    };

    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    mockGetDefinitionInfo.mockReturnValue([{ label: "1", pos: 20, size: 10 }]);

    const { editor, view } = createMockEditor();
    view.dom.querySelector = vi.fn(() => mockRefEl);

    insertFootnoteAndOpenPopup(editor);

    expect(mockOpenPopup).toHaveBeenCalledWith({
      label: "1",
      content: "",
      anchorRect: mockRect,
      definitionPos: 20,
      referencePos: 5,
      autoFocus: true,
    });

    rafSpy.mockRestore();
  });

  it("returns early when findNearestReference returns null (no refs in doc after insert)", () => {
    // Post-dispatch doc has no footnote_reference nodes
    const { editor, view } = createMockEditor();

    // Override post-dispatch doc descendants to return no refs
    const postDoc = {
      descendants: vi.fn((_callback: unknown) => {
        // Don't call callback with any footnote_reference
      }),
    };

    let dispatchCount = 0;
    view.dispatch = vi.fn(() => {
      dispatchCount++;
      if (dispatchCount === 1) {
        (view as unknown as { state: { doc: unknown } }).state = {
          ...view.state,
          doc: postDoc,
        };
      }
    });

    insertFootnoteAndOpenPopup(editor);
    // openPopup should NOT be called since ref is null
    expect(mockOpenPopup).not.toHaveBeenCalled();
  });

  it("returns early when nearest ref has empty label (line 52 guard)", () => {
    const { editor, view } = createMockEditor();

    // Post-dispatch doc has a ref with empty label
    const postDoc = {
      descendants: vi.fn((callback: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => boolean | void) => {
        callback(
          { type: { name: "footnote_reference" }, attrs: { label: "" } },
          5
        );
      }),
    };

    let dispatchCount = 0;
    view.dispatch = vi.fn(() => {
      dispatchCount++;
      if (dispatchCount === 1) {
        (view as unknown as { state: { doc: unknown } }).state = {
          ...view.state,
          doc: postDoc,
        };
      }
    });

    insertFootnoteAndOpenPopup(editor);
    expect(mockOpenPopup).not.toHaveBeenCalled();
  });

  it("findNearestReference picks the closest ref among multiple (lines 22-27)", () => {
    const { editor, view } = createMockEditor({ selectionTo: 10 });

    // Post-dispatch doc has multiple refs — the one closest to insertPos should win
    const postDoc = {
      descendants: vi.fn((callback: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => boolean | void) => {
        // First ref far away
        callback(
          { type: { name: "footnote_reference" }, attrs: { label: "1" } },
          1
        );
        // Second ref closer to insertPos (10)
        callback(
          { type: { name: "footnote_reference" }, attrs: { label: "2" } },
          9
        );
        // Third ref slightly farther
        callback(
          { type: { name: "footnote_reference" }, attrs: { label: "3" } },
          15
        );
      }),
    };

    mockGetDefinitionInfo.mockReturnValue([{ label: "2", pos: 30, size: 10 }]);

    let dispatchCount = 0;
    view.dispatch = vi.fn(() => {
      dispatchCount++;
      if (dispatchCount === 1) {
        (view as unknown as { state: { doc: unknown } }).state = {
          ...view.state,
          doc: postDoc,
        };
      }
    });

    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    const mockRefEl = { getBoundingClientRect: () => ({ top: 100, left: 200, width: 20, height: 16 }) };
    view.dom.querySelector = vi.fn(() => mockRefEl);

    insertFootnoteAndOpenPopup(editor);

    // Should pick label "2" as closest
    expect(mockOpenPopup).toHaveBeenCalledWith({
      label: "2",
      content: "",
      anchorRect: expect.anything(),
      definitionPos: 30,
      referencePos: 9,
      autoFocus: true,
    });
    rafSpy.mockRestore();
  });

  it("findNearestReference skips non-footnote_reference nodes (line 22 early return)", () => {
    const { editor, view } = createMockEditor({ selectionTo: 5 });

    // Post-dispatch doc has a mix of node types — findNearestReference should skip non-refs
    const postDoc = {
      descendants: vi.fn((callback: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => boolean | void) => {
        // Non-footnote node — should be skipped (line 22)
        callback(
          { type: { name: "paragraph" }, attrs: {} },
          1
        );
        // Another non-footnote node
        callback(
          { type: { name: "text" }, attrs: {} },
          3
        );
        // Actual footnote reference
        callback(
          { type: { name: "footnote_reference" }, attrs: { label: "2" } },
          5
        );
      }),
    };

    mockGetDefinitionInfo.mockReturnValue([{ label: "2", pos: 20, size: 10 }]);

    let dispatchCount = 0;
    view.dispatch = vi.fn(() => {
      dispatchCount++;
      if (dispatchCount === 1) {
        (view as unknown as { state: { doc: unknown } }).state = {
          ...view.state,
          doc: postDoc,
        };
      }
    });

    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    const mockRefEl = { getBoundingClientRect: () => ({ top: 100, left: 200, width: 20, height: 16 }) };
    view.dom.querySelector = vi.fn(() => mockRefEl);

    insertFootnoteAndOpenPopup(editor);

    expect(mockOpenPopup).toHaveBeenCalledWith({
      label: "2",
      content: "",
      anchorRect: expect.anything(),
      definitionPos: 20,
      referencePos: 5,
      autoFocus: true,
    });
    rafSpy.mockRestore();
  });

  it("findNearestReference handles label with null attr (line 27 nullish coalescing)", () => {
    const { editor, view } = createMockEditor({ selectionTo: 5 });

    const postDoc = {
      descendants: vi.fn((callback: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => boolean | void) => {
        // Footnote reference with null label — coalesces to ""
        callback(
          { type: { name: "footnote_reference" }, attrs: { label: null } },
          5
        );
      }),
    };

    let dispatchCount = 0;
    view.dispatch = vi.fn(() => {
      dispatchCount++;
      if (dispatchCount === 1) {
        (view as unknown as { state: { doc: unknown } }).state = {
          ...view.state,
          doc: postDoc,
        };
      }
    });

    insertFootnoteAndOpenPopup(editor);
    // Empty label should trigger the ref?.label guard (falsy) on line 52
    expect(mockOpenPopup).not.toHaveBeenCalled();
  });

  it("handles defPos as null when no matching definition found (line 54)", () => {
    mockGetDefinitionInfo.mockReturnValue([]); // No matching defs

    const { editor, view } = createMockEditor();

    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    const mockRefEl = { getBoundingClientRect: () => ({ top: 100, left: 200, width: 20, height: 16 }) };
    view.dom.querySelector = vi.fn(() => mockRefEl);

    insertFootnoteAndOpenPopup(editor);

    // defPos should be null (no matching definition)
    expect(mockOpenPopup).toHaveBeenCalledWith({
      label: "1",
      content: "",
      anchorRect: expect.anything(),
      definitionPos: null,
      referencePos: 5,
      autoFocus: true,
    });
    rafSpy.mockRestore();
  });

  it("does not open popup when ref element is not found in DOM", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    mockGetDefinitionInfo.mockReturnValue([{ label: "1", pos: 20, size: 10 }]);

    const { editor, view } = createMockEditor();
    view.dom.querySelector = vi.fn(() => null);

    insertFootnoteAndOpenPopup(editor);

    expect(mockOpenPopup).not.toHaveBeenCalled();

    rafSpy.mockRestore();
  });
});
