/**
 * Media popup — a MARKED inline image cannot become a block image.
 *
 * Since #1448 the markdown pipeline keeps the marks around an inline image,
 * so `[![a](pic.png)](A.md)` is an image carrying a link mark. A block image
 * is its own block node with no marks, so the inline→block toggle would drop
 * the link from the author's file. The toggle is hidden for such an image and
 * the conversion refused; an unmarked image converts as before.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { getProductionSchema } from "@/test/productionSchema";

vi.mock("@/plugins/shared/popupHostDom", () => ({
  getPopupHostForDom: (dom: HTMLElement) => dom.closest(".editor-container"),
  toHostCoordsForDom: (_host: HTMLElement, pos: { top: number; left: number }) => pos,
}));
vi.mock("./mediaPopupActions", () => ({ browseAndReplaceMedia: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ dirname: vi.fn(), join: vi.fn() }));
vi.mock("@/plugins/shared/hostDocument", () => ({ activeFilePathForCurrentWindow: () => null }));
vi.mock("@/services/navigation/windowFocus", () => ({ getWindowLabel: () => "main" }));

import { MediaPopupView } from "./MediaPopupView";

const schema = getProductionSchema();
const anchorRect = { top: 10, left: 10, bottom: 20, right: 30 };

function mount(linked: boolean) {
  const marks = linked ? [schema.marks.link.create({ href: "A.md" })] : [];
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("x "),
      schema.node("image", { src: "pic.png", alt: "a" }, undefined, marks),
    ]),
  ]);
  const container = document.createElement("div");
  container.className = "editor-container";
  document.body.appendChild(container);
  const view = new EditorView(container, { state: EditorState.create({ doc, schema }) });

  let state = {
    isOpen: false,
    mediaSrc: "pic.png",
    mediaAlt: "a",
    mediaTitle: "",
    mediaNodePos: 3, // after "x " inside the paragraph
    mediaNodeType: "image" as const,
    mediaPoster: "",
    mediaDimensions: null,
    anchorRect: null as typeof anchorRect | null,
    closePopup: vi.fn(),
    setSrc: vi.fn(),
    setAlt: vi.fn(),
    setTitle: vi.fn(),
    setPoster: vi.fn(),
    setNodeType: vi.fn(),
  };
  const listeners: Array<(s: typeof state, p: typeof state) => void> = [];
  const store = {
    getState: () => state,
    subscribe: (fn: (s: typeof state, p: typeof state) => void) => {
      listeners.push(fn);
      return () => listeners.splice(listeners.indexOf(fn), 1);
    },
  };
  const popup = new MediaPopupView(view as never, store as never);
  const prev = state;
  state = { ...state, isOpen: true, anchorRect };
  listeners.forEach((fn) => fn(state, prev));

  return {
    view,
    popup,
    toggleBtn: container.querySelector<HTMLElement>(".media-popup-btn-toggle")!,
    cleanup: () => {
      popup.destroy();
      view.destroy();
      container.remove();
    },
  };
}

const imageAt = (doc: PMNode) => {
  let found: PMNode | null = null;
  doc.descendants((n) => {
    if (n.type.name === "image" || n.type.name === "block_image") found = n;
  });
  return found as PMNode | null;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("inline → block toggle for a marked image", () => {
  it("is hidden, and the conversion is refused, keeping the link", () => {
    const { view, popup, toggleBtn, cleanup } = mount(true);
    expect(toggleBtn.style.display).toBe("none");

    (popup as unknown as { handleToggle: () => void }).handleToggle();

    const image = imageAt(view.state.doc)!;
    expect(image.type.name).toBe("image");
    expect(image.marks.map((m) => m.attrs.href)).toEqual(["A.md"]);
    cleanup();
  });

  it("stays available for an unmarked image", () => {
    const { view, popup, toggleBtn, cleanup } = mount(false);
    expect(toggleBtn.style.display).toBe("");

    (popup as unknown as { handleToggle: () => void }).handleToggle();

    expect(imageAt(view.state.doc)!.type.name).toBe("block_image");
    cleanup();
  });
});
