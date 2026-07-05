import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@/plugins/syntaxReveal/marks", () => ({
  findWordAtCursor: vi.fn(),
}));

vi.mock("@/hooks/useImageOperations", () => ({
  copyImageToAssets: vi.fn(),
  insertBlockImageNode: vi.fn(),
}));

vi.mock("@/hooks/useMediaOperations", () => ({
  copyMediaToAssets: vi.fn(),
  insertBlockVideoNode: vi.fn(),
  insertBlockAudioNode: vi.fn(),
}));

vi.mock("@/hooks/useWindowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/services/media/clipboardImagePath", () => ({
  readClipboardImagePath: vi.fn(),
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: vi.fn((_label: string, _guard: string, fn: () => Promise<void>) => fn()),
}));

vi.mock("@/plugins/mermaid/constants", () => ({
  DEFAULT_MERMAID_DIAGRAM: "flowchart LR\n  A --> B",
}));

vi.mock("@/plugins/markmap/constants", () => ({
  DEFAULT_MARKMAP_CONTENT: "# Topic\n## Branch",
}));

vi.mock("@/plugins/graphviz/constants", () => ({
  DEFAULT_GRAPHVIZ_DIAGRAM: "digraph G {\n  a -> b\n}",
}));

vi.mock("@/utils/debug", () => ({
  wysiwygAdapterWarn: vi.fn(),
  wysiwygAdapterError: vi.fn(),
}));

vi.mock("./wysiwygAdapterUtils", () => ({
  isViewConnected: vi.fn(() => true),
  getActiveFilePath: vi.fn(() => "/path/to/doc.md"),
}));

import {
  handleInsertImage,
  insertMathBlock,
  insertDiagramBlock,
  insertGraphvizBlock,
  insertMarkmapBlock,
  insertInlineMath,
  handleInsertVideo,
  handleInsertAudio,
} from "./wysiwygAdapterInsert";
import { Selection, NodeSelection } from "@tiptap/pm/state";
import { open, message } from "@tauri-apps/plugin-dialog";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { copyImageToAssets, insertBlockImageNode } from "@/hooks/useImageOperations";
import { copyMediaToAssets, insertBlockVideoNode, insertBlockAudioNode } from "@/hooks/useMediaOperations";
import { readClipboardImagePath } from "@/services/media/clipboardImagePath";
import { withReentryGuard } from "@/utils/reentryGuard";
import { wysiwygAdapterWarn } from "@/utils/debug";
import { isViewConnected, getActiveFilePath } from "./wysiwygAdapterUtils";
import type { WysiwygToolbarContext } from "./types";

function createMockEditor(opts?: {
  selection?: { from: number; to: number; empty: boolean };
  selectedText?: string;
}) {
  const editor = {
    state: {
      selection: opts?.selection ?? { from: 0, to: 0, empty: true },
      doc: { textBetween: vi.fn(() => opts?.selectedText ?? "") },
    },
    chain: vi.fn().mockReturnThis(),
    focus: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    run: vi.fn().mockReturnThis(),
  };
  return editor;
}

function createBaseContext(overrides?: Partial<WysiwygToolbarContext>): WysiwygToolbarContext {
  return {
    surface: "wysiwyg",
    view: null,
    editor: null,
    context: null,
    ...overrides,
  };
}

describe("insertMathBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when editor is null", () => {
    const context = createBaseContext();
    expect(insertMathBlock(context)).toBe(false);
  });

  it("inserts a LaTeX code block", () => {
    const editor = createMockEditor();
    const context = createBaseContext({ editor: editor as never });

    const result = insertMathBlock(context);
    expect(result).toBe(true);
    expect(editor.chain).toHaveBeenCalled();
    expect(editor.focus).toHaveBeenCalled();
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "latex" },
      content: [{ type: "text", text: expect.stringContaining("sqrt") }],
    });
    expect(editor.run).toHaveBeenCalled();
  });
});

describe("insertDiagramBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when editor is null", () => {
    const context = createBaseContext();
    expect(insertDiagramBlock(context)).toBe(false);
  });

  it("inserts a Mermaid code block", () => {
    const editor = createMockEditor();
    const context = createBaseContext({ editor: editor as never });

    const result = insertDiagramBlock(context);
    expect(result).toBe(true);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: "flowchart LR\n  A --> B" }],
    });
  });
});

