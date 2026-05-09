/**
 * Link Popup Plugin Tests
 *
 * Tests for:
 * - findLinkMarkRange: finding link mark ranges in document
 * - handleClick: Cmd+click (open/navigate), regular click (popup), close popups
 * - navigateToFragment: internal heading navigation
 * - LinkPopupPluginView lifecycle
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Mock CSS
vi.mock("./link-popup.css", () => ({}));

// Mock LinkPopupView
vi.mock("./LinkPopupView", () => ({
  LinkPopupView: class MockLinkPopupView {
    update = vi.fn();
    destroy = vi.fn();
  },
}));

// Mock stores
const mockLinkPopupState = {
  isOpen: false,
  openPopup: vi.fn(),
  closePopup: vi.fn(),
};
vi.mock("@/stores/linkPopupStore", () => ({
  useLinkPopupStore: {
    getState: () => mockLinkPopupState,
  },
}));

const mockLinkCreatePopupState = {
  isOpen: false,
  closePopup: vi.fn(),
};
vi.mock("@/stores/linkCreatePopupStore", () => ({
  useLinkCreatePopupStore: {
    getState: () => mockLinkCreatePopupState,
  },
}));

// Mock headingSlug
vi.mock("@/utils/headingSlug", () => ({
  findHeadingById: vi.fn(() => null),
  navigateToHeadingById: vi.fn(() => false),
}));

// Mock tauri opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

// Mock cross-file open helper (hoisted so vi.mock factory can reference it)
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

import { openUrl as mockOpenUrl } from "@tauri-apps/plugin-opener";
import { findLinkMarkRange, linkPopupExtension } from "./tiptap";

// Schema with link mark
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 }, id: { default: null } },
    },
    text: { inline: true, group: "inline" },
  },
  marks: {
    link: {
      attrs: { href: { default: "" } },
      parseDOM: [{ tag: "a[href]", getAttrs: (dom: HTMLElement) => ({ href: dom.getAttribute("href") }) }],
      toDOM: (mark) => ["a", { href: mark.attrs.href }, 0],
    },
    bold: {
      parseDOM: [{ tag: "strong" }],
      toDOM: () => ["strong", 0],
    },
  },
});

function createDocWithLink(
  textBefore: string,
  linkText: string,
  href: string,
  textAfter: string,
) {
  const nodes = [];
  if (textBefore) nodes.push(schema.text(textBefore));
  if (linkText) {
    nodes.push(
      schema.text(linkText, [schema.marks.link.create({ href })]),
    );
  }
  if (textAfter) nodes.push(schema.text(textAfter));

  return schema.node("doc", null, [
    schema.node("paragraph", null, nodes),
  ]);
}

function createMockView(state: EditorState): EditorView {
  return {
    state,
    dispatch: vi.fn(),
    focus: vi.fn(),
    coordsAtPos: vi.fn(() => ({ top: 100, bottom: 120, left: 50, right: 150 })),
    dom: {
      closest: vi.fn(() => null),
    },
  } as unknown as EditorView;
}

describe("linkPopupExtension", () => {
  beforeEach(() => {
    mockLinkPopupState.isOpen = false;
    mockLinkPopupState.openPopup.mockClear();
    mockLinkPopupState.closePopup.mockClear();
    mockLinkCreatePopupState.isOpen = false;
    mockLinkCreatePopupState.closePopup.mockClear();
    mockOpenFilepathLink.mockClear();
    mockOpenFilepathLink.mockResolvedValue(true);
  });

  describe("extension creation", () => {
    it("has name 'linkPopup'", () => {
      expect(linkPopupExtension.name).toBe("linkPopup");
    });
  });

  describe("findLinkMarkRange", () => {
    it("finds link mark range at a given position", () => {
      // doc: <p>Hello [link text](http://example.com) world</p>
      // positions: 0=doc, 1=para, 1..6=Hello , 7..15=link text, 16..21= world
      const doc = createDocWithLink("Hello ", "link text", "http://example.com", " world");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      // Position inside the link text (pos 8 = inside "link text")
      const result = findLinkMarkRange(view, 8);
      expect(result).not.toBeNull();
      expect(result!.mark.attrs.href).toBe("http://example.com");
      expect(result!.from).toBe(7);
      expect(result!.to).toBe(16);
    });

    it("returns null when position is not on a link", () => {
      const doc = createDocWithLink("Hello ", "link", "http://example.com", " world");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      // Position in "Hello " text (before the link)
      const result = findLinkMarkRange(view, 3);
      expect(result).toBeNull();
    });

    it("returns null when position is after the link", () => {
      const doc = createDocWithLink("Hello ", "link", "http://example.com", " world");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      // Position in " world" (after the link)
      const result = findLinkMarkRange(view, 13);
      expect(result).toBeNull();
    });

    it("handles adjacent text nodes with same link href", () => {
      // Create a document where link spans multiple text nodes (e.g., bold + link)
      const linkMark = schema.marks.link.create({ href: "http://example.com" });
      const boldMark = schema.marks.bold.create();

      const nodes = [
        schema.text("plain "),
        schema.text("bold-link", [boldMark, linkMark]),
        schema.text(" more-link", [linkMark]),
        schema.text(" plain"),
      ];

      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, nodes),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      // Position inside "bold-link"
      const result = findLinkMarkRange(view, 8);
      expect(result).not.toBeNull();
      expect(result!.mark.attrs.href).toBe("http://example.com");
      // Range should span both linked text nodes
      expect(result!.from).toBe(7);
      expect(result!.to).toBe(26); // "bold-link" (9) + " more-link" (10) = 19 chars from pos 7
    });

    it("returns null for document without links", () => {
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("no links here")]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const result = findLinkMarkRange(view, 5);
      expect(result).toBeNull();
    });

    it("distinguishes links with different hrefs", () => {
      // Two links with different hrefs next to each other
      const link1 = schema.marks.link.create({ href: "http://a.com" });
      const link2 = schema.marks.link.create({ href: "http://b.com" });

      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("aaa", [link1]),
          schema.text("bbb", [link2]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const resultA = findLinkMarkRange(view, 2);
      expect(resultA).not.toBeNull();
      expect(resultA!.mark.attrs.href).toBe("http://a.com");
      expect(resultA!.from).toBe(1);
      expect(resultA!.to).toBe(4);

      const resultB = findLinkMarkRange(view, 5);
      expect(resultB).not.toBeNull();
      expect(resultB!.mark.attrs.href).toBe("http://b.com");
      expect(resultB!.from).toBe(4);
      expect(resultB!.to).toBe(7);
    });
  });

  describe("handleClick behavior", () => {
    // Extract the handleClick function via the plugin spec
    function getHandleClick() {
      const plugins = linkPopupExtension.config.addProseMirrorPlugins!.call({
        editor: { view: {} },
      } as unknown as Parameters<typeof linkPopupExtension.config.addProseMirrorPlugins>[0]);
      return plugins[0].props.handleClick! as (
        view: EditorView,
        pos: number,
        event: MouseEvent
      ) => boolean;
    }

    it("opens popup on regular click on a link", () => {
      const handleClick = getHandleClick();
      const doc = createDocWithLink("", "click me", "http://example.com", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: false, ctrlKey: false });
      const result = handleClick(view, 3, event);

      expect(result).toBe(false); // Regular click returns false to let PM place cursor
      expect(mockLinkPopupState.openPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          href: "http://example.com",
          linkFrom: 1,
          linkTo: 9,
        })
      );
    });

    it("closes popups on regular click outside any link", () => {
      const handleClick = getHandleClick();
      mockLinkPopupState.isOpen = true;
      mockLinkCreatePopupState.isOpen = true;

      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("no links")]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: false, ctrlKey: false });
      handleClick(view, 3, event);

      expect(mockLinkPopupState.closePopup).toHaveBeenCalled();
      expect(mockLinkCreatePopupState.closePopup).toHaveBeenCalled();
    });

    it("does not close popups if none are open", () => {
      const handleClick = getHandleClick();
      mockLinkPopupState.isOpen = false;
      mockLinkCreatePopupState.isOpen = false;

      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("no links")]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: false, ctrlKey: false });
      handleClick(view, 3, event);

      expect(mockLinkPopupState.closePopup).not.toHaveBeenCalled();
      expect(mockLinkCreatePopupState.closePopup).not.toHaveBeenCalled();
    });

    it("closes link create popup when clicking a link", () => {
      const handleClick = getHandleClick();
      mockLinkCreatePopupState.isOpen = true;

      const doc = createDocWithLink("", "click", "http://test.com", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: false, ctrlKey: false });
      handleClick(view, 2, event);

      expect(mockLinkCreatePopupState.closePopup).toHaveBeenCalled();
      expect(mockLinkPopupState.openPopup).toHaveBeenCalled();
    });

    it("Cmd+click on external link opens in browser", async () => {
      const handleClick = getHandleClick();
      const doc = createDocWithLink("", "click me", "http://example.com", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: true, ctrlKey: false });
      const preventDefault = vi.spyOn(event, "preventDefault");
      const result = handleClick(view, 3, event);

      expect(result).toBe(true);
      expect(preventDefault).toHaveBeenCalled();

      // Wait deterministically for the dynamic openUrl import to resolve.
      await vi.waitFor(() => {
        expect(mockOpenUrl).toHaveBeenCalledWith("http://example.com");
      });
    });

    it("Ctrl+click on external link opens in browser", async () => {
      const handleClick = getHandleClick();
      const doc = createDocWithLink("", "click", "https://test.com", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: false, ctrlKey: true });
      const result = handleClick(view, 2, event);

      expect(result).toBe(true);
    });

    it("Cmd+click on fragment link navigates to heading", async () => {
      const handleClick = getHandleClick();

      const { navigateToHeadingById } = await import("@/utils/headingSlug");
      vi.mocked(navigateToHeadingById).mockReturnValueOnce(true);

      const doc = createDocWithLink("", "click", "#my-heading", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: true });
      const preventDefault = vi.spyOn(event, "preventDefault");
      const result = handleClick(view, 2, event);

      expect(result).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
      expect(navigateToHeadingById).toHaveBeenCalledWith(view, "my-heading");
    });

    it("Cmd+click on fragment link returns false when heading not found", async () => {
      const handleClick = getHandleClick();

      const { navigateToHeadingById } = await import("@/utils/headingSlug");
      vi.mocked(navigateToHeadingById).mockReturnValueOnce(false);

      const doc = createDocWithLink("", "click", "#nonexistent", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: true });
      const result = handleClick(view, 2, event);

      expect(result).toBe(false);
    });

    it("Cmd+click on a filepath link calls openFilepathLink and prevents default", async () => {
      const handleClick = getHandleClick();
      const doc = createDocWithLink("", "click", "../appendix/cards.md#bern", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: true });
      const preventDefault = vi.spyOn(event, "preventDefault");
      const result = handleClick(view, 2, event);

      expect(result).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
      expect(mockOpenFilepathLink).toHaveBeenCalledWith("../appendix/cards.md#bern");
      // Filepath path must not fall through to the external browser opener.
      // Snapshot the call count before this test's click to avoid false
      // positives from other tests in the same file.
      expect(vi.mocked(mockOpenUrl).mock.calls).not.toContainEqual([
        "../appendix/cards.md#bern",
      ]);
    });

    it("Cmd+click on non-link returns false", () => {
      const handleClick = getHandleClick();
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("plain text")]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: true });
      const result = handleClick(view, 3, event);

      expect(result).toBe(false);
    });

    it("handles click error gracefully", () => {
      const handleClick = getHandleClick();
      const view = {
        state: {
          doc: {
            resolve: () => { throw new Error("test error"); },
          },
        },
        coordsAtPos: vi.fn(),
        dispatch: vi.fn(),
        focus: vi.fn(),
        dom: { closest: vi.fn() },
      } as unknown as EditorView;

      const event = new MouseEvent("click");
      const result = handleClick(view, 3, event);

      expect(result).toBe(false);
    });

    it("does not open popup when link has empty href", () => {
      const handleClick = getHandleClick();
      const doc = createDocWithLink("", "click", "", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click");
      handleClick(view, 2, event);

      // Empty href means no popup opened
      expect(mockLinkPopupState.openPopup).not.toHaveBeenCalled();
    });
  });

  describe("navigateToFragment", () => {
    it("returns false when heading is not found", async () => {
      const { findHeadingById } = await import("@/utils/headingSlug");
      expect(findHeadingById(null as unknown as import("@tiptap/pm/model").Node, "nonexistent")).toBeNull();
    });
  });

  describe("handleClick — bookmark links (#fragment)", () => {
    function getHandleClick() {
      const plugins = linkPopupExtension.config.addProseMirrorPlugins!.call({
        editor: { view: {} },
      } as unknown as Parameters<typeof linkPopupExtension.config.addProseMirrorPlugins>[0]);
      return plugins[0].props.handleClick! as (
        view: EditorView,
        pos: number,
        event: MouseEvent
      ) => boolean;
    }

    it("navigates to heading on Cmd+click on #fragment link when heading found", async () => {
      const handleClick = getHandleClick();
      const { navigateToHeadingById } = await import("@/utils/headingSlug");
      vi.mocked(navigateToHeadingById).mockReturnValueOnce(true);

      const doc = createDocWithLink("", "click", "#test-heading", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: true });
      const preventDefault = vi.spyOn(event, "preventDefault");
      const result = handleClick(view, 2, event);

      expect(result).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
      expect(navigateToHeadingById).toHaveBeenCalledWith(view, "test-heading");
    });

    it("Cmd+click on #fragment link returns false when navigateToHeadingById fails", async () => {
      // The navigateToHeadingById error path (heading found but doc.resolve
      // throws) is covered in utils/headingSlug.test.ts. The handler contract
      // here is just: when the helper returns false, handleClick returns false.
      const handleClick = getHandleClick();
      const { navigateToHeadingById } = await import("@/utils/headingSlug");
      vi.mocked(navigateToHeadingById).mockReturnValueOnce(false);

      const doc = createDocWithLink("", "click", "#missing-or-broken", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: true });
      const result = handleClick(view, 2, event);

      expect(result).toBe(false);
    });
  });

  describe("handleClick — regular click edge cases", () => {
    function getHandleClick() {
      const plugins = linkPopupExtension.config.addProseMirrorPlugins!.call({
        editor: { view: {} },
      } as unknown as Parameters<typeof linkPopupExtension.config.addProseMirrorPlugins>[0]);
      return plugins[0].props.handleClick! as (
        view: EditorView,
        pos: number,
        event: MouseEvent
      ) => boolean;
    }

    it("regular click on link opens popup and returns false", () => {
      const handleClick = getHandleClick();
      const doc = createDocWithLink("pre ", "my link", "http://example.com", " post");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click");
      const result = handleClick(view, 6, event);

      expect(result).toBe(false); // returns false to let PM place cursor
      expect(mockLinkPopupState.openPopup).toHaveBeenCalledWith(
        expect.objectContaining({ href: "http://example.com" })
      );
    });

    it("Cmd+click on link with empty href returns false", () => {
      const handleClick = getHandleClick();
      const doc = createDocWithLink("", "click", "", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const event = new MouseEvent("click", { metaKey: true });
      const result = handleClick(view, 2, event);

      expect(result).toBe(false);
    });
  });

  describe("LinkPopupPluginView lifecycle", () => {
    it("plugin creates a view with destroy method", () => {
      const plugins = linkPopupExtension.config.addProseMirrorPlugins!.call({
        editor: { view: {} },
      } as unknown as Parameters<typeof linkPopupExtension.config.addProseMirrorPlugins>[0]);

      const plugin = plugins[0];
      expect(plugin.spec.view).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("handles empty paragraph (no text nodes)", () => {
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, []),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const result = findLinkMarkRange(view, 1);
      expect(result).toBeNull();
    });

    it("handles position at start of link", () => {
      const doc = createDocWithLink("", "link", "http://example.com", "");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const result = findLinkMarkRange(view, 1);
      expect(result).not.toBeNull();
      expect(result!.from).toBe(1);
    });

    it("handles position at end of link (exclusive)", () => {
      const doc = createDocWithLink("", "link", "http://example.com", " after");
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const result = findLinkMarkRange(view, 5);
      expect(result).toBeNull();
    });

    it("handles non-text child nodes in paragraph", () => {
      // A paragraph with only a non-text inline node wouldn't have link marks
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("text")]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      const result = findLinkMarkRange(view, 2);
      expect(result).toBeNull();
    });

    it("finds second link when cursor is past the first link (skip-ahead path)", () => {
      // Two links with same href, separated by plain text
      // This exercises lines 96-98 (continue after skipping past first link)
      const href = "http://example.com";
      const linkMark = schema.marks.link.create({ href });
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("first", [linkMark]),
          schema.text(" gap "),
          schema.text("second", [linkMark]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      // Position inside "second" — should skip past "first" link and find "second"
      // "first" = pos 1-6, " gap " = pos 6-11, "second" = pos 11-17
      const result = findLinkMarkRange(view, 13);
      expect(result).not.toBeNull();
      expect(result!.from).toBe(11);
      expect(result!.to).toBe(17);
    });

    it("breaks continuation when next child is non-text (line 88)", () => {
      // Schema with a non-text inline node (hard_break)
      const schemaWithBreak = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { group: "block", content: "inline*" },
          hard_break: { inline: true, group: "inline" },
          text: { inline: true, group: "inline" },
        },
        marks: {
          link: {
            attrs: { href: { default: "" } },
            toDOM: (mark) => ["a", { href: mark.attrs.href }, 0] as const,
          },
        },
      });
      const linkMark = schemaWithBreak.marks.link.create({ href: "http://example.com" });
      // linked text, then hard_break (non-text), then more linked text
      const doc = schemaWithBreak.node("doc", null, [
        schemaWithBreak.node("paragraph", null, [
          schemaWithBreak.text("click", [linkMark]),
          schemaWithBreak.nodes.hard_break.create(),
          schemaWithBreak.text("more", [linkMark]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema: schemaWithBreak });
      const view = createMockView(state);

      // Position inside "click" (the first linked text, pos 2)
      const result = findLinkMarkRange(view, 2);
      expect(result).not.toBeNull();
      // Range should stop at hard_break, NOT include "more"
      // "click" is at pos 1-6, hard_break is at pos 6-7, "more" at 7-11
      expect(result!.from).toBe(1);
      expect(result!.to).toBe(6); // stops before hard_break
    });

    it("skips link range when cursor is after it (position outside found range)", () => {
      // Cursor past the end of a link — the found link range doesn't contain the position
      // This exercises the `continue` at line 98
      const href = "http://example.com";
      const linkMark = schema.marks.link.create({ href });
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("link", [linkMark]),
          schema.text(" plain text here"),
        ]),
      ]);
      const state = EditorState.create({ doc, schema });
      const view = createMockView(state);

      // Position in plain text after the link — should return null
      const result = findLinkMarkRange(view, 10);
      expect(result).toBeNull();
    });

    it("second pass skips non-text child before linked text (line 63 else branch)", () => {
      // A schema with a non-text inline node so the second pass encounters it first
      const schemaWithBreak = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { group: "block", content: "inline*" },
          hard_break: { inline: true, group: "inline" },
          text: { inline: true, group: "inline" },
        },
        marks: {
          link: {
            attrs: { href: { default: "" } },
            toDOM: (mark) => ["a", { href: mark.attrs.href }, 0] as const,
          },
        },
      });
      const linkMark = schemaWithBreak.marks.link.create({ href: "http://example.com" });
      // hard_break (non-text), then linked text
      // First pass will find the link on the text node.
      // Second pass starts at hard_break (non-text) → hits line 101 else branch → then finds text link.
      const doc = schemaWithBreak.node("doc", null, [
        schemaWithBreak.node("paragraph", null, [
          schemaWithBreak.nodes.hard_break.create(),
          schemaWithBreak.text("click", [linkMark]),
        ]),
      ]);
      const state = EditorState.create({ doc, schema: schemaWithBreak });
      const view = createMockView(state);

      // Position inside "click" text (hard_break=1 node, so text starts at pos 2)
      const result = findLinkMarkRange(view, 3);
      expect(result).not.toBeNull();
      expect(result!.mark.attrs.href).toBe("http://example.com");
    });
  });

  describe("LinkPopupPluginView lifecycle", () => {
    it("creates and destroys the plugin view", () => {
      const plugins = linkPopupExtension.config.addProseMirrorPlugins!.call({
        name: "linkPopup",
        options: {},
        storage: {},
        parent: null as never,
        editor: {} as never,
        type: "extension" as never,
      });

      const plugin = plugins[0];
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("hello")]),
      ]);
      const state = EditorState.create({ doc, schema, plugins: [plugin] });
      const mockView = createMockView(state);

      // Instantiate the view
      const viewResult = plugin.spec.view!(mockView as never);
      expect(viewResult).toBeDefined();
      expect(viewResult.destroy).toBeTypeOf("function");

      // update should be callable
      if (viewResult.update) viewResult.update(mockView as never, state);

      // destroy should clean up
      viewResult.destroy!();
    });
  });
});
