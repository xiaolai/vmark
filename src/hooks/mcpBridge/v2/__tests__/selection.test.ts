// WI-2.1 — vmark.selection.{get, set} bridge handlers covering WYSIWYG +
// source modes, STALE concurrency, and the NO_EDITOR error path.
// Restored after MCP pruning to avoid full-doc round-trips on large files
// (see dev-docs/plans/20260504-mcp-pruning.md ADR-7).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore, generateRevisionId } from "@/stores/revisionStore";
import { useEditorStore } from "@/stores/editorStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useMcpCheckpointStore } from "@/stores/mcpCheckpointStore";
import { handleSelectionGet, handleSelectionSet } from "../selection";

vi.mock("../../utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

vi.mock("@/stores/mcpCheckpointPersistence", () => ({
  appendCheckpoint: vi.fn(async () => undefined),
}));

import { respond } from "../../utils";

// Track resources for teardown.
const cmViews: CMView[] = [];
const cmContainers: HTMLElement[] = [];
let tiptapEditor: Editor | null = null;

function resetStores() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
  useMcpCheckpointStore.setState({ checkpoints: [], hydrated: false });
  useEditorStore.setState({ sourceMode: false });
  useActiveEditorStore.setState({
    activeWysiwygEditor: null,
    activeSourceView: null,
  });
}

function seedTab(tabId: string, content: string, filePath: string | null) {
  useTabStore.setState({
    tabs: { main: [{ id: tabId, filePath, title: tabId, isPinned: false }] },
    activeTabId: { main: tabId },
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.getState().initDocument(tabId, content, filePath);
}

function makeTiptap(
  initialContent: string,
  from: number,
  to: number,
  tabId: string = focusedTabIdForHelpers(),
) {
  tiptapEditor = new Editor({
    extensions: [StarterKit],
    content: initialContent,
  });
  tiptapEditor.commands.setTextSelection({ from, to });
  useActiveEditorStore
    .getState()
    .setActiveWysiwygEditor(tiptapEditor, tabId);
  return tiptapEditor;
}

function makeCm(
  initial: string,
  from: number,
  to: number,
  tabId: string = focusedTabIdForHelpers(),
) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  cmContainers.push(parent);
  const state = CMState.create({
    doc: initial,
    selection: { anchor: from, head: to },
  });
  const view = new CMView({ state, parent });
  cmViews.push(view);
  useEditorStore.setState({ sourceMode: true });
  useActiveEditorStore.getState().setActiveSourceView(view, tabId);
  return view;
}

/**
 * Helper that returns the tab id currently active in the focused window
 * — matches what `resolveFocusedTab` will resolve to in the handler.
 */
function focusedTabIdForHelpers(): string {
  const id = useTabStore.getState().activeTabId["main"];
  if (!id) {
    throw new Error(
      "Tests must call seedTab() before makeTiptap()/makeCm() to have a focused tab.",
    );
  }
  return id;
}

function lastRespond() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

function parseStructuredError(s: string | undefined) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
});

afterEach(() => {
  if (tiptapEditor) {
    tiptapEditor.destroy();
    tiptapEditor = null;
  }
  while (cmViews.length) cmViews.pop()!.destroy();
  while (cmContainers.length) cmContainers.pop()!.remove();
});

// ---------------------------------------------------------------------------
// vmark.selection.get
// ---------------------------------------------------------------------------

describe("vmark.selection.get — WYSIWYG mode", () => {
  it("returns selected text, range, and metadata for a non-empty selection", async () => {
    seedTab("t-w", "Hello world", "/notes.md");
    // Doc structure: <p>Hello world</p> → "world" is at PM positions 7..12.
    makeTiptap("<p>Hello world</p>", 7, 12);

    await handleSelectionGet("req-1", {});

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      text: "world",
      isEmpty: false,
      mode: "wysiwyg",
      kind: "markdown",
      tabId: "t-w",
    });
    const data = r.data as { range: { from: number; to: number }; revision: string };
    expect(data.range).toEqual({ from: 7, to: 12 });
    expect(data.revision).toMatch(/^rev-/);
  });

  it("returns isEmpty=true for a collapsed selection", async () => {
    seedTab("t-empty", "abc", null);
    makeTiptap("<p>abc</p>", 2, 2);

    await handleSelectionGet("req-2", {});

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      text: "",
      isEmpty: true,
      mode: "wysiwyg",
    });
  });

  it("returns INVALID_TAB when no tab is active", async () => {
    await handleSelectionGet("req-3", {});

    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_TAB",
    });
  });

  it("returns NO_EDITOR when active tab has no live editor", async () => {
    seedTab("t-no-ed", "x", null);
    // No editor injected — useActiveEditorStore is reset to nulls.

    await handleSelectionGet("req-4", {});

    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NO_EDITOR",
    });
  });
});