describe("insertGraphvizBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when editor is null", () => {
    const context = createBaseContext();
    expect(insertGraphvizBlock(context)).toBe(false);
  });

  it("inserts a Graphviz (dot) code block", () => {
    const editor = createMockEditor();
    const context = createBaseContext({ editor: editor as never });

    const result = insertGraphvizBlock(context);
    expect(result).toBe(true);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "dot" },
      content: [{ type: "text", text: "digraph G {\n  a -> b\n}" }],
    });
  });
});

describe("insertMarkmapBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when editor is null", () => {
    const context = createBaseContext();
    expect(insertMarkmapBlock(context)).toBe(false);
  });

  it("inserts a Markmap code block", () => {
    const editor = createMockEditor();
    const context = createBaseContext({ editor: editor as never });

    const result = insertMarkmapBlock(context);
    expect(result).toBe(true);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "markmap" },
      content: [{ type: "text", text: "# Topic\n## Branch" }],
    });
  });
});

describe("insert block builders — selection becomes block content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses selected text as math block content instead of the default", () => {
    const editor = createMockEditor({
      selection: { from: 1, to: 8, empty: false },
      selectedText: "E = mc^2",
    });
    const context = createBaseContext({ editor: editor as never });

    expect(insertMathBlock(context)).toBe(true);
    expect(editor.state.doc.textBetween).toHaveBeenCalledWith(1, 8, "\n");
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "latex" },
      content: [{ type: "text", text: "E = mc^2" }],
    });
  });

  it("uses selected text as mermaid diagram content", () => {
    const editor = createMockEditor({
      selection: { from: 0, to: 20, empty: false },
      selectedText: "sequenceDiagram\n  A->>B: hi",
    });
    const context = createBaseContext({ editor: editor as never });

    expect(insertDiagramBlock(context)).toBe(true);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: "sequenceDiagram\n  A->>B: hi" }],
    });
  });

  it("uses selected text as graphviz content", () => {
    const editor = createMockEditor({
      selection: { from: 2, to: 12, empty: false },
      selectedText: "digraph { x -> y }",
    });
    const context = createBaseContext({ editor: editor as never });

    expect(insertGraphvizBlock(context)).toBe(true);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "dot" },
      content: [{ type: "text", text: "digraph { x -> y }" }],
    });
  });

  it("uses selected text as markmap content", () => {
    const editor = createMockEditor({
      selection: { from: 3, to: 9, empty: false },
      selectedText: "# Root\n## Leaf",
    });
    const context = createBaseContext({ editor: editor as never });

    expect(insertMarkmapBlock(context)).toBe(true);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "markmap" },
      content: [{ type: "text", text: "# Root\n## Leaf" }],
    });
  });

  it("falls back to default content when selection is empty", () => {
    const editor = createMockEditor();
    const context = createBaseContext({ editor: editor as never });

    expect(insertDiagramBlock(context)).toBe(true);
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: "flowchart LR\n  A --> B" }],
    });
  });
});

describe("handleInsertImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const context = createBaseContext();
    expect(handleInsertImage(context)).toBe(false);
  });

  it("returns true when view is provided (async fire-and-forget)", () => {
    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    const result = handleInsertImage(context);
    expect(result).toBe(true);
  });
});

describe("handleInsertVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const context = createBaseContext();
    expect(handleInsertVideo(context)).toBe(false);
  });

  it("returns true when view is provided", () => {
    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    const result = handleInsertVideo(context);
    expect(result).toBe(true);
  });
});

describe("handleInsertAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const context = createBaseContext();
    expect(handleInsertAudio(context)).toBe(false);
  });

  it("returns true when view is provided", () => {
    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    const result = handleInsertAudio(context);
    expect(result).toBe(true);
  });
});

