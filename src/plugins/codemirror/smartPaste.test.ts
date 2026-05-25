/**
 * Tests for Smart Paste Plugin (CodeMirror)
 *
 * Tests the paste event handler logic: markdown link creation from URLs,
 * image paste delegation, and AI markdown cleanup.
 *
 * The plugin uses EditorView.domEventHandlers which registers handlers on
 * CM's contentDOM. We test by creating a live view with the extension and
 * dispatching paste events. Note: CodeMirror's own paste handler also calls
 * preventDefault, so we verify behavior via document state and mock calls
 * rather than defaultPrevented for "not handled" cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockTryImagePaste = vi.fn(() => false);
const mockCleanPastedMarkdown = vi.fn((text: string) => text);
const mockIsValidUrl = vi.fn((text: string) => /^https?:\/\//.test(text));

vi.mock("./smartPasteImage", () => ({
  tryImagePaste: (...args: unknown[]) => mockTryImagePaste(...args),
}));

vi.mock("@/utils/cleanPastedMarkdown", () => ({
  cleanPastedMarkdown: (...args: unknown[]) => mockCleanPastedMarkdown(...args),
}));

vi.mock("./smartPasteUtils", () => ({
  isValidUrl: (...args: unknown[]) => mockIsValidUrl(...args),
}));

const mockHtmlToMarkdown = vi.fn((_html: string) => "");
const mockIsSubstantialHtml = vi.fn((_html: string) => false);
vi.mock("@/utils/htmlToMarkdown", () => ({
  htmlToMarkdown: (...args: unknown[]) => mockHtmlToMarkdown(...args),
  isSubstantialHtml: (...args: unknown[]) => mockIsSubstantialHtml(...args),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({ markdown: { pasteMode: "smart" } })),
    subscribe: vi.fn(() => () => {}),
  },
  useShortcutsStore: {
    getState: () => ({ getShortcut: () => "" }),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock("@/plugins/sourceContextDetection/codeFenceDetection", () => ({
  getCodeFenceInfo: vi.fn(() => null),
}));

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createSmartPastePlugin } from "./smartPaste";

const createdViews: EditorView[] = [];

afterEach(() => {
  createdViews.forEach((v) => v.destroy());
  createdViews.length = 0;
});

function createView(
  content: string,
  anchor: number,
  head?: number
): EditorView {
  const extension = createSmartPastePlugin();
  const state = EditorState.create({
    doc: content,
    selection: { anchor, head: head ?? anchor },
    extensions: [extension],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ state, parent: container });
  createdViews.push(view);
  return view;
}

/**
 * Create a minimal ClipboardData-like object for jsdom which lacks DataTransfer.
 */
function makeClipboardData(text: string, html?: string): DataTransfer {
  const data: Record<string, string> = { "text/plain": text };
  if (html) data["text/html"] = html;
  return {
    getData: (type: string) => data[type] ?? "",
    setData: (type: string, value: string) => { data[type] = value; },
    types: Object.keys(data),
  } as unknown as DataTransfer;
}

/**
 * Dispatch a paste event on the view's contentDOM.
 */
function dispatchPaste(view: EditorView, text: string): void {
  const clipboardData = makeClipboardData(text);
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  view.contentDOM.dispatchEvent(event);
}

/**
 * Dispatch a paste event with null clipboardData (no text/plain).
 */
function dispatchPasteNoData(view: EditorView): void {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => "", types: [] },
  });
  view.contentDOM.dispatchEvent(event);
}

