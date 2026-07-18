/**
 * Tests for markdownAutoPair — delay-based auto-pairing in Source mode.
 *
 * Covers:
 *   - markdownPairBackspace: single and double symmetric pair deletion
 *   - createMarkdownAutoPairPlugin: backtick/delay-char/always-double handlers
 *   - safeDispatch failure paths (disconnected view, composing)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock imeGuard
const mockIsCodeMirrorComposing = vi.fn(() => false);
vi.mock("@/utils/imeGuard", () => ({
  guardCodeMirrorKeyBinding: (binding: { key: string; run: (view: unknown) => boolean }) => binding,
  isCodeMirrorComposing: (...args: unknown[]) => mockIsCodeMirrorComposing(...args),
}));

import { markdownPairBackspace, createMarkdownAutoPairPlugin } from "./markdownAutoPair";

function createView(doc: string, cursorAt?: number): EditorView {
  const parent = document.createElement("div");
  const pos = cursorAt ?? doc.length;
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
  });
  return new EditorView({ state, parent });
}

describe("markdownPairBackspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  it("deletes single symmetric pair *|*", () => {
    const view = createView("**", 1); // cursor between two *
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes double symmetric pair ~~|~~", () => {
    const view = createView("~~~~", 2); // cursor between ~~|~~
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes double symmetric pair ==|==", () => {
    const view = createView("====", 2);
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("returns false when no pair at cursor", () => {
    const view = createView("abc", 2);
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(false);
    view.destroy();
  });

  it("returns false when cursor is at start of document", () => {
    const view = createView("*text*", 0);
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(false);
    view.destroy();
  });

  it("returns false when there is a selection", () => {
    const state = EditorState.create({
      doc: "**",
      selection: { anchor: 0, head: 2 },
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(false);
    view.destroy();
  });

  it("deletes single backtick pair `|`", () => {
    const view = createView("``", 1);
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("deletes single caret pair ^|^", () => {
    const view = createView("^^", 1);
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });
});

describe("markdownPairBackspace — code fence guard", () => {
  // Inside fenced code blocks pair chars are literal code — Backspace must
  // fall through (return false) so default backspace deletes ONE char, not
  // both halves of the "pair".

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  it("does not delete both asterisks of *|* inside a fence", () => {
    const doc = "```python\na ** b\n```";
    const view = createView(doc, 13); // between the two asterisks
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(false);
    expect(view.state.doc.toString()).toBe(doc); // untouched by the handler
    view.destroy();
  });

  it("does not delete both underscores of _|_ in __init__ inside a fence", () => {
    const doc = "```python\n__init__\n```";
    const view = createView(doc, 17); // between the trailing underscores
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("does not delete both backticks of `|` inside a fence", () => {
    const doc = "```sh\necho ``\n```";
    const view = createView(doc, 12); // between the two backticks
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("does not delete double pair ~~|~~ inside a fence", () => {
    const doc = "```\n~~~~\n```";
    const view = createView(doc, 6); // between ~~|~~
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it("still deletes the pair outside a fence in a doc containing a fence", () => {
    const doc = "**\n```python\na ** b\n```";
    const view = createView(doc, 1); // between *|* on the first line
    const result = markdownPairBackspace.run!(view, "Backspace" as never);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("\n```python\na ** b\n```");
    view.destroy();
  });
});

describe("createMarkdownAutoPairPlugin", () => {
  it("creates a ViewPlugin", () => {
    const plugin = createMarkdownAutoPairPlugin();
    expect(plugin).toBeDefined();
  });

  it("plugin instance has destroy method", () => {
    const parent = document.createElement("div");
    const plugin = createMarkdownAutoPairPlugin();
    const state = EditorState.create({
      doc: "test",
      extensions: [plugin],
    });
    const view = new EditorView({ state, parent });
    // Should not throw on destroy
    view.destroy();
  });
});

// ---------------------------------------------------------------------------
// Helpers for plugin update tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal EditorView with the auto-pair plugin installed,
 * appended to document.body so `dom.isConnected` is true.
 */
function createPluginView(initialDoc = ""): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const plugin = createMarkdownAutoPairPlugin();
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [plugin],
  });
  return new EditorView({ state, parent });
}

