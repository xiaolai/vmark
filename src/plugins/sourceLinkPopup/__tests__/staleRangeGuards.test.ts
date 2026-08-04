/**
 * WI-1 — Source link popup stale-range & retarget guards.
 *
 * Decision ledger: .claude/tdd-guardian/decisions-20260803.md
 *   D1 (RESOLVED): remap-when-mappable / close-when-destroyed — an update-listener
 *     extension remaps the tracked range through `update.changes.mapPos` while the
 *     popup is open (verbatim-slice identity), closing on destruction; save/remove
 *     re-validate at dispatch time and abort+close instead of dispatching stale
 *     offsets. Invariant: a stale write can never happen — asserted on the FINAL
 *     DOCUMENT STRING, never on dispatch call args.
 *   D7 (RESOLVED): empty/whitespace URL on save unlinks (removes the link markdown,
 *     keeps the text) — matching WYSIWYG `LinkPopupView.handleSave`.
 *
 * Mock boundary: NONE for stores/editor — real `useLinkPopupStore`, real CodeMirror
 * `EditorState`/`EditorView` transactions. Only `@tauri-apps/*` (clipboard/opener)
 * is stubbed, per the mock-boundary policy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useLinkPopupStore } from "@/stores/linkPopupStore";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import { saveLinkChanges } from "../sourceLinkActions";
import { createSourceLinkPopupPlugin } from "../sourceLinkPopupPlugin";

// The actions/plugin take the popup state as an injected PORT; these tests
// drive the REAL store — the wiring the app ships.
const store = useLinkPopupStore as never;

const rect = { top: 0, left: 0, bottom: 10, right: 10 };

/** Locate a link's markdown span inside a doc string. */
function linkRange(doc: string, linkText: string): { from: number; to: number } {
  const from = doc.indexOf(linkText);
  if (from < 0) throw new Error(`link ${linkText} not in doc`);
  return { from, to: from + linkText.length };
}

let view: EditorView | null = null;
let parent: HTMLElement | null = null;

function createView(doc: string, withPlugin: boolean): EditorView {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    extensions: withPlugin ? [createSourceLinkPopupPlugin(store)] : [],
  });
  view = new EditorView({ state, parent });
  return view;
}

/** Open the popup on a link via the real store action (the shipped open path). */
function openPopupOn(doc: string, linkText: string, href: string): { from: number; to: number } {
  const { from, to } = linkRange(doc, linkText);
  useLinkPopupStore.getState().openPopup({ href, linkFrom: from, linkTo: to, anchorRect: rect });
  return { from, to };
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

// ─── Case 1: MCP edit before the link while popup open, then save ───

describe("doc mutates while popup open (D1 remap path)", () => {
  it("save after an insert BEFORE the link edits the link, not unrelated text (with plugin)", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, true);
    openPopupOn(doc, "[text](old)", "old");

    // Simulated MCP/AI edit while the popup is open.
    v.dispatch({ changes: { from: 0, to: 0, insert: "XXX " } });

    useLinkPopupStore.getState().setHref("new");
    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("XXX before [text](new) after");
  });

  it("save with STALE offsets (no plugin remap) aborts: doc unchanged, popup closed", () => {
    // Drives the action directly with a range the doc has shifted out from
    // under — the layer-2 guard must refuse to dispatch.
    const doc = "before [text](old) after";
    const v = createView(doc, false);
    openPopupOn(doc, "[text](old)", "old");

    v.dispatch({ changes: { from: 0, to: 0, insert: "XXX " } });

    useLinkPopupStore.getState().setHref("new");
    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("XXX before [text](old) after");
    expect(useLinkPopupStore.getState().isOpen).toBe(false);
  });
});

// ─── Case 2: link range deleted entirely while open ───

describe("link range destroyed while popup open (D1 close path)", () => {
  it("deleting the whole link closes the popup; save is a no-op (with plugin)", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, true);
    const { from, to } = openPopupOn(doc, "[text](old)", "old");

    v.dispatch({ changes: { from, to, insert: "" } });

    expect(useLinkPopupStore.getState().isOpen).toBe(false);

    saveLinkChanges(v, store);
    expect(v.state.doc.toString()).toBe("before  after");
  });

  it("save against a fully deleted range aborts (no plugin): doc unchanged, popup closed", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, false);
    const { from, to } = openPopupOn(doc, "[text](old)", "old");

    v.dispatch({ changes: { from, to, insert: "" } });

    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("before  after");
    expect(useLinkPopupStore.getState().isOpen).toBe(false);
  });
});

