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
import { chooseEditorRestore } from "@/services/editor/restoreChoice";
import {
  bumpLintDocEpoch,
  markLintRunStart,
  isLintRunCurrent,
} from "@/plugins/lint/docEpoch";
import { journalBasis, rememberJournalBasis, windowNameFor } from "@/services/agentJournal/documentIdentity";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";

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

  it("forgets which surface showed the tabId, so a reused id starts fresh (#1556)", () => {
    chooseEditorRestore("tab-123", "wysiwyg", true);
    cleanupTabState("tab-123");
    setEditorScrollOffset("tab-123", "wysiwyg", 400);

    // A first show again: the cursor, not an offset left by the closed tab.
    expect(chooseEditorRestore("tab-123", "wysiwyg", true)).toBe("cursor");
    cleanupTabState("tab-123");
  });

  it("releases the tab's agent-journal state and window names (and only that tab's)", () => {
    rememberJournalBasis("tab-123", "path:/a.md", "rev-1");
    const name = windowNameFor("tab-123", "path:/a.md", "main");
    rememberJournalBasis("tab-456", "path:/a.md", "rev-2");

    cleanupTabState("tab-123");

    expect(journalBasis("tab-123", "path:/a.md")).toBeNull();
    expect(agentJournalEpochFake.released).toContain(name);
    expect(journalBasis("tab-456", "path:/a.md")).toBe("rev-2");
  });

  it("forgets the lint doc-epoch counters for the tabId", () => {
    markLintRunStart("tab-123");
    bumpLintDocEpoch("tab-123");
    markLintRunStart("tab-456");
    bumpLintDocEpoch("tab-456");

    cleanupTabState("tab-123");

    expect(isLintRunCurrent("tab-123")).toBe(true);
    expect(isLintRunCurrent("tab-456")).toBe(false);
  });

  it("a cleanup step that throws does not stop the rest, the journal release included, and is still reported", () => {
    rememberJournalBasis("tab-789", "path:/b.md", "rev-3");
    const name = windowNameFor("tab-789", "path:/b.md", "main");
    const failure = new Error("history store unavailable");
    mockClearDocument.mockImplementationOnce(() => {
      throw failure;
    });

    expect(() => cleanupTabState("tab-789")).toThrow(failure);

    expect(mockClearDiagnostics).toHaveBeenCalledWith("tab-789");
    expect(mockClearForTab).toHaveBeenCalledWith("tab-789");
    expect(journalBasis("tab-789", "path:/b.md")).toBeNull();
    expect(agentJournalEpochFake.released).toContain(name);
  });

  it("two failing steps are both reported", () => {
    mockRemoveDocument.mockImplementationOnce(() => {
      throw new Error("first");
    });
    mockClearForTab.mockImplementationOnce(() => {
      throw new Error("second");
    });

    let thrown: unknown;
    try {
      cleanupTabState("tab-790");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors.map((e: Error) => e.message)).toEqual(["first", "second"]);
  });
});
