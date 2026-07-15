/**
 * Tests for LinkPopupView — DOM management for the link editing popup.
 *
 * The editor view is backed by a real ProseMirror EditorState: save/remove
 * re-validate the captured range against the live document, so a fake state
 * object would not exercise the code under test.
 *
 * Regressions from the 20260713 audit:
 *   - retargeting an open popup at another link must refresh the input, or
 *     saving writes link A's URL onto link B;
 *   - a document edit under the open popup must not be rewritten with the
 *     captured (now stale) range;
 *   - the URL is trimmed before it is stored;
 *   - open/copy act on the URL the user can see (the input), not the store;
 *   - the deferred focus frame must not focus a closed popup.
 */

// ---------------------------------------------------------------------------
// Mocks (must be before imports)

vi.mock("@/utils/debug", () => ({
  linkPopupError: vi.fn(),
}));
// ---------------------------------------------------------------------------

vi.mock("./link-popup.css", () => ({}));

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: vi.fn(() => ({ top: 50, left: 100 })),
  getBoundaryRects: vi.fn(() => ({ top: 0, left: 0, right: 800, bottom: 600 })),
  getViewportBounds: vi.fn(() => ({ top: 0, left: 0, right: 1024, bottom: 768 })),
}));

vi.mock("@/utils/popupComponents", () => ({
  handlePopupTabNavigation: vi.fn(),
  popupIcons: {
    open: "<svg/>",
    copy: "<svg/>",
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

vi.mock("@/utils/headingSlug", () => ({
  findHeadingById: vi.fn(() => null),
  navigateToHeadingById: vi.fn(() => false),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

const { mockOpenFilepathLink } = vi.hoisted(() => ({
  mockOpenFilepathLink: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/services/navigation/linkOpen", async () => {
  const actual = await vi.importActual<typeof import("@/services/navigation/linkOpen")>("@/services/navigation/linkOpen");
  return {
    ...actual,
    openFilepathLink: mockOpenFilepathLink,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
// isImeKeyEvent is mocked above — no direct import needed
import { linkPopupError } from "@/utils/debug";

// ---------------------------------------------------------------------------
// Document fixture: <p><a href=HREF>link</a> tail</p> — the link spans 1..5,
// which is the range the mock store hands to the popup.
// ---------------------------------------------------------------------------

const HREF = "https://example.com";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { inline: true, group: "inline" },
  },
  marks: {
    link: { attrs: { href: { default: "" } }, toDOM: (m) => ["a", { href: m.attrs.href }, 0] },
  },
});

const noLinkSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { inline: true, group: "inline" },
  },
});

/** <p><a href=hrefA>link</a> mid <a href=hrefB>two!</a></p> — link A at 1..5,
 *  link B at 10..14 (only used by the retarget test). */
function createEditorState(hrefA = HREF, hrefB = "https://second.example") {
  return EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("link", [schema.marks.link.create({ href: hrefA })]),
        schema.text(" mid "),
        schema.text("two!", [schema.marks.link.create({ href: hrefB })]),
      ]),
    ]),
  });
}

/** The same document after an external reload wiped the links. */
function plainState() {
  return EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("plain text, no links")]),
    ]),
  });
}

