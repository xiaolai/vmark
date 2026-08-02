import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useLinkPopupStore } from "@/stores/linkPopupStore";

// The actions take the popup state as a parameter now. These tests drive the
// REAL store, so they pass it — the wiring the app ships.
const store = useLinkPopupStore as never;

// Mock external dependencies
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/utils/headingSlug", () => ({
  findHeadingByIdCM: vi.fn(() => null),
}));

import { saveLinkChanges, openLink, copyLinkHref, removeLink } from "../sourceLinkActions";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { findHeadingByIdCM } from "@/utils/headingSlug";

function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent });
}

describe("source link actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useLinkPopupStore.getState().closePopup();
  });

  describe("saveLinkChanges", () => {
    it("preserves title and angle-bracket destination when saving", () => {
      const doc = 'See [text](<path with space> "Title") here.';
      const linkText = '[text](<path with space> "Title")';
      const linkFrom = doc.indexOf(linkText);
      const linkTo = linkFrom + linkText.length;
      const view = createView(doc);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://example.com",
        linkFrom,
        linkTo,
        anchorRect: null,
      });

      saveLinkChanges(view, store);

      expect(view.state.doc.toString()).toBe(
        'See [text](<https://example.com> "Title") here.'
      );

      view.destroy();
    });

    it("saves a simple link without title", () => {
      const doc = "Visit [click](https://old.com) now.";
      const linkText = "[click](https://old.com)";
      const linkFrom = doc.indexOf(linkText);
      const linkTo = linkFrom + linkText.length;
      const view = createView(doc);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://new.com",
        linkFrom,
        linkTo,
        anchorRect: null,
      });

      saveLinkChanges(view, store);

      expect(view.state.doc.toString()).toBe(
        "Visit [click](https://new.com) now."
      );

      view.destroy();
    });

    it("does nothing when linkFrom is negative", () => {
      const doc = "Some text";
      const view = createView(doc);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://example.com",
        linkFrom: -1,
        linkTo: 5,
        anchorRect: null,
      });

      saveLinkChanges(view, store);

      expect(view.state.doc.toString()).toBe("Some text");
      view.destroy();
    });

    it("does nothing when linkTo is negative", () => {
      const doc = "Some text";
      const view = createView(doc);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://example.com",
        linkFrom: 0,
        linkTo: -1,
        anchorRect: null,
      });

      saveLinkChanges(view, store);

      expect(view.state.doc.toString()).toBe("Some text");
      view.destroy();
    });

    it("uses angle brackets for URLs with spaces", () => {
      const doc = "[link](https://example.com)";
      const view = createView(doc);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "path with spaces",
        linkFrom: 0,
        linkTo: doc.length,
        anchorRect: null,
      });

      saveLinkChanges(view, store);

      expect(view.state.doc.toString()).toBe("[link](<path with spaces>)");
      view.destroy();
    });
  });

  describe("openLink", () => {
    it("does nothing when href is empty", async () => {
      useLinkPopupStore.setState({
        isOpen: true,
        href: "",
        linkFrom: 0,
        linkTo: 5,
        anchorRect: null,
      });

      const view = createView("test");
      await openLink(view, store);

      const { openUrl } = await import("@tauri-apps/plugin-opener");
      expect(openUrl).not.toHaveBeenCalled();
      view.destroy();
    });

    it("navigates to heading for bookmark links", async () => {
      vi.mocked(findHeadingByIdCM).mockReturnValue(10);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "#my-heading",
        linkFrom: 0,
        linkTo: 5,
        anchorRect: null,
      });

      const view = createView("Some text with heading");
      await openLink(view, store);

      expect(findHeadingByIdCM).toHaveBeenCalledWith(
        expect.anything(),
        "my-heading"
      );
      view.destroy();
    });

    it("opens external link in browser", async () => {
      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://example.com",
        linkFrom: 0,
        linkTo: 5,
        anchorRect: null,
      });

      const view = createView("test");
      await openLink(view, store);

      const { openUrl } = await import("@tauri-apps/plugin-opener");
      expect(openUrl).toHaveBeenCalledWith("https://example.com");
      view.destroy();
    });

    it("handles bookmark link when heading not found", async () => {
      vi.mocked(findHeadingByIdCM).mockReturnValue(null);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "#nonexistent",
        linkFrom: 0,
        linkTo: 5,
        anchorRect: null,
      });

      const view = createView("test");
      await openLink(view, store);

      // Should not throw, just do nothing
      view.destroy();
    });
  });

  describe("copyLinkHref", () => {
    it("copies href to clipboard", async () => {
      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://example.com",
        linkFrom: 0,
        linkTo: 5,
        anchorRect: null,
      });

      await copyLinkHref(store);

      expect(writeText).toHaveBeenCalledWith("https://example.com");
    });

    it("does nothing when href is empty", async () => {
      useLinkPopupStore.setState({
        isOpen: true,
        href: "",
        linkFrom: 0,
        linkTo: 5,
        anchorRect: null,
      });

      await copyLinkHref(store);

      expect(writeText).not.toHaveBeenCalled();
    });

    it("handles clipboard write failure gracefully", async () => {
      vi.mocked(writeText).mockRejectedValueOnce(new Error("clipboard error"));

      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://example.com",
        linkFrom: 0,
        linkTo: 5,
        anchorRect: null,
      });

      await expect(copyLinkHref(store)).resolves.toBeUndefined();
    });
  });

  describe("removeLink", () => {
    it("removes link markdown and keeps text", () => {
      const doc = "Visit [click me](https://example.com) now.";
      const linkText = "[click me](https://example.com)";
      const linkFrom = doc.indexOf(linkText);
      const linkTo = linkFrom + linkText.length;
      const view = createView(doc);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://example.com",
        linkFrom,
        linkTo,
        anchorRect: null,
      });

      removeLink(view, store);

      expect(view.state.doc.toString()).toBe("Visit click me now.");
      view.destroy();
    });

    it("does nothing when linkFrom is negative", () => {
      const doc = "Some text";
      const view = createView(doc);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "https://example.com",
        linkFrom: -1,
        linkTo: 5,
        anchorRect: null,
      });

      removeLink(view, store);

      expect(view.state.doc.toString()).toBe("Some text");
      view.destroy();
    });

    it("removes link with angle-bracket URL", () => {
      const doc = '[text](<path with space> "Title")';
      const view = createView(doc);

      useLinkPopupStore.setState({
        isOpen: true,
        href: "path with space",
        linkFrom: 0,
        linkTo: doc.length,
        anchorRect: null,
      });

      removeLink(view, store);

      expect(view.state.doc.toString()).toBe("text");
      view.destroy();
    });
  });
});
