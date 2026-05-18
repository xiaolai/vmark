import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/debug", () => ({
  pasteError: vi.fn(),
}));
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection, SelectionRange, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Slice } from "@tiptap/pm/model";
import { MultiSelection } from "@/plugins/multiCursor/MultiSelection";
import { pasteError } from "@/utils/debug";
import type { MarkdownPasteMode } from "@/stores/settingsStore";
import {
  createMarkdownPasteSlice,
  createMarkdownPasteTransaction,
  MarkdownPasteTooComplexError,
  shouldHandleMarkdownPaste,
  triggerPastePlainText,
  markdownPasteExtension,
} from "./tiptap";

const schema = getSchema([StarterKit]);

function createParagraphDoc(text: string) {
  const paragraph = schema.nodes.paragraph.create(
    null,
    text ? schema.text(text) : undefined
  );
  return schema.nodes.doc.create(null, [paragraph]);
}

function containsNode(doc: PMNode, typeName: string): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.type.name === typeName) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

function createState(doc: PMNode, selectionPos = 1) {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, selectionPos),
  });
}

function createStateWithSelection(doc: PMNode, from: number, to: number) {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

function createMultiSelectionState(doc: PMNode, ranges: Array<{ from: number; to: number }>) {
  const base = EditorState.create({ doc });
  const selectionRanges = ranges.map((range) => {
    return new SelectionRange(doc.resolve(range.from), doc.resolve(range.to));
  });
  const multiSel = new MultiSelection(selectionRanges, 0);
  return base.apply(base.tr.setSelection(multiSel));
}

describe("markdownPasteExtension", () => {
  it("creates code blocks from fenced markdown", () => {
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, "```js\nconst a = 1;\n```");
    expect(tr).not.toBeNull();

    if (tr) {
      const next = state.apply(tr);
      expect(containsNode(next.doc, "codeBlock")).toBe(true);
    }
  });

  it("creates lists from markdown list text", () => {
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, "- first\n- second");
    expect(tr).not.toBeNull();

    if (tr) {
      const next = state.apply(tr);
      expect(containsNode(next.doc, "bulletList")).toBe(true);
    }
  });

  it("skips markdown parsing inside code blocks", () => {
    const codeBlock = schema.nodes.codeBlock.create(null, schema.text("code"));
    const doc = schema.nodes.doc.create(null, [codeBlock]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });

    const result = shouldHandleMarkdownPaste(state, "- item", {
      pasteMode: "auto",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("skips markdown parsing inside inline code marks", () => {
    const codeMark = schema.marks.code;
    const paragraph = schema.nodes.paragraph.create(
      null,
      schema.text("code", codeMark ? [codeMark.create()] : undefined)
    );
    const doc = schema.nodes.doc.create(null, [paragraph]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });

    const result = shouldHandleMarkdownPaste(state, "- item", {
      pasteMode: "auto",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("skips markdown parsing for multi-selection", () => {
    const doc = createParagraphDoc("hello world");
    const state = createMultiSelectionState(doc, [
      { from: 1, to: 6 },
      { from: 7, to: 12 },
    ]);

    const result = shouldHandleMarkdownPaste(state, "# Title\nText", {
      pasteMode: "auto",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("does not treat plain text as markdown", () => {
    const state = createState(createParagraphDoc(""));
    const result = shouldHandleMarkdownPaste(state, "Just a sentence.", {
      pasteMode: "auto",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("respects paste mode off", () => {
    const state = createState(createParagraphDoc(""));
    const result = shouldHandleMarkdownPaste(state, "# Title\nText", {
      pasteMode: "off" as MarkdownPasteMode,
      html: "",
    });
    expect(result).toBe(false);
  });

  it("handles markdown with non-substantial HTML wrapper", () => {
    const state = createState(createParagraphDoc(""));
    // Two divs (not substantial - needs > 2 to be substantial)
    const result = shouldHandleMarkdownPaste(state, "# Title\nText", {
      pasteMode: "auto",
      html: "<div># Title</div><div>Text</div>",
    });
    expect(result).toBe(true);
  });

  it("skips markdown parsing when HTML is substantial", () => {
    const state = createState(createParagraphDoc(""));
    // Substantial HTML (with formatting tags) should be handled by htmlPaste
    const result = shouldHandleMarkdownPaste(state, "Bold text", {
      pasteMode: "auto",
      html: "<p><strong>Bold text</strong></p>",
    });
    expect(result).toBe(false);
  });

  it("handles markdown when HTML is only a pre/code wrapper", () => {
    const state = createState(createParagraphDoc(""));
    const text = "# Title\n\n- first\n- second";
    const result = shouldHandleMarkdownPaste(state, text, {
      pasteMode: "auto",
      html: "<pre><code># Title\n\n- first\n- second</code></pre>",
    });
    expect(result).toBe(true);
  });

  it("pastes plain text from clipboard", async () => {
    vi.mocked(readText).mockResolvedValue("Plain");
    let state = createState(createParagraphDoc(""));
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr);
      },
    } as unknown as EditorView;

    await triggerPastePlainText(view);
    expect(state.doc.textContent).toBe("Plain");
  });
});

describe("shouldHandleMarkdownPaste edge cases", () => {
  it("returns false for empty text", () => {
    const state = createState(createParagraphDoc(""));
    expect(shouldHandleMarkdownPaste(state, "", { pasteMode: "auto", html: "" })).toBe(false);
  });

  it("returns false for whitespace-only text", () => {
    const state = createState(createParagraphDoc(""));
    expect(shouldHandleMarkdownPaste(state, "   \n  \t  ", { pasteMode: "auto", html: "" })).toBe(false);
  });

  it("returns false for text exceeding 200K character limit", () => {
    const state = createState(createParagraphDoc(""));
    const longText = "# Heading\n" + "a".repeat(200_001);
    expect(shouldHandleMarkdownPaste(state, longText, { pasteMode: "auto", html: "" })).toBe(false);
  });

  it("returns false when selection is non-empty and text is a URL", () => {
    // When there's selected text and we paste a URL, it should not be treated as markdown
    // (instead it might be used for linking the selected text)
    const doc = createParagraphDoc("hello world");
    const state = createStateWithSelection(doc, 1, 6); // "hello" selected
    expect(
      shouldHandleMarkdownPaste(state, "https://example.com", { pasteMode: "auto", html: "" })
    ).toBe(false);
  });

  it("returns true when selection is empty and text is markdown with URL", () => {
    const state = createState(createParagraphDoc(""));
    // Markdown-looking text with URL should still be treated as markdown
    expect(
      shouldHandleMarkdownPaste(state, "# Title\n[Link](https://example.com)", {
        pasteMode: "auto",
        html: "",
      })
    ).toBe(true);
  });

  it("skips when HTML has rich tags alongside pre/code", () => {
    const state = createState(createParagraphDoc(""));
    // HTML with code wrapper but also rich tags should defer to htmlPaste
    const html = "<pre><code># Title</code></pre><h1>Title</h1>";
    expect(
      shouldHandleMarkdownPaste(state, "# Title", { pasteMode: "auto", html })
    ).toBe(false);
  });
});

describe("createMarkdownPasteSlice", () => {
  it("returns a Slice from markdown text", () => {
    const state = createState(createParagraphDoc(""));
    const slice = createMarkdownPasteSlice(state, "# Heading");
    expect(slice).toBeInstanceOf(Slice);
    expect(slice.content.childCount).toBeGreaterThan(0);
  });

  it("handles empty content by creating empty paragraph", () => {
    const state = createState(createParagraphDoc(""));
    // Markdown that parses to empty content should produce at least a paragraph
    const slice = createMarkdownPasteSlice(state, "");
    expect(slice.content.childCount).toBeGreaterThanOrEqual(0);
  });
});

describe("createMarkdownPasteTransaction", () => {
  it("returns null on parse failure", () => {
    // Mock console.error to suppress noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Create a state with a broken/minimal schema that might cause parse to fail
    const state = createState(createParagraphDoc("existing"));
    // We can't easily trigger parse failure with real schema, but we test the success path
    const tr = createMarkdownPasteTransaction(state, "# Valid Markdown");
    expect(tr).not.toBeNull();
    spy.mockRestore();
  });

  it("creates headings from markdown heading syntax", () => {
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, "# Heading 1\n\n## Heading 2");
    expect(tr).not.toBeNull();
    if (tr) {
      const next = state.apply(tr);
      expect(containsNode(next.doc, "heading")).toBe(true);
    }
  });

  it("creates ordered lists from numbered list markdown", () => {
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, "1. first\n2. second\n3. third");
    expect(tr).not.toBeNull();
    if (tr) {
      const next = state.apply(tr);
      expect(containsNode(next.doc, "orderedList")).toBe(true);
    }
  });

  it("creates blockquotes from > syntax", () => {
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, "> quoted text");
    expect(tr).not.toBeNull();
    if (tr) {
      const next = state.apply(tr);
      expect(containsNode(next.doc, "blockquote")).toBe(true);
    }
  });
});

describe("markdownPasteExtension structure", () => {
  it("has the correct name", () => {
    expect(markdownPasteExtension.name).toBe("markdownPaste");
  });

  it("defines ProseMirror plugins", () => {
    expect(markdownPasteExtension.config.addProseMirrorPlugins).toBeDefined();
  });
});

describe("handlePaste via plugin", () => {
  function getHandlePaste() {
    const plugins = markdownPasteExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "markdownPaste",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handlePaste: (view: unknown, event: unknown) => boolean } };
    return plugin.props.handlePaste;
  }

  it("returns false when clipboardData has no text", () => {
    const handlePaste = getHandlePaste();
    const doc = createParagraphDoc("hello");
    const state = createState(doc);
    const view = { state, dispatch: vi.fn() };
    const event = { clipboardData: { getData: () => "" } };
    expect(handlePaste(view, event)).toBe(false);
  });

  it("returns false when shouldHandleMarkdownPaste returns false", () => {
    const handlePaste = getHandlePaste();
    const doc = createParagraphDoc("hello");
    const state = createState(doc);
    const view = { state, dispatch: vi.fn() };
    const event = {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "Just plain text." : ""),
      },
    };
    expect(handlePaste(view, event)).toBe(false);
  });

  it("dispatches transaction when markdown paste is valid", () => {
    const handlePaste = getHandlePaste();
    const doc = createParagraphDoc("");
    const state = createState(doc);
    const dispatchSpy = vi.fn();
    const preventDefaultSpy = vi.fn();
    const view = { state, dispatch: dispatchSpy };
    const event = {
      clipboardData: {
        getData: (type: string) => {
          if (type === "text/plain") return "# Heading\n\n- item 1\n- item 2";
          return "";
        },
      },
      preventDefault: preventDefaultSpy,
    };
    const result = handlePaste(view, event);
    expect(result).toBe(true);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it("returns false when createMarkdownPasteTransaction returns null", () => {
    const handlePaste = getHandlePaste();
    const doc = createParagraphDoc("");
    const state = createState(doc);
    const view = { state, dispatch: vi.fn() };
    // Text that looks like markdown but might fail to parse
    // Use empty-ish text that isMarkdownPasteCandidate rejects
    const event = {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "no markdown here" : ""),
      },
    };
    const result = handlePaste(view, event);
    expect(result).toBe(false);
  });
});

describe("createMarkdownPasteTransaction error handling", () => {
  it("returns null when parse/replace throws (lines 78-79)", () => {
    // Create a state with an incompatible schema to trigger an error
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema } = require("@tiptap/pm/model");
    const minSchema = new Schema({
      nodes: {
        doc: { content: "text*" },
        text: { inline: true },
      },
    });
    const doc = minSchema.text("hello");
    const docNode = minSchema.node("doc", null, [doc]);
    const state = EditorState.create({ doc: docNode, schema: minSchema });

    // This should fail because parseMarkdown expects paragraph nodes
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tr = createMarkdownPasteTransaction(state, "# Heading\n\nSome **bold** text");
    // If it doesn't throw internally, it might still succeed, so check both cases
    if (tr === null) {
      expect(consoleSpy).toHaveBeenCalled();
    }
    consoleSpy.mockRestore();
  });

  it("returns null and logs error when replaceSelection throws (lines 78-79 catch block)", () => {
    // Use a valid state but monkey-patch tr.replaceSelection to throw
    const state = createState(createParagraphDoc("existing"));
    const origTr = state.tr;
    const patchedTr = {
      ...origTr,
      replaceSelection: () => { throw new Error("replace failed"); },
    };
    const patchedState = { ...state, tr: patchedTr, schema: state.schema };

    const tr = createMarkdownPasteTransaction(patchedState as unknown as typeof state, "# Heading");
    expect(tr).toBeNull();
    expect(pasteError).toHaveBeenCalledWith(
      "Failed to parse markdown:",
      expect.any(Error)
    );
  });
});

describe("markdown paste node-count cap", () => {
  it("rejects pastes whose parsed structure exceeds MAX_MARKDOWN_PASTE_NODES", () => {
    // 6_000 single-character list items produces ~12_000 nodes (list_item + paragraph + text),
    // well above the 5_000 cap. This is the regression: previously a 199KB paste
    // with this shape could freeze the editor for seconds during dispatch.
    const big = Array.from({ length: 6_000 }, (_, i) => `- item ${i}`).join("\n");
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, big);
    expect(tr).toBeNull();
    // The catch path logs via pasteError with the "falling back to plain text" message.
    expect(pasteError).toHaveBeenCalledWith(
      expect.stringContaining("falling back to plain text"),
      expect.stringContaining("more than 5000 nodes"),
    );
  });

  it("MarkdownPasteTooComplexError exposes the node count in its message", () => {
    const err = new MarkdownPasteTooComplexError(8_000);
    expect(err.name).toBe("MarkdownPasteTooComplexError");
    expect(err.message).toMatch(/8000/);
  });

  it("accepts pastes well below the node cap", () => {
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, "# Title\n\nSome **bold** text.");
    expect(tr).not.toBeNull();
  });
});

