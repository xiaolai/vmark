import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before imports
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      tabs: { main: [{ id: "tab-1" }] },
      activeTabId: { main: "tab-1" },
    }),
  },
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { useDocumentStore } from "@/stores/documentStore";
import { isDocReadOnly, isActiveDocReadOnly } from "./readOnlyGuard";

describe("readOnlyGuard", () => {
  beforeEach(() => {
    // Reset document store
    const docs = useDocumentStore.getState().documents;
    Object.keys(docs).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
  });

  describe("isDocReadOnly", () => {
    it("returns false for non-existent tab", () => {
      expect(isDocReadOnly("nonexistent")).toBe(false);
    });

    it("returns false for writable document", () => {
      useDocumentStore.getState().initDocument("tab-1", "hello");
      expect(isDocReadOnly("tab-1")).toBe(false);
    });

    it("returns true for read-only document", () => {
      useDocumentStore.getState().initDocument("tab-1", "hello");
      useDocumentStore.getState().setReadOnly("tab-1", true);
      expect(isDocReadOnly("tab-1")).toBe(true);
    });
  });

  describe("isActiveDocReadOnly", () => {
    it("returns false when active tab is writable", () => {
      useDocumentStore.getState().initDocument("tab-1", "hello");
      expect(isActiveDocReadOnly()).toBe(false);
    });

    it("returns true when active tab is read-only", () => {
      useDocumentStore.getState().initDocument("tab-1", "hello");
      useDocumentStore.getState().setReadOnly("tab-1", true);
      expect(isActiveDocReadOnly()).toBe(true);
    });
  });
});