describe("vmark.selection.get — source mode", () => {
  it("returns selected text and range from CodeMirror", async () => {
    seedTab("t-src", "Hello world", "/notes.md");
    // CM positions: 'world' at offsets 6..11.
    makeCm("Hello world", 6, 11);

    await handleSelectionGet("req-src", {});

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      text: "world",
      isEmpty: false,
      mode: "source",
      kind: "markdown",
    });
    const data = r.data as { range: { from: number; to: number } };
    expect(data.range).toEqual({ from: 6, to: 11 });
  });
});

// ---------------------------------------------------------------------------
// vmark.selection.set
// ---------------------------------------------------------------------------

describe("vmark.selection.set — WYSIWYG mode", () => {
  it("replaces the current selection and updates the document store", async () => {
    seedTab("t-set", "Hello world", "/notes.md");
    makeTiptap("<p>Hello world</p>", 7, 12); // Selects "world".

    await handleSelectionSet("req-set", { content: "everyone" });

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-set"].content).toContain(
      "Hello everyone",
    );
    const data = r.data as { revision: string; replaced_chars: number };
    expect(data.revision).toMatch(/^rev-/);
    expect(data.replaced_chars).toBe("world".length);
  });

  it("rejects writes whose expected_revision is stale", async () => {
    seedTab("t-stale", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);
    useRevisionStore.getState().setRevision(generateRevisionId());
    const stale = "rev-OLDOLDOL";

    await handleSelectionSet("req-stale", {
      content: "x",
      expected_revision: stale,
    });

    const r = lastRespond();
    expect(r.success).toBe(false);
    const err = parseStructuredError(r.error);
    expect(err).toMatchObject({ error: "STALE" });
    expect(typeof err.current_revision).toBe("string");
    // Document unchanged.
    expect(useDocumentStore.getState().documents["t-stale"].content).toBe(
      "Hello world",
    );
  });

  it("accepts writes whose expected_revision matches current", async () => {
    seedTab("t-ok", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);
    const current = useRevisionStore.getState().getRevision();

    await handleSelectionSet("req-ok", {
      content: "ok",
      expected_revision: current,
    });

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-ok"].content).toContain(
      "Hello ok",
    );
  });

  it("allows writes without expected_revision (greenfield path)", async () => {
    seedTab("t-blind", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);

    await handleSelectionSet("req-blind", { content: "blind" });

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-blind"].content).toContain(
      "Hello blind",
    );
  });

  it("rejects non-string content", async () => {
    seedTab("t-bad", "x", null);
    makeTiptap("<p>x</p>", 1, 2);

    await handleSelectionSet("req-bad", { content: 42 });

    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({ error: "INTERNAL" });
  });

  it("returns NO_EDITOR when no active editor", async () => {
    seedTab("t-no-ed", "x", null);

    await handleSelectionSet("req-noed", { content: "y" });

    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NO_EDITOR",
    });
  });

  it("inserts at the cursor when the selection is collapsed", async () => {
    seedTab("t-collapsed", "Hello world", null);
    // Cursor between "Hello " and "world" (PM pos 7).
    makeTiptap("<p>Hello world</p>", 7, 7);

    await handleSelectionSet("req-collapsed", { content: "BIG " });

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-collapsed"].content).toContain(
      "Hello BIG world",
    );
    expect((r.data as { replaced_chars: number }).replaced_chars).toBe(0);
  });

  it("pushes a checkpoint after a successful set", async () => {
    seedTab("t-cp", "Hello world", "/notes.md");
    makeTiptap("<p>Hello world</p>", 7, 12);

    await handleSelectionSet("req-cp", { content: "xiaolai" });

    const cps = useMcpCheckpointStore
      .getState()
      .list({ filePath: "/notes.md" });
    expect(cps).toHaveLength(1);
    expect(cps[0]).toMatchObject({
      tabId: "t-cp",
      filePath: "/notes.md",
      tool: "selection.set",
    });
    // contentBefore is captured from a fresh serialize of the live
    // editor (not the documentStore string), so it has the canonical
    // trailing newline the markdown serializer produces.
    expect(cps[0].contentBefore).toBe("Hello world\n");
  });
});