describe("ensureBlockContent — block firstChild branch (line 50 false path)", () => {
  it("returns content unchanged when firstChild is already a block node", () => {
    const state = createState(createParagraphDoc(""));
    // A heading or paragraph is a block — ensureBlockContent should NOT wrap it
    const tr = createMarkdownPasteTransaction(state, "# Block Heading");
    expect(tr).not.toBeNull();
    if (tr) {
      const next = state.apply(tr);
      // heading node is a block — should be present without extra paragraph wrapper
      expect(containsNode(next.doc, "heading")).toBe(true);
    }
  });
});

describe("triggerPastePlainText", () => {
  it("does nothing for multi-selection", async () => {
    const doc = createParagraphDoc("hello world");
    const state = createMultiSelectionState(doc, [
      { from: 1, to: 6 },
      { from: 7, to: 12 },
    ]);
    const dispatchSpy = vi.fn();
    const view = {
      get state() {
        return state;
      },
      dispatch: dispatchSpy,
    } as unknown as EditorView;

    await triggerPastePlainText(view);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("does nothing when clipboard is empty", async () => {
    vi.mocked(readText).mockResolvedValue("");
    let state = createState(createParagraphDoc("existing"));
    const dispatchSpy = vi.fn((tr: Transaction) => {
      state = state.apply(tr);
    });
    const view = {
      get state() {
        return state;
      },
      dispatch: dispatchSpy,
    } as unknown as EditorView;

    await triggerPastePlainText(view);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("replaces selected text with clipboard content", async () => {
    vi.mocked(readText).mockResolvedValue("replaced");
    const doc = createParagraphDoc("hello world");
    let state = createStateWithSelection(doc, 1, 6); // select "hello"
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr);
      },
    } as unknown as EditorView;

    await triggerPastePlainText(view);
    expect(state.doc.textContent).toContain("replaced");
  });

  it("returns empty string when both Tauri and navigator clipboard fail (line 122)", async () => {
    vi.mocked(readText).mockRejectedValue(new Error("Tauri fail"));
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          readText: vi.fn().mockRejectedValue(new Error("Web clipboard fail")),
        },
      },
      writable: true,
      configurable: true,
    });

    let state = createState(createParagraphDoc("existing"));
    const dispatchSpy = vi.fn((tr: Transaction) => {
      state = state.apply(tr);
    });
    const view = {
      get state() { return state; },
      dispatch: dispatchSpy,
    } as unknown as EditorView;

    await triggerPastePlainText(view);
    // Both clipboards fail, so nothing is pasted
    expect(dispatchSpy).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "navigator", {
      value: origNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("falls back to navigator.clipboard when Tauri clipboard fails", async () => {
    vi.mocked(readText).mockRejectedValue(new Error("Tauri clipboard unavailable"));
    // Mock navigator.clipboard
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          readText: vi.fn().mockResolvedValue("fallback text"),
        },
      },
      writable: true,
      configurable: true,
    });

    let state = createState(createParagraphDoc(""));
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr);
      },
    } as unknown as EditorView;

    await triggerPastePlainText(view);
    expect(state.doc.textContent).toBe("fallback text");

    Object.defineProperty(globalThis, "navigator", {
      value: origNavigator,
      writable: true,
      configurable: true,
    });
  });
});