/**
 * Simulate a single user-input.type transaction: insert `text` at `pos`,
 * replacing [pos, pos+deleteCount].
 */
function typeChar(view: EditorView, text: string, at?: number, deleteCount = 0): void {
  const pos = at ?? view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, to: pos + deleteCount, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: "input.type",
  });
}

describe("createMarkdownAutoPairPlugin — handleAlwaysDoubleChar (=)", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  afterEach(() => {
    view?.destroy();
    vi.useRealTimers();
  });

  it("inserts closing == after typing second =", async () => {
    view = createPluginView("=");
    // cursor is at pos 1 after "="
    // Now type second "=" to complete "=="
    typeChar(view, "=", 1);
    // The insertClosingPair runs in setTimeout(0)
    await vi.runAllTimersAsync();
    // doc should now be "====" (opening == + closing ==)
    expect(view.state.doc.toString()).toBe("====");
  });

  it("does nothing when first = is typed (no preceding =)", () => {
    view = createPluginView("");
    typeChar(view, "=", 0);
    vi.runAllTimers();
    // Only one = — no closing pair added
    expect(view.state.doc.toString()).toBe("=");
  });
});

describe("createMarkdownAutoPairPlugin — handleDelayChar (*, ~, _)", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  afterEach(() => {
    view?.destroy();
    vi.useRealTimers();
  });

  it("inserts single closing char after delay expires", async () => {
    view = createPluginView("");
    typeChar(view, "*", 0);
    // Advance past 150ms delay
    vi.advanceTimersByTime(200);
    // The timeout fires — cursor should still be at pos 1
    await Promise.resolve();
    // Now closing * should be inserted
    expect(view.state.doc.toString()).toBe("**");
  });

  it("inserts double closing chars when second char typed quickly", async () => {
    view = createPluginView("");
    typeChar(view, "*", 0);
    // Type second * before delay expires
    typeChar(view, "*", 1);
    await vi.runAllTimersAsync();
    // Double close: **|** → doc = "****"
    expect(view.state.doc.toString()).toBe("****");
  });

  it("cancels pending pair when different delay char typed", async () => {
    view = createPluginView("");
    typeChar(view, "*", 0);
    // Type ~ before * delay expires — cancels * pending, starts ~ pending
    typeChar(view, "~", 1);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // ~ timeout fires (cursor at pos 2), inserts single ~
    expect(view.state.doc.toString()).toBe("*~~");
  });

  it("handles ~ delay char pair", async () => {
    view = createPluginView("");
    typeChar(view, "~", 0);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("~~");
  });

  it("handles _ delay char pair", async () => {
    view = createPluginView("");
    typeChar(view, "_", 0);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("__");
  });
});

describe("createMarkdownAutoPairPlugin — handleBacktick", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  afterEach(() => {
    view?.destroy();
    vi.useRealTimers();
  });

  it("inserts closing backtick after delay for single backtick", async () => {
    view = createPluginView("");
    typeChar(view, "`", 0);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("``");
  });

  it("cancels single pair when second backtick typed (double backtick)", async () => {
    view = createPluginView("");
    typeChar(view, "`", 0);
    // Second backtick at pos 1 — this should cancel the pending single pair
    typeChar(view, "`", 1);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // No closing backtick added for double `` (only triple inserts code fence)
    expect(view.state.doc.toString()).toBe("``");
  });

  it("inserts code fence for triple backtick at start of line", async () => {
    view = createPluginView("``");
    // Cursor at 2, type third ` to make ```
    typeChar(view, "`", 2);
    await vi.runAllTimersAsync();
    // Should add "\n\n```" after the ```
    expect(view.state.doc.toString()).toBe("```\n\n```");
  });

  it("does not insert code fence for triple backtick when preceded by text", async () => {
    view = createPluginView("text``");
    typeChar(view, "`", 6);
    await vi.runAllTimersAsync();
    // The line has "text" before ```, so no fence
    expect(view.state.doc.toString()).toBe("text```");
  });
});

