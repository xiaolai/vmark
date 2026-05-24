import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/plugins/editorPlugins.tiptap", () => ({
  expandedToggleMarkTiptap: vi.fn(),
}));

vi.mock("@/plugins/formatToolbar/linkPopupUtils", () => ({
  resolveLinkPopupPayload: vi.fn(),
}));

vi.mock("@/plugins/syntaxReveal/marks", () => ({
  findWordAtCursor: vi.fn(),
}));

vi.mock("@/stores/linkPopupStore", () => ({
  useLinkPopupStore: {
    getState: vi.fn(() => ({
      openPopup: vi.fn(),
    })),
  },
}));

vi.mock("@/stores/wikiLinkPopupStore", () => ({
  useWikiLinkPopupStore: {
    getState: vi.fn(() => ({
      openPopup: vi.fn(),
    })),
  },
}));

vi.mock("@/services/editor/clipboardUrl", () => ({
  readClipboardUrl: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/utils/debug", () => ({
  wysiwygAdapterWarn: vi.fn(),
  wysiwygAdapterError: vi.fn(),
}));

vi.mock("./wysiwygAdapterUtils", () => ({
  isViewConnected: vi.fn(() => true),
}));

import { openLinkEditor } from "./wysiwygAdapterLinkEditor";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { readClipboardUrl } from "@/services/editor/clipboardUrl";
import { resolveLinkPopupPayload } from "@/plugins/formatToolbar/linkPopupUtils";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { isViewConnected } from "./wysiwygAdapterUtils";
import type { WysiwygToolbarContext } from "./types";

