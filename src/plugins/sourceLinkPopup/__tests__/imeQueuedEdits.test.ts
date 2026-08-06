/**
 * Audit 20260804-F2 — Source link save/remove deferred by an IME composition.
 *
 * The bug: `saveLinkChanges` / `removeLink` wrap their work in
 * `runOrQueueCodeMirrorAction`, and the queued callback read the popup state
 * at FLUSH time. But `SourceLinkPopupView.handleSave` closes the popup on the
 * same click, and `closePopup()` resets the store to `linkFrom: 0, linkTo: 0,
 * href: ""`. So for a CJK user mid-composition the queued callback saw `0..0`,
 * failed the intact-range check, logged one debug line, and silently dropped
 * the edit. Non-composing users never saw it, because the action ran before
 * the close.
 *
 * The fix captures the intent (URL + range + closePopup) at ACTION time and
 * re-validates the RANGE against the live doc at execution time — so the
 * deferral survives the close without ever licensing a stale write.
 *
 * Mock boundary: NONE for the store or the editor — real `useLinkPopupStore`,
 * real CodeMirror `EditorState`/`EditorView`. Only `@tauri-apps/*` is stubbed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { flushCodeMirrorCompositionQueue } from "@/utils/imeGuard";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import { removeLink, saveLinkChanges } from "../sourceLinkActions";

const store = useLinkPopupStore as never;
const rect = { top: 0, left: 0, bottom: 10, right: 10 };

let view: EditorView | null = null;
let parent: HTMLElement | null = null;

/**
 * A real view reporting an in-flight composition. `composing` /
 * `compositionStarted` are prototype getters; an own data property shadows
 * them, which is the smallest way to put a real view into the state the
 * guard branches on without driving jsdom composition events (jsdom does not
 * reproduce the WebKit composition lifecycle — see the real-WebKit tier).
 */
function createComposingView(doc: string): EditorView {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({ state: EditorState.create({ doc }), parent });
  Object.defineProperty(view, "composing", { value: true, configurable: true });
  Object.defineProperty(view, "compositionStarted", { value: true, configurable: true });
  return view;
}

/** End the composition so the queue may flush, mirroring the CM ime guard. */
function endComposition(v: EditorView): void {
  Object.defineProperty(v, "composing", { value: false, configurable: true });
  Object.defineProperty(v, "compositionStarted", { value: false, configurable: true });
}

function openPopupOn(doc: string, linkText: string, href: string): void {
  const from = doc.indexOf(linkText);
  useLinkPopupStore.getState().openPopup({
    href,
    linkFrom: from,
    linkTo: from + linkText.length,
    anchorRect: rect,
  });
}

beforeEach(() => {
  useLinkPopupStore.getState().closePopup();
});

afterEach(() => {
  view?.destroy();
  view = null;
  parent?.remove();
  parent = null;
  useLinkPopupStore.getState().closePopup();
});

