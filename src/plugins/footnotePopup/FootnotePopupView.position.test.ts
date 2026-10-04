/**
 * FootnotePopupView positioning — issue #1494.
 *
 * The popup sits above its reference, so its top depends on its own height.
 * The height must be measured AFTER the textarea is sized for the footnote
 * being shown; measuring first reused the previous footnote's height, so the
 * popup landed at the previous footnote's offset until it was re-hovered.
 *
 * jsdom has no layout, so the tests simulate one: the textarea's scrollHeight
 * follows its text, and the container's height follows the textarea's inline
 * height — the same dependency the real browser layout has.
 */

vi.mock("./footnote-popup.css", () => ({}));

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: vi.fn(() => ({ top: 50, left: 100 })),
  getBoundaryRects: vi.fn(() => ({ top: 0, left: 0, right: 800, bottom: 600 })),
  getViewportBounds: vi.fn(() => ({ top: 0, left: 0, right: 1024, bottom: 768 })),
}));

vi.mock("@/plugins/shared/popupHostDom", () => ({
  getPopupHostForDom: vi.fn(() => null),
  toHostCoordsForDom: vi.fn((_host: unknown, pos: { top: number; left: number }) => pos),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculatePopupPosition } from "@/utils/popupPosition";
import { FootnotePopupView } from "./FootnotePopupView";

const LINE_PX = 20;
const CHROME_PX = 40; // container padding + button row
const CHARS_PER_LINE = 10;

let storeState: Record<string, unknown>;
let listener: ((s: Record<string, unknown>) => void) | null = null;
const store = {
  getState: () => storeState,
  subscribe: (cb: (s: Record<string, unknown>) => void) => {
    listener = cb;
    return () => { listener = null; };
  },
};

function setStore(partial: Record<string, unknown>) {
  storeState = { ...storeState, ...partial };
  listener?.(storeState);
}

const ANCHOR = { top: 300, left: 200, bottom: 320, right: 250, width: 50, height: 20 };

/** Height of the popup the layout simulation produces for `text`. */
function expectedHeight(text: string): number {
  return CHROME_PX + Math.ceil(text.length / CHARS_PER_LINE) * LINE_PX;
}

function lastPositionedHeight(): number {
  const calls = vi.mocked(calculatePopupPosition).mock.calls;
  return calls[calls.length - 1][0].popup.height;
}

describe("FootnotePopupView positioning (#1494)", () => {
  let editorContainer: HTMLElement;
  let popup: FootnotePopupView;

  beforeEach(() => {
    vi.clearAllMocks();
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

    editorContainer = document.createElement("div");
    editorContainer.className = "editor-container";
    const dom = document.createElement("div");
    editorContainer.appendChild(dom);
    document.body.appendChild(editorContainer);

    storeState = {
      isOpen: false, anchorRect: null, content: "", label: "1",
      definitionPos: 10, referencePos: 5, autoFocus: false,
      closePopup: vi.fn(), setContent: vi.fn(),
    };
    popup = new FootnotePopupView({ dom, focus: vi.fn() } as never, store as never);
  });

  afterEach(() => {
    popup.destroy();
    editorContainer.remove();
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    vi.restoreAllMocks();
  });

  it("positions the first popup with its own height", () => {
    const text = "x".repeat(45);
    setStore({ isOpen: true, anchorRect: ANCHOR, label: "1", content: text });
    expect(lastPositionedHeight()).toBe(expectedHeight(text));
  });

  it("hovering straight from a short footnote to a long one uses the long one's height", () => {
    const short = "short";
    const long = "y".repeat(55);
    setStore({ isOpen: true, anchorRect: ANCHOR, label: "1", content: short });
    setStore({ label: "2", content: long });
    expect(lastPositionedHeight()).toBe(expectedHeight(long));
  });

  it("hovering from a long footnote to a short one uses the short one's height", () => {
    const long = "y".repeat(55);
    const short = "short";
    setStore({ isOpen: true, anchorRect: ANCHOR, label: "1", content: long });
    setStore({ label: "2", content: short });
    expect(lastPositionedHeight()).toBe(expectedHeight(short));
  });

  it("reopening after a close uses the new footnote's height, not the last one's", () => {
    const long = "y".repeat(55);
    const short = "short";
    setStore({ isOpen: true, anchorRect: ANCHOR, label: "1", content: long });
    setStore({ isOpen: false, anchorRect: null });
    setStore({ isOpen: true, anchorRect: ANCHOR, label: "2", content: short });
    expect(lastPositionedHeight()).toBe(expectedHeight(short));
  });

  it("hovering a second reference to the same footnote re-anchors on it", () => {
    const second = { ...ANCHOR, top: 450, bottom: 470 };
    setStore({ isOpen: true, anchorRect: ANCHOR, label: "1", content: "note", referencePos: 5 });
    setStore({ anchorRect: second, referencePos: 40 });
    const calls = vi.mocked(calculatePopupPosition).mock.calls;
    expect(calls[calls.length - 1][0].anchor).toEqual(second);
  });

  it("repositions when typing changes the popup's height", () => {
    setStore({ isOpen: true, anchorRect: ANCHOR, label: "1", content: "short" });
    const textarea = popup["textarea"];
    textarea.value = "z".repeat(35);
    textarea.dispatchEvent(new Event("input"));
    expect(lastPositionedHeight()).toBe(expectedHeight(textarea.value));
  });
});
