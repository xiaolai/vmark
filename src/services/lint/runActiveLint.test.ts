// @vitest-environment node
/**
 * Tests for runActiveLint — doc-epoch run-start marking (Codex audit finding 5)
 * and format routing.
 *
 * The lint store is mocked; the format registry is the real one, so the file
 * path is what decides which linter runs and whether the markdown link check
 * applies. The run start must be marked for the active tab at the moment
 * content is captured.
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

// WI-4.3: the call site asks the FORMAT for its linter instead of choosing
// between two hard-coded store actions.
const mockRunLintForFormat = vi.fn(() => []);
const mockRunLinkCheck = vi.fn(() => Promise.resolve([]));
vi.mock("@/stores/documentStore", () => ({
  useLintStore: {
    getState: () => ({
      runLintForFormat: mockRunLintForFormat,
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

import { __resetRegistry } from "@/lib/formats/registry";
import { bootstrapFormats } from "@/lib/formats/registryBootstrap";
import { imeToast } from "@/services/ime/imeToast";
import { activeTabHasLinter, runActiveLint } from "./runActiveLint";

__resetRegistry();
bootstrapFormats();

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
    // WI-4.3: dispatch is by FORMAT now — the file path is what selects the
    // linter, so it must reach the store.
    expect(mockRunLintForFormat).toHaveBeenCalledWith("tab-42", "# hi", null);
  });

  it("marks the run start for YAML files too", () => {
    mockGetActiveDocument.mockReturnValue({
      content: "a: 1",
      filePath: "/tmp/x.yaml",
    });
    runActiveLint("main");
    expect(mockMarkLintRunStart).toHaveBeenCalledWith("tab-42");
    expect(mockRunLintForFormat).toHaveBeenCalledWith(
      "tab-42",
      "a: 1",
      "/tmp/x.yaml",
    );
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
    expect(mockRunLintForFormat).not.toHaveBeenCalled();
  });
});

describe("runActiveLint format routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lintEnabled = true;
    mockGetActiveTabId.mockReturnValue("tab-7");
  });

  it("runs the markdown link check for a saved markdown file", async () => {
    mockGetActiveDocument.mockReturnValue({ content: "[a](./b.md)", filePath: "/repo/x.md" });
    runActiveLint("main");
    await vi.waitFor(() => expect(imeToast.success).toHaveBeenCalled());
    expect(mockRunLinkCheck).toHaveBeenCalledWith("tab-7", "[a](./b.md)", "/repo/x.md");
  });

  it("never runs the markdown link check over a YAML file", () => {
    mockGetActiveDocument.mockReturnValue({ content: "a: [x](./b.md)", filePath: "/repo/ci.yml" });
    runActiveLint("main");
    expect(mockRunLintForFormat).toHaveBeenCalledTimes(1);
    expect(mockRunLinkCheck).not.toHaveBeenCalled();
  });

  it.each(["/repo/data.json", "/repo/Cargo.toml", "/repo/notes.txt", "/repo/table.csv"])(
    "does nothing for %s, whose format contributes no linter",
    (filePath) => {
      mockGetActiveDocument.mockReturnValue({ content: "[a](./missing.md)", filePath });
      runActiveLint("main");
      expect(mockRunLinkCheck).not.toHaveBeenCalled();
      expect(mockRunLintForFormat).not.toHaveBeenCalled();
      expect(mockMarkLintRunStart).not.toHaveBeenCalled();
      expect(imeToast.success).not.toHaveBeenCalled();
      expect(imeToast.info).not.toHaveBeenCalled();
    },
  );
});

describe("activeTabHasLinter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveTabId.mockReturnValue("tab-7");
  });

  it.each([
    [null, true],
    ["/repo/x.md", true],
    ["/repo/ci.yaml", true],
    ["/repo/data.json", false],
    ["/repo/Cargo.toml", false],
    ["/repo/notes.txt", false],
  ])("filePath %s → %s", (filePath, expected) => {
    mockGetActiveDocument.mockReturnValue({ content: "", filePath });
    expect(activeTabHasLinter("main")).toBe(expected);
  });

  it("is false with no active document", () => {
    mockGetActiveTabId.mockReturnValue(null);
    mockGetActiveDocument.mockReturnValue(null);
    expect(activeTabHasLinter("main")).toBe(false);
  });
});
