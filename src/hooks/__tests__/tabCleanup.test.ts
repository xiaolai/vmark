import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRemoveDocument = vi.fn();
const mockClearDocument = vi.fn();
const mockClearDiagnostics = vi.fn();
const mockClearForTab = vi.fn();

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({ removeDocument: mockRemoveDocument }),
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

import { cleanupTabState } from "../tabCleanup";

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
});
