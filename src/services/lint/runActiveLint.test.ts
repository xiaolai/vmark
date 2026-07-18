/**
 * Tests for runActiveLint — doc-epoch run-start marking (Codex audit finding 5).
 *
 * The full lint/link-check/toast flow is covered by store and plugin tests;
 * these tests pin the seam that guards stale async completions: the run start
 * must be marked for the active tab at the moment content is captured.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMarkLintRunStart = vi.fn();
vi.mock("@/plugins/lint/docEpoch", () => ({
  markLintRunStart: (...args: unknown[]) => mockMarkLintRunStart(...args),
}));

vi.mock("@/plugins/codemirror/sourceLint", () => ({
  triggerLintRefresh: vi.fn(),
}));

vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { success: vi.fn(), info: vi.fn() },
}));

const mockGetActiveTabId = vi.fn();
const mockGetActiveDocument = vi.fn();
vi.mock("@/services/navigation/activeDocument", () => ({
  getActiveTabId: (...args: unknown[]) => mockGetActiveTabId(...args),
  getActiveDocument: (...args: unknown[]) => mockGetActiveDocument(...args),
}));

const mockRunLint = vi.fn(() => []);
const mockRunYamlLint = vi.fn(() => []);
const mockRunLinkCheck = vi.fn(() => Promise.resolve([]));
vi.mock("@/stores/documentStore", () => ({
  useLintStore: {
    getState: () => ({
      runLint: mockRunLint,
      runYamlLint: mockRunYamlLint,
      runLinkCheck: mockRunLinkCheck,
    }),
  },
}));

let lintEnabled = true;
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ markdown: { lintEnabled } }),
  },
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ sourceMode: false }) },
}));

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => ({
      active: { activeSourceView: null },
      tiptap: { editor: null },
    }),
  },
}));

import { runActiveLint } from "./runActiveLint";

describe("runActiveLint doc-epoch marking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lintEnabled = true;
    mockGetActiveTabId.mockReturnValue("tab-42");
    mockGetActiveDocument.mockReturnValue({ content: "# hi", filePath: null });
  });

  it("marks the run start for the active tab when content is captured", () => {
    runActiveLint("main");
    expect(mockMarkLintRunStart).toHaveBeenCalledWith("tab-42");
    expect(mockRunLint).toHaveBeenCalledWith("tab-42", "# hi");
  });

  it("marks the run start for YAML files too", () => {
    mockGetActiveDocument.mockReturnValue({
      content: "a: 1",
      filePath: "/tmp/x.yaml",
    });
    runActiveLint("main");
    expect(mockMarkLintRunStart).toHaveBeenCalledWith("tab-42");
    expect(mockRunYamlLint).toHaveBeenCalledWith("tab-42", "a: 1");
  });

  it("does not mark when lint is disabled", () => {
    lintEnabled = false;
    runActiveLint("main");
    expect(mockMarkLintRunStart).not.toHaveBeenCalled();
  });

  it("does not mark when there is no active tab", () => {
    mockGetActiveTabId.mockReturnValue(null);
    runActiveLint("main");
    expect(mockMarkLintRunStart).not.toHaveBeenCalled();
  });

  it("does not mark when no content can be resolved", () => {
    mockGetActiveDocument.mockReturnValue(undefined);
    runActiveLint("main");
    expect(mockMarkLintRunStart).not.toHaveBeenCalled();
    expect(mockRunLint).not.toHaveBeenCalled();
  });
});
