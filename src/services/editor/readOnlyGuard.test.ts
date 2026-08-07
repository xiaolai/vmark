// @vitest-environment node
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

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { useDocumentStore } from "@/stores/documentStore";
import {
  isDocReadOnly,
  isActiveDocReadOnly,
  isTargetDocReadOnly,
} from "./readOnlyGuard";

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

  // WI-4 — the MCP router used to gate writes on the ACTIVE tab while
  // document.write / document.transform / workflow.apply_patch all accept a
  // `tabId`. That let a write to a read-only BACKGROUND tab through (buffer and
  // disk both modified), and wrongly rejected a write to a writable background
  // tab whenever the active doc happened to be read-only.
  describe("isTargetDocReadOnly", () => {
    it("blocks a write targeting a read-only background tab", () => {
      useDocumentStore.getState().initDocument("tab-1", "active");
      useDocumentStore.getState().initDocument("tab-2", "background");
      useDocumentStore.getState().setReadOnly("tab-2", true);

      // Active tab (tab-1) is writable, so the old active-tab check passed.
      expect(isActiveDocReadOnly()).toBe(false);
      expect(isTargetDocReadOnly("tab-2")).toBe(true);
    });

    it("allows a write targeting a writable background tab while the active doc is read-only", () => {
      useDocumentStore.getState().initDocument("tab-1", "active");
      useDocumentStore.getState().setReadOnly("tab-1", true);
      useDocumentStore.getState().initDocument("tab-2", "background");

      // Active tab is read-only, so the old check rejected this valid write.
      expect(isActiveDocReadOnly()).toBe(true);
      expect(isTargetDocReadOnly("tab-2")).toBe(false);
    });

    it("falls back to the active tab when no tabId is supplied", () => {
      // selection.set carries no tabId — it operates on the focused tab.
      useDocumentStore.getState().initDocument("tab-1", "active");
      useDocumentStore.getState().setReadOnly("tab-1", true);
      expect(isTargetDocReadOnly(undefined)).toBe(true);
    });

    it("ignores a non-string tabId and falls back to the active tab", () => {
      useDocumentStore.getState().initDocument("tab-1", "active");
      useDocumentStore.getState().setReadOnly("tab-1", true);
      expect(isTargetDocReadOnly(42)).toBe(true);
      expect(isTargetDocReadOnly(null)).toBe(true);
    });

    it("reports an unknown tab as writable so the handler can raise its own error", () => {
      // A misleading READ_ONLY would mask the real TAB_NOT_FOUND.
      useDocumentStore.getState().initDocument("tab-1", "active");
      expect(isTargetDocReadOnly("no-such-tab")).toBe(false);
    });
  });
});