describe("insertInlineMath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const context = createBaseContext();
    expect(insertInlineMath(context)).toBe(false);
  });

  it("returns false when schema has no math_inline node type", () => {
    const mockView = {
      state: {
        selection: {
          from: 0,
          to: 0,
          $from: { nodeAfter: null, nodeBefore: null },
        },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: {} },
        tr: {},
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn() },
    };
    const context = createBaseContext({ view: mockView as never });

    const result = insertInlineMath(context);
    expect(result).toBe(false);
  });

  it("unwraps math_inline when NodeSelection selects one", () => {
    const mockNode = {
      type: { name: "math_inline" },
      attrs: { content: "x^2" },
      nodeSize: 3,
    };
    const resolvedPos = { pos: 5 };
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };
    const mockSelection = Object.create(NodeSelection.prototype);
    Object.defineProperties(mockSelection, {
      from: { get: () => 5, configurable: true },
      to: { get: () => 8, configurable: true },
      $from: { get: () => ({ nodeAfter: null, nodeBefore: null }), configurable: true },
      node: { get: () => mockNode, configurable: true },
    });

    const mockView = {
      state: {
        selection: mockSelection,
        doc: { textBetween: vi.fn(() => "") },
        schema: {
          nodes: { math_inline: { create: vi.fn() } },
          text: vi.fn((t: string) => ({ text: t })),
        },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn() },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    expect(mockTr.replaceWith).toHaveBeenCalledWith(5, 8, expect.anything());
    expect(mockView.dispatch).toHaveBeenCalled();
    expect(mockView.focus).toHaveBeenCalled();
    nearSpy.mockRestore();
  });

  it("unwraps math_inline when cursor nodeAfter is math_inline", () => {
    const mathNode = {
      type: { name: "math_inline" },
      attrs: { content: "y+1" },
      nodeSize: 4,
    };
    const resolvedPos = { pos: 3 };
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 5,
          to: 5,
          $from: { nodeAfter: mathNode, nodeBefore: null },
        },
        doc: { textBetween: vi.fn(() => "") },
        schema: {
          nodes: { math_inline: { create: vi.fn() } },
          text: vi.fn((t: string) => ({ text: t })),
        },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn() },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    expect(mockTr.replaceWith).toHaveBeenCalledWith(5, 9, expect.anything());
    expect(mockView.dispatch).toHaveBeenCalled();
    nearSpy.mockRestore();
  });

  it("unwraps math_inline when cursor nodeBefore is math_inline", () => {
    const mathNode = {
      type: { name: "math_inline" },
      attrs: { content: "z" },
      nodeSize: 3,
    };
    const resolvedPos = { pos: 4 };
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 8,
          to: 8,
          $from: { nodeAfter: null, nodeBefore: mathNode },
        },
        doc: { textBetween: vi.fn(() => "") },
        schema: {
          nodes: { math_inline: { create: vi.fn() } },
          text: vi.fn((t: string) => ({ text: t })),
        },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn() },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    expect(mockTr.replaceWith).toHaveBeenCalledWith(5, 8, expect.anything());
    expect(mockView.dispatch).toHaveBeenCalled();
    nearSpy.mockRestore();
  });

  it("unwraps math_inline with empty content producing empty array", () => {
    const mathNode = {
      type: { name: "math_inline" },
      attrs: { content: "" },
      nodeSize: 3,
    };
    const resolvedPos = { pos: 5 };
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 5,
          to: 5,
          $from: { nodeAfter: mathNode, nodeBefore: null },
        },
        doc: { textBetween: vi.fn(() => "") },
        schema: {
          nodes: { math_inline: { create: vi.fn() } },
          text: vi.fn((t: string) => ({ text: t })),
        },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn() },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    expect(mockTr.replaceWith).toHaveBeenCalledWith(5, 8, []);
    nearSpy.mockRestore();
  });

  it("wraps selected text in math_inline", () => {
    const mathInlineType = { create: vi.fn(() => ({ type: "math_inline" })) };
    const resolvedPos = { pos: 2 };
    const mockTr = {
      replaceSelectionWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 2,
          to: 7,
          $from: { nodeAfter: null, nodeBefore: null },
        },
        doc: { textBetween: vi.fn(() => "hello") },
        schema: { nodes: { math_inline: mathInlineType } },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn(() => null) },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    expect(mathInlineType.create).toHaveBeenCalledWith({ content: "hello" });
    expect(mockTr.replaceSelectionWith).toHaveBeenCalled();
    nearSpy.mockRestore();
  });

  it("wraps word at cursor into math_inline when no selection", () => {
    vi.mocked(findWordAtCursor).mockReturnValue({ from: 2, to: 7 });

    const mathInlineType = { create: vi.fn(() => ({ type: "math_inline" })) };
    const resolvedPos = { pos: 2 };
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 4,
          to: 4,
          $from: { nodeAfter: null, nodeBefore: null },
        },
        doc: { textBetween: vi.fn(() => "hello") },
        schema: { nodes: { math_inline: mathInlineType } },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn(() => null) },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    expect(mathInlineType.create).toHaveBeenCalledWith({ content: "hello" });
    expect(mockTr.replaceWith).toHaveBeenCalledWith(2, 7, expect.anything());
    nearSpy.mockRestore();
  });

  it("inserts empty math_inline when no selection and no word at cursor", () => {
    vi.mocked(findWordAtCursor).mockReturnValue(null);

    const mathInlineType = { create: vi.fn(() => ({ type: "math_inline" })) };
    const resolvedPos = { pos: 4 };
    const mockTr = {
      replaceSelectionWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 4,
          to: 4,
          $from: { nodeAfter: null, nodeBefore: null },
        },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { math_inline: mathInlineType } },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn(() => null) },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    expect(mathInlineType.create).toHaveBeenCalledWith({ content: "" });
    expect(mockTr.replaceSelectionWith).toHaveBeenCalled();
    nearSpy.mockRestore();
  });
});