describe("createMarkdownAutoPairPlugin — composing guard", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    view?.destroy();
    vi.useRealTimers();
  });

  it("skips update when composing", async () => {
    mockIsCodeMirrorComposing.mockReturnValue(true);
    view = createPluginView("");
    typeChar(view, "*", 0);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // No closing pair because composing was active
    expect(view.state.doc.toString()).toBe("*");
  });
});

describe("createMarkdownAutoPairPlugin — safeDispatch failure paths", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  afterEach(() => {
    view?.destroy();
    vi.useRealTimers();
  });

  it("safeDispatch returns false when view is composing at dispatch time", async () => {
    view = createPluginView("");
    typeChar(view, "*", 0);
    // Make composing return true when the timeout fires
    mockIsCodeMirrorComposing.mockReturnValue(true);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // No pair inserted because composing was true at dispatch time
    expect(view.state.doc.toString()).toBe("*");
  });

  it("safeDispatch returns false and does not throw for disconnected view", async () => {
    view = createPluginView("");
    typeChar(view, "*", 0);
    // Destroy view before timeout fires — dom.isConnected becomes false
    view.destroy();
    // Should not throw
    vi.advanceTimersByTime(200);
    await Promise.resolve();
  });
});

describe("createMarkdownAutoPairPlugin — destroy with pending timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears pending timeout on destroy", async () => {
    const view = createPluginView("");
    typeChar(view, "*", 0);
    // Destroy while timeout is still pending
    view.destroy();
    // Advance timers — no error or spurious dispatch
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
});

/* ------------------------------------------------------------------ */
/*  Code fence guard — auto-pair must NOT fire inside fenced code blocks */
/* ------------------------------------------------------------------ */

describe("createMarkdownAutoPairPlugin — code fence guard", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  afterEach(() => {
    view?.destroy();
    vi.useRealTimers();
  });

  // Document: "text\n```\ncode here\n```"
  // Positions: "text\n" (5) + "```\n" (4) + "code here\n" (10) + "```" (3) = 22
  // Cursor at position 14 is inside "code here" (14 - 9 = 5th char = space)
  const CODE_FENCE_DOC = "text\n```\ncode here\n```";

  it("does NOT pair * inside fenced code block", async () => {
    view = createPluginView(CODE_FENCE_DOC);
    typeChar(view, "*", 14); // inside "code here"
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // Only the typed * should exist — no closing * inserted
    expect(view.state.doc.toString()).toBe("text\n```\ncode *here\n```");
  });

  it("does NOT pair ~ inside fenced code block", async () => {
    view = createPluginView(CODE_FENCE_DOC);
    typeChar(view, "~", 14);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("text\n```\ncode ~here\n```");
  });

  it("does NOT pair _ inside fenced code block", async () => {
    view = createPluginView(CODE_FENCE_DOC);
    typeChar(view, "_", 14);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("text\n```\ncode _here\n```");
  });

  it("does NOT pair = inside fenced code block", async () => {
    // Document with "==" already typed inside code block
    const docWithEq = "text\n```\n=\n```";
    view = createPluginView(docWithEq);
    // Type second = right after the first one (position 10)
    typeChar(view, "=", 10);
    await vi.runAllTimersAsync();
    // Should NOT insert closing == — only the typed = appears
    expect(view.state.doc.toString()).toBe("text\n```\n==\n```");
  });

  it("does NOT pair backtick inside fenced code block (single backtick)", async () => {
    view = createPluginView(CODE_FENCE_DOC);
    typeChar(view, "`", 14);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // No closing backtick inserted
    expect(view.state.doc.toString()).toBe("text\n```\ncode `here\n```");
  });

  it("does NOT pair * inside a tilde (~~~) fenced code block", async () => {
    // Same layout as CODE_FENCE_DOC but with tilde fences
    view = createPluginView("text\n~~~\ncode here\n~~~");
    typeChar(view, "*", 14); // inside "code here"
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("text\n~~~\ncode *here\n~~~");
  });

  it("does NOT pair * inside an unclosed fenced code block", async () => {
    // Opening fence with no closer — fence extends to end of document
    view = createPluginView("text\n```\ncode here");
    typeChar(view, "*", 14); // inside "code here"
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("text\n```\ncode *here");
  });

  it("still pairs * outside code block (regression guard)", async () => {
    // Cursor is BEFORE the code fence, in "text"
    view = createPluginView(CODE_FENCE_DOC);
    typeChar(view, "*", 2); // inside "text" (before the fence)
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // Closing * should be inserted since we're outside the code fence
    expect(view.state.doc.toString()).toBe("te**xt\n```\ncode here\n```");
  });
});

