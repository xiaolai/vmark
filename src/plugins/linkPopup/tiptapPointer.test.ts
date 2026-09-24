/**
 * Link Popup Plugin — pointer behaviour in a REAL EditorView (#1448).
 *
 * Covers what the mocked-view suite in `tiptap.test.ts` cannot: the native
 * click that follows ProseMirror's mouseup-driven handleClick, and the plugin
 * view's reaction to edits made while a click-opened popup is showing.
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Plugin } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

vi.mock("./link-popup.css", () => ({}));
const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("./LinkPopupView", () => ({
  LinkPopupView: class MockLinkPopupView {
    destroy = vi.fn();
  },
}));

import { linkPopupExtension } from "./tiptap";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    text: { inline: true, group: "inline" },
    image: {
      inline: true,
      group: "inline",
      attrs: { src: { default: "" } },
      toDOM: (node) => ["img", { src: node.attrs.src }],
    },
  },
  marks: {
    link: {
      attrs: { href: { default: "" } },
      toDOM: (mark) => ["a", { href: mark.attrs.href }, 0],
    },
  },
});

/** A paragraph "see " + link("Alpha" → A.md) + " end": the link spans 5..10. */
function docWithLink() {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("see "),
      schema.text("Alpha", [schema.marks.link.create({ href: "A.md" })]),
      schema.text(" end"),
    ]),
  ]);
}

const popupState = {
  isOpen: false,
  linkFrom: 0,
  linkTo: 0,
  openPopup: vi.fn(),
  closePopup: vi.fn(),
};
const popupStore = { getState: () => popupState };
const createStore = { getState: () => ({ isOpen: false, closePopup: vi.fn() }) };

/** Like VMark's image node view: keeps mousedown/click away from ProseMirror. */
const clickSwallowingImage = (node: import("@tiptap/pm/model").Node) => {
  const dom = document.createElement("img");
  dom.src = node.attrs.src as string;
  return { dom, stopEvent: (e: Event) => e.type === "mousedown" || e.type === "click" };
};

function mount(doc = docWithLink()) {
  const addPlugins = linkPopupExtension.config.addProseMirrorPlugins as unknown as (
    this: unknown,
  ) => Plugin[];
  const plugins = addPlugins.call({ editor: { view: {} }, options: { store: popupStore, createStore } });
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, {
    state: EditorState.create({ doc, schema, plugins: [plugins[0]] }),
    nodeViews: { image: clickSwallowingImage },
  });
  Object.assign(popupState, { isOpen: false, linkFrom: 0, linkTo: 0 });
  popupState.openPopup.mockClear();
  popupState.closePopup.mockClear();
  return {
    view,
    plugin: plugins[0],
    cleanup: () => {
      view.destroy();
      place.remove();
    },
  };
}

// A click on a link must leave the keyboard in the document: the popup's URL
// field used to take focus with its text selected, so the next Backspace or
// paste landed there instead of in the link text.
it("opens the edit popup without taking focus on a plain click", () => {
  const { view, plugin, cleanup } = mount();
  // jsdom has no layout; the popup only needs some anchor rect.
  vi.spyOn(view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 10, left: 0, right: 10 });
  const handleClick = plugin.props.handleClick!.bind(plugin);
  handleClick(view, 7, new MouseEvent("click"));
  expect(popupState.openPopup).toHaveBeenCalledWith(
    expect.objectContaining({ href: "A.md", linkFrom: 5, linkTo: 10, autoFocus: false }),
  );
  cleanup();
});