describe("createSmartPastePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTryImagePaste.mockReturnValue(false);
    mockCleanPastedMarkdown.mockImplementation((t: string) => t);
    mockIsValidUrl.mockImplementation((text: string) => /^https?:\/\//.test(text));
  });

  describe("export", () => {
    it("returns a valid extension", () => {
      const extension = createSmartPastePlugin();
      expect(extension).toBeDefined();
    });

    it("extension integrates with EditorView", () => {
      const view = createView("hello", 0);
      expect(view.state.doc.toString()).toBe("hello");
    });
  });

  describe("empty / null paste data", () => {
    it("does not invoke any handler for paste with no text/plain", () => {
      const view = createView("hello", 0);
      dispatchPasteNoData(view);

      // Handler returns early — no downstream calls
      expect(mockTryImagePaste).not.toHaveBeenCalled();
      expect(mockCleanPastedMarkdown).not.toHaveBeenCalled();
    });

    it("does not invoke any handler for empty string paste", () => {
      const view = createView("hello", 0);
      dispatchPaste(view, "");

      // getData returns "" which is falsy → handler returns false early
      expect(mockTryImagePaste).not.toHaveBeenCalled();
      expect(mockCleanPastedMarkdown).not.toHaveBeenCalled();
    });
  });

  describe("image paste delegation", () => {
    it("delegates to tryImagePaste when it handles the paste", () => {
      mockTryImagePaste.mockReturnValue(true);
      const view = createView("hello", 0);
      dispatchPaste(view, "/path/to/image.png");

      expect(mockTryImagePaste).toHaveBeenCalledWith(view, "/path/to/image.png");
      // Doc unchanged — image handler consumed the event
      expect(view.state.doc.toString()).toBe("hello");
    });

    it("continues when tryImagePaste returns false", () => {
      mockTryImagePaste.mockReturnValue(false);
      const view = createView("hello", 0);
      dispatchPaste(view, "plain text");

      expect(mockTryImagePaste).toHaveBeenCalledWith(view, "plain text");
      // cleanPastedMarkdown should still be called
      expect(mockCleanPastedMarkdown).toHaveBeenCalledWith("plain text");
    });

    it("image paste takes priority over URL link creation", () => {
      mockTryImagePaste.mockReturnValue(true);
      const view = createView("hello", 0, 5);
      dispatchPaste(view, "https://example.com/image.png");

      expect(mockTryImagePaste).toHaveBeenCalled();
      // Doc unchanged — image handler consumed it before link creation
      expect(view.state.doc.toString()).toBe("hello");
    });
  });

  describe("markdown cleanup", () => {
    it("inserts cleaned text when cleanPastedMarkdown modifies it", () => {
      mockCleanPastedMarkdown.mockReturnValue("cleaned text");
      const view = createView("hello", 5, 5);
      dispatchPaste(view, "dirty text");

      expect(mockCleanPastedMarkdown).toHaveBeenCalledWith("dirty text");
      expect(view.state.doc.toString()).toBe("hellocleaned text");
    });

    it("replaces selection when cleaning markdown with selection", () => {
      mockCleanPastedMarkdown.mockReturnValue("clean");
      const view = createView("hello world", 0, 5);
      dispatchPaste(view, "dirty");

      expect(view.state.doc.toString()).toBe("clean world");
    });

    it("places cursor after cleaned text insertion", () => {
      mockCleanPastedMarkdown.mockReturnValue("ABC");
      const view = createView("hello", 5, 5);
      dispatchPaste(view, "dirty");

      // Cursor at end: "hello" (5) + "ABC" (3) = 8
      expect(view.state.selection.main.anchor).toBe(8);
    });

    it("does not dispatch custom changes when cleaned text is identical", () => {
      mockCleanPastedMarkdown.mockImplementation((t: string) => t);
      const view = createView("hello", 5, 5);
      dispatchPaste(view, "same text");

      // Not a URL, no selection → falls through to default CM paste
      // isValidUrl should not be called (no selection, from === to)
      expect(mockIsValidUrl).not.toHaveBeenCalled();
    });

    it("markdown cleanup takes priority over URL link creation", () => {
      mockCleanPastedMarkdown.mockReturnValue("cleaned URL text");
      const view = createView("hello world", 0, 5);
      dispatchPaste(view, "https://example.com");

      // Should use cleaned text, not create a link
      expect(view.state.doc.toString()).toBe("cleaned URL text world");
    });
  });

  describe("URL paste over selection (link creation)", () => {
    it("creates markdown link when pasting URL over selected text", () => {
      const view = createView("hello world", 0, 5);
      dispatchPaste(view, "https://example.com");

      expect(view.state.doc.toString()).toBe("[hello](https://example.com) world");
    });

    it("does not create link when there is no selection", () => {
      const view = createView("hello world", 5, 5);
      dispatchPaste(view, "https://example.com");

      // No selection → handler returns false, isValidUrl never called
      expect(mockIsValidUrl).not.toHaveBeenCalled();
    });

    it("does not create link when pasted text is not a URL", () => {
      mockIsValidUrl.mockReturnValue(false);
      const view = createView("hello world", 0, 5);
      dispatchPaste(view, "not a url");

      expect(mockIsValidUrl).toHaveBeenCalledWith("not a url");
      // Doc is unchanged from our handler (CM default paste may change it)
    });

    it("does not wrap if selected text already looks like a markdown link", () => {
      const mdLink = "[text](url)";
      const view = createView(mdLink, 0, mdLink.length);
      dispatchPaste(view, "https://example.com");

      // Already a markdown link → handler returns false
      // Verify the doc was NOT changed to a double-wrapped link
      expect(view.state.doc.toString()).not.toContain("[[text]");
    });

    it("trims whitespace from pasted URL", () => {
      const view = createView("hello world", 0, 5);
      dispatchPaste(view, "  https://example.com  ");

      expect(view.state.doc.toString()).toBe("[hello](https://example.com) world");
    });

    it("places cursor after inserted link", () => {
      const view = createView("hello world", 0, 5);
      dispatchPaste(view, "https://example.com");

      const expectedLink = "[hello](https://example.com)";
      expect(view.state.selection.main.anchor).toBe(expectedLink.length);
    });

    it("handles http URL", () => {
      const view = createView("click here", 0, 10);
      dispatchPaste(view, "http://example.com");

      expect(view.state.doc.toString()).toBe("[click here](http://example.com)");
    });

    it("handles URL with path and query string", () => {
      const view = createView("docs", 0, 4);
      dispatchPaste(view, "https://example.com/path?q=1");

      expect(view.state.doc.toString()).toBe("[docs](https://example.com/path?q=1)");
    });

    it("handles URL with fragment identifier", () => {
      const view = createView("heading", 0, 7);
      dispatchPaste(view, "https://example.com/page#section");

      expect(view.state.doc.toString()).toBe("[heading](https://example.com/page#section)");
    });

    it("handles single character selection", () => {
      const view = createView("a", 0, 1);
      dispatchPaste(view, "https://example.com");

      expect(view.state.doc.toString()).toBe("[a](https://example.com)");
    });

    it("handles multiline selected text", () => {
      const view = createView("hello\nworld", 0, 11);
      dispatchPaste(view, "https://example.com");

      expect(view.state.doc.toString()).toBe("[hello\nworld](https://example.com)");
    });

    it("handles CJK selection", () => {
      const view = createView("你好世界", 0, 4);
      dispatchPaste(view, "https://example.com/page");

      expect(view.state.doc.toString()).toBe("[你好世界](https://example.com/page)");
    });

    it("handles mid-document selection", () => {
      const view = createView("before target after", 7, 13);
      dispatchPaste(view, "https://example.com");

      expect(view.state.doc.toString()).toBe("before [target](https://example.com) after");
    });

    it("handles paste over entire document", () => {
      const view = createView("hello", 0, 5);
      dispatchPaste(view, "https://example.com");

      expect(view.state.doc.toString()).toBe("[hello](https://example.com)");
    });
  });

  describe("handler priority chain", () => {
    it("image paste > markdown cleanup > URL link", () => {
      // When image paste handles it, nothing else runs
      mockTryImagePaste.mockReturnValue(true);
      const view = createView("hello", 0, 5);
      dispatchPaste(view, "https://example.com");

      expect(mockTryImagePaste).toHaveBeenCalled();
      expect(mockCleanPastedMarkdown).not.toHaveBeenCalled();
      expect(mockIsValidUrl).not.toHaveBeenCalled();
    });

    it("when cleanup modifies text, URL link creation is skipped", () => {
      mockCleanPastedMarkdown.mockReturnValue("modified");
      const view = createView("hello", 0, 5);
      dispatchPaste(view, "https://example.com");

      expect(mockCleanPastedMarkdown).toHaveBeenCalled();
      expect(mockIsValidUrl).not.toHaveBeenCalled();
      // Cleaned text replaces selection
      expect(view.state.doc.toString()).toBe("modified");
    });

    it("when cleanup returns same text, URL check proceeds", () => {
      mockCleanPastedMarkdown.mockImplementation((t: string) => t);
      const view = createView("hello", 0, 5);
      dispatchPaste(view, "https://example.com");

      expect(mockCleanPastedMarkdown).toHaveBeenCalled();
      expect(mockIsValidUrl).toHaveBeenCalledWith("https://example.com");
    });
  });

  describe("HTML paste to markdown (smart mode)", () => {
    function dispatchPasteWithHtml(view: EditorView, text: string, html: string): void {
      const clipboardData = makeClipboardData(text, html);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      view.contentDOM.dispatchEvent(event);
    }

    beforeEach(() => {
      mockIsSubstantialHtml.mockReturnValue(true);
    });

    it("converts substantial HTML to markdown", () => {
      mockHtmlToMarkdown.mockReturnValue("**bold text**");

      const view = createView("hello", 5, 5);
      dispatchPasteWithHtml(view, "bold text", "<b>bold text</b>");

      expect(view.state.doc.toString()).toBe("hello**bold text**");
    });

    it("falls through when HTML is not substantial", () => {
      mockIsSubstantialHtml.mockReturnValue(false);

      const view = createView("hello", 5, 5);
      dispatchPasteWithHtml(view, "plain text", "<p>plain text</p>");

      // Should not have converted — falls through to default paste
      expect(mockHtmlToMarkdown).not.toHaveBeenCalled();
    });
  });
});
