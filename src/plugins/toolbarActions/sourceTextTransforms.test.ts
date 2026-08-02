import { vi, describe, it, expect } from "vitest";

vi.mock("@/utils/textTransformations", async () => {
  const actual = await vi.importActual<typeof import("@/utils/textTransformations")>(
    "@/utils/textTransformations"
  );
  return {
    ...actual,
    moveLinesUp: vi.fn((text: string, from: number, to: number) => {
      const lines = text.split("\n");
      const startLine = text.slice(0, from).split("\n").length - 1;
      const endLine = text.slice(0, to).split("\n").length - 1;
      if (startLine === 0) return null;
      const moved = [...lines];
      const target = moved.splice(startLine, endLine - startLine + 1);
      moved.splice(startLine - 1, 0, ...target);
      const newText = moved.join("\n");
      return { newText, newFrom: from - lines[startLine - 1].length - 1, newTo: to - lines[startLine - 1].length - 1 };
    }),
    moveLinesDown: vi.fn((text: string, from: number, to: number) => {
      const lines = text.split("\n");
      const startLine = text.slice(0, from).split("\n").length - 1;
      const endLine = text.slice(0, to).split("\n").length - 1;
      if (endLine >= lines.length - 1) return null;
      const moved = [...lines];
      const target = moved.splice(startLine, endLine - startLine + 1);
      moved.splice(startLine + 1, 0, ...target);
      const newText = moved.join("\n");
      return { newText, newFrom: from + lines[endLine + 1].length + 1, newTo: to + lines[endLine + 1].length + 1 };
    }),
    duplicateLines: vi.fn((text: string, from: number, to: number) => {
      const lines = text.split("\n");
      const startLine = text.slice(0, from).split("\n").length - 1;
      const endLine = text.slice(0, to).split("\n").length - 1;
      const dup = lines.slice(startLine, endLine + 1);
      const result = [...lines];
      result.splice(endLine + 1, 0, ...dup);
      const newText = result.join("\n");
      const offset = dup.join("\n").length + 1;
      return { newText, newFrom: from + offset, newTo: to + offset };
    }),
    deleteLines: vi.fn((text: string, from: number, to: number) => {
      const lines = text.split("\n");
      const startLine = text.slice(0, from).split("\n").length - 1;
      const endLine = text.slice(0, to).split("\n").length - 1;
      const result = [...lines];
      result.splice(startLine, endLine - startLine + 1);
      const newText = result.join("\n");
      return { newText, newCursor: Math.min(from, newText.length) };
    }),
    joinLines: vi.fn((text: string, from: number, to: number) => {
      const lines = text.split("\n");
      const startLine = text.slice(0, from).split("\n").length - 1;
      const endLine = text.slice(0, to).split("\n").length - 1;
      const joined = lines.slice(startLine, endLine + 1).join(" ");
      const result = [...lines.slice(0, startLine), joined, ...lines.slice(endLine + 1)];
      const newText = result.join("\n");
      return { newText, newFrom: from, newTo: from + joined.length };
    }),
    sortLinesAscending: vi.fn((text: string, from: number, to: number) => {
      const selected = text.slice(from, to);
      const sorted = selected.split("\n").sort().join("\n");
      const newText = text.slice(0, from) + sorted + text.slice(to);
      return { newText, newFrom: from, newTo: from + sorted.length };
    }),
    sortLinesDescending: vi.fn((text: string, from: number, to: number) => {
      const selected = text.slice(from, to);
      const sorted = selected.split("\n").sort().reverse().join("\n");
      const newText = text.slice(0, from) + sorted + text.slice(to);
      return { newText, newFrom: from, newTo: from + sorted.length };
    }),
    removeBlankLines: vi.fn((text: string) =>
      text.split("\n").filter((l: string) => l.trim() !== "").join("\n")
    ),
  };
});

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  handleMoveLineUp,
  handleMoveLineDown,
  handleDuplicateLine,
  handleDeleteLine,
  handleJoinLines,
  handleSortLinesAsc,
  handleSortLinesDesc,
  handleRemoveBlankLines,
  handleTransformCase,
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toggleCase,
} from "./sourceTextTransforms";

function createView(doc: string, from: number, to?: number): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to ?? from),
  });
  return new EditorView({ state, parent });
}