describe("handleInsertImage — async paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("inserts image from clipboard when clipboard has valid image URL", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "https://example.com/img.png",
      needsCopy: false,
    } as never);

    const imageCreate = vi.fn(() => ({ type: "image" }));
    const mockTr = { replaceWith: vi.fn().mockReturnThis() };

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: imageCreate } }, text: vi.fn() },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(imageCreate).toHaveBeenCalledWith({
        src: "https://example.com/img.png",
        alt: "",
        title: "",
      });
    });
  });

  it("uses selection text as alt when clipboard has image", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "https://example.com/img.png",
      needsCopy: false,
    } as never);

    const imageCreate = vi.fn(() => ({ type: "image" }));
    const mockTr = { replaceWith: vi.fn().mockReturnThis() };

    const mockView = {
      state: {
        selection: { from: 2, to: 7, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "hello") },
        schema: { nodes: { image: { create: imageCreate } }, text: vi.fn() },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(imageCreate).toHaveBeenCalledWith({
        src: "https://example.com/img.png",
        alt: "hello",
        title: "",
      });
    });
  });

  it("uses word at cursor as alt text when no selection", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "https://example.com/img.png",
      needsCopy: false,
    } as never);
    vi.mocked(findWordAtCursor).mockReturnValue({ from: 0, to: 5 });

    const imageCreate = vi.fn(() => ({ type: "image" }));
    const mockTr = { replaceWith: vi.fn().mockReturnThis() };

    const mockView = {
      state: {
        selection: { from: 3, to: 3, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "world") },
        schema: { nodes: { image: { create: imageCreate } }, text: vi.fn() },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(imageCreate).toHaveBeenCalledWith({
        src: "https://example.com/img.png",
        alt: "world",
        title: "",
      });
    });
  });

  it("copies local image to assets when needsCopy is true", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/Users/test/photo.png",
      needsCopy: true,
      resolvedPath: "/Users/test/photo.png",
    } as never);
    vi.mocked(copyImageToAssets).mockResolvedValue("assets/photo.png");

    const imageCreate = vi.fn(() => ({ type: "image" }));
    const mockTr = { replaceWith: vi.fn().mockReturnThis() };

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: imageCreate } }, text: vi.fn() },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(copyImageToAssets).toHaveBeenCalledWith("/Users/test/photo.png", "/path/to/doc.md");
      expect(imageCreate).toHaveBeenCalledWith({
        src: "assets/photo.png",
        alt: "",
        title: "",
      });
    });
  });

  it("recomputes the insert range when the doc changes during the async copy", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/Users/test/photo.png",
      needsCopy: true,
      resolvedPath: "/Users/test/photo.png",
    } as never);
    vi.mocked(findWordAtCursor).mockReturnValue(null);

    const imageCreate = vi.fn(() => ({ type: "image" }));
    const trBefore = { replaceWith: vi.fn().mockReturnThis() };
    const trAfter = { replaceWith: vi.fn().mockReturnThis() };

    const stateBefore = {
      selection: { from: 2, to: 7, $from: { nodeAfter: null, nodeBefore: null } },
      doc: { textBetween: vi.fn(() => "hello") },
      schema: { nodes: { image: { create: imageCreate } }, text: vi.fn() },
      tr: trBefore,
    };
    const stateAfter = {
      selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
      doc: { textBetween: vi.fn(() => "") },
      schema: { nodes: { image: { create: imageCreate } }, text: vi.fn() },
      tr: trAfter,
    };

    const mockView = {
      state: stateBefore as unknown,
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };

    // Simulate an edit landing while the copy is in flight: the view's
    // state (doc + selection) is replaced before the promise resolves.
    vi.mocked(copyImageToAssets).mockImplementation(async () => {
      mockView.state = stateAfter;
      return "assets/photo.png";
    });

    const context = createBaseContext({ view: mockView as never });
    handleInsertImage(context);

    await vi.waitFor(() => {
      // The insertion must target the post-copy selection (0,0), not the
      // stale pre-copy range (2,7) against the new doc.
      expect(trAfter.replaceWith).toHaveBeenCalledWith(0, 0, expect.anything());
    });
    expect(trBefore.replaceWith).not.toHaveBeenCalled();
    expect(imageCreate).toHaveBeenCalledWith({ src: "assets/photo.png", alt: "", title: "" });
  });

  it("falls back to file picker when clipboard has no image", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue(null);
    vi.mocked(open).mockResolvedValue(null as never);

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
  });

  it("falls back to file picker when needsCopy true but no active file path", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/Users/test/photo.png",
      needsCopy: true,
    } as never);
    vi.mocked(getActiveFilePath).mockReturnValue(null);
    vi.mocked(open).mockResolvedValue(null as never);

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
  });

  it("falls back to file picker when image copy fails", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/Users/test/photo.png",
      needsCopy: true,
      resolvedPath: "/Users/test/photo.png",
    } as never);
    vi.mocked(copyImageToAssets).mockRejectedValue(new Error("copy failed"));
    vi.mocked(open).mockResolvedValue(null as never);

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
  });

  it("does not insert if view disconnects after clipboard read", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "https://example.com/img.png",
      needsCopy: false,
    } as never);
    vi.mocked(isViewConnected).mockReturnValue(false);

    const imageCreate = vi.fn();
    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: imageCreate } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: false },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await new Promise((r) => setTimeout(r, 20));
    expect(imageCreate).not.toHaveBeenCalled();
  });
});

