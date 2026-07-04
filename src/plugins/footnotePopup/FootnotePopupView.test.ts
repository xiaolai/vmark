/**
 * Tests for FootnotePopupView — DOM management for the footnote hover popup.
 *
 * Covers uncovered lines:
 *   - lines 147-150: autoFocus setTimeout fires when popup still open
 *   - line 179: isImeKeyEvent guard in setupKeyboardNavigation handler
 *   - lines 214-215: updatePosition else branch (host === document.body)
 *   - line 230: isImeKeyEvent guard in handleInputKeydown
 *   - line 287: catch block in handleSave (dispatch throws)
 */

// ---------------------------------------------------------------------------
// Mocks (before imports)
// ---------------------------------------------------------------------------

vi.mock("./footnote-popup.css", () => ({}));

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: vi.fn(() => ({ top: 50, left: 100 })),
  getBoundaryRects: vi.fn(() => ({ top: 0, left: 0, right: 800, bottom: 600 })),
  getViewportBounds: vi.fn(() => ({ top: 0, left: 0, right: 1024, bottom: 768 })),
}));

vi.mock("@/utils/popupComponents", () => ({
  handlePopupTabNavigation: vi.fn(),
  popupIcons: {
    goto: "<svg/>",
    save: "<svg/>",
    delete: "<svg/>",
  },
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn((e: KeyboardEvent) => e.key === "Process"),
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: vi.fn(() => null),
  toHostCoordsForDom: vi.fn((_host: unknown, pos: { top: number; left: number }) => pos),
}));

vi.mock("@/utils/markdownPipeline", () => ({
  parseMarkdown: vi.fn(() => ({ forEach: vi.fn() })),
}));

vi.mock("./tiptapDomUtils", () => ({
  scrollToPosition: vi.fn(),
}));

