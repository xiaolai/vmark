// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tiptap/pm/state", () => ({
  Selection: {
    near: vi.fn((resolved) => ({ type: "near", resolved })),
  },
}));

import {
  handleWysiwygMoveBlockUp,
  handleWysiwygMoveBlockDown,
  handleWysiwygDuplicateBlock,
  handleWysiwygDeleteBlock,
  handleWysiwygJoinBlocks,
  handleWysiwygRemoveBlankLines,
} from "./wysiwygAdapterBlockOps";
import { Selection } from "@tiptap/pm/state";
import type { WysiwygToolbarContext } from "./types";

/** Create a mock resolved position at a given depth with configurable parent. */
function createMockResolved(opts: {
  depth: number;
  blockIndex: number;
  parentChildCount: number;
  children?: Array<{ nodeSize: number; textContent?: string; isBlock?: boolean; isTextblock?: boolean }>;
}) {
  const children = opts.children ?? [
    { nodeSize: 10, textContent: "prev" },
    { nodeSize: 12, textContent: "current" },
    { nodeSize: 8, textContent: "next" },
  ];

  const parent = {
    childCount: opts.parentChildCount,
    // The container above the line unit. `doc` is deliberately NOT one of the
    // wrappers `lineUnitDepth` climbs through, so the resolved line unit stays
    // at `opts.depth` and these tests keep exercising the same code path.
    type: { name: "doc" },
    isTextblock: false,
    child: vi.fn((i: number) => {
      const c = children[i] ?? children[0];
      return {
        nodeSize: c.nodeSize,
        type: { name: "paragraph" },
        textContent: c.textContent ?? "",
        isBlock: c.isBlock ?? false,
        isTextblock: c.isTextblock ?? true,
        content: "mock-content",
        copy: vi.fn(() => ({ nodeSize: c.nodeSize, content: "mock-content" })),
      };
    }),
  };

  // The line unit itself — `lineUnitDepth` walks up from `$from.depth` looking
  // for the innermost textblock, so the node AT that depth must report as one.
  const lineUnit = { type: { name: "paragraph" }, isTextblock: true, childCount: 1 };

  return {
    depth: opts.depth,
    pos: 15,
    index: vi.fn(() => opts.blockIndex),
    node: vi.fn((d: number) => (d === opts.depth ? lineUnit : parent)),
    before: vi.fn(() => 10),
    after: vi.fn(() => 22),
    start: vi.fn(() => 11),
    // `textblockLineAt` inspects the cursor's parent for hardBreak children;
    // a non-textblock parent makes it bow out so these mocks keep exercising
    // the block-level paths.
    parent: { isTextblock: false },
  };
}

function createMockTr() {
  return {
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    setSelection: vi.fn().mockReturnThis(),
    doc: {
      resolve: vi.fn(() => ({})),
      content: { size: 50 },
    },
    mapping: {
      map: vi.fn((pos: number) => pos),
    },
  };
}

/** Schema stub with no `hardBreak`, so duplication takes the structural-unit
 *  path; the textblock/hard-break path is covered by the parity harness. */
const MOCK_SCHEMA = { nodes: {} };

function createContext(overrides?: Partial<WysiwygToolbarContext>): WysiwygToolbarContext {
  const tr = createMockTr();
  const $from = createMockResolved({ depth: 1, blockIndex: 1, parentChildCount: 3 });
  const dispatch = vi.fn();
  const focus = vi.fn();

  return {
    surface: "wysiwyg",
    view: {
      state: {
        selection: { $from, from: 10, to: 22, empty: false },
        tr,
        schema: MOCK_SCHEMA,
        doc: {
          nodesBetween: vi.fn(),
          content: { size: 50 },
        },
      },
      dispatch,
    } as never,
    editor: {
      commands: { focus, joinBackward: vi.fn(() => true) },
    } as never,
    context: null,
    ...overrides,
  };
}

describe("handleWysiwygMoveBlockUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const ctx = createContext({ view: null });
    expect(handleWysiwygMoveBlockUp(ctx)).toBe(false);
  });

  it("returns false when editor is null", () => {
    const ctx = createContext({ editor: null });
    expect(handleWysiwygMoveBlockUp(ctx)).toBe(false);
  });

  it("returns false when depth is 0", () => {
    const ctx = createContext();
    const $from = createMockResolved({ depth: 0, blockIndex: 0, parentChildCount: 1 });
    (ctx.view!.state as { selection: { $from: typeof $from } }).selection.$from = $from;
    expect(handleWysiwygMoveBlockUp(ctx)).toBe(false);
  });

  it("returns false when block is already at top (index 0)", () => {
    const ctx = createContext();
    const $from = createMockResolved({ depth: 1, blockIndex: 0, parentChildCount: 3 });
    (ctx.view!.state as { selection: { $from: typeof $from } }).selection.$from = $from;
    expect(handleWysiwygMoveBlockUp(ctx)).toBe(false);
  });

  it("moves block up, dispatches, and focuses", () => {
    const ctx = createContext();
    const result = handleWysiwygMoveBlockUp(ctx);

    expect(result).toBe(true);
    expect(ctx.view!.dispatch).toHaveBeenCalled();
    expect(ctx.editor!.commands.focus).toHaveBeenCalled();
    expect(Selection.near).toHaveBeenCalled();
  });
});

describe("handleWysiwygMoveBlockDown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    expect(handleWysiwygMoveBlockDown(createContext({ view: null }))).toBe(false);
  });

  it("returns false when editor is null", () => {
    expect(handleWysiwygMoveBlockDown(createContext({ editor: null }))).toBe(false);
  });

  it("returns false when depth is 0", () => {
    const ctx = createContext();
    const $from = createMockResolved({ depth: 0, blockIndex: 0, parentChildCount: 1 });
    (ctx.view!.state as { selection: { $from: typeof $from } }).selection.$from = $from;
    expect(handleWysiwygMoveBlockDown(ctx)).toBe(false);
  });

  it("returns false when block is at bottom", () => {
    const ctx = createContext();
    const $from = createMockResolved({ depth: 1, blockIndex: 2, parentChildCount: 3 });
    (ctx.view!.state as { selection: { $from: typeof $from } }).selection.$from = $from;
    expect(handleWysiwygMoveBlockDown(ctx)).toBe(false);
  });

  it("moves block down, dispatches, and focuses", () => {
    const ctx = createContext();
    const result = handleWysiwygMoveBlockDown(ctx);

    expect(result).toBe(true);
    expect(ctx.view!.dispatch).toHaveBeenCalled();
    expect(ctx.editor!.commands.focus).toHaveBeenCalled();
  });
});

describe("handleWysiwygDuplicateBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    expect(handleWysiwygDuplicateBlock(createContext({ view: null }))).toBe(false);
  });

  it("returns false when editor is null", () => {
    expect(handleWysiwygDuplicateBlock(createContext({ editor: null }))).toBe(false);
  });

  it("returns false when depth is 0", () => {
    const ctx = createContext();
    const $from = createMockResolved({ depth: 0, blockIndex: 0, parentChildCount: 1 });
    (ctx.view!.state as { selection: { $from: typeof $from } }).selection.$from = $from;
    expect(handleWysiwygDuplicateBlock(ctx)).toBe(false);
  });

  it("duplicates block, dispatches, and focuses", () => {
    const ctx = createContext();
    const result = handleWysiwygDuplicateBlock(ctx);

    expect(result).toBe(true);
    const tr = ctx.view!.state.tr;
    expect(tr.insert).toHaveBeenCalled();
    expect(ctx.view!.dispatch).toHaveBeenCalled();
    expect(ctx.editor!.commands.focus).toHaveBeenCalled();
  });
});

describe("handleWysiwygDeleteBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    expect(handleWysiwygDeleteBlock(createContext({ view: null }))).toBe(false);
  });

  it("returns false when editor is null", () => {
    expect(handleWysiwygDeleteBlock(createContext({ editor: null }))).toBe(false);
  });

  it("returns false when depth is 0", () => {
    const ctx = createContext();
    const $from = createMockResolved({ depth: 0, blockIndex: 0, parentChildCount: 1 });
    (ctx.view!.state as { selection: { $from: typeof $from } }).selection.$from = $from;
    expect(handleWysiwygDeleteBlock(ctx)).toBe(false);
  });

  it("deletes block, dispatches, and focuses", () => {
    const ctx = createContext();
    const result = handleWysiwygDeleteBlock(ctx);

    expect(result).toBe(true);
    const tr = ctx.view!.state.tr;
    expect(tr.delete).toHaveBeenCalled();
    expect(ctx.view!.dispatch).toHaveBeenCalled();
    expect(ctx.editor!.commands.focus).toHaveBeenCalled();
  });

  it("handles case where newPos is 0 (skips setSelection)", () => {
    const ctx = createContext();
    const tr = ctx.view!.state.tr;
    // Make blockStart resolve to 0 and doc.content.size to 0 after delete
    const $from = createMockResolved({ depth: 1, blockIndex: 0, parentChildCount: 1 });
    $from.before = vi.fn(() => 0);
    $from.after = vi.fn(() => 5);
    (ctx.view!.state as { selection: { $from: typeof $from } }).selection.$from = $from;
    (tr.doc.content as { size: number }).size = 0;

    const result = handleWysiwygDeleteBlock(ctx);
    expect(result).toBe(true);
    // setSelection should not be called when newPos is 0
    expect(tr.setSelection).not.toHaveBeenCalled();
  });
});

