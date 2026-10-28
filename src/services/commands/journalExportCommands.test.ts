// @vitest-environment node
// WI-AL4.1 — "Export Edit History to Git…": pick a repository folder, export
// the active document's journal to its branch, report the outcome.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockOpen, mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockOpen: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => mockOpen(...a) }));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    error: (...a: unknown[]) => mockToastError(...a),
    success: (...a: unknown[]) => mockToastSuccess(...a),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { registerJournalExportCommands } from "./journalExportCommands";
import { executeCommand, hasCommand, searchCommands } from "./CommandBus";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

const COMMAND = "history.exportToGit";

function openDoc(filePath: string | null, windowLabel = "main"): string {
  const tabId = useTabStore.getState().createTab(windowLabel);
  useDocumentStore.getState().initDocument(tabId, "x", filePath);
  useTabStore.getState().setActiveTab(windowLabel, tabId);
  return tabId;
}

function report(commitsCreated: number, syntheticCreated = 0) {
  return {
    branch: "vmark-journal/0f8c2b1e-0000-4000-8000-000000000001",
    head: commitsCreated === 0 ? null : "a".repeat(40),
    commitsCreated,
    syntheticCreated,
  };
}

function refusal(exportCode: string) {
  return { code: "INVALID_INPUT", message: "refused", detail: { exportCode } };
}

const run = () => executeCommand(COMMAND, undefined, { windowLabel: "main" });

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState(useTabStore.getInitialState());
  useDocumentStore.setState(useDocumentStore.getInitialState());
  registerJournalExportCommands();
});

