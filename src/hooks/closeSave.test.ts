import { describe, it, expect, beforeEach, vi } from "vitest";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { saveToPath } from "@/utils/saveToPath";
import { promptSaveForDirtyDocument } from "@/hooks/closeSave";

vi.mock("@/utils/saveToPath", () => ({
  saveToPath: vi.fn(),
}));

const WINDOW_LABEL = "main";

describe("promptSaveForDirtyDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cancelled when user dismisses prompt", async () => {
    vi.mocked(ask).mockResolvedValueOnce(null);

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Untitled",
      filePath: "/tmp/test.md",
      content: "content",
    });

    expect(result.action).toBe("cancelled");
  });

  it("returns discarded when user chooses Don't Save", async () => {
    vi.mocked(ask).mockResolvedValueOnce(false);

    const result = await promptSaveForDirtyDocument({
      windowLabel: WINDOW_LABEL,
      tabId: "tab-1",
      title: "Untitled",
      filePath: "/tmp/test.md",
      content: "content",
    });

    expect(result.action).toBe("discarded");
  });

  it("saves to existing path when user chooses Save", async () => {
    vi.mocked(ask).mockResolvedValueOnce(true);
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
    expect(result.path).toBe("/tmp/test.md");
  });

  it("returns cancelled when Save As dialog is cancelled", async () => {
    vi.mocked(ask).mockResolvedValueOnce(true);
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
    vi.mocked(ask).mockResolvedValueOnce(true);
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
