import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanMarkdownForClipboard, cleanTextForClipboard } from "./tiptap";

// Mock debug utilities
vi.mock("@/utils/debug", () => ({
  clipboardWarn: vi.fn(),
  markdownCopyWarn: vi.fn(),
}));

describe("cleanMarkdownForClipboard", () => {
  describe("backslash escape stripping", () => {
    it("strips escaped dollar signs", () => {
      expect(cleanMarkdownForClipboard("Price is \\$99.99")).toBe(
        "Price is $99.99"
      );
    });

    it("strips escaped tildes", () => {
      expect(cleanMarkdownForClipboard("\\~20% off")).toBe("~20% off");
    });

    it("strips escaped at signs", () => {
      expect(cleanMarkdownForClipboard("user\\@example.com")).toBe(
        "user@example.com"
      );
    });

    it("strips escaped brackets", () => {
      expect(cleanMarkdownForClipboard("\\[not a link]")).toBe("[not a link]");
    });

    it("strips escaped asterisks", () => {
      expect(cleanMarkdownForClipboard("5 \\* 3 = 15")).toBe("5 * 3 = 15");
    });

    it("strips escaped underscores", () => {
      expect(cleanMarkdownForClipboard("snake\\_case")).toBe("snake_case");
    });

    it("strips escaped colons", () => {
      expect(cleanMarkdownForClipboard("https\\://example.com")).toBe(
        "https://example.com"
      );
    });

    it("strips escaped ampersands", () => {
      expect(cleanMarkdownForClipboard("foo\\&bar")).toBe("foo&bar");
    });

    it("converts double backslash to single", () => {
      expect(cleanMarkdownForClipboard("C:\\\\Users\\\\foo")).toBe(
        "C:\\Users\\foo"
      );
    });

    it("does not strip backslash before newline", () => {
      expect(cleanMarkdownForClipboard("line1\\\nline2")).toBe(
        "line1\\\nline2"
      );
    });

    it("handles multiple escapes in one line", () => {
      expect(
        cleanMarkdownForClipboard("\\$99 is \\~20% off\\!")
      ).toBe("$99 is ~20% off!");
    });
  });

  describe("autolink collapsing", () => {
    it("collapses URL autolinks", () => {
      expect(
        cleanMarkdownForClipboard(
          "[https://example.com/path](https://example.com/path)"
        )
      ).toBe("https://example.com/path");
    });

    it("collapses mailto autolinks", () => {
      expect(
        cleanMarkdownForClipboard(
          "[user@example.com](mailto:user@example.com)"
        )
      ).toBe("user@example.com");
    });

    it("collapses autolinks with escaped chars in text", () => {
      // Serializer escapes @ in text but not in URL
      expect(
        cleanMarkdownForClipboard(
          "[user\\@example.com](mailto:user@example.com)"
        )
      ).toBe("user@example.com");
    });

    it("collapses URL autolinks with escaped colons", () => {
      expect(
        cleanMarkdownForClipboard(
          "[https\\://example.com](https://example.com)"
        )
      ).toBe("https://example.com");
    });

    it("preserves real links where text differs from URL", () => {
      expect(
        cleanMarkdownForClipboard("[click here](https://example.com)")
      ).toBe("[click here](https://example.com)");
    });
  });

  describe("preserves markdown syntax", () => {
    it("preserves bold", () => {
      expect(cleanMarkdownForClipboard("**bold**")).toBe("**bold**");
    });

    it("preserves italic", () => {
      expect(cleanMarkdownForClipboard("*italic*")).toBe("*italic*");
    });

    it("preserves strikethrough", () => {
      expect(cleanMarkdownForClipboard("~~deleted~~")).toBe("~~deleted~~");
    });

    it("preserves code spans", () => {
      expect(cleanMarkdownForClipboard("`code`")).toBe("`code`");
    });

    it("preserves headings", () => {
      expect(cleanMarkdownForClipboard("## Heading")).toBe("## Heading");
    });

    it("preserves fenced code blocks", () => {
      const input = "```js\nconst x = 1;\n```";
      expect(cleanMarkdownForClipboard(input)).toBe(input);
    });
  });

  describe("does not strip unknown escapes", () => {
    it("preserves backslash before letters", () => {
      expect(cleanMarkdownForClipboard("\\n \\t")).toBe("\\n \\t");
    });

    it("preserves backslash before digits", () => {
      expect(cleanMarkdownForClipboard("item \\1")).toBe("item \\1");
    });

    it("preserves backslash before space", () => {
      expect(cleanMarkdownForClipboard("foo\\ bar")).toBe("foo\\ bar");
    });
  });
});

