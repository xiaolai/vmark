/**
 * SourceFootnotePopupView retargeting and positioning — issue #1494.
 *
 * Hovering straight from one footnote to another keeps the popup open, so the
 * view must re-show for the new footnote (content AND position). The popup
 * sits above its reference, so its offset must come from its real rendered
 * height for the footnote being shown — not a constant, and not the previous
 * footnote's height.
 *
 * jsdom has no layout, so the tests simulate one: the textarea's scrollHeight
 * follows its text, and the container's height follows the textarea's inline
 * height.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";

vi.mock("@/plugins/shared/popupHostDom", () => ({
  getPopupHostForDom: () => null,
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));

vi.mock("@/plugins/shared/sourcePopupUtils", () => ({
  getEditorBounds: () => ({
    horizontal: { left: 0, right: 800 },
    vertical: { top: 0, bottom: 600 },
  }),
}));

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: vi.fn(() => ({ top: 200, left: 150 })),
}));

import { calculatePopupPosition } from "@/utils/popupPosition";
import { SourceFootnotePopupView } from "../SourceFootnotePopupView";

const LINE_PX = 20;
const CHROME_PX = 36; // header row + padding
const CHARS_PER_LINE = 10;

let storeState: Record<string, unknown>;
const subscribers: Array<(s: Record<string, unknown>) => void> = [];
const store = {
  getState: () => storeState,
  subscribe: (fn: (s: Record<string, unknown>) => void) => {
    subscribers.push(fn);
    return () => { subscribers.splice(subscribers.indexOf(fn), 1); };
  },
};

function setStore(partial: Record<string, unknown>) {
  storeState = { ...storeState, ...partial };
  subscribers.forEach((fn) => fn(storeState));
}

const ANCHOR_1 = { top: 300, left: 50, bottom: 320, right: 80, width: 30, height: 20 };
const ANCHOR_2 = { top: 400, left: 90, bottom: 420, right: 120, width: 30, height: 20 };

function expectedHeight(text: string): number {
  return CHROME_PX + Math.ceil(text.length / CHARS_PER_LINE) * LINE_PX;
}

function lastPositionCall() {
  const calls = vi.mocked(calculatePopupPosition).mock.calls;
  return calls[calls.length - 1][0];
}

describe("SourceFootnotePopupView retargeting and positioning (#1494)", () => {
  let editorDom: HTMLElement;
  let popup: SourceFootnotePopupView;

  beforeEach(() => {
    vi.clearAllMocks();
    subscribers.length = 0;
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return Math.ceil(this.value.length / CHARS_PER_LINE) * LINE_PX;
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const textarea = this.querySelector("textarea");
      const height = textarea ? CHROME_PX + (parseFloat(textarea.style.height) || 0) : 0;
      return { top: 0, left: 0, right: 300, bottom: height, width: 300, height, x: 0, y: 0 } as DOMRect;
    });

    editorDom = document.createElement("div");
    editorDom.className = "cm-editor";
    const contentDOM = document.createElement("div");
    editorDom.appendChild(contentDOM);
    document.body.appendChild(editorDom);

    storeState = {
      isOpen: false, label: "", content: "", anchorRect: null,
      definitionPos: null, referencePos: null, autoFocus: false,
      closePopup: vi.fn(), setContent: vi.fn(),
    };
    const view = { dom: editorDom, contentDOM, focus: vi.fn() } as unknown as EditorView;
    popup = new SourceFootnotePopupView(view, store as never);
  });

  afterEach(() => {
    popup.destroy();
    editorDom.remove();
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    vi.restoreAllMocks();
  });

  function open(label: string, content: string, anchorRect: object, referencePos: number) {
    setStore({ isOpen: true, label, content, anchorRect, referencePos, definitionPos: 900 });
  }

  it("positions the popup with its rendered height, not a constant", () => {
    const text = "x".repeat(45);
    open("1", text, ANCHOR_1, 10);
    expect(lastPositionCall().popup.height).toBe(expectedHeight(text));
  });

  it("hovering straight to another footnote shows its content at its own anchor and height", () => {
    const long = "y".repeat(55);
    open("1", "short", ANCHOR_1, 10);
    open("2", long, ANCHOR_2, 20);

    expect(popup["textarea"].value).toBe(long);
    expect(popup["labelSpan"].textContent).toBe("[^2]");
    expect(lastPositionCall().anchor).toEqual(ANCHOR_2);
    expect(lastPositionCall().popup.height).toBe(expectedHeight(long));
  });

  it("hovering a second reference to the same footnote re-anchors on it", () => {
    open("1", "same note", ANCHOR_1, 10);
    open("1", "same note", ANCHOR_2, 20);
    expect(lastPositionCall().anchor).toEqual(ANCHOR_2);
  });

  it("does not re-show while editing the same footnote", () => {
    open("1", "short", ANCHOR_1, 10);
    const textarea = popup["textarea"];
    textarea.value = "edited";
    setStore({ content: "edited" });
    expect(textarea.value).toBe("edited");
  });

  it("repositions when typing changes the popup's height", () => {
    open("1", "short", ANCHOR_1, 10);
    const textarea = popup["textarea"];
    textarea.value = "z".repeat(35);
    textarea.dispatchEvent(new Event("input"));
    expect(lastPositionCall().popup.height).toBe(expectedHeight(textarea.value));
  });
});
