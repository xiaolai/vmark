// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRemoveDocument = vi.fn();
const mockClearDocument = vi.fn();
const mockClearDiagnostics = vi.fn();
const mockClearForTab = vi.fn();

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({ removeDocument: mockRemoveDocument }),
  },
  useRevisionStore: {
    getState: () => ({ clearRevision: vi.fn() }),
  },
  useUnifiedHistoryStore: {
    getState: () => ({ clearDocument: mockClearDocument }),
  },
  useLintStore: {
    getState: () => ({ clearDiagnostics: mockClearDiagnostics }),
  },
  useLargeFileSessionStore: {
    getState: () => ({ clearForcedSource: vi.fn() }),
  },
}));

vi.mock("@/stores/aiStore", () => ({
  useAiSuggestionStore: {
    getState: () => ({ clearForTab: mockClearForTab }),
  },
}));

import { cleanupTabState } from "./tabCleanup";
import {
  getEditorScrollOffset,
  setEditorScrollOffset,
} from "@/services/editor/scrollPosition";

describe("cleanupTabState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls removeDocument for the tabId", () => {
    cleanupTabState("tab-123");
    expect(mockRemoveDocument).toHaveBeenCalledWith("tab-123");
  });

  it("calls clearDocument (history) for the tabId", () => {
    cleanupTabState("tab-123");
    expect(mockClearDocument).toHaveBeenCalledWith("tab-123");
  });

  it("calls clearDiagnostics (lint) for the tabId", () => {
    cleanupTabState("tab-123");
    expect(mockClearDiagnostics).toHaveBeenCalledWith("tab-123");
  });

  it("calls clearForTab (ai suggestions) for the tabId", () => {
    cleanupTabState("tab-123");
    expect(mockClearForTab).toHaveBeenCalledWith("tab-123");
  });

  it("forgets the remembered reading positions for the tabId (#1249)", () => {
    setEditorScrollOffset("tab-123", "wysiwyg", 400);
    setEditorScrollOffset("tab-123", "source", 90);
    setEditorScrollOffset("tab-456", "wysiwyg", 400);

    cleanupTabState("tab-123");

    expect(getEditorScrollOffset("tab-123", "wysiwyg")).toBeUndefined();
    expect(getEditorScrollOffset("tab-123", "source")).toBeUndefined();
    // A closing tab must not take another tab's position with it.
    expect(getEditorScrollOffset("tab-456", "wysiwyg")).toBe(400);
  });
});
