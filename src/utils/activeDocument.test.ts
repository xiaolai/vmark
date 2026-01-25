/**
 * Unit tests for activeDocument helper
 * Tests windowLabel → activeTabId resolution
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getActiveTabId,
  getActiveDocument,
  getActiveTabIdOrNull,
} from "./activeDocument";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

describe("activeDocument", () => {
  beforeEach(() => {
    // Reset stores before each test
    useTabStore.setState({
      tabs: {},
      activeTabId: {},
      untitledCounter: 0,
      closedTabs: {},
    });
    useDocumentStore.setState({
      documents: {},
    });
  });

  describe("getActiveTabId", () => {
    it("returns null when windowLabel has no tabs", () => {
      const result = getActiveTabId("main");
      expect(result).toBeNull();
    });

    it("returns null when windowLabel has tabs but no active tab", () => {
      useTabStore.setState({
        tabs: { main: [{ id: "tab-1", filePath: null, title: "Untitled", isPinned: false }] },
        activeTabId: { main: null },
      });

      const result = getActiveTabId("main");
      expect(result).toBeNull();
    });

    it("returns the active tabId when one exists", () => {
      useTabStore.setState({
        tabs: { main: [{ id: "tab-1", filePath: null, title: "Untitled", isPinned: false }] },
        activeTabId: { main: "tab-1" },
      });

      const result = getActiveTabId("main");
      expect(result).toBe("tab-1");
    });

    it("handles multiple windows independently", () => {
      useTabStore.setState({
        tabs: {
          main: [{ id: "tab-1", filePath: null, title: "Untitled", isPinned: false }],
          secondary: [{ id: "tab-2", filePath: "/path/to/file.md", title: "file", isPinned: false }],
        },
        activeTabId: { main: "tab-1", secondary: "tab-2" },
      });

      expect(getActiveTabId("main")).toBe("tab-1");
      expect(getActiveTabId("secondary")).toBe("tab-2");
    });

    it("returns null when active tab ID references non-existent tab", () => {
      // Edge case: activeTabId set but tab doesn't exist in tabs array
      useTabStore.setState({
        tabs: { main: [] },
        activeTabId: { main: "ghost-tab" },
      });

      const result = getActiveTabId("main");
      // Should return null because the tab doesn't actually exist
      expect(result).toBeNull();
    });
  });

  describe("getActiveTabIdOrNull (alias)", () => {
    it("behaves the same as getActiveTabId", () => {
      useTabStore.setState({
        tabs: { main: [{ id: "tab-1", filePath: null, title: "Untitled", isPinned: false }] },
        activeTabId: { main: "tab-1" },
      });

      expect(getActiveTabIdOrNull("main")).toBe("tab-1");
      expect(getActiveTabIdOrNull("unknown")).toBeNull();
    });
  });

  describe("getActiveDocument", () => {
    it("returns null when no active tab", () => {
      const result = getActiveDocument("main");
      expect(result).toBeNull();
    });

    it("returns null when active tab has no document", () => {
      useTabStore.setState({
        tabs: { main: [{ id: "tab-1", filePath: null, title: "Untitled", isPinned: false }] },
        activeTabId: { main: "tab-1" },
      });
      // No document initialized for tab-1

      const result = getActiveDocument("main");
      expect(result).toBeNull();
    });

    it("returns the document for the active tab", () => {
      useTabStore.setState({
        tabs: { main: [{ id: "tab-1", filePath: "/test.md", title: "test", isPinned: false }] },
        activeTabId: { main: "tab-1" },
      });
      useDocumentStore.setState({
        documents: {
          "tab-1": {
            content: "# Hello",
            savedContent: "# Hello",
            filePath: "/test.md",
            isDirty: false,
            documentId: 1,
            cursorInfo: null,
            lastAutoSave: null,
            isMissing: false,
            isDivergent: false,
            lineEnding: "unknown",
            hardBreakStyle: "unknown",
          },
        },
      });

      const result = getActiveDocument("main");
      expect(result).not.toBeNull();
      expect(result?.content).toBe("# Hello");
      expect(result?.filePath).toBe("/test.md");
    });

    it("returns correct document when multiple tabs exist", () => {
      useTabStore.setState({
        tabs: {
          main: [
            { id: "tab-1", filePath: "/first.md", title: "first", isPinned: false },
            { id: "tab-2", filePath: "/second.md", title: "second", isPinned: false },
          ],
        },
        activeTabId: { main: "tab-2" }, // Second tab is active
      });
      useDocumentStore.setState({
        documents: {
          "tab-1": {
            content: "First content",
            savedContent: "First content",
            filePath: "/first.md",
            isDirty: false,
            documentId: 1,
            cursorInfo: null,
            lastAutoSave: null,
            isMissing: false,
            isDivergent: false,
            lineEnding: "unknown",
            hardBreakStyle: "unknown",
          },
          "tab-2": {
            content: "Second content",
            savedContent: "Second content",
            filePath: "/second.md",
            isDirty: false,
            documentId: 2,
            cursorInfo: null,
            lastAutoSave: null,
            isMissing: false,
            isDivergent: false,
            lineEnding: "unknown",
            hardBreakStyle: "unknown",
          },
        },
      });

      const result = getActiveDocument("main");
      expect(result?.content).toBe("Second content");
      expect(result?.filePath).toBe("/second.md");
    });
  });
});