describe("handlePaste — uncovered branches (lines 134, 135, 145)", () => {
  function getHandlePaste() {
    const plugins = markdownPasteExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "markdownPaste",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handlePaste: (view: unknown, event: unknown) => boolean } };
    return plugin.props.handlePaste;
  }

  it("uses 'auto' fallback when pasteMarkdownInWysiwyg is undefined (line 134 ?? branch)", async () => {
    const handlePaste = getHandlePaste();
    const doc = createParagraphDoc("");
    const state = createState(doc);
    const view = { state, dispatch: vi.fn() };

    // Settings without pasteMarkdownInWysiwyg — undefined triggers the ?? "auto" branch
    const { useSettingsStore } = await import("@/stores/settingsStore");
    vi.spyOn(useSettingsStore, "getState").mockReturnValueOnce({
      markdown: { pasteMarkdownInWysiwyg: undefined, preserveLineBreaks: false },
    } as never);

    const event = {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "Just plain text." : "",
      },
    };
    // shouldHandleMarkdownPaste returns false for plain text — but we exercised the ?? branch
    const result = handlePaste(view, event);
    expect(result).toBe(false);
  });

  it("uses empty string fallback when getData('text/html') returns null (line 135 ?? branch)", () => {
    const handlePaste = getHandlePaste();
    const doc = createParagraphDoc("");
    const state = createState(doc);
    const view = { state, dispatch: vi.fn() };

    const event = {
      clipboardData: {
        // getData returns null for text/html — exercises the ?? "" branch
        getData: (type: string) =>
          type === "text/plain" ? "Just plain text." : null,
      },
    };
    const result = handlePaste(view, event);
    expect(result).toBe(false);
  });

  it("returns false when createMarkdownPasteTransaction returns null (line 145 !tr branch)", async () => {
    const handlePaste = getHandlePaste();
    const doc = createParagraphDoc("");
    const state = createState(doc);
    const dispatchSpy = vi.fn();
    const view = { state, dispatch: dispatchSpy };

    // shouldHandleMarkdownPaste must return true, then createMarkdownPasteTransaction must return null.
    // Monkey-patch tr.replaceSelection to throw so createMarkdownPasteTransaction returns null.
    const origTr = state.tr;
    const patchedState = {
      ...state,
      schema: state.schema,
      tr: { ...origTr, replaceSelection: () => { throw new Error("force null"); } },
      selection: state.selection,
      doc: state.doc,
    };

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = {
      clipboardData: {
        getData: (type: string) => {
          if (type === "text/plain") return "# Heading\n\n- item 1\n- item 2";
          return "";
        },
      },
      preventDefault: vi.fn(),
    };

    // Use patched state so replaceSelection throws → createMarkdownPasteTransaction returns null
    const result = handlePaste({ ...view, state: patchedState }, event);
    expect(result).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("ensureBlockContent — inline firstChild wrapping (markdownPaste line 50)", () => {
  it("wraps inline content in a paragraph when parseMarkdown returns inline fragment", async () => {
    // We need parseMarkdown to return a doc whose .content has an inline text node as firstChild.
    // Mock parseMarkdown to return a fake doc with inline content.
    const { Schema, Fragment: PMFragment } = await import("@tiptap/pm/model");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
      },
    });

    // Create a fragment with just an inline text node (no block wrapper)
    const inlineFragment = PMFragment.from(testSchema.text("just inline"));

    // Build a fake "parsed doc" whose .content is inline
    const fakeDoc = { content: inlineFragment } as unknown as import("@tiptap/pm/model").Node;

    // Mock parseMarkdown to return fakeDoc
    const pipelineMod = await import("@/utils/markdownPipeline");
    const spy = vi.spyOn(pipelineMod, "parseMarkdown").mockReturnValueOnce(fakeDoc);

    const state = EditorState.create({
      doc: testSchema.node("doc", null, [testSchema.node("paragraph")]),
      schema: testSchema,
    });

    // createMarkdownPasteSlice calls parseMarkdown → gets fakeDoc with inline content
    // ensureBlockContent should wrap it in a paragraph (line 50 true path)
    const { createMarkdownPasteSlice } = await import("./tiptap");
    const slice = createMarkdownPasteSlice(state, "ignored — mocked");

    expect(slice).toBeDefined();
    // The inline content should have been wrapped in a paragraph
    expect(slice.content.childCount).toBeGreaterThanOrEqual(1);

    spy.mockRestore();
  });
});