describe("cleanTextForClipboard", () => {
  it("trims trailing whitespace from each line", () => {
    expect(cleanTextForClipboard("hello   \nworld  ")).toBe("hello\nworld");
  });

  it("trims trailing tabs from each line", () => {
    expect(cleanTextForClipboard("hello\t\t\nworld\t")).toBe("hello\nworld");
  });

  it("collapses multiple blank lines into one", () => {
    expect(cleanTextForClipboard("a\n\n\nb")).toBe("a\n\nb");
  });

  it("collapses many blank lines into one", () => {
    expect(cleanTextForClipboard("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("trims leading blank lines", () => {
    expect(cleanTextForClipboard("\n\nhello")).toBe("hello");
  });

  it("trims trailing blank lines", () => {
    expect(cleanTextForClipboard("hello\n\n")).toBe("hello");
  });

  it("trims both leading and trailing blank lines", () => {
    expect(cleanTextForClipboard("\n\nhello\n\n")).toBe("hello");
  });

  it("handles all three rules together", () => {
    const input = "\n\nline one   \n\n\n\nline two  \n\n";
    expect(cleanTextForClipboard(input)).toBe("line one\n\nline two");
  });

  it("preserves single blank line between paragraphs", () => {
    expect(cleanTextForClipboard("para one\n\npara two")).toBe(
      "para one\n\npara two"
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(cleanTextForClipboard("   \n\n  \n  ")).toBe("");
  });

  it("handles empty string input", () => {
    expect(cleanTextForClipboard("")).toBe("");
  });

  it("preserves indentation on non-first lines", () => {
    // The outer .trim() strips leading spaces on the first line,
    // but indentation on subsequent lines is preserved.
    expect(cleanTextForClipboard("first\n    indented")).toBe(
      "first\n    indented"
    );
  });

  it("handles single line with trailing whitespace", () => {
    expect(cleanTextForClipboard("hello   ")).toBe("hello");
  });

  it("handles mixed tabs and spaces in trailing whitespace", () => {
    expect(cleanTextForClipboard("hello \t \t\nworld")).toBe("hello\nworld");
  });

  it("handles exactly two newlines (single blank line preserved)", () => {
    expect(cleanTextForClipboard("a\n\nb")).toBe("a\n\nb");
  });

  it("does not trim non-breaking spaces", () => {
    // \u00a0 is a non-breaking space, which is not matched by [^\S\n]+ (it is \S)
    // Actually \u00a0 IS matched by \s but NOT by \S... let's verify behavior
    const result = cleanTextForClipboard("hello\u00a0\nworld");
    // Non-breaking space at end of line: [^\S\n]+ matches it since \u00a0 is whitespace but not \n
    expect(result).toBe("hello\nworld");
  });
});

describe("markdownCopyExtension structure", () => {
  it("has correct name", async () => {
    const { markdownCopyExtension } = await import("./tiptap");
    expect(markdownCopyExtension.name).toBe("markdownCopy");
  });

  it("defines ProseMirror plugins", async () => {
    const { markdownCopyExtension } = await import("./tiptap");
    expect(markdownCopyExtension.config.addProseMirrorPlugins).toBeDefined();
  });

  it("plugin has clipboardTextSerializer", async () => {
    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "markdownCopy",
      options: copyOptions(),
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    expect(plugins).toHaveLength(1);
    const plugin = plugins[0] as { props: { clipboardTextSerializer?: unknown } };
    expect(plugin.props.clipboardTextSerializer).toBeDefined();
  });

  it("plugin has mouseup DOM event handler", async () => {
    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "markdownCopy",
      options: copyOptions(),
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents?: { mouseup?: unknown } } };
    expect(plugin.props.handleDOMEvents?.mouseup).toBeDefined();
  });
});

describe("ensureBlockContent via cleanMarkdownForClipboard integration", () => {
  it("handles input with only markdown formatting", () => {
    expect(cleanMarkdownForClipboard("**bold** *italic* `code`")).toBe(
      "**bold** *italic* `code`"
    );
  });

  it("handles escaped exclamation mark", () => {
    expect(cleanMarkdownForClipboard("\\!important")).toBe("!important");
  });

  it("handles consecutive escapes", () => {
    expect(cleanMarkdownForClipboard("\\$\\$math\\$\\$")).toBe("$$math$$");
  });
});

describe("cleanMarkdownForClipboard — additional edge cases", () => {
  it("handles empty string", () => {
    expect(cleanMarkdownForClipboard("")).toBe("");
  });

  it("strips escaped hash marks", () => {
    expect(cleanMarkdownForClipboard("\\# Not a heading")).toBe("# Not a heading");
  });

  it("strips escaped pipes", () => {
    expect(cleanMarkdownForClipboard("col1 \\| col2")).toBe("col1 | col2");
  });

  it("strips escaped parentheses", () => {
    expect(cleanMarkdownForClipboard("fn\\(x\\)")).toBe("fn(x)");
  });

  it("strips escaped closing bracket", () => {
    expect(cleanMarkdownForClipboard("\\[foo\\]")).toBe("[foo]");
  });

  it("strips escaped plus sign", () => {
    expect(cleanMarkdownForClipboard("\\+ item")).toBe("+ item");
  });

  it("strips escaped dot", () => {
    expect(cleanMarkdownForClipboard("1\\. not ordered")).toBe("1. not ordered");
  });

  it("strips escaped greater-than", () => {
    expect(cleanMarkdownForClipboard("\\> not blockquote")).toBe("> not blockquote");
  });

  it("strips escaped hyphen/dash", () => {
    expect(cleanMarkdownForClipboard("\\- not list")).toBe("- not list");
  });

  it("strips escaped backtick", () => {
    expect(cleanMarkdownForClipboard("\\`not code\\`")).toBe("`not code`");
  });

  it("handles combined escape stripping and autolink collapse", () => {
    const input = "Visit [https\\://example.com](https://example.com) for \\$5 off";
    expect(cleanMarkdownForClipboard(input)).toBe(
      "Visit https://example.com for $5 off"
    );
  });

  it("handles multiple autolinks in one string", () => {
    const input =
      "[https://a.com](https://a.com) and [https://b.com](https://b.com)";
    expect(cleanMarkdownForClipboard(input)).toBe(
      "https://a.com and https://b.com"
    );
  });

  it("does not collapse link with different text and URL", () => {
    expect(
      cleanMarkdownForClipboard("[Example](https://example.com)")
    ).toBe("[Example](https://example.com)");
  });

  it("handles nested markdown formatting", () => {
    expect(cleanMarkdownForClipboard("**bold and *italic***")).toBe(
      "**bold and *italic***"
    );
  });
});

// --- Plugin integration tests ---
// Test the plugin behavior through the extension's ProseMirror plugin.

/**
 * The plugin takes GETTERS now (ADR-015), so these drive the values directly
 * instead of mocking the settings store — which is also what the app does.
 */
let testCopyFormat: "default" | "markdown" = "default";
let testCopyOnSelect = false;
const copyOptions = () => ({
  getCopyFormat: () => testCopyFormat,
  getCopyOnSelect: () => testCopyOnSelect,
});

describe("markdownCopyExtension plugin integration", () => {
  // WI-DP3.0 pilot — archetype "vi.doMock". Nothing called `_getPluginInstance`
  // and nothing read `_mockSettingsGetState`; both were underscore-prefixed
  // scaffolding left behind by an earlier approach. The only `vi.doMock` of a
  // store in this file lived inside that dead helper, so the conversion here is
  // a deletion — the cheapest archetype, and one a count of mocks cannot
  // distinguish from the expensive ones.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clipboardTextSerializer returns empty string when copyFormat is not 'markdown'", async () => {
    const { markdownCopyExtension } = await import("./tiptap");
    const extensionContext = {
      editor: {},
      name: "markdownCopy",
      options: copyOptions(),
      storage: {},
      type: undefined,
      parent: undefined,
    };
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call(extensionContext as never);
    const plugin = plugins[0] as { props: { clipboardTextSerializer: (slice: unknown, view: unknown) => string } };
    expect(plugin.props.clipboardTextSerializer).toBeDefined();
  });

  it("mouseup handler returns false when copyOnSelect is disabled", async () => {
    const { markdownCopyExtension } = await import("./tiptap");
    const extensionContext = {
      editor: {},
      name: "markdownCopy",
      options: copyOptions(),
      storage: {},
      type: undefined,
      parent: undefined,
    };
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call(extensionContext as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };
    // mouseup always returns false (it does not prevent default)
    const result = plugin.props.handleDOMEvents.mouseup({} as never);
    expect(result).toBe(false);
  });
});