describe("createMarkdownAutoPairPlugin — additional branch coverage", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsCodeMirrorComposing.mockReturnValue(false);
  });

  afterEach(() => {
    view?.destroy();
    vi.useRealTimers();
  });

  // Line 143: text.length !== 1 — multi-char input.type transaction is ignored
  it("ignores multi-char input.type transactions", async () => {
    view = createPluginView("");
    // Dispatch a 2-char input.type (paste via input.type — unusual but possible)
    view.dispatch({
      changes: { from: 0, to: 0, insert: "**" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // No closing pair — multi-char input is skipped
    expect(view.state.doc.toString()).toBe("**");
  });

  // Lines 191-192: triple backtick path clears existing pending before inserting fence
  it("clears pending single-char when triple backtick typed", async () => {
    // Start with `` in doc, cursor at 2, pending backtick in state
    view = createPluginView("`");
    // First backtick already in doc; type second backtick to set pending
    typeChar(view, "`", 1);
    // Now type third backtick — this triggers triple-backtick path with pending active
    typeChar(view, "`", 2);
    await vi.runAllTimersAsync();
    // Triple backtick inserts code fence closing
    expect(view.state.doc.toString()).toBe("```\n\n```");
  });

  // Line 196: pos < 0 or pos > doc.length — guard in handleBacktick (very unusual edge)
  it("triple backtick guard: does not crash when pos is at line start with odd bounds", async () => {
    // This indirectly tests the lineAt bounds guard — the code fence path at line start
    view = createPluginView("``");
    // Simulate typing third backtick at position 2 (valid)
    typeChar(view, "`", 2);
    await vi.runAllTimersAsync();
    // Normal code fence insertion — guard was not triggered but the path was exercised
    expect(view.state.doc.toString()).toBe("```\n\n```");
  });

  // Lines 222-223: single backtick with existing pending of different char clears it
  it("single backtick clears existing pending of different char before setting new pending", async () => {
    view = createPluginView("");
    // Type * to set a pending for *
    typeChar(view, "*", 0);
    // Now type ` — this should clear the * pending and create a new ` pending
    typeChar(view, "`", 1);
    // Advance past delay — ` timeout fires (cursor at pos 2 = pos + 1 check)
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    // * pending was cleared (no * closing), ` closing was inserted
    expect(view.state.doc.toString()).toBe("*``");
  });

  // Line 68: catch block in safeDispatch — dispatch throws
  it("safeDispatch catch block: dispatch exception does not propagate", async () => {
    view = createPluginView("");
    typeChar(view, "*", 0);

    // Monkey-patch view.dispatch to throw after the timeout fires
    const origDispatch = view.dispatch.bind(view);
    let throwOnce = true;
    view.dispatch = (...args) => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("simulated dispatch error");
      }
      return origDispatch(...args);
    };

    // Should not throw — catch block returns false silently
    expect(() => {
      vi.advanceTimersByTime(200);
    }).not.toThrow();
  });

  // Line 58: safeDispatch returns false when dom is disconnected
  it("safeDispatch returns false when dom is not connected", async () => {
    // Create a view whose parent is NOT in document.body
    const parent = document.createElement("div");
    // Don't append to body — dom.isConnected will be false
    const plugin = createMarkdownAutoPairPlugin();
    const state = EditorState.create({
      doc: "",
      extensions: [plugin],
    });
    const disconnectedView = new EditorView({ state, parent });

    // Type a char — safeDispatch will see dom.isConnected === false
    typeChar(disconnectedView, "*", 0);
    vi.advanceTimersByTime(200);
    await Promise.resolve();

    // No closing pair inserted because dom is disconnected
    expect(disconnectedView.state.doc.toString()).toBe("*");
    disconnectedView.destroy();
  });
});