describe("history.exportToGit", () => {
  it("is registered and only offered when a document is active", () => {
    expect(hasCommand(COMMAND)).toBe(true);
    expect(searchCommands("Git", { windowLabel: "main" }).some((r) => r.command.id === COMMAND)).toBe(false);
    openDoc("/repo/notes.md");
    expect(searchCommands("Git", { windowLabel: "main" }).some((r) => r.command.id === COMMAND)).toBe(true);
  });

  it("exports the saved document to the picked folder and reports the commits", async () => {
    openDoc("/repo/notes/chapter.md");
    mockOpen.mockResolvedValue("/repo");
    mockInvoke.mockResolvedValue(report(3, 1));
    await run();
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false, defaultPath: "/repo/notes" }),
    );
    expect(mockInvoke).toHaveBeenCalledWith("agent_journal_git_export", {
      payload: JSON.stringify({ docKey: "path:/repo/notes/chapter.md", repository: "/repo" }),
    });
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(String(mockToastSuccess.mock.calls[0]?.[0])).toContain("vmark-journal/");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("keys an untitled document by its tab and opens the picker without a default", async () => {
    const tabId = openDoc(null);
    mockOpen.mockResolvedValue("/repo");
    mockInvoke.mockResolvedValue(report(1));
    await run();
    const opts = mockOpen.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.defaultPath).toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith("agent_journal_git_export", {
      payload: JSON.stringify({ docKey: `tab:main/${tabId}`, repository: "/repo" }),
    });
  });

  it("keeps a Unicode folder path byte for byte", async () => {
    openDoc("/文档/草稿 1.md");
    mockOpen.mockResolvedValue("/文档");
    mockInvoke.mockResolvedValue(report(1));
    await run();
    expect(mockInvoke).toHaveBeenCalledWith("agent_journal_git_export", {
      payload: JSON.stringify({ docKey: "path:/文档/草稿 1.md", repository: "/文档" }),
    });
  });

  it("does nothing when the picker is cancelled", async () => {
    openDoc("/repo/a.md");
    mockOpen.mockResolvedValue(null);
    await run();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("does nothing without an active document", async () => {
    await executeCommand(COMMAND, undefined, { windowLabel: "main" });
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("says the branch is up to date when nothing new was exported", async () => {
    openDoc("/repo/a.md");
    mockOpen.mockResolvedValue("/repo");
    mockInvoke.mockResolvedValue(report(0));
    await run();
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(String(mockToastSuccess.mock.calls[0]?.[0])).toMatch(/up to date/i);
  });

  it.each([
    ["GIT_MISSING", /Git/],
    ["NOT_A_REPOSITORY", /repository/i],
    ["NO_HISTORY", /history/i],
    ["EXPORT_CONFLICT", /changed/i],
    ["UNRELATED_BRANCH", /not VMark/i],
    ["BRANCH_CHECKED_OUT", /checked out/i],
  ])("shows a translated message for %s", async (code, pattern) => {
    openDoc("/repo/a.md");
    mockOpen.mockResolvedValue("/repo");
    mockInvoke.mockRejectedValue(refusal(code));
    await run();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    const shown = String(mockToastError.mock.calls[0]?.[0]);
    expect(shown).toMatch(pattern);
    expect(shown).not.toBe("refused");
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("shows the backend message for a refusal without an export code", async () => {
    openDoc("/repo/a.md");
    mockOpen.mockResolvedValue("/repo");
    mockInvoke.mockRejectedValue(new Error("disk on fire"));
    await run();
    expect(String(mockToastError.mock.calls[0]?.[0])).toContain("disk on fire");
  });

  it("reports a folder picker that fails instead of letting it escape", async () => {
    openDoc("/repo/a.md");
    mockOpen.mockRejectedValue(new Error("dialog unavailable"));
    await expect(run()).resolves.toBe(true);
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(String(mockToastError.mock.calls[0]?.[0])).toContain("dialog unavailable");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("exports the document under its new path when it is saved as during the picker", async () => {
    const tabId = openDoc("/repo/old.md");
    mockOpen.mockImplementation(async () => {
      useDocumentStore.getState().setFilePath(tabId, "/repo/new.md");
      return "/repo";
    });
    mockInvoke.mockResolvedValue(report(1));
    await run();
    expect(mockInvoke).toHaveBeenCalledWith("agent_journal_git_export", {
      payload: JSON.stringify({ docKey: "path:/repo/new.md", repository: "/repo" }),
    });
  });

  it("exports nothing when the document closes during the picker, even if its path is reopened", async () => {
    const tabId = openDoc("/repo/a.md");
    mockOpen.mockImplementation(async () => {
      useTabStore.getState().closeTab("main", tabId);
      useDocumentStore.getState().removeDocument(tabId);
      openDoc("/repo/a.md"); // a different document at the old path
      return "/repo";
    });
    mockInvoke.mockResolvedValue(report(1));
    await run();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("exports nothing when a clean untitled tab is reused for another file during the picker", async () => {
    const tabId = openDoc(null);
    mockOpen.mockImplementation(async () => {
      useDocumentStore.getState().ingestExternalContent(tabId, "other", "disk-open", {
        filePath: "/repo/other.md",
      });
      return "/repo";
    });
    mockInvoke.mockResolvedValue(report(1));
    await run();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("exports nothing when a saved tab is replaced by another file during the picker", async () => {
    const tabId = openDoc("/repo/a.md");
    mockOpen.mockImplementation(async () => {
      useDocumentStore.getState().ingestExternalContent(tabId, "b", "disk-open", {
        filePath: "/repo/b.md",
      });
      return "/repo";
    });
    mockInvoke.mockResolvedValue(report(1));
    await run();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("still exports when the same file is reloaded from disk during the picker", async () => {
    const tabId = openDoc("/repo/a.md");
    mockOpen.mockImplementation(async () => {
      useDocumentStore.getState().ingestExternalContent(tabId, "changed on disk", "disk-open");
      return "/repo";
    });
    mockInvoke.mockResolvedValue(report(1));
    await run();
    expect(mockInvoke).toHaveBeenCalledWith("agent_journal_git_export", {
      payload: JSON.stringify({ docKey: "path:/repo/a.md", repository: "/repo" }),
    });
  });

  it("runs one export at a time per window when triggered rapidly", async () => {
    openDoc("/repo/a.md");
    let release!: (v: unknown) => void;
    mockOpen.mockReturnValue(new Promise((r) => (release = r)));
    mockInvoke.mockResolvedValue(report(1));
    const first = run();
    const second = run();
    release("/repo");
    await Promise.all([first, second]);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
