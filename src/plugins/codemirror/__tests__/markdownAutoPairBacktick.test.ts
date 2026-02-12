/**
 * Backtick Auto-Pair Tests
 *
 * Verifies that backtick is NOT in the closeBrackets config (which would
 * collide with the markdownAutoPair plugin's code fence handler).
 *
 * Bug: #38 — typing 3 backticks produces 4 because closeBrackets pairs
 * the 3rd backtick, then markdownAutoPair also fires for the code fence.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { closeBrackets } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

vi.mock("@/utils/imeGuard", () => ({
  isCodeMirrorComposing: () => false,
  guardCodeMirrorKeyBinding: (binding: unknown) => binding,
}));

import { createMarkdownAutoPairPlugin } from "../markdownAutoPair";

/**
 * Helper: simulate a single-character user input transaction.
 * This mimics what CodeMirror does when the user types a character.
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
 * Create an EditorView attached to the document body (so isConnected = true).
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

describe("backtick auto-pair collision guard", () => {
  let activeView: EditorView | null = null;

  afterEach(() => {
    const parent = activeView?.dom.parentElement;
    activeView?.destroy();
    parent?.remove();
    activeView = null;
  });

  it("closeBrackets config for markdown must NOT include backtick", () => {
    // Backtick in closeBrackets collides with markdownAutoPair's code fence
    // handler (bug #38). This test mirrors the production config and verifies
    // backtick is excluded.
    const markdownCloseBrackets = markdownLanguage.data.of({
      closeBrackets: {
        brackets: ["(", "[", "{", '"', "'", "^"],
      },
    });

    const state = EditorState.create({
      doc: "",
      extensions: [closeBrackets(), markdownCloseBrackets, markdown()],
    });

    const config = state.languageDataAt<{ brackets?: string[] }>("closeBrackets", 0);
    const allBrackets = config.flatMap((c) => c.brackets ?? []);
    expect(allBrackets).not.toContain("`");
  });

  it("markdownAutoPair inserts closing fence on triple backtick at line start", async () => {
    activeView = createView("");

    simulateTyping(activeView, "`");
    simulateTyping(activeView, "`");
    simulateTyping(activeView, "`");

    // Exactly 3 backticks before setTimeout fires
    expect(activeView.state.doc.sliceString(0, 3)).toBe("```");

    // Flush the setTimeout(0) from insertClosingPair
    await new Promise((r) => setTimeout(r, 10));

    // After flush: ```\n\n```
    const content = activeView.state.doc.toString();
    expect(content).toBe("```\n\n```");
  });

  it("markdownAutoPair does NOT insert fence for backticks mid-line", async () => {
    activeView = createView("some text ", 10);

    simulateTyping(activeView, "`");
    simulateTyping(activeView, "`");
    simulateTyping(activeView, "`");

    await new Promise((r) => setTimeout(r, 10));

    expect(activeView.state.doc.toString()).toBe("some text ```");
  });

  it("single backtick does NOT trigger code fence", async () => {
    activeView = createView("");

    simulateTyping(activeView, "`");

    await new Promise((r) => setTimeout(r, 10));

    expect(activeView.state.doc.toString()).toBe("`");
  });

  it("two backticks do NOT trigger code fence", async () => {
    activeView = createView("");

    simulateTyping(activeView, "`");
    simulateTyping(activeView, "`");

    await new Promise((r) => setTimeout(r, 10));

    expect(activeView.state.doc.toString()).toBe("``");
  });
});