function createMockView(opts?: {
  inWikiLink?: boolean;
  selectionFrom?: number;
  selectionTo?: number;
}) {
  const selectionFrom = opts?.selectionFrom ?? 10;
  const selectionTo = opts?.selectionTo ?? 10;
  const inWikiLink = opts?.inWikiLink ?? false;

  const depth = inWikiLink ? 1 : 0;
  const $from = {
    depth,
    pos: selectionFrom,
    node: vi.fn((d: number) => {
      if (d === 1 && inWikiLink) {
        return { type: { name: "wikiLink" }, attrs: { value: "test-page" }, nodeSize: 12 };
      }
      return { type: { name: "doc" } };
    }),
    before: vi.fn(() => 5),
  };

  return {
    state: {
      selection: {
        from: selectionFrom,
        to: selectionTo,
        $from,
      },
      schema: {
        marks: {
          link: {
            create: vi.fn((attrs: Record<string, unknown>) => ({ type: "link", attrs })),
          },
        },
        text: vi.fn((t: string, marks: unknown[]) => ({ text: t, marks })),
      },
      doc: {
        textBetween: vi.fn(() => "selected text"),
      },
      tr: {
        addMark: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
      },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    coordsAtPos: vi.fn(() => ({ top: 100, left: 200, bottom: 120, right: 300 })),
    dom: { isConnected: true },
  } as unknown as import("@tiptap/pm/view").EditorView;
}

function createContext(viewOpts?: Parameters<typeof createMockView>[0]): WysiwygToolbarContext {
  return {
    surface: "wysiwyg",
    view: createMockView(viewOpts),
    editor: null,
    context: null,
  };
}

describe("openLinkEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when view is null", () => {
    const ctx = createContext();
    ctx.view = null;
    expect(openLinkEditor(ctx)).toBe(false);
  });

  it("opens wiki link popup when cursor is inside a wikiLink", () => {
    const openPopup = vi.fn();
    vi.mocked(useWikiLinkPopupStore.getState).mockReturnValue({ openPopup } as never);

    const ctx = createContext({ inWikiLink: true });
    const result = openLinkEditor(ctx);

    expect(result).toBe(true);
    expect(openPopup).toHaveBeenCalledWith(
      expect.objectContaining({ top: 100, left: 200 }),
      "test-page",
      5
    );
    expect(ctx.view!.focus).toHaveBeenCalled();
  });

  it("handles error when opening wiki link popup", async () => {
    const openPopup = vi.fn(() => {
      throw new Error("popup error");
    });
    vi.mocked(useWikiLinkPopupStore.getState).mockReturnValue({ openPopup } as never);
    const debug = await import("@/utils/debug");

    const ctx = createContext({ inWikiLink: true });
    const result = openLinkEditor(ctx);

    expect(result).toBe(true); // still returns true (handled)
    expect(vi.mocked(debug.wysiwygAdapterError)).toHaveBeenCalled();
  });

  it("returns true and triggers async smart link flow for non-wiki links", () => {
    vi.mocked(readClipboardUrl).mockResolvedValue(null);
    const ctx = createContext();
    const result = openLinkEditor(ctx);
    expect(result).toBe(true);
  });

  it("applies clipboard URL directly when selection exists", async () => {
    vi.mocked(readClipboardUrl).mockResolvedValue("https://example.com");
    vi.mocked(isViewConnected).mockReturnValue(true);

    const ctx = createContext({ selectionFrom: 5, selectionTo: 15 });
    openLinkEditor(ctx);

    // Wait for the async promise to resolve
    await vi.waitFor(() => {
      expect(ctx.view!.dispatch).toHaveBeenCalled();
    });
  });

  it("falls back to popup when no clipboard URL", async () => {
    vi.mocked(readClipboardUrl).mockResolvedValue(null);
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(resolveLinkPopupPayload).mockReturnValue({
      href: "https://test.com",
      linkFrom: 5,
      linkTo: 15,
    } as never);

    const openPopup = vi.fn();
    vi.mocked(useLinkPopupStore.getState).mockReturnValue({ openPopup } as never);

    const ctx = createContext();
    openLinkEditor(ctx);

    await vi.waitFor(() => {
      expect(openPopup).toHaveBeenCalled();
    });
  });

  it("falls back to expandedToggleMarkTiptap when resolveLinkPopupPayload returns null", async () => {
    vi.mocked(readClipboardUrl).mockResolvedValue(null);
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(resolveLinkPopupPayload).mockReturnValue(null);

    const ctx = createContext();
    openLinkEditor(ctx);

    await vi.waitFor(() => {
      expect(expandedToggleMarkTiptap).toHaveBeenCalledWith(ctx.view, "link");
    });
  });

  it("skips link popup when view disconnects after async clipboard read", async () => {
    vi.mocked(readClipboardUrl).mockResolvedValue(null);
    vi.mocked(isViewConnected).mockReturnValue(false);

    const ctx = createContext();
    openLinkEditor(ctx);

    // Give the async flow time to complete
    await new Promise((r) => setTimeout(r, 10));

    // Should not have tried to open any popup
    expect(resolveLinkPopupPayload).not.toHaveBeenCalled();
  });

  it("applies clipboard URL with word expansion when no selection", async () => {
    const { findWordAtCursor } = await import("@/plugins/syntaxReveal/marks");
    vi.mocked(readClipboardUrl).mockResolvedValue("https://example.com");
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(findWordAtCursor).mockReturnValue({ from: 5, to: 10 });

    const ctx = createContext({ selectionFrom: 7, selectionTo: 7 }); // collapsed cursor
    openLinkEditor(ctx);

    await vi.waitFor(() => {
      // Should call addMark on the word range
      expect(ctx.view!.state.tr.addMark).toHaveBeenCalled();
      expect(ctx.view!.dispatch).toHaveBeenCalled();
    });
  });

  it("inserts URL as linked text when no selection and no word at cursor", async () => {
    const { findWordAtCursor } = await import("@/plugins/syntaxReveal/marks");
    vi.mocked(readClipboardUrl).mockResolvedValue("https://example.com");
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(findWordAtCursor).mockReturnValue(null);

    const ctx = createContext({ selectionFrom: 5, selectionTo: 5 }); // collapsed cursor
    openLinkEditor(ctx);

    await vi.waitFor(() => {
      // Should call insert (insertLinkAtCursor path)
      expect(ctx.view!.state.tr.insert).toHaveBeenCalled();
      expect(ctx.view!.dispatch).toHaveBeenCalled();
    });
  });

  it("skips smart link when already in a link", async () => {
    vi.mocked(readClipboardUrl).mockResolvedValue("https://example.com");
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(resolveLinkPopupPayload).mockReturnValue({
      href: "https://existing.com",
      linkFrom: 5,
      linkTo: 15,
    } as never);

    const openPopup = vi.fn();
    vi.mocked(useLinkPopupStore.getState).mockReturnValue({ openPopup } as never);

    const ctx = createContext();
    ctx.context = { inLink: { href: "https://existing.com" } } as never;
    openLinkEditor(ctx);

    await vi.waitFor(() => {
      // Should fall back to popup since inLink is true
      expect(openPopup).toHaveBeenCalled();
    });
  });

  it("skips smart link when view disconnects during clipboard read", async () => {
    vi.mocked(readClipboardUrl).mockResolvedValue("https://example.com");
    // First call (from trySmartLinkInsertion) returns false
    vi.mocked(isViewConnected).mockReturnValue(false);

    const ctx = createContext();
    openLinkEditor(ctx);

    await new Promise((r) => setTimeout(r, 10));
    // dispatch should NOT have been called because view is disconnected
    expect(ctx.view!.dispatch).not.toHaveBeenCalled();
  });

  it("falls back to expandedToggleMarkTiptap when coordsAtPos throws", async () => {
    vi.mocked(readClipboardUrl).mockResolvedValue(null);
    vi.mocked(isViewConnected).mockReturnValue(true);
    vi.mocked(resolveLinkPopupPayload).mockReturnValue({
      href: "https://test.com",
      linkFrom: 5,
      linkTo: 15,
    } as never);

    const ctx = createContext();
    (ctx.view! as { coordsAtPos: ReturnType<typeof vi.fn> }).coordsAtPos = vi.fn(() => {
      throw new Error("coordsAtPos failed");
    });
    openLinkEditor(ctx);

    await vi.waitFor(() => {
      expect(expandedToggleMarkTiptap).toHaveBeenCalledWith(ctx.view, "link");
    });
  });

  it("handles wiki link with null value attr", () => {
    const openPopup = vi.fn();
    vi.mocked(useWikiLinkPopupStore.getState).mockReturnValue({ openPopup } as never);

    // Create a view where the wikiLink node has value: null
    const ctx = createContext({ inWikiLink: true });
    // Override the node mock to return null value
    const mockView = ctx.view!;
    const $from = (mockView.state.selection as { $from: { node: ReturnType<typeof vi.fn> } }).$from;
    $from.node = vi.fn((d: number) => {
      if (d === 1) {
        return { type: { name: "wikiLink" }, attrs: { value: null }, nodeSize: 8 };
      }
      return { type: { name: "doc" } };
    });

    openLinkEditor(ctx);

    expect(openPopup).toHaveBeenCalledWith(
      expect.any(Object),
      "", // null coerced to empty string
      5
    );
  });
});
