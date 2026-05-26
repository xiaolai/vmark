import { describe, it, expect, vi, beforeEach } from "vitest";

const messageMock = vi.fn(async () => {});
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: (text: string, opts: unknown) => messageMock(text, opts),
}));

import { showError, FileErrors } from "./errorDialog";

beforeEach(() => {
  messageMock.mockClear();
});

describe("showError", () => {
  it("calls Tauri message with title only when no description", async () => {
    await showError("Boom");
    expect(messageMock).toHaveBeenCalledWith("Boom", { title: "Error", kind: "error" });
  });

  it("appends description on two new lines when provided", async () => {
    await showError("Boom", "more detail");
    expect(messageMock).toHaveBeenCalledWith("Boom\n\nmore detail", { title: "Error", kind: "error" });
  });
});

describe("FileErrors", () => {
  it("formats file/folder exists messages", () => {
    expect(FileErrors.fileExists("a.md")).toBe('A file named "a.md" already exists.');
    expect(FileErrors.folderExists("docs")).toBe('A folder named "docs" already exists.');
  });

  it("formats operation-failed messages", () => {
    expect(FileErrors.createFailed("x")).toBe('Failed to create "x".');
    expect(FileErrors.renameFailed("x")).toBe('Failed to rename "x".');
    expect(FileErrors.deleteFailed("x")).toBe('Failed to delete "x".');
    expect(FileErrors.moveFailed("x")).toBe('Failed to move "x".');
    expect(FileErrors.duplicateFailed("x")).toBe('Failed to duplicate "x".');
    expect(FileErrors.tooManyCopies("x")).toBe('Too many copies of "x" exist. Please delete some first.');
  });

  it("exposes static copyFailed string", () => {
    expect(FileErrors.copyFailed).toBe("Failed to copy to clipboard.");
  });

  it("formats exportFailed with format name", () => {
    expect(FileErrors.exportFailed("PDF")).toBe("Failed to export to PDF.");
  });
});
