import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockRenameFile = vi.fn();
const mockShowError = vi.fn();
const mockStopRename = vi.fn();

vi.mock("@/services/persistence/renameFile", () => ({
  renameFile: (...args: unknown[]) => mockRenameFile(...args),
}));

vi.mock("@/services/dialogs/errorDialog", () => ({
  showError: (...args: unknown[]) => mockShowError(...args),
  FileErrors: {
    fileExists: (name: string) => ({ kind: "fileExists", name }),
    folderExists: (name: string) => ({ kind: "folderExists", name }),
    renameFailed: (name: string) => ({ kind: "renameFailed", name }),
  },
}));

vi.mock("@/stores/tabRenameStore", () => ({
  useTabRenameStore: { getState: () => ({ stopRename: mockStopRename }) },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { TabRenameInput } from "./TabRenameInput";

beforeEach(() => {
  vi.clearAllMocks();
  mockRenameFile.mockResolvedValue({ status: "renamed", newPath: "/docs/new.md" });
});

function renderInput() {
  render(<TabRenameInput filePath="/docs/note.md" fileName="note.md" />);
  return screen.getByRole("textbox");
}

describe("TabRenameInput", () => {
  it("prefills the filename and selects the stem (without extension) on focus", () => {
    const input = renderInput() as HTMLInputElement;
    expect(input.value).toBe("note.md");
    // autoFocus + onFocus selection: stem "note" (indices 0..4) selected.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);
  });

  it("commits on Enter via the shared renameFile and exits rename mode", async () => {
    const user = userEvent.setup();
    const input = renderInput();
    await user.clear(input);
    await user.type(input, "renamed{Enter}");
    expect(mockRenameFile).toHaveBeenCalledWith("/docs/note.md", "renamed");
    expect(mockStopRename).toHaveBeenCalled();
  });

  it("cancels on Escape without renaming", async () => {
    const user = userEvent.setup();
    const input = renderInput();
    await user.type(input, "whatever{Escape}");
    expect(mockRenameFile).not.toHaveBeenCalled();
    expect(mockStopRename).toHaveBeenCalled();
  });

  it("does not rename when the name is unchanged", async () => {
    const user = userEvent.setup();
    const input = renderInput();
    await user.type(input, "{Enter}");
    expect(mockRenameFile).not.toHaveBeenCalled();
    expect(mockStopRename).toHaveBeenCalled();
  });

  it("surfaces an error dialog when the target already exists", async () => {
    mockRenameFile.mockResolvedValue({ status: "exists", name: "taken.md", isFile: true });
    const user = userEvent.setup();
    const input = renderInput();
    await user.clear(input);
    await user.type(input, "taken{Enter}");
    expect(mockShowError).toHaveBeenCalledWith({ kind: "fileExists", name: "taken.md" });
    expect(mockStopRename).toHaveBeenCalled();
  });
});
