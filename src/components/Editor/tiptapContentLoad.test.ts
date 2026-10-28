// WI-RA18.2 — a content load into the WYSIWYG editor (the initial load, the
// store→editor sync) waits for an IME composition to end and be cleaned up
// instead of replacing the document under the text the browser is composing;
// when it runs it replaces the document as it is THEN; and a load that a newer
// load or the editor's own flush superseded while it waited is dropped, so
// store and editor never settle on different documents.
//
// A real Tiptap editor and the real composition bookkeeping; the composition
// guard's part (ending a composition, flushing the queue) is done by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Transaction } from "@tiptap/pm/state";
import {
  flushProseMirrorCompositionQueue,
  IME_GRACE_PERIOD_MS,
  markProseMirrorCompositionEnd,
} from "@/utils/imeGuard";
import { parseMarkdown } from "@/utils/markdownPipeline";

const reportUnparseableDocument = vi.hoisted(() => vi.fn());
vi.mock("@/services/editor/unparseableDocument", () => ({ reportUnparseableDocument }));

import { setContentWithoutHistory, syncMarkdownToEditor } from "./tiptapContentLoad";
import { hasContentApplied } from "@/services/editor/contentApplied";
import { MAX_NESTING_DEPTH, nestingRefusal } from "@/utils/markdownPipeline/nestingDepth";

let editor: Editor;
let transactions: Transaction[];
let composing: ReturnType<typeof vi.spyOn>;

const docOf = (markdown: string) => parseMarkdown(editor.schema, markdown, { preserveLineBreaks: false });

/** What the composition guard does when the user commits the composition. */
function endComposition(): void {
  composing.mockReturnValue(false);
  markProseMirrorCompositionEnd(editor.view);
  flushProseMirrorCompositionQueue(editor.view);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.advanceTimersByTime(10_000);
  editor = new Editor({ extensions: [StarterKit], content: "<p>old document</p>" });
  transactions = [];
  editor.on("transaction", ({ transaction }) => {
    if (transaction.docChanged) transactions.push(transaction);
  });
  composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(false);
});

afterEach(() => {
  editor.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  reportUnparseableDocument.mockReset();
});

describe("setContentWithoutHistory", () => {
  it("replaces the document at once when nobody is composing", () => {
    expect(setContentWithoutHistory(editor, docOf("new document\n"))).toBe("applied");

    expect(editor.getText()).toBe("new document");
    expect(transactions).toHaveLength(1);
    expect(transactions[0].getMeta("addToHistory")).toBe(false);
    expect(transactions[0].getMeta("preventUpdate")).toBe(true);
  });

  it("waits while a composition is in progress, then through its grace period", () => {
    composing.mockReturnValue(true);

    expect(setContentWithoutHistory(editor, docOf("new document\n"))).toBe("deferred");
    expect(editor.getText()).toBe("old document");
    expect(transactions).toEqual([]);

    endComposition();
    expect(editor.getText()).toBe("old document");
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);
    expect(editor.getText()).toBe("new document");
    expect(transactions).toHaveLength(1);
    expect(transactions[0].getMeta("preventUpdate")).toBe(true);
  });

  it("replaces the document as it is when the load runs, not as it was when asked", () => {
    composing.mockReturnValue(true);
    setContentWithoutHistory(editor, docOf("new document\n"));

    // The composition commits text: the document grows past the size the
    // load would have captured had it built its transaction up front.
    editor.view.dispatch(editor.state.tr.insertText("你好，世界".repeat(20), 1));
    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("new document");
  });

  it("drops a deferred load that is no longer wanted when it would run", () => {
    composing.mockReturnValue(true);
    let wanted = true;
    setContentWithoutHistory(editor, docOf("new document\n"), () => wanted);

    wanted = false;
    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("old document");
    expect(transactions).toEqual([]);
  });

  it("does not ask whether a load it applies at once is still wanted", () => {
    const stillWanted = vi.fn(() => false);
    expect(setContentWithoutHistory(editor, docOf("new document\n"), stillWanted)).toBe("applied");
    expect(stillWanted).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("new document");
  });
});

