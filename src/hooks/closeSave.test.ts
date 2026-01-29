import { describe, it, expect, beforeEach, vi } from "vitest";
import { message, save, open } from "@tauri-apps/plugin-dialog";
import { saveToPath } from "@/utils/saveToPath";
import {
  promptSaveForDirtyDocument,
  promptSaveForMultipleDocuments,
  saveAllDocuments,
} from "@/hooks/closeSave";

vi.mock("@/utils/saveToPath", () => ({
  saveToPath: vi.fn(),
}));

const WINDOW_LABEL = "main";

describe("promptSaveForDirtyDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cancelled when user clicks Cancel", async () => {
    // message() with yes/no/cancel buttons returns 'Cancel' when user cancels
    vi.mocked(message).mockResolvedValueOnce("Cancel");

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Untitled",
      filePath: "/tmp/test.md",
      content: "content",
    });

    expect(result.action).toBe("cancelled");
  });

  it("returns discarded when user chooses Don't Save (No)", async () => {
    // message() returns 'No' when user clicks "Don't Save"
    vi.mocked(message).mockResolvedValueOnce("No");

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Untitled",
      filePath: "/tmp/test.md",
      content: "content",
    });

    expect(result.action).toBe("discarded");
  });

  it("returns discarded when dialog returns custom button label (Don't Save)", async () => {
    vi.mocked(message).mockResolvedValueOnce("Don't Save");

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Untitled",
      filePath: "/tmp/test.md",
      content: "content",
    });

    expect(result.action).toBe("discarded");
  });

  it("saves to existing path when user chooses Save (Yes)", async () => {
    // message() returns 'Yes' when user clicks "Save"
    vi.mocked(message).mockResolvedValueOnce("Yes");
    vi.mocked(saveToPath).mockResolvedValueOnce(true);

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Doc",
      filePath: "/tmp/test.md",
      content: "content",
    });

    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/test.md", "content", "manual");
    expect(result.action).toBe("saved");
    if (result.action === "saved") {
      expect(result.path).toBe("/tmp/test.md");
    }
  });

  it("saves to existing path when dialog returns custom button label (Save)", async () => {
    vi.mocked(message).mockResolvedValueOnce("Save");
    vi.mocked(saveToPath).mockResolvedValueOnce(true);

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Doc",
      filePath: "/tmp/test.md",
      content: "content",
    });

    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/test.md", "content", "manual");
    expect(result.action).toBe("saved");
    if (result.action === "saved") {
      expect(result.path).toBe("/tmp/test.md");
    }
  });

  it("returns cancelled when Save As dialog is cancelled", async () => {
    vi.mocked(message).mockResolvedValueOnce("Yes");
    vi.mocked(save).mockResolvedValueOnce(null);

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Untitled",
      filePath: null,
      content: "content",
    });

    expect(result.action).toBe("cancelled");
  });

  it("returns cancelled when saveToPath fails", async () => {
    vi.mocked(message).mockResolvedValueOnce("Yes");
    vi.mocked(save).mockResolvedValueOnce("/tmp/new.md");
    vi.mocked(saveToPath).mockResolvedValueOnce(false);

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Untitled",
      filePath: null,
      content: "content",
    });

    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/new.md", "content", "manual");
    expect(result.action).toBe("cancelled");
  });
});

