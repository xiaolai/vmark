/**
 * Tests for SourceMathPopupView — editable math popup in Source mode.
 *
 * Covers:
 *   - Constructor wires DOM refs after super() (class-fields gotcha regression)
 *   - Click-outside commits the edit (P2 — was silently discarding)
 *   - Escape still discards (cancel semantics preserved)
 *   - Stale mathFrom/mathTo are rejected without corrupting the doc (P3)
 */

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: vi.fn(() => ({ top: 50, left: 100 })),
}));

vi.mock("@/utils/popupComponents", () => ({
  handlePopupTabNavigation: vi.fn(),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getEditorBounds: vi.fn(() => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  })),
  getPopupHostForDom: vi.fn(() => null),
  toHostCoordsForDom: vi.fn(
    (_host: unknown, pos: { top: number; left: number }) => pos,
  ),
}));

vi.mock("@/plugins/latex/katexLoader", () => ({
  loadKatex: vi.fn(() => Promise.resolve({ default: { render: vi.fn() } })),
}));

vi.mock("@/utils/debug", () => ({
  renderWarn: vi.fn(),
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { SourceMathPopupView } from "./SourceMathPopupView";
import { useSourceMathPopupStore } from "@/stores/sourceMathPopupStore";

function createCmView(doc: string): EditorView {
  const parent = document.createElement("div");
  parent.className = "cm-editor";
  document.body.appendChild(parent);
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent });
}

function openPopup(opts: {
  latex: string;
  mathFrom: number;
  mathTo: number;
  isBlock?: boolean;
}) {
  useSourceMathPopupStore.getState().openPopup(
    { top: 100, left: 100, bottom: 120, right: 200 },
    opts.latex,
    opts.mathFrom,
    opts.mathTo,
    opts.isBlock ?? false,
  );
}

function resetStore() {
  useSourceMathPopupStore.setState({
    isOpen: false,
    anchorRect: null,
    latex: "",
    originalLatex: "",
    mathFrom: 0,
    mathTo: 0,
    isBlock: false,
  });
}

// Bypass the justOpened rAF guard so click-outside dispatches immediately.
function flushJustOpened() {
  // SourcePopupView.show() schedules `this.justOpened = false` via rAF.
  // Force it to run synchronously.
  const original = globalThis.requestAnimationFrame;
   
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  return () => {
    globalThis.requestAnimationFrame = original;
  };
}

describe("SourceMathPopupView — construction (class-fields regression)", () => {
  let view: EditorView;
  let popup: SourceMathPopupView;

  beforeEach(() => {
    resetStore();
    view = createCmView("");
    popup = new SourceMathPopupView(view);
  });

  afterEach(() => {
    popup.destroy();
    view.destroy();
    document.body.innerHTML = "";
    resetStore();
  });

  it("queries textarea/preview/error from container after super()", () => {
     
    const internals = popup as any;
    expect(internals.textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect(internals.preview).toBeInstanceOf(HTMLElement);
    expect(internals.error).toBeInstanceOf(HTMLElement);
  });
});

describe("SourceMathPopupView — click-outside commits the edit (P2)", () => {
  let view: EditorView;
  let popup: SourceMathPopupView;
  let restoreRaf: () => void;

  beforeEach(() => {
    resetStore();
    view = createCmView("text $x^2$ tail");
    restoreRaf = flushJustOpened();
    popup = new SourceMathPopupView(view);
  });

  afterEach(() => {
    popup.destroy();
    view.destroy();
    document.body.innerHTML = "";
    resetStore();
    restoreRaf();
  });

  it("writes the edited LaTeX to the doc on click-outside", () => {
    openPopup({ latex: "x^2", mathFrom: 5, mathTo: 10, isBlock: false });
    useSourceMathPopupStore.getState().updateLatex("y^3");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.doc.toString()).toBe("text $y^3$ tail");
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });

  it("does not dispatch when latex is unchanged from original", () => {
    openPopup({ latex: "x^2", mathFrom: 5, mathTo: 10, isBlock: false });
    // No updateLatex call — content unchanged.

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.doc.toString()).toBe("text $x^2$ tail");
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });

  it("Escape still discards the edit", () => {
    openPopup({ latex: "x^2", mathFrom: 5, mathTo: 10, isBlock: false });
    useSourceMathPopupStore.getState().updateLatex("y^3");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(view.state.doc.toString()).toBe("text $x^2$ tail");
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });
});