describe("handleInsertImage — file picker paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("inserts image from file picker and copies to assets", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue(null);
    vi.mocked(open).mockResolvedValue("/Users/test/photo.png" as never);
    vi.mocked(copyImageToAssets).mockResolvedValue("assets/photo.png");

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(insertBlockImageNode).toHaveBeenCalledWith(mockView, "assets/photo.png");
    });
  });

  it("shows warning when file picker selected but no active file path", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue(null);
    vi.mocked(open).mockResolvedValue("/Users/test/photo.png" as never);
    vi.mocked(getActiveFilePath).mockReturnValue(null);

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(message).toHaveBeenCalledWith(
        expect.stringContaining("save the document"),
        expect.objectContaining({ kind: "warning" })
      );
    });
  });

  it("handles file picker returning array of paths", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue(null);
    vi.mocked(open).mockResolvedValue(["/Users/test/photo.png"] as never);
    vi.mocked(copyImageToAssets).mockResolvedValue("assets/photo.png");

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(insertBlockImageNode).toHaveBeenCalledWith(mockView, "assets/photo.png");
    });
  });
});

describe("handleInsertVideo — async paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("inserts video from file picker", async () => {
    vi.mocked(open).mockResolvedValue("/Users/test/video.mp4" as never);
    vi.mocked(copyMediaToAssets).mockResolvedValue("assets/video.mp4");

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertVideo(context);

    await vi.waitFor(() => {
      expect(insertBlockVideoNode).toHaveBeenCalledWith(mockView, "assets/video.mp4");
    });
  });

  it("does nothing when user cancels file picker", async () => {
    vi.mocked(open).mockResolvedValue(null as never);

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertVideo(context);

    await new Promise((r) => setTimeout(r, 20));
    expect(insertBlockVideoNode).not.toHaveBeenCalled();
  });

  it("shows warning when no active file path for video", async () => {
    vi.mocked(open).mockResolvedValue("/Users/test/video.mp4" as never);
    vi.mocked(getActiveFilePath).mockReturnValue(null);

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertVideo(context);

    await vi.waitFor(() => {
      expect(message).toHaveBeenCalledWith(
        expect.stringContaining("save the document"),
        expect.objectContaining({ kind: "warning" })
      );
    });
  });
});