describe("vmark.selection.set — source mode", () => {
  it("replaces the current CodeMirror selection", async () => {
    seedTab("t-src-set", "Hello world", null);
    makeCm("Hello world", 6, 11); // Selects "world".

    await handleSelectionSet("req-src-set", { content: "code" });

    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-src-set"].content).toBe(
      "Hello code",
    );
  });

  it("rejects STALE expected_revision in source mode", async () => {
    seedTab("t-src-stale", "Hello world", null);
    makeCm("Hello world", 6, 11);

    await handleSelectionSet("req-src-stale", {
      content: "x",
      expected_revision: "rev-OLDOLDOL",
    });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({ error: "STALE" });
  });

  it("returns NO_EDITOR when source mode has no active view", async () => {
    seedTab("t-src-noed", "x", null);
    useEditorStore.setState({ sourceMode: true });
    // No source view injected.

    await handleSelectionSet("req-src-noed", { content: "y" });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NO_EDITOR",
    });
  });

  it("get returns NO_EDITOR when source mode has no active view", async () => {
    seedTab("t-src-noed-g", "x", null);
    useEditorStore.setState({ sourceMode: true });

    await handleSelectionGet("req-src-noed-g", {});
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NO_EDITOR",
    });
  });
});

// ---------------------------------------------------------------------------
// Branch coverage — exercises the markdown round-trip, deletion, block
// replacement, kind detection, and tab-resolution paths.
// ---------------------------------------------------------------------------