// WI-OC1.1 — an editor counts as holding its document only once a load has
// actually been written into it: a flush before then would serialize the empty
// placeholder over the document's text.
describe("an editor holds its content only once a load has run", () => {
  it("not before any load", () => {
    expect(hasContentApplied(editor)).toBe(false);
  });

  it("at once, for a load applied at once", () => {
    setContentWithoutHistory(editor, docOf("new document\n"));
    expect(hasContentApplied(editor)).toBe(true);
  });

  it("only when a load waiting behind a composition runs", () => {
    composing.mockReturnValue(true);
    setContentWithoutHistory(editor, docOf("new document\n"));
    expect(hasContentApplied(editor)).toBe(false);

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);
    expect(hasContentApplied(editor)).toBe(true);
  });

  it("never, for a waiting load that was dropped", () => {
    composing.mockReturnValue(true);
    let wanted = true;
    setContentWithoutHistory(editor, docOf("new document\n"), () => wanted);
    wanted = false;
    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);
    expect(hasContentApplied(editor)).toBe(false);
  });
});

describe("syncMarkdownToEditor while a composition is in progress", () => {
  it("reports nothing synced yet, skips a repeat of the same content, and loads it once settled", () => {
    const lastExternalContent = { current: "old document\n" };
    composing.mockReturnValue(true);

    expect(syncMarkdownToEditor(editor, "external change\n", lastExternalContent, false, "tab-1")).toBe(false);
    expect(syncMarkdownToEditor(editor, "external change\n", lastExternalContent, false, "tab-1")).toBe(false);
    expect(editor.getText()).toBe("old document");

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("external change");
    expect(transactions).toHaveLength(1);
    expect(lastExternalContent.current).toBe("external change\n");
  });

  it("drops the load when the editor's own flush superseded it while it waited", () => {
    const lastExternalContent = { current: "old document\n" };
    composing.mockReturnValue(true);
    syncMarkdownToEditor(editor, "external change\n", lastExternalContent, false, "tab-1");

    // The editor flushed what the user composed into the store; the store and
    // the editor now agree on that, and the stale load must not undo it.
    editor.view.dispatch(editor.state.tr.insertText("中文", 1));
    lastExternalContent.current = "中文old document\n";
    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("中文old document");
  });

  it("lets the newest of several waiting loads win, in order", () => {
    const lastExternalContent = { current: "old document\n" };
    composing.mockReturnValue(true);
    syncMarkdownToEditor(editor, "first\n", lastExternalContent, false, "tab-1");
    syncMarkdownToEditor(editor, "second\n", lastExternalContent, false, "tab-1");

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("second");
    expect(lastExternalContent.current).toBe("second\n");
  });
});

describe("syncMarkdownToEditor on a document the parser refuses (#1407)", () => {
  beforeEach(() => {
    editor.commands.setContent("<p>what the user had</p>");
    transactions = [];
  });

  it("keeps the editor's content, and reports the refusal for this tab", () => {
    const lastExternalContent = { current: "what the user had" };
    const tooDeep = `${"> ".repeat(MAX_NESTING_DEPTH + 1)}a\n`;

    const synced = syncMarkdownToEditor(editor, tooDeep, lastExternalContent, false, "tab-7");

    expect(synced).toBe(false);
    expect(editor.getText()).toBe("what the user had");
    // Not marked as synced, so a later successful sync is not skipped.
    expect(lastExternalContent.current).toBe("what the user had");
    expect(reportUnparseableDocument).toHaveBeenCalledTimes(1);
    const [tabId, error] = reportUnparseableDocument.mock.calls[0];
    expect(tabId).toBe("tab-7");
    expect(nestingRefusal(error)).toEqual({ depth: MAX_NESTING_DEPTH + 1, limit: MAX_NESTING_DEPTH });
  });

  it("reports nothing when the content parses", () => {
    const lastExternalContent = { current: "" };
    expect(syncMarkdownToEditor(editor, "# fine\n", lastExternalContent, false, "tab-7")).toBe(true);
    expect(reportUnparseableDocument).not.toHaveBeenCalled();
  });
});