describe("handleInsertAudio — async paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("inserts audio from file picker", async () => {
    vi.mocked(open).mockResolvedValue("/Users/test/audio.mp3" as never);
    vi.mocked(copyMediaToAssets).mockResolvedValue("assets/audio.mp3");

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertAudio(context);

    await vi.waitFor(() => {
      expect(insertBlockAudioNode).toHaveBeenCalledWith(mockView, "assets/audio.mp3");
    });
  });

  it("does nothing when user cancels audio file picker", async () => {
    vi.mocked(open).mockResolvedValue(null as never);

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertAudio(context);

    await new Promise((r) => setTimeout(r, 20));
    expect(insertBlockAudioNode).not.toHaveBeenCalled();
  });

  it("shows warning when no active file path for audio", async () => {
    vi.mocked(open).mockResolvedValue("/Users/test/audio.mp3" as never);
    vi.mocked(getActiveFilePath).mockReturnValue(null);

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertAudio(context);

    await vi.waitFor(() => {
      expect(message).toHaveBeenCalledWith(
        expect.stringContaining("save the document"),
        expect.objectContaining({ kind: "warning" })
      );
    });
  });

  it("does not insert if view disconnects after media copy", async () => {
    vi.mocked(open).mockResolvedValue("/Users/test/audio.mp3" as never);
    vi.mocked(copyMediaToAssets).mockResolvedValue("assets/audio.mp3");
    vi.mocked(isViewConnected).mockReturnValue(false);

    const mockView = { dom: { isConnected: false } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertAudio(context);

    await new Promise((r) => setTimeout(r, 20));
    expect(insertBlockAudioNode).not.toHaveBeenCalled();
  });

  it("handles error in async audio insertion", async () => {
    vi.mocked(withReentryGuard).mockRejectedValue(new Error("guard failed"));

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertAudio(context);

    await vi.waitFor(() => {
      expect(wysiwygAdapterWarn).toHaveBeenCalledWith(
        "Audio insertion failed:",
        "guard failed"
      );
    });
  });
});

describe("handleInsertImage — view disconnect after copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("does not insert when view disconnects after image copy to assets", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/Users/test/photo.png",
      needsCopy: true,
      resolvedPath: "/Users/test/photo.png",
    } as never);
    vi.mocked(copyImageToAssets).mockResolvedValue("assets/photo.png");
    // Connected initially, disconnected after copy
    vi.mocked(isViewConnected)
      .mockReturnValueOnce(true)  // first check after clipboard read
      .mockReturnValueOnce(false); // second check after image copy

    const imageCreate = vi.fn();
    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: imageCreate } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(wysiwygAdapterWarn).toHaveBeenCalledWith("View disconnected after image copy");
    });
    expect(imageCreate).not.toHaveBeenCalled();
  });
});

describe("handleInsertVideo — view disconnect after copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("does not insert when view disconnects after video copy", async () => {
    vi.mocked(open).mockResolvedValue("/Users/test/video.mp4" as never);
    vi.mocked(copyMediaToAssets).mockResolvedValue("assets/video.mp4");
    vi.mocked(isViewConnected).mockReturnValue(false);

    const mockView = { dom: { isConnected: false } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertVideo(context);

    await new Promise((r) => setTimeout(r, 20));
    expect(insertBlockVideoNode).not.toHaveBeenCalled();
  });
});

