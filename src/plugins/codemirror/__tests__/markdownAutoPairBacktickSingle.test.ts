/**
 * Single Backtick Auto-Pair Tests (Issue #58 Problem 1)
 *
 * Verifies that single backtick auto-pairs in Source mode.
 * Uses delay-based approach to avoid collision with code fence (```).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";

vi.mock("@/utils/imeGuard", () => ({
  isCodeMirrorComposing: () => false,
  guardCodeMirrorKeyBinding: (binding: unknown) => binding,
}));

import { createMarkdownAutoPairPlugin, markdownPairBackspace } from "../markdownAutoPair";

/**
 * Helper: simulate a single-character user input transaction.
 */
function simulateTyping(view: EditorView, char: string): void {
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, to: pos, insert: char },
    selection: { anchor: pos + 1 },
    userEvent: "input.type",
  });
}

/**
 * Create an EditorView attached to the document body.
 */
function createView(doc: string, cursorPos?: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const state = EditorState.create({
    doc,
    selection: cursorPos != null ? { anchor: cursorPos } : undefined,
    extensions: [createMarkdownAutoPairPlugin()],
  });
  return new EditorView({ state, parent });
}

describe("single backtick auto-pair (Source mode)", () => {
  let activeView: EditorView | null = null;

  afterEach(() => {
    const parent = activeView?.dom.parentElement;
    activeView?.destroy();
    parent?.remove();
    activeView = null;
  });

  it("auto-pairs single backtick after delay", async () => {
    activeView = createView("");

    simulateTyping(activeView, "`");

    // Before delay: just one backtick
    expect(activeView.state.doc.toString()).toBe("`");

    // After delay: paired backticks with cursor between
    await new Promise((r) => setTimeout(r, 200));

    expect(activeView.state.doc.toString()).toBe("``");
    expect(activeView.state.selection.main.head).toBe(1);
  });

  it("does not pair when double backtick typed quickly", async () => {
    activeView = createView("");

    simulateTyping(activeView, "`");
    simulateTyping(activeView, "`");

    await new Promise((r) => setTimeout(r, 200));

    // Two backticks, no extra pair
    expect(activeView.state.doc.toString()).toBe("``");
  });

  it("triple backtick at line start still produces code fence", async () => {
    activeView = createView("");

    simulateTyping(activeView, "`");
    simulateTyping(activeView, "`");
    simulateTyping(activeView, "`");

    await new Promise((r) => setTimeout(r, 200));

    expect(activeView.state.doc.toString()).toBe("```\n\n```");
  });

  it("single backtick mid-line auto-pairs after delay", async () => {
    activeView = createView("hello ", 6);

    simulateTyping(activeView, "`");

    await new Promise((r) => setTimeout(r, 200));

    expect(activeView.state.doc.toString()).toBe("hello ``");
    expect(activeView.state.selection.main.head).toBe(7);
  });
});

describe("backtick backspace pair deletion (Source mode)", () => {
  let activeView: EditorView | null = null;

  afterEach(() => {
    const parent = activeView?.dom.parentElement;
    activeView?.destroy();
    parent?.remove();
    activeView = null;
  });

  it("deletes both backticks when backspace between paired backticks", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const state = EditorState.create({
      doc: "``",
      selection: { anchor: 1 },
      extensions: [
        createMarkdownAutoPairPlugin(),
        EditorView.domEventHandlers({
          keydown: () => false,
        }),
      ],
    });
    activeView = new EditorView({ state, parent });

    // Simulate backspace using the handler directly
    const handled = markdownPairBackspace.run!(activeView);

    expect(handled).toBe(true);
    expect(activeView.state.doc.toString()).toBe("");
  });
});