describe("a newer sync the parser refuses supersedes a load waiting behind a composition", () => {
  const tooDeep = `${"> ".repeat(MAX_NESTING_DEPTH + 1)}a\n`;

  it("drops the waiting load: the store has moved past it", () => {
    const lastExternalContent = { current: "old document\n" };
    composing.mockReturnValue(true);
    syncMarkdownToEditor(editor, "queued valid\n", lastExternalContent, false, "tab-1");
    expect(syncMarkdownToEditor(editor, tooDeep, lastExternalContent, false, "tab-1")).toBe(false);

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("old document");
    expect(transactions).toHaveLength(0);
    expect(reportUnparseableDocument).toHaveBeenCalledTimes(1);
  });

  it("drops a waiting initial load too", () => {
    const lastExternalContent = { current: "initial\n" };
    composing.mockReturnValue(true);
    setContentWithoutHistory(editor, docOf("initial"), () => lastExternalContent.current === "initial\n", "initial\n");
    syncMarkdownToEditor(editor, tooDeep, lastExternalContent, false, "tab-1");

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("old document");
  });

  it("a later valid sync after the refusal still loads", () => {
    const lastExternalContent = { current: "old document\n" };
    composing.mockReturnValue(true);
    syncMarkdownToEditor(editor, "queued valid\n", lastExternalContent, false, "tab-1");
    syncMarkdownToEditor(editor, tooDeep, lastExternalContent, false, "tab-1");
    syncMarkdownToEditor(editor, "newest\n", lastExternalContent, false, "tab-1");

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("newest");
  });

  it("a repeat of the dropped load's own text still loads it", () => {
    const lastExternalContent = { current: "old document\n" };
    composing.mockReturnValue(true);
    syncMarkdownToEditor(editor, "queued valid\n", lastExternalContent, false, "tab-1");
    syncMarkdownToEditor(editor, tooDeep, lastExternalContent, false, "tab-1");
    // The editor never held "queued valid": the tracking ref must not say so.
    expect(lastExternalContent.current).toBe("old document\n");
    syncMarkdownToEditor(editor, "queued valid\n", lastExternalContent, false, "tab-1");

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("queued valid");
    expect(lastExternalContent.current).toBe("queued valid\n");
  });

  it("a repeat after two dropped loads restores what the editor held before both", () => {
    const lastExternalContent = { current: "old document\n" };
    composing.mockReturnValue(true);
    syncMarkdownToEditor(editor, "first\n", lastExternalContent, false, "tab-1");
    syncMarkdownToEditor(editor, "second\n", lastExternalContent, false, "tab-1");
    syncMarkdownToEditor(editor, tooDeep, lastExternalContent, false, "tab-1");
    expect(lastExternalContent.current).toBe("old document\n");
    syncMarkdownToEditor(editor, "first\n", lastExternalContent, false, "tab-1");

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("first");
  });

  it("a repeat of a dropped initial load's text still loads it", () => {
    const lastExternalContent = { current: "" };
    composing.mockReturnValue(true);
    setContentWithoutHistory(
      editor, docOf("initial"), () => lastExternalContent.current === "initial\n", "initial\n", lastExternalContent.current,
    );
    lastExternalContent.current = "initial\n";
    syncMarkdownToEditor(editor, tooDeep, lastExternalContent, false, "tab-1");
    expect(lastExternalContent.current).toBe("");
    syncMarkdownToEditor(editor, "initial\n", lastExternalContent, false, "tab-1");

    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);

    expect(editor.getText()).toBe("initial");
  });

  it("a refusal after the waiting load ran keeps the tracking ref: the editor holds it", () => {
    const lastExternalContent = { current: "old document\n" };
    composing.mockReturnValue(true);
    syncMarkdownToEditor(editor, "queued valid\n", lastExternalContent, false, "tab-1");
    endComposition();
    vi.advanceTimersByTime(IME_GRACE_PERIOD_MS);
    syncMarkdownToEditor(editor, tooDeep, lastExternalContent, false, "tab-1");

    expect(lastExternalContent.current).toBe("queued valid\n");
  });
});