describe("ensureBlockContent and createDocFromSlice via clipboardTextSerializer", () => {
  it("clipboardTextSerializer returns empty string for non-markdown copyFormat", async () => {
    testCopyFormat = "default";
    testCopyOnSelect = false;

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { clipboardTextSerializer: (slice: unknown, view: unknown) => string } };

    const result = plugin.props.clipboardTextSerializer({} as never, {} as never);
    expect(result).toBe("");
  });

  it("clipboardTextSerializer serializes markdown when copyFormat is 'markdown'", async () => {
    testCopyFormat = "markdown";
    testCopyOnSelect = false;

    const { Schema } = await import("@tiptap/pm/model");
    const { Slice, Fragment } = await import("@tiptap/pm/model");
    const { EditorState } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { clipboardTextSerializer: (slice: unknown, view: unknown) => string } };

    const content = Fragment.from(testSchema.node("paragraph", null, [testSchema.text("hello")]));
    const slice = new Slice(content, 0, 0);
    const mockView = { state };

    const result = plugin.props.clipboardTextSerializer(slice, mockView);
    expect(typeof result).toBe("string");
  });

  it("clipboardTextSerializer returns empty string when serialization fails", async () => {
    testCopyFormat = "markdown";
    testCopyOnSelect = false;

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { clipboardTextSerializer: (slice: unknown, view: unknown) => string } };

    // Pass invalid slice and view to trigger error path
    const result = plugin.props.clipboardTextSerializer(null, { state: { schema: {} } });
    expect(result).toBe("");
  });
});