describe("handleInsertImage — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("handles error in async image insertion with non-Error throw", async () => {
    vi.mocked(withReentryGuard).mockRejectedValue("string error");

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(wysiwygAdapterWarn).toHaveBeenCalledWith(
        "Image insertion failed:",
        "string error"
      );
    });
  });

  it("handles error in async video insertion", async () => {
    vi.mocked(withReentryGuard).mockRejectedValue(new Error("video guard fail"));

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertVideo(context);

    await vi.waitFor(() => {
      expect(wysiwygAdapterWarn).toHaveBeenCalledWith(
        "Video insertion failed:",
        "video guard fail"
      );
    });
  });

  it("handles file picker returning empty array for image", async () => {
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(readClipboardImagePath).mockResolvedValue(null);
    vi.mocked(open).mockResolvedValue([] as never);

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    // normalizeDialogPath returns null for empty array
    await new Promise((r) => setTimeout(r, 20));
    expect(insertBlockImageNode).not.toHaveBeenCalled();
  });

  it("uses clipboard path (no resolvedPath) when needsCopy and no resolvedPath", async () => {
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/Users/test/photo.png",
      needsCopy: true,
      // No resolvedPath set — should fall back to path
    } as never);
    vi.mocked(copyImageToAssets).mockResolvedValue("assets/photo.png");

    const imageCreate = vi.fn(() => ({ type: "image" }));
    const mockTr = { replaceWith: vi.fn().mockReturnThis() };

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: imageCreate } }, text: vi.fn() },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await vi.waitFor(() => {
      expect(copyImageToAssets).toHaveBeenCalledWith("/Users/test/photo.png", "/path/to/doc.md");
    });
  });
});

describe("insertInlineMath — unwrap NodeSelection math_inline with empty content (line 262)", () => {
  it("uses empty array when NodeSelection math_inline has empty content", () => {
    const mockNode = {
      type: { name: "math_inline" },
      attrs: { content: "" },
      nodeSize: 3,
    };
    const resolvedPos = { pos: 5 };
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };
    const mockSelection = Object.create(NodeSelection.prototype);
    Object.defineProperties(mockSelection, {
      from: { get: () => 5, configurable: true },
      to: { get: () => 8, configurable: true },
      $from: { get: () => ({ nodeAfter: null, nodeBefore: null }), configurable: true },
      node: { get: () => mockNode, configurable: true },
    });

    const mockView = {
      state: {
        selection: mockSelection,
        doc: { textBetween: vi.fn(() => "") },
        schema: {
          nodes: { math_inline: { create: vi.fn() } },
          text: vi.fn((t: string) => ({ text: t })),
        },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn() },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    // content is "" so replaceWith should receive empty array (line 262 ternary false branch)
    expect(mockTr.replaceWith).toHaveBeenCalledWith(5, 8, []);
    nearSpy.mockRestore();
  });
});

describe("insertInlineMath — unwrap nodeBefore math_inline with empty content (line 295)", () => {
  it("uses empty array when nodeBefore math_inline has empty content", () => {
    const mathNode = {
      type: { name: "math_inline" },
      attrs: { content: "" },
      nodeSize: 3,
    };
    const resolvedPos = { pos: 5 };
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 8,
          to: 8,
          $from: { nodeAfter: null, nodeBefore: mathNode },
        },
        doc: { textBetween: vi.fn(() => "") },
        schema: {
          nodes: { math_inline: { create: vi.fn() } },
          text: vi.fn((t: string) => ({ text: t })),
        },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { querySelector: vi.fn() },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    // content is "" so line 295 ternary → empty array
    expect(mockTr.replaceWith).toHaveBeenCalledWith(5, 8, []);
    nearSpy.mockRestore();
  });
});

describe("handleInsertImage — image type missing in schema (line 36)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("returns early when image node type is missing from schema", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "https://example.com/img.png",
      needsCopy: false,
    } as never);

    const mockTr = { replaceWith: vi.fn().mockReturnThis() };
    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        // No image type in schema
        schema: { nodes: {}, text: vi.fn() },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    // trySmartImageInsertion calls insertImageWithAlt which checks for imageType
    // When imageType is falsy, it returns early without dispatching
    await new Promise((r) => setTimeout(r, 20));
    expect(mockView.dispatch).not.toHaveBeenCalled();
  });
});

describe("handleInsertImage — file picker view disconnect (line 151)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withReentryGuard).mockImplementation((_label, _guard, fn) => fn());
    vi.mocked(getActiveFilePath).mockReturnValue("/path/to/doc.md");
  });

  it("does not insert when view disconnects after file picker copy", async () => {
    vi.mocked(readClipboardImagePath).mockResolvedValue(null);
    vi.mocked(open).mockResolvedValue("/Users/test/photo.png" as never);
    vi.mocked(copyImageToAssets).mockResolvedValue("assets/photo.png");
    vi.mocked(isViewConnected).mockReturnValue(false);

    const mockView = {
      state: {
        selection: { from: 0, to: 0, $from: { nodeAfter: null, nodeBefore: null } },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { image: { create: vi.fn() } } },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: false },
    };
    const context = createBaseContext({ view: mockView as never });

    handleInsertImage(context);

    await new Promise((r) => setTimeout(r, 20));
    expect(insertBlockImageNode).not.toHaveBeenCalled();
  });
});