/** The href of the link mark covering `pos`, or null. */
function linkHrefAt(state: EditorState, pos: number): string | null {
  const node = state.doc.nodeAt(pos);
  const mark = node?.marks.find((m) => m.type.name === "link");
  return (mark?.attrs.href as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Store mock
// ---------------------------------------------------------------------------

const mockClosePopup = vi.fn();
const mockSetHref = vi.fn();
let storeState = {
  isOpen: false as boolean,
  anchorRect: null as { top: number; left: number; bottom: number; right: number } | null,
  href: HREF,
  linkFrom: 1,
  linkTo: 5,
  closePopup: mockClosePopup,
  setHref: mockSetHref,
};

let storeListener: ((state: typeof storeState) => void) | null = null;

vi.mock("@/stores/linkPopupStore", () => ({
  useLinkPopupStore: {
    getState: () => storeState,
    subscribe: (cb: (state: typeof storeState) => void) => {
      storeListener = cb;
      return () => { storeListener = null; };
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mirrors the real slice shim: every update yields a NEW state object, so
 *  the popup base class can compare prev/next (shouldReshow). */
function triggerStore(partial: Partial<typeof storeState>) {
  storeState = { ...storeState, ...partial };
  storeListener?.(storeState);
}

const ANCHOR = { top: 100, left: 200, bottom: 120, right: 250 };

function createMockEditorView(overrides: Record<string, unknown> = {}) {
  const editorDom = document.createElement("div");
  editorDom.className = "cm-editor";

  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";
  editorContainer.appendChild(editorDom);
  document.body.appendChild(editorContainer);

  return {
    dom: editorDom,
    state: createEditorState(),
    dispatch: vi.fn(),
    focus: vi.fn(),
    ...overrides,
    _editorContainer: editorContainer,
  };
}

/** The transaction handed to `dispatch` by the last save/remove. */
function dispatchedTr(view: ReturnType<typeof createMockEditorView>): Transaction {
  return view.dispatch.mock.calls[0][0] as Transaction;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LinkPopupView", () => {
  let view: ReturnType<typeof createMockEditorView>;
  let LinkPopupView: typeof import("./LinkPopupView").LinkPopupView;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockOpenFilepathLink.mockResolvedValue(true);
    storeState = {
      isOpen: false,
      anchorRect: null,
      href: HREF,
      linkFrom: 1,
      linkTo: 5,
      closePopup: mockClosePopup,
      setHref: mockSetHref,
    };
    storeListener = null;
    view = createMockEditorView();
    // Dynamic import to ensure mocks are in place
    const mod = await import("./LinkPopupView");
    LinkPopupView = mod.LinkPopupView;
  });

  afterEach(() => {
    view._editorContainer.remove();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // handleInputKeydown
  // ---------------------------------------------------------------------------

  it("handleInputKeydown ignores IME key events (Process key)", () => {
    const popup = new LinkPopupView(view as never);

    // Open the popup
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    // Get input element
    const input = popup["input"] as HTMLInputElement;

    // Dispatch IME key — isImeKeyEvent returns true for Process
    const event = new KeyboardEvent("keydown", { key: "Process", bubbles: true });
    input.dispatchEvent(event);

    // closePopup should not be called (IME guard fired)
    expect(mockClosePopup).not.toHaveBeenCalled();

    popup.destroy();
  });

  it("handleInputKeydown Enter key calls handleSave", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    const input = popup["input"] as HTMLInputElement;
    input.value = "https://test.com";

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(view.dispatch).toHaveBeenCalled();
    expect(linkHrefAt(view.state.apply(dispatchedTr(view)), 1)).toBe("https://test.com");

    popup.destroy();
  });

  it("handleInputKeydown Escape key calls closePopup and focusEditor", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    const input = popup["input"] as HTMLInputElement;
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(mockClosePopup).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleSave
  // ---------------------------------------------------------------------------

  it("handleSave returns early when schema has no link mark", () => {
    const stateWithoutLinkMark = EditorState.create({
      schema: noLinkSchema,
      doc: noLinkSchema.node("doc", null, [
        noLinkSchema.node("paragraph", null, [noLinkSchema.text("link tail")]),
      ]),
    });
    const viewNoLinkMark = createMockEditorView({ state: stateWithoutLinkMark });

    const popup = new LinkPopupView(viewNoLinkMark as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    (popup["saveBtn"] as HTMLElement).click();

    // dispatch should NOT be called since there's no link mark
    expect(viewNoLinkMark.dispatch).not.toHaveBeenCalled();

    popup.destroy();
    viewNoLinkMark._editorContainer.remove();
  });

  it("handleSave catch block logs error, closes popup and restores editor focus", () => {
    const viewWithError = createMockEditorView();
    viewWithError.dispatch = vi.fn(() => { throw new Error("dispatch failed"); });

    const popup = new LinkPopupView(viewWithError as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    (popup["saveBtn"] as HTMLElement).click();

    expect(linkPopupError).toHaveBeenCalledWith("Save failed:", expect.any(Error));
    expect(mockClosePopup).toHaveBeenCalled();
    // Focus must go back to the editor — it was on the now-hidden popup input.
    expect(viewWithError.focus).toHaveBeenCalled();

    popup.destroy();
    viewWithError._editorContainer.remove();
  });

  it("handleSave writes the edited URL onto the captured range", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    const input = popup["input"] as HTMLInputElement;
    input.value = "https://edited.example";
    (popup["saveBtn"] as HTMLElement).click();

    const next = view.state.apply(dispatchedTr(view));
    expect(linkHrefAt(next, 1)).toBe("https://edited.example");
    // The other link in the document is untouched.
    expect(linkHrefAt(next, 10)).toBe("https://second.example");

    popup.destroy();
  });

  it("handleSave trims surrounding whitespace from the URL", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    const input = popup["input"] as HTMLInputElement;
    input.value = "  https://spaced.example  ";
    (popup["saveBtn"] as HTMLElement).click();

    expect(linkHrefAt(view.state.apply(dispatchedTr(view)), 1)).toBe("https://spaced.example");

    popup.destroy();
  });

  it("handleSave removes the link when the input holds only whitespace", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    (popup["input"] as HTMLInputElement).value = "   ";
    (popup["saveBtn"] as HTMLElement).click();

    // Empty/whitespace href routes to the remove path: mark gone, no new one.
    expect(view.dispatch).toHaveBeenCalled();
    expect(linkHrefAt(view.state.apply(dispatchedTr(view)), 1)).toBeNull();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // Regression: retargeting an open popup (audit 20260713)
  // ---------------------------------------------------------------------------

  it("refreshes the input when the popup is retargeted at another link while open", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF, linkFrom: 1, linkTo: 5 });

    const input = popup["input"] as HTMLInputElement;
    expect(input.value).toBe(HREF);

    // Retarget at the second link without an intervening close.
    triggerStore({
      isOpen: true,
      anchorRect: ANCHOR,
      href: "https://second.example",
      linkFrom: 10,
      linkTo: 14,
    });
    expect(input.value).toBe("https://second.example");

    // Saving must not write link A's URL over link B.
    (popup["saveBtn"] as HTMLElement).click();
    const next = view.state.apply(dispatchedTr(view));
    expect(linkHrefAt(next, 10)).toBe("https://second.example");
    expect(linkHrefAt(next, 1)).toBe(HREF);

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // Regression: the document changed under the open popup (audit 20260713)
  // ---------------------------------------------------------------------------

  it("does not mutate the document when the captured range no longer holds the link", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    // A concurrent edit (MCP write, external reload) replaced the document; the
    // captured 1..5 range now covers plain, unlinked text.
    view.state = plainState();

    (popup["saveBtn"] as HTMLElement).click();

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(linkPopupError).toHaveBeenCalledWith(
      "Stale link range — skipping mutation:",
      { linkFrom: 1, linkTo: 5 }
    );
    expect(mockClosePopup).toHaveBeenCalled();

    popup.destroy();
  });

  it("does not remove a link through a stale range", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    view.state = plainState();
    (popup["deleteBtn"] as HTMLElement).click();

    expect(view.dispatch).not.toHaveBeenCalled();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleOpen
  // ---------------------------------------------------------------------------

  it("handleOpen does not close popup when navigateToHeadingById returns false", async () => {
    const { navigateToHeadingById } = await import("@/utils/headingSlug");
    vi.mocked(navigateToHeadingById).mockReturnValueOnce(false);

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "#missing" });
    mockClosePopup.mockClear();

    (popup["openBtn"] as HTMLElement).click();

    // navigateToHeadingById is responsible for the catch logging — covered in
    // utils/headingSlug.test.ts. The popup just must not close on failure.
    expect(mockClosePopup).not.toHaveBeenCalled();

    popup.destroy();
  });

  it("handleOpen opens external link in browser", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    (popup["openBtn"] as HTMLElement).click();

    await vi.waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith(HREF);
    });

    popup.destroy();
  });

  it("handleOpen acts on the URL shown in the input, not a stale store value", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    // Simulate a paste that lands in the DOM without an `input` event: the
    // store still holds the old URL, the user sees the new one.
    (popup["input"] as HTMLInputElement).value = "https://pasted.example";
    (popup["openBtn"] as HTMLElement).click();

    await vi.waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith("https://pasted.example");
    });

    popup.destroy();
  });

  it("handleOpen routes a relative filepath link through openFilepathLink and closes the popup on success", async () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({
      isOpen: true,
      anchorRect: ANCHOR,
      href: "../appendix/cards.md#bern",
    });

    (popup["openBtn"] as HTMLElement).click();

    await vi.waitFor(() => {
      // Second arg is the source-doc path read from the tab store. The
      // test setup doesn't seed an active tab with a filePath, so it
      // resolves to null. Assertion focuses on routing — source-path
      // resolution is covered in linkOpen.test.ts.
      expect(mockOpenFilepathLink).toHaveBeenCalledWith(
        "../appendix/cards.md#bern",
        null,
      );
    });
    await vi.waitFor(() => expect(mockClosePopup).toHaveBeenCalled());

    const { openUrl } = await import("@tauri-apps/plugin-opener");
    expect(openUrl).not.toHaveBeenCalled();

    popup.destroy();
  });

  it("handleOpen leaves the popup open when openFilepathLink resolves false (unresolvable)", async () => {
    mockOpenFilepathLink.mockResolvedValueOnce(false);

    const popup = new LinkPopupView(view as never);
    triggerStore({
      isOpen: true,
      anchorRect: ANCHOR,
      href: "../appendix/cards.md",
    });
    mockClosePopup.mockClear();

    (popup["openBtn"] as HTMLElement).click();

    await vi.waitFor(() => {
      expect(mockOpenFilepathLink).toHaveBeenCalled();
    });
    expect(mockClosePopup).not.toHaveBeenCalled();

    popup.destroy();
  });

  it("does not close a popup that was retargeted while a filepath open was in flight", async () => {
    let resolveOpen: (v: boolean) => void = () => {};
    mockOpenFilepathLink.mockReturnValueOnce(
      new Promise<boolean>((resolve) => { resolveOpen = resolve; })
    );

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "../a.md", linkFrom: 1, linkTo: 5 });

    (popup["openBtn"] as HTMLElement).click();

    // While the open is pending the user clicks a different link.
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "https://second.example", linkFrom: 10, linkTo: 14 });
    mockClosePopup.mockClear();

    resolveOpen(true);
    await vi.waitFor(() => expect(mockOpenFilepathLink).toHaveBeenCalled());

    // The completion belongs to the old popup — it must not close the new one.
    expect(mockClosePopup).not.toHaveBeenCalled();

    popup.destroy();
  });

  it("handleOpen does nothing when the input is empty", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "" });

    (popup["openBtn"] as HTMLElement).click();

    expect(view.dispatch).not.toHaveBeenCalled();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleCopy
  // ---------------------------------------------------------------------------

  it("handleCopy copies the URL shown in the input", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });
    (popup["input"] as HTMLInputElement).value = "  https://pasted.example  ";

    (popup["copyBtn"] as HTMLElement).click();

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://pasted.example");
    });

    popup.destroy();
  });

  it("handleCopy logs error when clipboard.writeText fails", async () => {
    vi.mocked(linkPopupError).mockClear();

    // jsdom doesn't provide navigator.clipboard — install a mock that rejects
    const origClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("clipboard denied")) },
      writable: true,
      configurable: true,
    });

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    (popup["copyBtn"] as HTMLElement).click();

    await vi.waitFor(() => {
      expect(linkPopupError).toHaveBeenCalledWith(
        "Failed to copy URL:",
        expect.any(Error)
      );
    });

    popup.destroy();

    Object.defineProperty(navigator, "clipboard", {
      value: origClipboard,
      writable: true,
      configurable: true,
    });
  });

  it("handleCopy does nothing when the input is empty", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "" });

    (popup["copyBtn"] as HTMLElement).click();

    expect(writeText).not.toHaveBeenCalled();
    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleRemove
  // ---------------------------------------------------------------------------

  it("handleRemove returns early when editorState is missing", () => {
    const viewNoState = createMockEditorView({ state: null });
    const popup = new LinkPopupView(viewNoState as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    (popup["deleteBtn"] as HTMLElement).click();

    expect(viewNoState.dispatch).not.toHaveBeenCalled();

    popup.destroy();
    viewNoState._editorContainer.remove();
  });

  it("handleRemove strips the link mark and sets preventAutolink meta (#584)", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    (popup["deleteBtn"] as HTMLElement).click();

    expect(view.dispatch).toHaveBeenCalled();
    const tr = dispatchedTr(view);
    expect(tr.getMeta("preventAutolink")).toBe(true);
    expect(linkHrefAt(view.state.apply(tr), 1)).toBeNull();

    popup.destroy();
  });

  it("handleRemove catch block logs error, closes popup and restores editor focus", () => {
    vi.mocked(linkPopupError).mockClear();
    const viewWithError = createMockEditorView();
    viewWithError.dispatch = vi.fn(() => { throw new Error("remove dispatch failed"); });

    const popup = new LinkPopupView(viewWithError as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    (popup["deleteBtn"] as HTMLElement).click();

    expect(linkPopupError).toHaveBeenCalledWith("Remove failed:", expect.any(Error));
    expect(mockClosePopup).toHaveBeenCalled();
    expect(viewWithError.focus).toHaveBeenCalled();

    popup.destroy();
    viewWithError._editorContainer.remove();
  });

  // ---------------------------------------------------------------------------
  // Deferred focus frame (audit 20260713)
  // ---------------------------------------------------------------------------

  it("does not focus the input when the popup closed before the focus frame ran", async () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });

    const input = popup["input"] as HTMLInputElement;
    const focusSpy = vi.spyOn(input, "focus");

    // Escape before the requestAnimationFrame callback fires.
    triggerStore({ isOpen: false, anchorRect: null });

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    expect(focusSpy).not.toHaveBeenCalled();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // Regression: #894 — openBtn aria-label must track title so screen readers
  // announce the context-aware action (heading vs external URL).
  // ---------------------------------------------------------------------------

  it("openBtn aria-label matches title for bookmark links", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "#some-heading" });

    const openBtn = popup["openBtn"] as HTMLElement;
    expect(openBtn.title).toBe("Go to heading");
    expect(openBtn.getAttribute("aria-label")).toBe("Go to heading");
    expect(openBtn.getAttribute("aria-label")).toBe(openBtn.title);

    popup.destroy();
  });

  it("openBtn aria-label flips back to 'Open link' when popup re-opens on a regular URL", () => {
    const popup = new LinkPopupView(view as never);

    // First open on a bookmark to set the aria-label to "Go to heading".
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "#first-heading" });
    const openBtn = popup["openBtn"] as HTMLElement;
    expect(openBtn.getAttribute("aria-label")).toBe("Go to heading");

    // Close, then re-open on a regular URL.
    triggerStore({ isOpen: false, anchorRect: null });
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: HREF });
    expect(openBtn.title).toBe("Open link");
    expect(openBtn.getAttribute("aria-label")).toBe("Open link");
    expect(openBtn.getAttribute("aria-label")).toBe(openBtn.title);

    popup.destroy();
  });
});