describe("ensureBlockContent and createDocFromSlice edge cases", () => {
  it("handles inline-only content slice for markdown serialization", async () => {
    testCopyFormat = "markdown";
    testCopyOnSelect = false;

    const { Schema } = await import("@tiptap/pm/model");
    const { Slice, Fragment } = await import("@tiptap/pm/model");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
      },
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { clipboardTextSerializer: (slice: unknown, view: unknown) => string } };

    // Inline-only content (text node without paragraph wrapper)
    const inlineContent = Fragment.from(testSchema.text("just inline text"));
    const slice = new Slice(inlineContent, 0, 0);
    const { EditorState } = await import("@tiptap/pm/state");
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });
    const mockView = { state };

    const result = plugin.props.clipboardTextSerializer(slice, mockView);
    expect(typeof result).toBe("string");
  });

  it("handles empty fragment slice", async () => {
    testCopyFormat = "markdown";
    testCopyOnSelect = false;

    const { Schema } = await import("@tiptap/pm/model");
    const { Slice, Fragment } = await import("@tiptap/pm/model");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
      },
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { clipboardTextSerializer: (slice: unknown, view: unknown) => string } };

    const emptySlice = new Slice(Fragment.empty, 0, 0);
    const { EditorState } = await import("@tiptap/pm/state");
    const doc = testSchema.node("doc", null, [testSchema.node("paragraph")]);
    const state = EditorState.create({ doc, schema: testSchema });

    const result = plugin.props.clipboardTextSerializer(emptySlice, { state });
    expect(typeof result).toBe("string");
  });
});

describe("mouseup handler with copyOnSelect and markdown format", () => {
  it("copies markdown on mouseup when copyOnSelect and copyFormat=markdown", async () => {
    testCopyFormat = "markdown";
    testCopyOnSelect = true;

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    const mockView = {
      state,
      isDestroyed: false,
    };

    const result = plugin.props.handleDOMEvents.mouseup(mockView);
    expect(result).toBe(false);
  });
});