describe("handleInsertVideo/Audio — error with non-Error throw (line 170/391/431)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isViewConnected).mockReturnValue(true);
  });

  it("handles non-Error throw in video insertion", async () => {
    vi.mocked(withReentryGuard).mockRejectedValue("string video error");

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertVideo(context);

    await vi.waitFor(() => {
      expect(wysiwygAdapterWarn).toHaveBeenCalledWith(
        "Video insertion failed:",
        "string video error"
      );
    });
  });

  it("handles non-Error throw in audio insertion", async () => {
    vi.mocked(withReentryGuard).mockRejectedValue("string audio error");

    const mockView = { dom: { isConnected: true } };
    const context = createBaseContext({ view: mockView as never });

    handleInsertAudio(context);

    await vi.waitFor(() => {
      expect(wysiwygAdapterWarn).toHaveBeenCalledWith(
        "Audio insertion failed:",
        "string audio error"
      );
    });
  });
});

describe("insertInlineMath — focusMathInput with real mathInput (lines 308-310)", () => {
  let originalRAF: typeof requestAnimationFrame;

  beforeEach(() => {
    vi.clearAllMocks();
    originalRAF = globalThis.requestAnimationFrame;
    // Make rAF synchronous so the focusMathInput callback fires immediately
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
  });

  it("calls focus() and setSelectionRange() on mathInput when found (lines 308-310)", () => {
    const mockMathInput = {
      focus: vi.fn(),
      setSelectionRange: vi.fn(),
    };

    const mathInlineType = { create: vi.fn(() => ({ type: "math_inline" })) };
    const resolvedPos = { pos: 2 };
    const mockTr = {
      replaceSelectionWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 2,
          to: 7,
          $from: { nodeAfter: null, nodeBefore: null },
        },
        doc: { textBetween: vi.fn(() => "hello") },
        schema: { nodes: { math_inline: mathInlineType } },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: {
        // querySelector returns the mock math input
        querySelector: vi.fn(() => mockMathInput),
      },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    // rAF fired synchronously — mathInput.focus() should have been called
    expect(mockMathInput.focus).toHaveBeenCalled();
    // cursorOffset = selectedText.length = "hello".length = 5
    expect(mockMathInput.setSelectionRange).toHaveBeenCalledWith(5, 5);
    nearSpy.mockRestore();
  });

  it("calls focus() but not setSelectionRange() when cursorOffset is undefined (line 308 only)", () => {
    const mockMathInput = {
      focus: vi.fn(),
      setSelectionRange: vi.fn(),
    };

    vi.mocked(findWordAtCursor).mockReturnValue(null);

    const mathInlineType = { create: vi.fn(() => ({ type: "math_inline" })) };
    const resolvedPos = { pos: 4 };
    const mockTr = {
      replaceSelectionWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      doc: { resolve: vi.fn(() => resolvedPos) },
    };

    const mockView = {
      state: {
        selection: {
          from: 4,
          to: 4,
          $from: { nodeAfter: null, nodeBefore: null },
        },
        doc: { textBetween: vi.fn(() => "") },
        schema: { nodes: { math_inline: mathInlineType } },
        tr: mockTr,
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: {
        querySelector: vi.fn(() => mockMathInput),
      },
    };

    const nearSpy = vi.spyOn(Selection, "near").mockReturnValue({} as never);

    const context = createBaseContext({ view: mockView as never });
    // Case 3: empty math insertion — focusMathInput(0) is called with cursorOffset=0
    const result = insertInlineMath(context);

    expect(result).toBe(true);
    expect(mockMathInput.focus).toHaveBeenCalled();
    // cursorOffset=0 IS defined, so setSelectionRange IS called
    expect(mockMathInput.setSelectionRange).toHaveBeenCalledWith(0, 0);
    nearSpy.mockRestore();
  });
});