describe("handleMoveLineUp", () => {
  it("moves current line up", () => {
    const view = createView("first\nsecond\nthird", 8);
    const result = handleMoveLineUp(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("second\nfirst\nthird");
    view.destroy();
  });

  it("returns false when already on first line", () => {
    const view = createView("first\nsecond", 2);
    const result = handleMoveLineUp(view);
    expect(result).toBe(false);
    expect(view.state.doc.toString()).toBe("first\nsecond");
    view.destroy();
  });

  it("handles single-line document", () => {
    const view = createView("only", 2);
    const result = handleMoveLineUp(view);
    expect(result).toBe(false);
    view.destroy();
  });
});

describe("handleMoveLineDown", () => {
  it("moves current line down", () => {
    const view = createView("first\nsecond\nthird", 2);
    const result = handleMoveLineDown(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("second\nfirst\nthird");
    view.destroy();
  });

  it("returns false when already on last line", () => {
    const view = createView("first\nsecond", 8);
    const result = handleMoveLineDown(view);
    expect(result).toBe(false);
    expect(view.state.doc.toString()).toBe("first\nsecond");
    view.destroy();
  });

  it("handles single-line document", () => {
    const view = createView("only", 2);
    const result = handleMoveLineDown(view);
    expect(result).toBe(false);
    view.destroy();
  });
});

describe("handleDuplicateLine", () => {
  // A plain paragraph line gets an explicit hard break between the copies: a
  // bare newline is a SOFT break and renders as one continued line, so the
  // duplicate would be invisible.
  it("duplicates a paragraph line with a hard break", () => {
    const view = createView("first\nsecond", 2);
    const result = handleDuplicateLine(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("first\\\nfirst\nsecond");
    view.destroy();
  });

  it.each([
    { name: "list item", doc: "- item\n- other", at: 2, expected: "- item\n- item\n- other" },
    { name: "heading", doc: "# Title\ntext", at: 3, expected: "# Title\n# Title\ntext" },
    { name: "table row", doc: "| a |\n| b |", at: 2, expected: "| a |\n| a |\n| b |" },
  ])("duplicates a $name as a sibling, with no break marker", ({ doc, at, expected }) => {
    const view = createView(doc, at);
    handleDuplicateLine(view);
    expect(view.state.doc.toString()).toBe(expected);
    view.destroy();
  });

  it("duplicates line in single-line document", () => {
    const view = createView("hello", 2);
    const result = handleDuplicateLine(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello\\\nhello");
    view.destroy();
  });

  it("duplicates last line", () => {
    const view = createView("first\nlast", 8);
    const result = handleDuplicateLine(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("first\nlast\\\nlast");
    view.destroy();
  });
});

describe("handleDeleteLine", () => {
  it("deletes current line", () => {
    const view = createView("first\nsecond\nthird", 8);
    const result = handleDeleteLine(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("first\nthird");
    view.destroy();
  });

  it("deletes first line", () => {
    const view = createView("first\nsecond", 2);
    const result = handleDeleteLine(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("second");
    view.destroy();
  });

  it("deletes last remaining line", () => {
    const view = createView("only", 2);
    const result = handleDeleteLine(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });
});

describe("handleJoinLines", () => {
  it("joins selected lines with spaces", () => {
    const view = createView("line1\nline2\nline3", 0, 17);
    const result = handleJoinLines(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("line1 line2 line3");
    view.destroy();
  });

  it("joins two lines", () => {
    const view = createView("hello\nworld", 0, 11);
    const result = handleJoinLines(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello world");
    view.destroy();
  });
});

describe("handleSortLinesAsc", () => {
  it("sorts selected lines in ascending order", () => {
    const view = createView("cherry\napple\nbanana", 0, 19);
    const result = handleSortLinesAsc(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("apple\nbanana\ncherry");
    view.destroy();
  });

  it("handles already sorted lines", () => {
    const view = createView("a\nb\nc", 0, 5);
    const result = handleSortLinesAsc(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("a\nb\nc");
    view.destroy();
  });
});

describe("handleSortLinesDesc", () => {
  it("sorts selected lines in descending order", () => {
    const view = createView("apple\nbanana\ncherry", 0, 19);
    const result = handleSortLinesDesc(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("cherry\nbanana\napple");
    view.destroy();
  });
});

describe("handleRemoveBlankLines", () => {
  it("removes blank lines from selection", () => {
    const view = createView("line1\n\nline2\n\nline3", 0, 19);
    const result = handleRemoveBlankLines(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("line1\nline2\nline3");
    view.destroy();
  });

  it("returns false when no selection", () => {
    const view = createView("line1\n\nline2", 3);
    const result = handleRemoveBlankLines(view);
    expect(result).toBe(false);
    view.destroy();
  });

  it("does nothing when no blank lines in selection", () => {
    const view = createView("line1\nline2", 0, 11);
    const result = handleRemoveBlankLines(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("line1\nline2");
    view.destroy();
  });

  it("preserves selection range after removal", () => {
    const view = createView("a\n\nb", 0, 4);
    handleRemoveBlankLines(view);
    const sel = view.state.selection.main;
    expect(sel.from).toBe(0);
    expect(sel.to).toBe(3); // "a\nb" = 3 chars
    view.destroy();
  });
});

describe("handleTransformCase", () => {
  it("transforms selected text to uppercase", () => {
    const view = createView("hello world", 0, 5);
    const result = handleTransformCase(view, (t) => t.toUpperCase());
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("HELLO world");
    view.destroy();
  });

  it("returns false when no selection", () => {
    const view = createView("hello", 3);
    const result = handleTransformCase(view, (t) => t.toUpperCase());
    expect(result).toBe(false);
    view.destroy();
  });

  it("does nothing when transform produces same text", () => {
    const view = createView("HELLO", 0, 5);
    const result = handleTransformCase(view, (t) => t.toUpperCase());
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("HELLO");
    view.destroy();
  });

  it("transforms to lowercase", () => {
    const view = createView("HELLO world", 0, 5);
    const result = handleTransformCase(view, (t) => t.toLowerCase());
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello world");
    view.destroy();
  });

  it("preserves selection after transform", () => {
    const view = createView("hello world", 0, 5);
    handleTransformCase(view, (t) => t.toUpperCase());
    const sel = view.state.selection.main;
    expect(sel.from).toBe(0);
    expect(sel.to).toBe(5);
    view.destroy();
  });

  it("handles multi-line selection", () => {
    const view = createView("hello\nworld", 0, 11);
    const result = handleTransformCase(view, (t) => t.toUpperCase());
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("HELLO\nWORLD");
    view.destroy();
  });
});

describe("re-exported transform functions", () => {
  it("exports toUpperCase", () => {
    expect(toUpperCase).toBeDefined();
  });

  it("exports toLowerCase", () => {
    expect(toLowerCase).toBeDefined();
  });

  it("exports toTitleCase", () => {
    expect(toTitleCase).toBeDefined();
  });

  it("exports toggleCase", () => {
    expect(toggleCase).toBeDefined();
  });
});