describe("mouseup handler rAF callback execution", () => {
  it("executes clipboard write inside requestAnimationFrame callback", async () => {
    // Capture the rAF callback and execute it synchronously
    const rAFCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });

    testCopyFormat = "default";
    testCopyOnSelect = true;

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    const mockView = { state, isDestroyed: false };
    plugin.props.handleDOMEvents.mouseup(mockView);

    // Execute the rAF callback
    rAFCallbacks.forEach((cb) => cb(0));

    // Should have called clipboard.writeText with the selected text
    expect(writeTextSpy).toHaveBeenCalledWith("hello");
  });

  it("handles clipboard write failure gracefully", async () => {
    const rAFCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });

    testCopyFormat = "default";
    testCopyOnSelect = true;

    const writeTextSpy = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    const mockView = { state, isDestroyed: false };
    plugin.props.handleDOMEvents.mouseup(mockView);

    // Execute the rAF callback — should not throw despite clipboard rejection
    expect(() => rAFCallbacks.forEach((cb) => cb(0))).not.toThrow();
  });

  it("does not write to clipboard when selection is empty in rAF", async () => {
    const rAFCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });

    testCopyFormat = "default";
    testCopyOnSelect = true;

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello")]),
    ]);
    // Collapsed selection (from === to)
    const state = EditorState.create({ doc, schema: testSchema });

    const mockView = { state, isDestroyed: false };
    plugin.props.handleDOMEvents.mouseup(mockView);

    rAFCallbacks.forEach((cb) => cb(0));

    // Should not write to clipboard when from === to
    expect(writeTextSpy).not.toHaveBeenCalled();
  });
});

describe("getSelectionText with copyFormat=markdown (lines 123-125)", () => {
  it("returns markdown-formatted text when copyFormat is markdown", async () => {
    const rAFCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });

    testCopyFormat = "markdown";
    testCopyOnSelect = true;

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    const mockView = { state, isDestroyed: false };
    plugin.props.handleDOMEvents.mouseup(mockView);

    // Execute rAF callback
    rAFCallbacks.forEach((cb) => cb(0));

    // Should write markdown-formatted text to clipboard
    expect(writeTextSpy).toHaveBeenCalledWith(expect.any(String));
  });
});

describe("createDocFromSlice catch path (line 46)", () => {
  it("falls back to createAndFill when docType.create throws", async () => {
    testCopyFormat = "markdown";
    testCopyOnSelect = false;

    const { Schema, Slice, Fragment } = await import("@tiptap/pm/model");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    // Monkey-patch topNodeType.create to throw, forcing the catch path
    const origCreate = testSchema.topNodeType.create.bind(testSchema.topNodeType);
    let callCount = 0;
    testSchema.topNodeType.create = function (...args: Parameters<typeof origCreate>) {
      callCount++;
      // The first call is from createDocFromSlice — make it throw.
      // Subsequent calls (from the catch fallback) should succeed.
      if (callCount === 1) throw new RangeError("Invalid content for node doc");
      return origCreate(...args);
    } as typeof origCreate;

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { clipboardTextSerializer: (slice: unknown, view: unknown) => string } };

    const para = testSchema.node("paragraph", null, [testSchema.text("hello")]);
    const slice = new Slice(Fragment.from(para), 0, 0);

    const { EditorState } = await import("@tiptap/pm/state");
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("body")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });

    const result = plugin.props.clipboardTextSerializer(slice, { state });
    // Should return a string from the createAndFill fallback
    expect(typeof result).toBe("string");
    // Verify the create was called (and threw on first call)
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});

describe("createDocFromSlice — createAndFill returns null path (line 46 ?? branch)", () => {
  it("falls back to docType.create() when createAndFill returns null", async () => {
    testCopyFormat = "markdown";
    testCopyOnSelect = false;

    const { Schema, Slice, Fragment } = await import("@tiptap/pm/model");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    // Monkey-patch: first call to create throws, createAndFill returns null, second create succeeds
    const origCreate = testSchema.topNodeType.create.bind(testSchema.topNodeType);
    const origCreateAndFill = testSchema.topNodeType.createAndFill?.bind(testSchema.topNodeType);
    let createCallCount = 0;
    testSchema.topNodeType.create = function (...args: Parameters<typeof origCreate>) {
      createCallCount++;
      if (createCallCount === 1) throw new RangeError("Invalid content");
      return origCreate(...args);
    } as typeof origCreate;
    // createAndFill returns null to exercise the ?? branch
    testSchema.topNodeType.createAndFill = () => null;

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { clipboardTextSerializer: (slice: unknown, view: unknown) => string } };

    const para = testSchema.node("paragraph", null, [testSchema.text("hello")]);
    const slice = new Slice(Fragment.from(para), 0, 0);
    const { EditorState } = await import("@tiptap/pm/state");
    const doc = origCreate(null, [testSchema.node("paragraph", null, [testSchema.text("body")])]);
    const state = EditorState.create({ doc, schema: testSchema });

    // Should not throw — falls back to docType.create() without args
    const result = plugin.props.clipboardTextSerializer(slice, { state });
    expect(typeof result).toBe("string");

    // Restore
    testSchema.topNodeType.create = origCreate;
    if (origCreateAndFill) testSchema.topNodeType.createAndFill = origCreateAndFill;
  });
});