describe("promptSaveForMultipleDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createContext = (id: string, filePath: string | null = "/tmp/test.md") => ({
    windowLabel: WINDOW_LABEL,
    tabId: id,
    title: filePath ? `Doc ${id}` : `Untitled ${id}`,
    filePath,
    content: `content ${id}`,
  });

  it("returns saved-all for empty array", async () => {
    const result = await promptSaveForMultipleDocuments([]);
    expect(result.action).toBe("saved-all");
    expect(message).not.toHaveBeenCalled();
  });

  it("returns cancelled when user clicks Cancel", async () => {
    vi.mocked(message).mockResolvedValueOnce("Cancel");

    const result = await promptSaveForMultipleDocuments([
      createContext("1"),
      createContext("2"),
    ]);

    expect(result.action).toBe("cancelled");
  });

  it("returns discarded-all when user clicks Don't Save", async () => {
    vi.mocked(message).mockResolvedValueOnce("Don't Save");

    const result = await promptSaveForMultipleDocuments([
      createContext("1"),
      createContext("2"),
    ]);

    expect(result.action).toBe("discarded-all");
  });

  it("saves all documents with existing paths when user clicks Save All", async () => {
    vi.mocked(message).mockResolvedValueOnce("Save All");
    vi.mocked(saveToPath).mockResolvedValue(true);

    const result = await promptSaveForMultipleDocuments([
      createContext("1", "/tmp/doc1.md"),
      createContext("2", "/tmp/doc2.md"),
    ]);

    expect(saveToPath).toHaveBeenCalledTimes(2);
    expect(saveToPath).toHaveBeenCalledWith("1", "/tmp/doc1.md", "content 1", "manual");
    expect(saveToPath).toHaveBeenCalledWith("2", "/tmp/doc2.md", "content 2", "manual");
    expect(result.action).toBe("saved-all");
  });

  it("prompts Save As for untitled documents", async () => {
    vi.mocked(message).mockResolvedValueOnce("Save All");
    vi.mocked(save).mockResolvedValueOnce("/tmp/saved.md");
    vi.mocked(saveToPath).mockResolvedValue(true);

    const result = await promptSaveForMultipleDocuments([
      createContext("1", null), // Untitled
    ]);

    expect(save).toHaveBeenCalled();
    expect(saveToPath).toHaveBeenCalledWith("1", "/tmp/saved.md", "content 1", "manual");
    expect(result.action).toBe("saved-all");
  });

  it("returns cancelled if Save As is cancelled for untitled document", async () => {
    vi.mocked(message).mockResolvedValueOnce("Save All");
    vi.mocked(save).mockResolvedValueOnce(null); // User cancelled Save As

    const result = await promptSaveForMultipleDocuments([
      createContext("1", null), // Untitled
    ]);

    expect(result.action).toBe("cancelled");
    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("returns cancelled if any save fails", async () => {
    vi.mocked(message).mockResolvedValueOnce("Save All");
    vi.mocked(saveToPath)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false); // Second save fails

    const result = await promptSaveForMultipleDocuments([
      createContext("1", "/tmp/doc1.md"),
      createContext("2", "/tmp/doc2.md"),
    ]);

    expect(result.action).toBe("cancelled");
  });

  it("uses batch folder picker for multiple untitled documents", async () => {
    vi.mocked(message).mockResolvedValueOnce("Save All");
    vi.mocked(open).mockResolvedValueOnce("/tmp/chosen-folder");
    vi.mocked(saveToPath).mockResolvedValue(true);

    const result = await promptSaveForMultipleDocuments([
      createContext("1", null), // Untitled 1
      createContext("2", null), // Untitled 2
    ]);

    // Should use open() for folder picker, not save() for each file
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      directory: true,
      multiple: false,
    }));
    expect(save).not.toHaveBeenCalled();
    expect(saveToPath).toHaveBeenCalledTimes(2);
    expect(saveToPath).toHaveBeenCalledWith("1", "/tmp/chosen-folder/Untitled 1.md", "content 1", "manual");
    expect(saveToPath).toHaveBeenCalledWith("2", "/tmp/chosen-folder/Untitled 2.md", "content 2", "manual");
    expect(result.action).toBe("saved-all");
  });

  it("returns cancelled if batch folder picker is cancelled", async () => {
    vi.mocked(message).mockResolvedValueOnce("Save All");
    vi.mocked(open).mockResolvedValueOnce(null);

    const result = await promptSaveForMultipleDocuments([
      createContext("1", null),
      createContext("2", null),
    ]);

    expect(result.action).toBe("cancelled");
    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("shows path info in dialog message", async () => {
    vi.mocked(message).mockResolvedValueOnce("Cancel");

    await promptSaveForMultipleDocuments([
      createContext("1", "/projects/docs/doc1.md"),
      createContext("2", null), // Untitled
    ]);

    // Check that the message includes path context and "(new)" indicator
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("(new)"),
      expect.anything()
    );
  });
});

describe("saveAllDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createContext = (id: string, filePath: string | null = "/tmp/test.md") => ({
    windowLabel: "main",
    tabId: id,
    title: filePath ? `Doc ${id}` : `Untitled ${id}`,
    filePath,
    content: `content ${id}`,
  });

  it("returns saved-all for empty array without prompts", async () => {
    const result = await saveAllDocuments([]);
    expect(result.action).toBe("saved-all");
    expect(message).not.toHaveBeenCalled();
    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("saves all documents with paths without prompting", async () => {
    vi.mocked(saveToPath).mockResolvedValue(true);

    const result = await saveAllDocuments([
      createContext("1", "/tmp/doc1.md"),
      createContext("2", "/tmp/doc2.md"),
    ]);

    expect(message).not.toHaveBeenCalled();
    expect(saveToPath).toHaveBeenCalledTimes(2);
    expect(result.action).toBe("saved-all");
  });

  it("uses batch folder picker for multiple untitled", async () => {
    vi.mocked(open).mockResolvedValueOnce("/tmp/folder");
    vi.mocked(saveToPath).mockResolvedValue(true);

    const result = await saveAllDocuments([
      createContext("1", null),
      createContext("2", null),
    ]);

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect(save).not.toHaveBeenCalled();
    expect(result.action).toBe("saved-all");
  });

  it("calls progress callback", async () => {
    vi.mocked(saveToPath).mockResolvedValue(true);
    const onProgress = vi.fn();

    await saveAllDocuments(
      [createContext("1", "/tmp/doc1.md"), createContext("2", "/tmp/doc2.md")],
      { onProgress }
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(1, 2, "Doc 1");
    expect(onProgress).toHaveBeenCalledWith(2, 2, "Doc 2");
  });
});
