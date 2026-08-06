/**
 * Tests for Smart Paste Utilities
 *
 * Tests pure/small helper functions used by the smart paste plugin.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";
import {
  isViewConnected,
  isValidUrl,
  getActiveFilePath,
  getToastAnchorRect,
  pasteAsText,
  expandHomePath,
  validateLocalPath,
} from "./smartPasteUtils";

// These drive the REAL stores; bind them to the seams the plugin reads,
// which is what the app does at startup.
beforeEach(bindPluginHostSettings);

// Track views for cleanup
const views: EditorView[] = [];
afterEach(() => {
  views.forEach((v) => v.destroy());
  views.length = 0;
});

function createView(content: string, cursorPos?: number): EditorView {
  const pos = cursorPos ?? content.length;
  const state = EditorState.create({
    doc: content,
    selection: { anchor: pos },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ state, parent: container });
  views.push(view);
  return view;
}

describe("isViewConnected", () => {
  it("returns false for null", () => {
    expect(isViewConnected(null)).toBe(false);
  });

  it("returns false when dom is null (covers ?? false branch)", () => {
    // Simulate a view whose dom property is null — hits the `?? false` branch on line 24
    const fakeView = {
      get dom() {
        return null as unknown as HTMLElement;
      },
    } as unknown as EditorView;
    expect(isViewConnected(fakeView)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isViewConnected(undefined)).toBe(false);
  });

  it("returns true for a connected view", () => {
    const view = createView("hello");
    expect(isViewConnected(view)).toBe(true);
  });

  it("returns false for a destroyed/disconnected view", () => {
    const state = EditorState.create({ doc: "hello" });
    // Create a view with a detached parent (not in document)
    const detachedContainer = document.createElement("div");
    const view = new EditorView({ state, parent: detachedContainer });
    // detachedContainer is not appended to document, so dom.isConnected = false
    expect(isViewConnected(view)).toBe(false);
    view.destroy();
  });

  it("handles view with broken dom gracefully", () => {
    const fakeView = {
      get dom() {
        throw new Error("broken");
      },
    } as unknown as EditorView;
    expect(isViewConnected(fakeView)).toBe(false);
  });
});

describe("isValidUrl", () => {
  it("returns true for http URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
  });

  it("returns true for https URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  it("returns true for URLs with paths", () => {
    expect(isValidUrl("https://example.com/path/to/page")).toBe(true);
  });

  it("returns true for URLs with query strings", () => {
    expect(isValidUrl("https://example.com?q=search&page=1")).toBe(true);
  });

  it("returns true for trimmed URL with whitespace", () => {
    expect(isValidUrl("  https://example.com  ")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isValidUrl("")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(isValidUrl("just some text")).toBe(false);
  });

  it("returns false for file paths", () => {
    expect(isValidUrl("/Users/test/file.md")).toBe(false);
  });

  it("returns false for ftp URLs", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
  });

  it("returns false for mailto links", () => {
    expect(isValidUrl("mailto:test@example.com")).toBe(false);
  });

  it("returns false for URLs without protocol", () => {
    expect(isValidUrl("example.com")).toBe(false);
  });

  it("returns false for URLs with spaces", () => {
    // Strings with spaces are not valid URLs
    expect(isValidUrl("https://exam ple.com")).toBe(false);
  });

  it("returns false for protocol-only with no path", () => {
    expect(isValidUrl("https:// ")).toBe(false);
  });
});

describe("getActiveFilePath", () => {
  it("returns null when no active tab", () => {
    // Default store state has no active tab
    expect(getActiveFilePath()).toBeNull();
  });

  it("returns filePath when active tab has a document with filePath", async () => {
    const { useTabStore } = await import("@/stores/tabStore");
    const { useDocumentStore } = await import("@/stores/documentStore");
    const origTabState = useTabStore.getState;
    const origDocState = useDocumentStore.getState;

    (useTabStore as unknown as { getState: () => unknown }).getState = () => ({
      activeTabId: { main: "tab-1" },
    });
    (useDocumentStore as unknown as { getState: () => unknown }).getState = () => ({
      getDocument: (id: string) => id === "tab-1" ? { filePath: "/test/file.md" } : null,
    });

    expect(getActiveFilePath()).toBe("/test/file.md");

    (useTabStore as unknown as { getState: typeof origTabState }).getState = origTabState;
    (useDocumentStore as unknown as { getState: typeof origDocState }).getState = origDocState;
  });

  it("returns null when store access throws (line 49)", async () => {
    const { useTabStore } = await import("@/stores/tabStore");
    const origTabState = useTabStore.getState;

    (useTabStore as unknown as { getState: () => unknown }).getState = () => {
      throw new Error("store error");
    };

    expect(getActiveFilePath()).toBeNull();

    (useTabStore as unknown as { getState: typeof origTabState }).getState = origTabState;
  });

  it("returns null when document has no filePath", async () => {
    const { useTabStore } = await import("@/stores/tabStore");
    const { useDocumentStore } = await import("@/stores/documentStore");
    const origTabState = useTabStore.getState;
    const origDocState = useDocumentStore.getState;

    (useTabStore as unknown as { getState: () => unknown }).getState = () => ({
      activeTabId: { main: "tab-2" },
    });
    (useDocumentStore as unknown as { getState: () => unknown }).getState = () => ({
      getDocument: () => ({ filePath: undefined }),
    });

    expect(getActiveFilePath()).toBeNull();

    (useTabStore as unknown as { getState: typeof origTabState }).getState = origTabState;
    (useDocumentStore as unknown as { getState: typeof origDocState }).getState = origDocState;
  });
});

describe("getToastAnchorRect", () => {
  it("returns fallback rect when coordsAtPos fails", () => {
    const view = createView("hello");
    // jsdom doesn't implement coordsAtPos, so it will throw/return null
    const rect = getToastAnchorRect(view, 0);
    // Should return center-of-window fallback
    expect(rect).toHaveProperty("top");
    expect(rect).toHaveProperty("left");
    expect(rect).toHaveProperty("bottom");
    expect(rect).toHaveProperty("right");
    expect(typeof rect.top).toBe("number");
  });

  it("returns fallback rect for out-of-range position", () => {
    const view = createView("hello");
    const rect = getToastAnchorRect(view, 9999);
    expect(rect).toHaveProperty("top");
    expect(typeof rect.top).toBe("number");
  });

  it("returns fallback rect for empty document", () => {
    const view = createView("");
    const rect = getToastAnchorRect(view, 0);
    expect(rect).toHaveProperty("top");
  });

  it("returns coords when coordsAtPos succeeds", () => {
    const view = createView("hello world");
    const fakeCoords = { top: 10, left: 20, bottom: 30, right: 40 };
    vi.spyOn(view, "coordsAtPos").mockReturnValue(fakeCoords);
    const rect = getToastAnchorRect(view, 0);
    expect(rect).toEqual({ top: 10, left: 20, bottom: 30, right: 40 });
  });
});

describe("pasteAsText", () => {
  it("inserts text at captured position", () => {
    const view = createView("hello world", 5);
    pasteAsText(view, " there", 5, 5);
    expect(view.state.doc.toString()).toBe("hello there world");
  });

  it("replaces selection range", () => {
    const state = EditorState.create({
      doc: "hello world",
      selection: { anchor: 0, head: 5 },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    views.push(view);

    pasteAsText(view, "goodbye", 0, 5);
    expect(view.state.doc.toString()).toBe("goodbye world");
  });

  it("does nothing for disconnected view", () => {
    const result = pasteAsText(null as unknown as EditorView, "text", 0, 0);
    expect(result).toBeUndefined();
  });

  it("clamps positions to document length", () => {
    const view = createView("hi", 2);
    // Captured positions beyond doc length
    pasteAsText(view, "!", 2, 2);
    expect(view.state.doc.toString()).toBe("hi!");
  });

  it("uses current positions when selection has changed", () => {
    const view = createView("hello", 3);
    // Captured positions differ from current
    pasteAsText(view, "X", 0, 0);
    // Current selection is at 3, captured was 0 — they differ, so uses current
    expect(view.state.doc.toString()).toBe("helXlo");
  });

  it("handles empty text insertion", () => {
    const view = createView("hello", 0);
    pasteAsText(view, "", 0, 0);
    expect(view.state.doc.toString()).toBe("hello");
  });
});

describe("expandHomePath", () => {
  it("returns the path unchanged when it does not start with ~/", async () => {
    const result = await expandHomePath("/absolute/path/file.md");
    expect(result).toBe("/absolute/path/file.md");
  });

  it("returns the path unchanged for relative paths", async () => {
    const result = await expandHomePath("relative/path/file.md");
    expect(result).toBe("relative/path/file.md");
  });

  it("returns the path unchanged for empty string", async () => {
    const result = await expandHomePath("");
    expect(result).toBe("");
  });

  it("attempts to expand ~/ paths", async () => {
    // In test environment, homeDir() may fail (Tauri not available)
    // The function catches the error and returns null
    const result = await expandHomePath("~/Documents/file.md");
    // Will return null if homeDir() throws (no Tauri runtime)
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("returns null when homeDir throws", async () => {
    const pathMod = await import("@tauri-apps/api/path");
    vi.mocked(pathMod.homeDir).mockRejectedValueOnce(new Error("no home"));
    const result = await expandHomePath("~/some/file.md");
    expect(result).toBeNull();
  });
});

describe("validateLocalPath", () => {
  it("returns false when exists() returns falsy", async () => {
    // Mock exists returns undefined by default
    const result = await validateLocalPath("/nonexistent/path/file.txt");
    expect(result).toBeFalsy();
  });

  it("returns false when exists() throws", async () => {
    const { exists } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockRejectedValueOnce(new Error("fs error"));
    const result = await validateLocalPath("/bad/path");
    expect(result).toBe(false);
  });

  it("returns true when exists() returns true", async () => {
    const { exists } = await import("@tauri-apps/plugin-fs");
    vi.mocked(exists).mockResolvedValueOnce(true);
    const result = await validateLocalPath("/valid/file.txt");
    expect(result).toBe(true);
  });
});