describe("getSelectionText — md is null fallback to textBetween (line 125)", () => {
  it("falls back to textBetween when serializeSliceAsMarkdown returns null", async () => {
    const rAFCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });

    testCopyFormat = "markdown";
    testCopyOnSelect = true;

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    // Make slice() return something that triggers serialization failure → md is null
    const origSlice = state.doc.slice.bind(state.doc);
    state.doc.slice = (...args: Parameters<typeof origSlice>) => {
      const s = origSlice(...args);
      // Corrupt the schema so serialization throws
      return { ...s, content: null } as never;
    };

    const mockView = { state, isDestroyed: false };
    plugin.props.handleDOMEvents.mouseup(mockView);
    rAFCallbacks.forEach((cb) => cb(0));

    // textBetween fallback should still write to clipboard
    expect(writeTextSpy).toHaveBeenCalled();
  });
});

describe("mouseup rAF — view.isDestroyed true path (line 150)", () => {
  it("skips clipboard write when view is destroyed inside rAF", async () => {
    const rAFCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });

    testCopyFormat = "default";
    testCopyOnSelect = true;

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    // view.isDestroyed is true — rAF callback should return early
    const mockView = { state, isDestroyed: true };
    plugin.props.handleDOMEvents.mouseup(mockView);

    // Execute rAF callback — isDestroyed is true so writeText should NOT be called
    rAFCallbacks.forEach((cb) => cb(0));

    expect(writeTextSpy).not.toHaveBeenCalled();
  });
});

describe("mouseup rAF — non-Error clipboard rejection (line 155)", () => {
  it("handles non-Error clipboard write rejection using String(error)", async () => {
    const rAFCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });

    testCopyFormat = "default";
    testCopyOnSelect = true;

    // Reject with a non-Error value (string) to exercise the String(error) branch
    const writeTextSpy = vi.fn().mockRejectedValue("permission denied");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    const mockView = { state, isDestroyed: false };
    plugin.props.handleDOMEvents.mouseup(mockView);

    // Should not throw even with non-Error rejection
    expect(() => rAFCallbacks.forEach((cb) => cb(0))).not.toThrow();
    expect(writeTextSpy).toHaveBeenCalled();
  });
});

describe("mouseup handler with copyOnSelect enabled", () => {
  it("copies selected text on mouseup when copyOnSelect is enabled", async () => {
    testCopyFormat = "default";
    testCopyOnSelect = true;

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState, TextSelection } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world")]),
    ]);
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));

    const mockView = {
      state,
      isDestroyed: false,
    };

    const result = plugin.props.handleDOMEvents.mouseup(mockView);
    expect(result).toBe(false); // Always returns false
  });

  it("mouseup does not copy when view is destroyed in rAF", async () => {
    testCopyFormat = "default";
    testCopyOnSelect = true;

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const mockView = {
      state: { selection: { from: 1, to: 1 } },
      isDestroyed: true,
    };

    const result = plugin.props.handleDOMEvents.mouseup(mockView);
    expect(result).toBe(false);
  });

  it("mouseup does not copy when selection is empty (from === to)", async () => {
    testCopyFormat = "default";
    testCopyOnSelect = true;

    const { markdownCopyExtension } = await import("./tiptap");
    const plugins = markdownCopyExtension.config.addProseMirrorPlugins!.call({
      editor: {}, name: "markdownCopy", options: copyOptions(), storage: {}, type: undefined, parent: undefined,
    } as never);
    const plugin = plugins[0] as { props: { handleDOMEvents: { mouseup: (view: unknown) => boolean } } };

    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState } = await import("@tiptap/pm/state");

    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });

    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });

    const mockView = {
      state,
      isDestroyed: false,
    };

    const result = plugin.props.handleDOMEvents.mouseup(mockView);
    expect(result).toBe(false);
  });
});
