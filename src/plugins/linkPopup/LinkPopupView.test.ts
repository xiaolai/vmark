/**
 * Tests for LinkPopupView — DOM management for the link editing popup.
 *
 * Covers uncovered lines:
 *   - line 133: isImeKeyEvent guard in handleInputKeydown
 *   - line 158: no link mark in schema — handleSave returns early
 *   - lines 168-169: handleSave catch block
 *   - line 199: handleOpen bookmark catch block
 *   - line 210: handleCopy clipboard failure
 *   - line 221: no editorState in handleRemove — returns early
 *   - lines 232-233: handleRemove catch block
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

vi.mock("@/utils/linkOpen", async () => {
  const actual = await vi.importActual<typeof import("@/utils/linkOpen")>("@/utils/linkOpen");
  return {
    ...actual,
    openFilepathLink: mockOpenFilepathLink,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// isImeKeyEvent is mocked above — no direct import needed
import { linkPopupError } from "@/utils/debug";

// ---------------------------------------------------------------------------
// Store mock
// ---------------------------------------------------------------------------

const mockClosePopup = vi.fn();
const mockSetHref = vi.fn();
let storeState = {
  isOpen: false as boolean,
  anchorRect: null as { top: number; left: number; bottom: number; right: number } | null,
  href: "https://example.com",
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

function triggerStore(partial: Partial<typeof storeState>) {
  Object.assign(storeState, partial);
  storeListener?.(storeState);
}

const ANCHOR = { top: 100, left: 200, bottom: 120, right: 250 };

function createMockSchema(includeLinkMark = true) {
  const marks: Record<string, unknown> = {};
  if (includeLinkMark) {
    marks.link = {
      create: vi.fn(() => ({ type: "link", attrs: {} })),
      isInSet: vi.fn(),
    };
  }
  return { marks };
}

function createMockEditorView(overrides: Record<string, unknown> = {}) {
  const editorDom = document.createElement("div");
  editorDom.className = "cm-editor";

  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";
  editorContainer.appendChild(editorDom);
  document.body.appendChild(editorContainer);

  const schema = createMockSchema();
  const mockTr = {
    removeMark: vi.fn().mockReturnThis(),
    addMark: vi.fn().mockReturnThis(),
    setSelection: vi.fn().mockReturnThis(),
    scrollIntoView: vi.fn().mockReturnThis(),
    setMeta: vi.fn().mockReturnThis(),
  };

  const mockState = {
    schema,
    tr: mockTr,
    doc: {
      resolve: vi.fn(() => ({})),
    },
  };

  return {
    dom: editorDom,
    state: mockState,
    dispatch: vi.fn(),
    focus: vi.fn(),
    ...overrides,
    _editorContainer: editorContainer,
  };
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
      href: "https://example.com",
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
  // handleInputKeydown — line 133: IME guard
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

    // dispatch should have been called (save)
    expect(view.dispatch).toHaveBeenCalled();

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
  // handleSave — line 158: no link mark in schema
  // ---------------------------------------------------------------------------

  it("handleSave returns early when schema has no link mark", () => {
    const viewNoLinkMark = createMockEditorView();
    // Remove link mark from schema
    (viewNoLinkMark.state.schema as ReturnType<typeof createMockSchema>) = createMockSchema(false);

    const popup = new LinkPopupView(viewNoLinkMark as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "https://example.com" });

    const saveBtn = popup["saveBtn"] as HTMLElement;
    saveBtn.click();

    // dispatch should NOT be called since there's no link mark
    expect(viewNoLinkMark.dispatch).not.toHaveBeenCalled();

    popup.destroy();
    viewNoLinkMark._editorContainer.remove();
  });

  // ---------------------------------------------------------------------------
  // handleSave — lines 168-169: catch block
  // ---------------------------------------------------------------------------

  it("handleSave catch block logs error and closes popup on dispatch failure", () => {
    const viewWithError = createMockEditorView();
    viewWithError.dispatch = vi.fn(() => { throw new Error("dispatch failed"); });

    const popup = new LinkPopupView(viewWithError as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "https://example.com" });

    const saveBtn = popup["saveBtn"] as HTMLElement;
    saveBtn.click();

    expect(linkPopupError).toHaveBeenCalledWith(
      "Save failed:",
      expect.any(Error)
    );
    expect(mockClosePopup).toHaveBeenCalled();

    popup.destroy();
    viewWithError._editorContainer.remove();
  });

  // ---------------------------------------------------------------------------
  // handleOpen — line 199: bookmark catch block
  // ---------------------------------------------------------------------------

  it("handleOpen does not close popup when navigateToHeadingById returns false", async () => {
    const { navigateToHeadingById } = await import("@/utils/headingSlug");
    vi.mocked(navigateToHeadingById).mockReturnValueOnce(false);

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "#missing" });
    mockClosePopup.mockClear();

    const openBtn = popup["openBtn"] as HTMLElement;
    openBtn.click();

    // navigateToHeadingById is responsible for the catch logging — covered in
    // utils/headingSlug.test.ts. The popup just must not close on failure.
    expect(mockClosePopup).not.toHaveBeenCalled();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleCopy — line 210: clipboard failure
  // ---------------------------------------------------------------------------

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
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "https://example.com" });

    const copyBtn = popup["copyBtn"] as HTMLElement;
    copyBtn.click();

    // Wait deterministically for the rejected clipboard write to surface.
    await vi.waitFor(() => {
      expect(linkPopupError).toHaveBeenCalledWith(
        "Failed to copy URL:",
        expect.any(Error)
      );
    });

    popup.destroy();

    // Restore original clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: origClipboard,
      writable: true,
      configurable: true,
    });
  });

  // ---------------------------------------------------------------------------
  // handleRemove — line 221: no editorState
  // ---------------------------------------------------------------------------

  it("handleRemove returns early when editorState is missing", () => {
    const viewNoState = createMockEditorView({ state: null });
    const popup = new LinkPopupView(viewNoState as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    const deleteBtn = popup["deleteBtn"] as HTMLElement;
    deleteBtn.click();

    // dispatch should NOT be called
    expect(viewNoState.dispatch).not.toHaveBeenCalled();

    popup.destroy();
    viewNoState._editorContainer.remove();
  });

  // ---------------------------------------------------------------------------
  // handleSave — lines 149-150: empty href triggers remove
  // ---------------------------------------------------------------------------

  it("handleSave removes link when href is empty or whitespace", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "   " });

    const saveBtn = popup["saveBtn"] as HTMLElement;
    saveBtn.click();

    // Empty/whitespace href should trigger handleRemove path
    expect(view.dispatch).toHaveBeenCalled();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleOpen — lines 197-199: external link open
  // ---------------------------------------------------------------------------

  it("handleOpen opens external link in browser", async () => {
    // Import the mock BEFORE clicking so we have the same reference
    const { openUrl } = await import("@tauri-apps/plugin-opener");

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "https://example.com" });

    const openBtn = popup["openBtn"] as HTMLElement;
    openBtn.click();

    // Wait for dynamic import + .then() chain inside handleOpen to resolve
    await vi.waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith("https://example.com");
    });

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleOpen — filepath link routes through openFilepathLink
  // ---------------------------------------------------------------------------

  it("handleOpen routes a relative filepath link through openFilepathLink and closes the popup on success", async () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({
      isOpen: true,
      anchorRect: ANCHOR,
      href: "../appendix/cards.md#bern",
    });

    const openBtn = popup["openBtn"] as HTMLElement;
    openBtn.click();

    await vi.waitFor(() => {
      expect(mockOpenFilepathLink).toHaveBeenCalledWith("../appendix/cards.md#bern");
    });
    expect(mockClosePopup).toHaveBeenCalled();

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

    const openBtn = popup["openBtn"] as HTMLElement;
    openBtn.click();

    await vi.waitFor(() => {
      expect(mockOpenFilepathLink).toHaveBeenCalled();
    });
    expect(mockClosePopup).not.toHaveBeenCalled();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleOpen — empty href guard
  // ---------------------------------------------------------------------------

  it("handleOpen does nothing when href is empty", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "" });

    const openBtn = popup["openBtn"] as HTMLElement;
    openBtn.click();

    // Should not navigate or open anything
    expect(view.dispatch).not.toHaveBeenCalled();

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleCopy — empty href guard
  // ---------------------------------------------------------------------------

  it("handleCopy does nothing when href is empty", () => {
    // Empty-href guard short-circuits synchronously; no async wait required.
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "" });

    const copyBtn = popup["copyBtn"] as HTMLElement;
    copyBtn.click();

    // Strong assertion: clipboard write must NEVER fire for empty href.
    expect(writeText).not.toHaveBeenCalled();
    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleRemove — preventAutolink meta (#584)
  // ---------------------------------------------------------------------------

  it("handleRemove sets preventAutolink meta to stop autolink re-adding the mark", () => {
    const popup = new LinkPopupView(view as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    const deleteBtn = popup["deleteBtn"] as HTMLElement;
    deleteBtn.click();

    expect(view.dispatch).toHaveBeenCalled();
    // The transaction should have preventAutolink meta set
    const tr = view.state.tr;
    expect(tr.setMeta).toHaveBeenCalledWith("preventAutolink", true);

    popup.destroy();
  });

  // ---------------------------------------------------------------------------
  // handleRemove — lines 232-233: catch block
  // ---------------------------------------------------------------------------

  it("handleRemove catch block logs error and closes popup on dispatch failure", () => {
    vi.mocked(linkPopupError).mockClear();
    const viewWithError = createMockEditorView();
    viewWithError.dispatch = vi.fn(() => { throw new Error("remove dispatch failed"); });

    const popup = new LinkPopupView(viewWithError as never);
    triggerStore({ isOpen: true, anchorRect: ANCHOR });

    const deleteBtn = popup["deleteBtn"] as HTMLElement;
    deleteBtn.click();

    expect(linkPopupError).toHaveBeenCalledWith(
      "Remove failed:",
      expect.any(Error)
    );
    expect(mockClosePopup).toHaveBeenCalled();

    popup.destroy();
    viewWithError._editorContainer.remove();
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

    // Close, then re-open on a regular URL — onShow runs on the
    // false → true isOpen transition, so a "close-then-open" cycle is
    // the only way to drive a fresh onShow() in the popup contract.
    triggerStore({ isOpen: false, anchorRect: null });
    triggerStore({ isOpen: true, anchorRect: ANCHOR, href: "https://example.com" });
    expect(openBtn.title).toBe("Open link");
    expect(openBtn.getAttribute("aria-label")).toBe("Open link");
    expect(openBtn.getAttribute("aria-label")).toBe(openBtn.title);

    popup.destroy();
  });
});
