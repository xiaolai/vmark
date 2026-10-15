// @vitest-environment node
/**
 * Caret restore without moving the viewport (#1556): a tab switch puts the
 * caret back AND restores the reader's scroll, so the caret restore must not
 * scroll on its own. Every dispatch branch, both editors, both settings.
 */
import { describe, expect, it, vi } from "vitest";
import { EditorState as CMState } from "@codemirror/state";
import type { CursorInfo } from "@/types/cursorSync";
import { restoreCursorInCodeMirror } from "./codemirror";
import { restoreCursorInTiptap } from "./tiptap";
import { codeBlock, createMockView, createState, para, schema, table } from "./__tests__/tiptapFixtures";

function info(overrides: Partial<CursorInfo>): CursorInfo {
  return {
    sourceLine: 1,
    wordAtCursor: "",
    offsetInWord: 0,
    nodeType: "paragraph",
    percentInLine: 0,
    contextBefore: "",
    contextAfter: "",
    ...overrides,
  };
}

/** Every WYSIWYG branch that dispatches a caret: generic, code block, table. */
const tiptapCases = [
  {
    name: "a paragraph",
    doc: () => schema.node("doc", null, [para("阅读 position", 1), para("second", 2)]),
    at: 14, // start of "second"
    cursor: info({ sourceLine: 2, wordAtCursor: "second" }),
  },
  {
    name: "a code block",
    doc: () => schema.node("doc", null, [codeBlock("a\nb", 1)]),
    at: 3, // line "b": the code-block anchor, not the generic line lookup
    cursor: info({ nodeType: "code_block", blockAnchor: { kind: "code", lineInBlock: 1, columnInLine: 0 } }),
  },
  {
    name: "a table cell",
    doc: () => schema.node("doc", null, [table([["h1", "h2"], ["中", "文"]], 1)]),
    at: 23, // the "文" cell: the table anchor
    cursor: info({ nodeType: "table_cell", blockAnchor: { kind: "table", row: 1, col: 1, offsetInCell: 0 } }),
  },
] as const;

describe("restoreCursorInTiptap scrollIntoView", () => {
  for (const { name, doc, at, cursor } of tiptapCases) {
    it(`places the caret in ${name} without scrolling when told not to`, () => {
      const view = createMockView(createState(doc()));
      restoreCursorInTiptap(view as never, cursor, false);

      expect(view._dispatched).toHaveLength(1);
      expect(view._dispatched[0].selection.from).toBe(at);
      expect(view._dispatched[0].scrolledIntoView).toBe(false);
    });

    it(`scrolls the caret in ${name} into view by default`, () => {
      const view = createMockView(createState(doc()));
      restoreCursorInTiptap(view as never, cursor);

      expect(view._dispatched).toHaveLength(1);
      expect(view._dispatched[0].scrolledIntoView).toBe(true);
    });
  }
});

/** Every Source branch that dispatches a caret: generic, code block, table. */
const sourceCases = [
  { name: "a paragraph", doc: "阅读\nsecond", at: 3, cursor: info({ sourceLine: 2, wordAtCursor: "second" }) },
  {
    name: "a code block",
    doc: "```\na\nb\n```",
    at: 6, // line "b": the code-block anchor, not the generic line lookup
    cursor: info({ sourceLine: 1, nodeType: "code_block", blockAnchor: { kind: "code", lineInBlock: 1, columnInLine: 0 } }),
  },
  {
    name: "a table row",
    doc: "| h1 | h2 |\n| --- | --- |\n| 中 | 文 |",
    at: 32, // the "文" cell: the table anchor, not the generic line lookup
    cursor: info({ sourceLine: 3, nodeType: "table_cell", blockAnchor: { kind: "table", row: 1, col: 1, offsetInCell: 0 } }),
  },
] as const;

function cmView(doc: string) {
  return { state: CMState.create({ doc }), dispatch: vi.fn() };
}

describe("restoreCursorInCodeMirror scrollIntoView", () => {
  for (const { name, doc, at, cursor } of sourceCases) {
    it(`places the caret in ${name} without scrolling when told not to`, () => {
      const view = cmView(doc);
      restoreCursorInCodeMirror(view as never, cursor, false);

      expect(view.dispatch).toHaveBeenCalledTimes(1);
      expect(view.dispatch.mock.calls[0][0]).toEqual({ selection: { anchor: at }, scrollIntoView: false });
    });

    it(`scrolls the caret in ${name} into view by default`, () => {
      const view = cmView(doc);
      restoreCursorInCodeMirror(view as never, cursor);

      expect(view.dispatch.mock.calls[0][0]).toMatchObject({ scrollIntoView: true });
    });
  }
});