describe("save queued during composition, store reset by the popup close", () => {
  it("applies the captured URL when the queue flushes", () => {
    const doc = "before [text](old) after";
    const v = createComposingView(doc);
    openPopupOn(doc, "[text](old)", "old");
    useLinkPopupStore.getState().setHref("new");

    saveLinkChanges(v, store);
    // The view closes the popup on the same click — this is what used to
    // destroy the queued action's only source of truth.
    useLinkPopupStore.getState().closePopup();
    expect(v.state.doc.toString()).toBe(doc);

    endComposition(v);
    flushCodeMirrorCompositionQueue(v);

    expect(v.state.doc.toString()).toBe("before [text](new) after");
  });

  it("unlinks on an empty URL captured before the close (D7 survives deferral)", () => {
    const doc = "before [text](old) after";
    const v = createComposingView(doc);
    openPopupOn(doc, "[text](old)", "old");
    useLinkPopupStore.getState().setHref("   ");

    saveLinkChanges(v, store);
    useLinkPopupStore.getState().closePopup();
    endComposition(v);
    flushCodeMirrorCompositionQueue(v);

    expect(v.state.doc.toString()).toBe("before text after");
  });

  it("still refuses to write when the captured range no longer holds the link", () => {
    // Capture-at-action-time must not become capture-and-trust: the range is
    // re-validated against the live doc at execution time.
    const doc = "before [text](old) after";
    const v = createComposingView(doc);
    openPopupOn(doc, "[text](old)", "old");
    useLinkPopupStore.getState().setHref("new");

    saveLinkChanges(v, store);
    useLinkPopupStore.getState().closePopup();
    // A concurrent edit (MCP / AI suggestion) destroys the link while the
    // action sits in the queue.
    const from = doc.indexOf("[text](old)");
    v.dispatch({ changes: { from, to: from + "[text](old)".length, insert: "" } });

    endComposition(v);
    flushCodeMirrorCompositionQueue(v);

    expect(v.state.doc.toString()).toBe("before  after");
  });

  it("writes at the remapped range when the popup tracked a concurrent edit", () => {
    const doc = "before [text](old) after";
    const v = createComposingView(doc);
    openPopupOn(doc, "[text](old)", "old");
    useLinkPopupStore.getState().setHref("new");
    // An edit AFTER the link leaves the offsets valid — the guard must not be
    // a blanket abort just because time passed.
    v.dispatch({ changes: { from: doc.length, to: doc.length, insert: " tail" } });

    saveLinkChanges(v, store);
    useLinkPopupStore.getState().closePopup();
    endComposition(v);
    flushCodeMirrorCompositionQueue(v);

    expect(v.state.doc.toString()).toBe("before [text](new) after tail");
  });
});

describe("remove queued during composition, store reset by the popup close", () => {
  it("removes the link markdown when the queue flushes", () => {
    const doc = "before [text](old) after";
    const v = createComposingView(doc);
    openPopupOn(doc, "[text](old)", "old");

    removeLink(v, store);
    useLinkPopupStore.getState().closePopup();
    expect(v.state.doc.toString()).toBe(doc);

    endComposition(v);
    flushCodeMirrorCompositionQueue(v);

    expect(v.state.doc.toString()).toBe("before text after");
  });

  it("removes the correct link when two links share the doc", () => {
    // A reset store would have pointed at 0..0; the captured range must be
    // the one the user actually opened.
    const doc = "[a](ua) and [b](ub)";
    const v = createComposingView(doc);
    openPopupOn(doc, "[b](ub)", "ub");

    removeLink(v, store);
    useLinkPopupStore.getState().closePopup();
    endComposition(v);
    flushCodeMirrorCompositionQueue(v);

    expect(v.state.doc.toString()).toBe("[a](ua) and b");
  });

  it("aborts when the captured range was destroyed while queued", () => {
    const doc = "before [text](old) after";
    const v = createComposingView(doc);
    openPopupOn(doc, "[text](old)", "old");

    removeLink(v, store);
    useLinkPopupStore.getState().closePopup();
    const from = doc.indexOf("](old)");
    v.dispatch({ changes: { from, to: from + "](old)".length, insert: "" } });

    endComposition(v);
    flushCodeMirrorCompositionQueue(v);

    expect(v.state.doc.toString()).toBe("before [text after");
  });
});

describe("CJK document (the configuration this bug only ever hit)", () => {
  it("saves through a deferral with multibyte text around the link", () => {
    const doc = "中文前 [链接](old) 后缀";
    const v = createComposingView(doc);
    openPopupOn(doc, "[链接](old)", "old");
    useLinkPopupStore.getState().setHref("new");

    saveLinkChanges(v, store);
    useLinkPopupStore.getState().closePopup();
    endComposition(v);
    flushCodeMirrorCompositionQueue(v);

    expect(v.state.doc.toString()).toBe("中文前 [链接](new) 后缀");
  });
});