describe("SourceMathPopupView — stale range validation (P3)", () => {
  let view: EditorView;
  let popup: SourceMathPopupView;
  let restoreRaf: () => void;

  beforeEach(() => {
    resetStore();
    view = createCmView("text $x^2$ tail");
    restoreRaf = flushJustOpened();
    popup = new SourceMathPopupView(view);
  });

  afterEach(() => {
    popup.destroy();
    view.destroy();
    document.body.innerHTML = "";
    resetStore();
    restoreRaf();
  });

  it("aborts save when mathTo overshoots the current doc length", () => {
    openPopup({ latex: "x^2", mathFrom: 5, mathTo: 999, isBlock: false });
    useSourceMathPopupStore.getState().updateLatex("y^3");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.doc.toString()).toBe("text $x^2$ tail");
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });

  it("aborts save when the captured range no longer wraps `$...$`", () => {
    // Simulate an external edit removing the opening `$` after the popup
    // captured its range.
    view.dispatch({ changes: { from: 5, to: 6, insert: "" } });
    expect(view.state.doc.toString()).toBe("text x^2$ tail");

    openPopup({ latex: "x^2", mathFrom: 5, mathTo: 10, isBlock: false });
    useSourceMathPopupStore.getState().updateLatex("y^3");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.doc.toString()).toBe("text x^2$ tail");
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });

  it("aborts save when mathFrom is negative", () => {
    openPopup({ latex: "x^2", mathFrom: -1, mathTo: 10, isBlock: false });
    useSourceMathPopupStore.getState().updateLatex("y^3");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.doc.toString()).toBe("text $x^2$ tail");
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });

  it("block math: requires $$ or ```latex prefix in current doc", () => {
    view.destroy();
    view = createCmView("plain text without math");
    popup.destroy();
    popup = new SourceMathPopupView(view);

    openPopup({ latex: "x", mathFrom: 0, mathTo: 5, isBlock: true });
    useSourceMathPopupStore.getState().updateLatex("y");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.doc.toString()).toBe("plain text without math");
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });

  it("block math: aborts when captured range opens with $$ but has no closing $$", () => {
    // Range starts with `$$` (passes the prefix check) but the body — captured
    // before the user deleted the closing fence — no longer contains a valid
    // closer. Writing back the new block would clobber the trailing text.
    view.destroy();
    view = createCmView("$$\nx^2\n\nstray paragraph");
    popup.destroy();
    popup = new SourceMathPopupView(view);

    openPopup({ latex: "x^2", mathFrom: 0, mathTo: 23, isBlock: true });
    useSourceMathPopupStore.getState().updateLatex("y^3");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.doc.toString()).toBe("$$\nx^2\n\nstray paragraph");
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });

  it("block math: aborts when latex-fence range has no closing ```", () => {
    view.destroy();
    view = createCmView("```latex\nx^2\nmore content with no fence end");
    popup.destroy();
    popup = new SourceMathPopupView(view);

    openPopup({
      latex: "x^2",
      mathFrom: 0,
      mathTo: view.state.doc.length,
      isBlock: true,
    });
    useSourceMathPopupStore.getState().updateLatex("y^3");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.doc.toString()).toBe(
      "```latex\nx^2\nmore content with no fence end",
    );
    expect(useSourceMathPopupStore.getState().isOpen).toBe(false);
  });
});
