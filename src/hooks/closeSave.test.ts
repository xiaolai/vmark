import { describe, it, expect, beforeEach, vi } from "vitest";
import { message, save } from "@tauri-apps/plugin-dialog";
import { saveToPath } from "@/utils/saveToPath";
import {
  promptSaveForDirtyDocument,
  promptSaveForMultipleDocuments,
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
});