// ─── Case 3: edit AFTER the link — guard must not be a blanket abort ───

describe("edit after the link (offsets unaffected)", () => {
  it("save still succeeds at the correct position (with plugin)", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, true);
    openPopupOn(doc, "[text](old)", "old");

    v.dispatch({ changes: { from: doc.length, to: doc.length, insert: " tail" } });

    useLinkPopupStore.getState().setHref("new");
    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("before [text](new) after tail");
  });
});

// ─── Case 4: retarget A→B refreshes popup state AND the visible input ───

describe("retarget to a different link while open (shouldReshow port)", () => {
  it("popup input and store hold B's URL, never A's", () => {
    const doc = "[a](ua) and [b](ub)";
    createView(doc, true);
    openPopupOn(doc, "[a](ua)", "ua");

    const input = () =>
      document.querySelector<HTMLInputElement>(".source-link-popup-href");
    expect(input()?.value).toBe("ua");

    // Retarget while the popup is still open (openPopup fires again — the
    // click path with justOpened still set, or a programmatic retarget).
    openPopupOn(doc, "[b](ub)", "ub");

    expect(useLinkPopupStore.getState().href).toBe("ub");
    expect(input()?.value).toBe("ub");
  });
});

// ─── Case 5: empty/whitespace URL on save (D7: unlink) ───

describe("empty/whitespace URL on save (D7: unlink, matches WYSIWYG)", () => {
  it("empty URL removes the link markdown and keeps the text", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, false);
    openPopupOn(doc, "[text](old)", "old");

    useLinkPopupStore.getState().setHref("");
    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("before text after");
  });

  it("whitespace-only URL removes the link markdown and keeps the text", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, false);
    openPopupOn(doc, "[text](old)", "old");

    useLinkPopupStore.getState().setHref("   ");
    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("before text after");
  });
});

// ─── Case 6: CJK text around the link — UTF-16 offset drift ───

describe("CJK doc, insert before link, save (remap offset integrity)", () => {
  it("remaps through multibyte text and edits exactly the link", () => {
    const doc = "中文前 [链接](old) 后缀";
    const v = createView(doc, true);
    openPopupOn(doc, "[链接](old)", "old");

    v.dispatch({ changes: { from: 0, to: 0, insert: "你好" } });

    useLinkPopupStore.getState().setHref("new");
    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("你好中文前 [链接](new) 后缀");
  });
});

// ─── Case 7: partial link destruction ───

describe("partial link destruction (delete `](old)`)", () => {
  it("closes the popup at doc-change time and save aborts (with plugin)", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, true);
    openPopupOn(doc, "[text](old)", "old");

    const cut = doc.indexOf("](old)");
    v.dispatch({ changes: { from: cut, to: cut + "](old)".length, insert: "" } });

    expect(useLinkPopupStore.getState().isOpen).toBe(false);

    saveLinkChanges(v, store);
    expect(v.state.doc.toString()).toBe("before [text after");
  });

  it("save against a half-destroyed range aborts (no plugin): doc unchanged, popup closed", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, false);
    openPopupOn(doc, "[text](old)", "old");

    const cut = doc.indexOf("](old)");
    v.dispatch({ changes: { from: cut, to: cut + "](old)".length, insert: "" } });

    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("before [text after");
    expect(useLinkPopupStore.getState().isOpen).toBe(false);
  });
});

// ─── Case 8: double save (rapid repeat) is idempotent ───

describe("double save without changes", () => {
  it("doc is identical after both saves (no plugin — stale second range)", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, false);
    openPopupOn(doc, "[text](old)", "old");

    useLinkPopupStore.getState().setHref("new");
    saveLinkChanges(v, store);
    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("before [text](new) after");
  });

  it("doc is identical after both saves (with plugin)", () => {
    const doc = "before [text](old) after";
    const v = createView(doc, true);
    openPopupOn(doc, "[text](old)", "old");

    useLinkPopupStore.getState().setHref("new");
    saveLinkChanges(v, store);
    saveLinkChanges(v, store);

    expect(v.state.doc.toString()).toBe("before [text](new) after");
  });
});