describe("vmark.selection — branch coverage", () => {
  it("get returns INVALID_TAB when tabId does not match the focused tab", async () => {
    seedTab("t-focused", "x", null);
    makeTiptap("<p>x</p>", 1, 1);

    await handleSelectionGet("req-mismatch", { tabId: "t-other" });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_TAB",
    });
  });

  it("get reports kind=yaml-workflow for workflow files", async () => {
    seedTab(
      "t-wf",
      "name: ci\non:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
      "/repo/.github/workflows/ci.yml",
    );
    makeCm("name: ci", 0, 4);

    await handleSelectionGet("req-wf", {});
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ kind: "yaml-workflow" });
  });

  it("set with empty content deletes the selection", async () => {
    seedTab("t-del", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12); // "world"

    await handleSelectionSet("req-del", { content: "" });
    const r = lastRespond();
    expect(r.success).toBe(true);
    // Trailing space remains: "Hello "
    expect(useDocumentStore.getState().documents["t-del"].content).toMatch(
      /^Hello\s*$/,
    );
  });

  it("set parses inline markdown (e.g. **bold**) and applies marks", async () => {
    seedTab("t-md", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);

    await handleSelectionSet("req-md", { content: "**brave**" });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-md"].content).toContain(
      "**brave**",
    );
  });

  it("set with block-level markdown across paragraphs keeps block structure", async () => {
    seedTab("t-blocks", "Para one\n\nPara two", null);
    // Select across both paragraphs. PM positions: doc=<p>Para one</p><p>Para two</p>
    // 'P' of "Para one" at PM pos 1, end-of-doc near 21.
    makeTiptap("<p>Para one</p><p>Para two</p>", 1, 21);

    await handleSelectionSet("req-blocks", {
      content: "# Heading\n\nNew paragraph",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    const content = useDocumentStore.getState().documents["t-blocks"].content;
    expect(content).toContain("# Heading");
    expect(content).toContain("New paragraph");
  });

  it("get returns markdown for a multi-paragraph slice (block path)", async () => {
    seedTab("t-multi", "Para one\n\nPara two", null);
    makeTiptap("<p>Para one</p><p>Para two</p>", 1, 21);

    await handleSelectionGet("req-multi", {});
    const r = lastRespond();
    expect(r.success).toBe(true);
    const text = (r.data as { text: string }).text;
    expect(text).toContain("Para one");
    expect(text).toContain("Para two");
  });

  it("get reports kind=yaml-workflow when content matches the workflow shape (no path)", async () => {
    // Untitled tab with workflow-shaped YAML content — exercises the
    // content-only branch of resolveKind.
    const yaml =
      "name: ci\non:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
    seedTab("t-wf-content", yaml, null);
    makeCm(yaml, 0, 4);

    await handleSelectionGet("req-wf-content", {});
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ kind: "yaml-workflow" });
  });

  it("source mode get returns isEmpty=true when the selection is collapsed", async () => {
    seedTab("t-src-empty", "abc", null);
    makeCm("abc", 1, 1);

    await handleSelectionGet("req-src-empty", {});
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ text: "", isEmpty: true, mode: "source" });
  });

  it("source mode set inserts at the cursor when the selection is collapsed", async () => {
    seedTab("t-src-collapsed", "abcdef", null);
    makeCm("abcdef", 3, 3); // Cursor between "abc" and "def".

    await handleSelectionSet("req-src-collapsed", { content: "X" });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-src-collapsed"].content).toBe(
      "abcXdef",
    );
    expect((r.data as { replaced_chars: number }).replaced_chars).toBe(0);
  });

  it("looksLikeMarkdown routes heading content through the parser (block path)", async () => {
    seedTab("t-heading", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);

    // A heading-prefixed string forces the block-marker regex branch.
    await handleSelectionSet("req-heading", { content: "# Title\n\nbody" });
    const r = lastRespond();
    expect(r.success).toBe(true);
    const content = useDocumentStore.getState().documents["t-heading"].content;
    expect(content).toContain("# Title");
  });

  it("looksLikeMarkdown matches a single-line block marker (no blank lines)", async () => {
    seedTab("t-list", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);

    // "- item" has no blank line; only the second block-marker regex
    // (line 129 of selection.ts) flags it as markdown.
    await handleSelectionSet("req-list", { content: "- item" });
    const r = lastRespond();
    expect(r.success).toBe(true);
  });

  it("set with explicit tabId matching the focused tab succeeds", async () => {
    seedTab("t-explicit", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);

    await handleSelectionSet("req-explicit", {
      tabId: "t-explicit",
      content: "everyone",
    });
    const r = lastRespond();
    expect(r.success).toBe(true);
    expect(useDocumentStore.getState().documents["t-explicit"].content).toContain(
      "Hello everyone",
    );
  });

  it("set returns INVALID_TAB when supplied tabId does not match focused", async () => {
    seedTab("t-set-focused", "x", null);
    makeTiptap("<p>x</p>", 1, 1);

    await handleSelectionSet("req-set-mismatch", {
      tabId: "t-other",
      content: "y",
    });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "INVALID_TAB",
    });
  });

  it("looksLikeMarkdown detects single-marker emphasis (*italic*)", async () => {
    seedTab("t-em", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);

    // *brave* should be parsed as italic, not inserted as literal text
    // with surrounding asterisks. The em mark serializes back to *brave*.
    await handleSelectionSet("req-em", { content: "*brave*" });
    const r = lastRespond();
    expect(r.success).toBe(true);
    const content = useDocumentStore.getState().documents["t-em"].content;
    expect(content).toContain("*brave*");
  });

  it("plain text with a single asterisk (no pair) is inserted literally", async () => {
    seedTab("t-star", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12);

    // A single unpaired asterisk in plain text should NOT be treated as
    // markdown — the heuristic only matches paired *foo*.
    await handleSelectionSet("req-star", { content: "5*4 result" });
    const r = lastRespond();
    expect(r.success).toBe(true);
    const content = useDocumentStore.getState().documents["t-star"].content;
    expect(content).toContain("5*4 result");
  });

  it("set returns NO_EDITOR when the WYSIWYG editor is destroyed", async () => {
    seedTab("t-destroyed", "x", null);
    const ed = makeTiptap("<p>x</p>", 1, 1);
    ed.destroy();
    // The store still holds a reference to the destroyed editor — the
    // handler must reject it rather than crashing on a torn-down view.
    tiptapEditor = null; // prevent the afterEach from double-destroying

    await handleSelectionSet("req-destroyed", { content: "y" });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NO_EDITOR",
    });
  });

  it("get returns NO_EDITOR when the WYSIWYG editor is destroyed", async () => {
    seedTab("t-destroyed-g", "x", null);
    const ed = makeTiptap("<p>x</p>", 1, 1);
    ed.destroy();
    tiptapEditor = null;

    await handleSelectionGet("req-destroyed-g", {});
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NO_EDITOR",
    });
  });

  it("set returns NO_EDITOR when the active editor is bound to a different tab", async () => {
    // Focused tab is t-current. The editor in the store is bound to a
    // stale tabId (t-stale) — e.g. the user switched tabs but a stale
    // ref survived. The handler MUST reject rather than mutate using
    // the wrong tab's editor.
    seedTab("t-current", "Hello world", null);
    makeTiptap("<p>Hello world</p>", 7, 12, "t-stale");

    await handleSelectionSet("req-cross-tab", { content: "x" });
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NO_EDITOR",
    });
    // Document content unchanged.
    expect(useDocumentStore.getState().documents["t-current"].content).toBe(
      "Hello world",
    );
  });

  it("get returns NO_EDITOR when the active editor is bound to a different tab", async () => {
    seedTab("t-current-g", "x", null);
    makeTiptap("<p>x</p>", 1, 1, "t-stale-g");

    await handleSelectionGet("req-cross-tab-g", {});
    const r = lastRespond();
    expect(r.success).toBe(false);
    expect(parseStructuredError(r.error)).toMatchObject({
      error: "NO_EDITOR",
    });
  });
});