describe("handleWysiwygJoinBlocks", () => {
  it("returns false when editor is null", () => {
    const ctx = createContext({ editor: null });
    expect(handleWysiwygJoinBlocks(ctx)).toBe(false);
  });

  it("delegates to editor.commands.joinBackward", () => {
    const joinBackward = vi.fn(() => true);
    const ctx = createContext();
    (ctx.editor as { commands: { joinBackward: typeof joinBackward } }).commands.joinBackward = joinBackward;

    expect(handleWysiwygJoinBlocks(ctx)).toBe(true);
    expect(joinBackward).toHaveBeenCalled();
  });

  it("returns false when joinBackward returns false", () => {
    const joinBackward = vi.fn(() => false);
    const ctx = createContext();
    (ctx.editor as { commands: { joinBackward: typeof joinBackward } }).commands.joinBackward = joinBackward;

    expect(handleWysiwygJoinBlocks(ctx)).toBe(false);
  });
});

describe("handleWysiwygRemoveBlankLines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    expect(handleWysiwygRemoveBlankLines(createContext({ view: null }))).toBe(false);
  });

  it("returns false when editor is null", () => {
    expect(handleWysiwygRemoveBlankLines(createContext({ editor: null }))).toBe(false);
  });

  it("returns false when selection is empty", () => {
    const ctx = createContext();
    (ctx.view!.state.selection as { empty: boolean }).empty = true;
    expect(handleWysiwygRemoveBlankLines(ctx)).toBe(false);
  });

  it("returns true when no blank lines found", () => {
    const ctx = createContext();
    // nodesBetween calls callback with non-empty textblocks only
    const nodesBetween = vi.fn((_from: number, _to: number, cb: (node: Record<string, unknown>, pos: number) => boolean) => {
      cb({ isBlock: false, isTextblock: true, textContent: "has content", nodeSize: 5 }, 10);
    });
    (ctx.view!.state.doc as { nodesBetween: typeof nodesBetween }).nodesBetween = nodesBetween;

    expect(handleWysiwygRemoveBlankLines(ctx)).toBe(true);
  });

  // The deletion path itself is covered against a real document in
  // `wysiwygAdapterBlockOps.realdoc.test.ts` — a transaction mock cannot see
  // whether the replace-fitter undoes the delete, which is the whole defect.

  it("skips blank textblocks outside selection range", () => {
    const ctx = createContext();
    (ctx.view!.state.selection as { from: number; to: number }).from = 10;
    (ctx.view!.state.selection as { from: number; to: number }).to = 15;

    const tr = createMockTr();
    (ctx.view!.state as { tr: typeof tr }).tr = tr;

    const nodesBetween = vi.fn((_from: number, _to: number, cb: (node: Record<string, unknown>, pos: number) => boolean) => {
      // Empty textblock at pos 5, nodeSize 4 => ends at 9, before selection start 10
      cb({ isBlock: false, isTextblock: true, textContent: "", nodeSize: 4 }, 5);
    });
    (ctx.view!.state.doc as { nodesBetween: typeof nodesBetween }).nodesBetween = nodesBetween;

    const result = handleWysiwygRemoveBlankLines(ctx);
    // No deletions => returns true (nothing to remove)
    expect(result).toBe(true);
    expect(tr.delete).not.toHaveBeenCalled();
  });

  it("skips non-textblock container nodes (returns true to recurse)", () => {
    const ctx = createContext();
    const tr = createMockTr();
    (ctx.view!.state as { tr: typeof tr }).tr = tr;

    const nodesBetween = vi.fn((_from: number, _to: number, cb: (node: Record<string, unknown>, pos: number) => boolean) => {
      // A container block node (like a list)
      const result = cb({ isBlock: true, isTextblock: false, textContent: "", nodeSize: 20 }, 5);
      expect(result).toBe(true); // should return true to recurse into children
    });
    (ctx.view!.state.doc as { nodesBetween: typeof nodesBetween }).nodesBetween = nodesBetween;

    handleWysiwygRemoveBlankLines(ctx);
  });
});
