// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  isMultiSelection,
  isSelectionInCodeBlock,
  isSelectionInCode,
  isViewSelectionInCodeBlock,
  isViewSelectionInCode,
  isViewMultiSelection,
} from "./pasteUtils";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Mock EditorState factory
function createMockState(options: {
  rangeCount?: number;
  fromDepth?: number;
  toDepth?: number;
  fromNodeTypes?: string[];
  toNodeTypes?: string[];
  hasCodeBlock?: boolean;
  hasCodeMark?: boolean;
  fromMarks?: { type: { name: string } }[];
  toMarks?: { type: { name: string } }[];
  storedMarks?: { type: { name: string } }[] | null;
}): EditorState {
  const {
    rangeCount = 1,
    fromDepth = 1,
    toDepth = 1,
    fromNodeTypes = ["paragraph"],
    toNodeTypes = ["paragraph"],
    hasCodeBlock = true,
    hasCodeMark = true,
    fromMarks = [],
    toMarks = [],
    storedMarks = null,
  } = options;

  const codeBlockType = hasCodeBlock ? { name: "codeBlock" } : null;
  const codeMark = hasCodeMark
    ? {
        name: "code",
        isInSet: (marks: { type: { name: string } }[]) =>
          marks.some((m) => m.type.name === "code"),
      }
    : null;

  return {
    selection: {
      ranges: Array(rangeCount).fill({}),
      $from: {
        depth: fromDepth,
        node: (depth: number) => ({
          type: fromNodeTypes[fromDepth - depth] === "codeBlock" ? codeBlockType : { name: fromNodeTypes[fromDepth - depth] || "paragraph" },
        }),
        marks: () => fromMarks,
      },
      $to: {
        depth: toDepth,
        node: (depth: number) => ({
          type: toNodeTypes[toDepth - depth] === "codeBlock" ? codeBlockType : { name: toNodeTypes[toDepth - depth] || "paragraph" },
        }),
        marks: () => toMarks,
      },
    },
    schema: {
      nodes: {
        codeBlock: codeBlockType,
      },
      marks: {
        code: codeMark,
      },
    },
    storedMarks,
  } as unknown as EditorState;
}

// Mock EditorView factory
function createMockView(state: EditorState): EditorView {
  return { state } as unknown as EditorView;
}

describe("isMultiSelection", () => {
  it("returns false for single selection", () => {
    const state = createMockState({ rangeCount: 1 });
    expect(isMultiSelection(state)).toBe(false);
  });

  it("returns true for multiple selections", () => {
    const state = createMockState({ rangeCount: 2 });
    expect(isMultiSelection(state)).toBe(true);
  });

  it("returns true for many selections", () => {
    const state = createMockState({ rangeCount: 5 });
    expect(isMultiSelection(state)).toBe(true);
  });
});

describe("isSelectionInCodeBlock", () => {
  it("returns false when codeBlock node type does not exist", () => {
    const state = createMockState({ hasCodeBlock: false });
    expect(isSelectionInCodeBlock(state)).toBe(false);
  });

  it("returns false when selection is in a paragraph", () => {
    const state = createMockState({
      fromDepth: 1,
      toDepth: 1,
      fromNodeTypes: ["paragraph"],
      toNodeTypes: ["paragraph"],
    });
    expect(isSelectionInCodeBlock(state)).toBe(false);
  });

  it("returns true when $from is inside a code block", () => {
    const state = createMockState({
      fromDepth: 2,
      toDepth: 1,
      fromNodeTypes: ["codeBlock", "text"],
      toNodeTypes: ["paragraph"],
    });
    expect(isSelectionInCodeBlock(state)).toBe(true);
  });

  it("returns true when $to is inside a code block", () => {
    const state = createMockState({
      fromDepth: 1,
      toDepth: 2,
      fromNodeTypes: ["paragraph"],
      toNodeTypes: ["codeBlock", "text"],
    });
    expect(isSelectionInCodeBlock(state)).toBe(true);
  });

  it("returns true when both $from and $to are in code block", () => {
    const state = createMockState({
      fromDepth: 2,
      toDepth: 2,
      fromNodeTypes: ["codeBlock", "text"],
      toNodeTypes: ["codeBlock", "text"],
    });
    expect(isSelectionInCodeBlock(state)).toBe(true);
  });
});

describe("isSelectionInCode", () => {
  it("returns true when in code block", () => {
    const state = createMockState({
      fromDepth: 2,
      fromNodeTypes: ["codeBlock", "text"],
    });
    expect(isSelectionInCode(state)).toBe(true);
  });

  it("returns false when code mark does not exist", () => {
    const state = createMockState({
      hasCodeMark: false,
      fromDepth: 1,
      fromNodeTypes: ["paragraph"],
    });
    expect(isSelectionInCode(state)).toBe(false);
  });

  it("returns true when $from has code mark", () => {
    const state = createMockState({
      fromMarks: [{ type: { name: "code" } }],
    });
    expect(isSelectionInCode(state)).toBe(true);
  });

  it("returns true when $to has code mark", () => {
    const state = createMockState({
      toMarks: [{ type: { name: "code" } }],
    });
    expect(isSelectionInCode(state)).toBe(true);
  });

  it("returns true when storedMarks has code mark", () => {
    const state = createMockState({
      storedMarks: [{ type: { name: "code" } }],
    });
    expect(isSelectionInCode(state)).toBe(true);
  });

  it("returns false when no code marks or code block", () => {
    const state = createMockState({
      fromMarks: [{ type: { name: "bold" } }],
      toMarks: [{ type: { name: "italic" } }],
      storedMarks: [{ type: { name: "link" } }],
    });
    expect(isSelectionInCode(state)).toBe(false);
  });
});

describe("view wrapper functions", () => {
  it("isViewSelectionInCodeBlock delegates to isSelectionInCodeBlock", () => {
    const state = createMockState({
      fromDepth: 2,
      fromNodeTypes: ["codeBlock", "text"],
    });
    const view = createMockView(state);
    expect(isViewSelectionInCodeBlock(view)).toBe(true);
  });

  it("isViewSelectionInCode delegates to isSelectionInCode", () => {
    const state = createMockState({
      fromMarks: [{ type: { name: "code" } }],
    });
    const view = createMockView(state);
    expect(isViewSelectionInCode(view)).toBe(true);
  });

  it("isViewMultiSelection delegates to isMultiSelection", () => {
    const state = createMockState({ rangeCount: 3 });
    const view = createMockView(state);
    expect(isViewMultiSelection(view)).toBe(true);
  });
});