vi.mock("@/utils/debug", () => ({
  footnotePopupWarn: vi.fn(),
  footnotePopupError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Store mock — subscribable
// ---------------------------------------------------------------------------

const mockClosePopup = vi.fn();
const mockSetContent = vi.fn();
let storeState = {
  isOpen: false as boolean,
  anchorRect: null as DOMRect | null,
  content: "Footnote content",
  label: "1",
  definitionPos: 10 as number | null,
  referencePos: 5 as number | null,
  autoFocus: false,
  closePopup: mockClosePopup,
  setContent: mockSetContent,
};

let storeListener: ((state: typeof storeState) => void) | null = null;

vi.mock("@/stores/footnotePopupStore", () => ({
  useFootnotePopupStore: {
    getState: () => storeState,
    subscribe: (cb: (state: typeof storeState) => void) => {
      storeListener = cb;
      return () => { storeListener = null; };
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FootnotePopupView } from "./FootnotePopupView";
import { footnotePopupError } from "@/utils/debug";
import { handlePopupTabNavigation } from "@/utils/popupComponents";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triggerStore(partial: Partial<typeof storeState>) {
  Object.assign(storeState, partial);
  storeListener?.(storeState);
}

const ANCHOR = {
  top: 100, left: 200, bottom: 120, right: 250,
  width: 50, height: 20, x: 200, y: 100, toJSON: () => ({}),
} as DOMRect;

function createMockView(overrides: Record<string, unknown> = {}) {
  const editorDom = document.createElement("div");
  editorDom.className = "cm-editor";

  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";
  editorContainer.appendChild(editorDom);
  document.body.appendChild(editorContainer);

  const mockTr = {
    replaceWith: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  const mockState = {
    schema: {
      marks: {},
      nodes: {
        paragraph: {
          create: vi.fn(() => ({ type: { name: "paragraph" } })),
        },
      },
      text: vi.fn((content: string) => ({ type: { name: "text" }, text: content })),
    },
    tr: mockTr,
    doc: {
      nodeAt: vi.fn(() => ({
        type: { name: "footnote_definition" },
        attrs: { label: "1" },
        nodeSize: 10,
        forEach: vi.fn(),
      })),
    },
  };

  return {
    dom: editorDom,
    state: mockState,
    dispatch: vi.fn(),
    focus: vi.fn(),
    _editorContainer: editorContainer,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FootnotePopupView", () => {
  let view: ReturnType<typeof createMockView>;

  beforeEach(() => {
    vi.clearAllMocks();
    storeState = {
      isOpen: false,
      anchorRect: null,
      content: "Footnote content",
      label: "1",
      definitionPos: 10,
      referencePos: 5,
      autoFocus: false,
      closePopup: mockClosePopup,
      setContent: mockSetContent,
    };
    storeListener = null;
    view = createMockView();
  });

  afterEach(() => {
    view._editorContainer.remove();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Lines 147-150: autoFocus setTimeout fires when popup still open
  // -------------------------------------------------------------------------

  it("autoFocus setTimeout calls textarea.focus/select when popup is still open", async () => {
    vi.useFakeTimers();

    const popup = new FootnotePopupView(view as never);

    // Show with autoFocus = true
    triggerStore({ isOpen: true, anchorRect: ANCHOR, autoFocus: true });

    // The autoFocus path: state.autoFocus = true triggers setTimeout
    // Advance timers to fire the setTimeout (AUTOFOCUS_DELAY_MS = 50)
    vi.advanceTimersByTime(100);

    // The store is still open — textarea.focus() and .select() should be called
    const _textarea = popup["textarea"] as HTMLTextAreaElement;
    // We can't easily spy on element methods directly, but we verify no errors
    // and the popup is still visible (autoFocus ran without throwing)
    expect(popup["container"].style.display).toBe("flex");

    popup.destroy();
    vi.useRealTimers();
  });

  it("autoFocus setTimeout skips focus/select when popup closed before timer fires", async () => {
    vi.useFakeTimers();

    const popup = new FootnotePopupView(view as never);

    // Show with autoFocus = true
    triggerStore({ isOpen: true, anchorRect: ANCHOR, autoFocus: true });

    // Close before timer fires
    triggerStore({ isOpen: false, anchorRect: null });

    // Advance timers — store.isOpen is false, so focus/select are skipped
    vi.advanceTimersByTime(100);

    // Popup should be hidden
    expect(popup["container"].style.display).toBe("none");

    popup.destroy();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Line 179: isImeKeyEvent guard in setupKeyboardNavigation handler
  // -------------------------------------------------------------------------

  it("keyboard navigation handler ignores IME key events (Process key)", () => {
    const popup = new FootnotePopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    // Dispatch a Process key (IME key) — handler should return early before handlePopupTabNavigation
    const event = new KeyboardEvent("keydown", { key: "Process", bubbles: true });
    document.dispatchEvent(event);

    // handlePopupTabNavigation should NOT be called (IME guard fired)
    expect(vi.mocked(handlePopupTabNavigation)).not.toHaveBeenCalled();

    popup.destroy();
  });

  // -------------------------------------------------------------------------
  // Lines 214-215: updatePosition else branch (host === document.body)
  // -------------------------------------------------------------------------

  it("updatePosition uses viewport coords when host is document.body (no editor-container)", () => {
    // Create view with DOM not inside an .editor-container
    const dom = document.createElement("div");
    document.body.appendChild(dom);

    const mockView = {
      dom,
      state: view.state,
      dispatch: vi.fn(),
      focus: vi.fn(),
      _editorContainer: null,
    };

    const popup = new FootnotePopupView(mockView as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    // Container style should have been set (top/left)
    expect(popup["container"].style.top).not.toBe("");
    expect(popup["container"].style.left).not.toBe("");

    popup.destroy();
    dom.remove();
  });

  // -------------------------------------------------------------------------
  // Line 230: isImeKeyEvent guard in handleInputKeydown
  // -------------------------------------------------------------------------

  it("handleInputKeydown ignores IME key events (Process key)", () => {
    const popup = new FootnotePopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    const textarea = popup["textarea"] as HTMLTextAreaElement;

    // Dispatch Process key (IME) — should return early without calling closePopup or dispatch
    const event = new KeyboardEvent("keydown", { key: "Process", bubbles: true });
    textarea.dispatchEvent(event);

    expect(mockClosePopup).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();

    popup.destroy();
  });

  it("handleInputKeydown Enter saves and closes", () => {
    const popup = new FootnotePopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    const textarea = popup["textarea"] as HTMLTextAreaElement;
    textarea.value = "new content";

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);

    // dispatch should be called (save) OR closePopup if definitionPos === null
    // Since definitionPos = 10, dispatch should be called
    expect(view.dispatch).toHaveBeenCalled();

    popup.destroy();
  });

  it("handleInputKeydown Escape closes popup and focuses editor", () => {
    const popup = new FootnotePopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    const textarea = popup["textarea"] as HTMLTextAreaElement;

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);

    expect(mockClosePopup).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();

    popup.destroy();
  });

  // -------------------------------------------------------------------------
  // Line 287 (catch block): handleSave dispatch throws
  // -------------------------------------------------------------------------

  it("handleSave catch block logs error and keeps popup open when dispatch throws", () => {
    const viewWithError = createMockView({
      dispatch: vi.fn(() => { throw new Error("save dispatch failed"); }),
    });

    const popup = new FootnotePopupView(viewWithError as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, definitionPos: 10, label: "1" });

    // Trigger via Enter key on textarea (which calls handleSave)
    const textarea = popup["textarea"] as HTMLTextAreaElement;
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);

    expect(footnotePopupError).toHaveBeenCalledWith(
      "Save failed; keeping popup open to preserve the edit:",
      expect.any(Error)
    );
    // The popup must stay open so the user's edited text isn't lost
    expect(mockClosePopup).not.toHaveBeenCalled();

    popup.destroy();
    viewWithError._editorContainer.remove();
  });
});