// #1448 — tauri-plugin-opener injects a window `click` listener that sends any
// anchor clicked with Ctrl/Shift (or `target="_blank"`) to the OS browser
// unless the event is already defaultPrevented. ProseMirror's handleClick runs
// on MOUSEUP, so its preventDefault never reached the native click: on Windows
// (origin http://tauri.localhost) a Ctrl+clicked `A.md` opened
// `http://tauri.localhost/A.md` in the browser. VMark owns link activation in
// the editor, so the native click on a link must arrive handled.
describe("native click on a link anchor", () => {
  /** Dispatch a native click and report what a window listener saw. */
  function clickSeenByWindow(target: Element, init: MouseEventInit): boolean {
    let seenPrevented = false;
    const spy = (e: Event) => {
      seenPrevented = e.defaultPrevented;
    };
    window.addEventListener("click", spy);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    window.removeEventListener("click", spy);
    return seenPrevented;
  }

  it.each([
    ["Ctrl+click", { ctrlKey: true }],
    ["Shift+click", { shiftKey: true }],
    ["plain click", {}],
  ])("arrives defaultPrevented on %s", (_label, init) => {
    const { view, cleanup } = mount();
    const anchor = view.dom.querySelector("a")!;
    expect(anchor).not.toBeNull();
    expect(clickSeenByWindow(anchor, init)).toBe(true);
    cleanup();
  });

  // The image node view keeps clicks from ProseMirror, so neither handleClick
  // nor a ProseMirror DOM handler ever sees them: the guard must listen on the
  // editor element itself, and must also OPEN the link, as handleClick would.
  it("opens a Ctrl+clicked linked image through VMark, not the native opener", async () => {
    const link = schema.marks.link.create({ href: "https://example.com/x" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.node("image", { src: "i.png" }, undefined, [link])]),
    ]);
    const { view, cleanup } = mount(doc);
    openUrlMock.mockClear();
    const img = view.dom.querySelector("img")!;
    expect(clickSeenByWindow(img, { ctrlKey: true })).toBe(true);
    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://example.com/x"));

    openUrlMock.mockClear();
    expect(clickSeenByWindow(img, {})).toBe(true); // plain click: handled, not opened
    await new Promise((r) => setTimeout(r, 0));
    expect(openUrlMock).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not open a Ctrl+clicked TEXT link a second time", async () => {
    const { view, cleanup } = mount();
    openUrlMock.mockClear();
    clickSeenByWindow(view.dom.querySelector("a")!, { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(openUrlMock).not.toHaveBeenCalled(); // handleClick owns text links
    cleanup();
  });

  it("arrives defaultPrevented when the link begins with an inline image", () => {
    const link = schema.marks.link.create({ href: "A.md" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.node("image", { src: "i.png" }, undefined, [link]),
        schema.text(" caption", [link]),
      ]),
    ]);
    const { view, cleanup } = mount(doc);
    const anchor = view.dom.querySelector("a")!;
    expect(anchor.querySelector("img")).not.toBeNull();
    expect(clickSeenByWindow(anchor, { ctrlKey: true })).toBe(true);
    cleanup();
  });

  it("leaves clicks on plain text alone", () => {
    const { view, cleanup } = mount();
    const paragraph = view.dom.querySelector("p")!;
    expect(clickSeenByWindow(paragraph, { ctrlKey: true })).toBe(false);
    cleanup();
  });
});

// #1448 — a click-opened popup leaves the keyboard in the document, so the
// user may keep editing the link text under it. Whatever they do there makes
// the popup's snapshot of the link stale; it must close rather than linger.
describe("link popup follows the document while the editor has focus", () => {
  function mountOpen() {
    const mounted = mount();
    Object.assign(popupState, { isOpen: true, linkFrom: 5, linkTo: 10 });
    return mounted;
  }

  it("closes when the user edits the document", () => {
    const { view, cleanup } = mountOpen();
    vi.spyOn(view, "hasFocus").mockReturnValue(true);
    view.dispatch(view.state.tr.insertText("x", 7));
    expect(popupState.closePopup).toHaveBeenCalled();
    cleanup();
  });

  it("closes when the caret leaves the link", () => {
    const { view, cleanup } = mountOpen();
    vi.spyOn(view, "hasFocus").mockReturnValue(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));
    expect(popupState.closePopup).not.toHaveBeenCalled();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)));
    expect(popupState.closePopup).toHaveBeenCalled();
    cleanup();
  });

  it("stays open for changes that arrive while the popup holds focus", () => {
    // MCP edits and the like: the save path's own range guard covers them.
    const { view, cleanup } = mountOpen();
    vi.spyOn(view, "hasFocus").mockReturnValue(false);
    view.dispatch(view.state.tr.insertText("x", 2));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 13)));
    expect(popupState.closePopup).not.toHaveBeenCalled();
    cleanup();
  });

  it("does nothing while the popup is closed", () => {
    const { view, cleanup } = mountOpen();
    popupState.isOpen = false;
    vi.spyOn(view, "hasFocus").mockReturnValue(true);
    view.dispatch(view.state.tr.insertText("x", 7));
    expect(popupState.closePopup).not.toHaveBeenCalled();
    cleanup();
  });
});
