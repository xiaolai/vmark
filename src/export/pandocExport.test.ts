// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted() so mock variables are available before vi.mock() factories run
const { mockInvoke, mockPick, mockToast } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockPick: vi.fn(),
  mockToast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// The save panel is Rust's (`pick_export_target`, which records the answer as
// the only path `export_via_pandoc` will write); every other command goes to
// `mockInvoke`.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) =>
    cmd === "pick_export_target" ? mockPick(args) : mockInvoke(cmd, ...(args === undefined ? [] : [args])),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/utils/pathUtils", () => ({
  joinPath: (...parts: string[]) => parts.join("/"),
}));

import { exportViaPandoc } from "./pandocExport";
import { PANDOC_FORMAT_KEYS } from "./pandocFormats";

describe("PANDOC_FORMAT_KEYS", () => {
  it("contains all expected formats", () => {
    expect(PANDOC_FORMAT_KEYS).toEqual(["docx", "epub", "latex", "odt", "rtf", "txt"]);
  });

  it("all keys resolve to valid format metadata", async () => {
    for (const key of PANDOC_FORMAT_KEYS) {
      mockInvoke.mockResolvedValueOnce({ available: true, path: "/usr/local/bin/pandoc", version: "3.1.2" });
      mockPick.mockResolvedValueOnce(null);
      // Should not throw "Unknown export format"
      await exportViaPandoc({ markdown: "content", format: key });
      expect(mockToast.error).not.toHaveBeenCalledWith(`Unknown export format: ${key}`);
      vi.clearAllMocks();
    }
  });
});

describe("exportViaPandoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error toast for unknown format", async () => {
    const result = await exportViaPandoc({ markdown: "# Hello", format: "xyz" });
    expect(result).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith("Unknown export format: xyz");
  });

  it("shows error toast when content is empty", async () => {
    const result = await exportViaPandoc({ markdown: "   ", format: "docx" });
    expect(result).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith("No content to export!");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("shows error toast when Pandoc is not installed", async () => {
    mockInvoke.mockResolvedValueOnce({
      available: false,
      path: null,
      version: null,
    });

    const result = await exportViaPandoc({ markdown: "# Hello", format: "docx" });
    expect(result).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("detect_pandoc");
    expect(mockToast.error).toHaveBeenCalledWith(
      "Pandoc is not installed. Install it from pandoc.org",
      { duration: 5000 }
    );
  });

  it("returns false when user cancels save dialog", async () => {
    mockInvoke.mockResolvedValueOnce({
      available: true,
      path: "/usr/local/bin/pandoc",
      version: "3.1.2",
    });
    mockPick.mockResolvedValueOnce(null);

    const result = await exportViaPandoc({ markdown: "# Hello", format: "docx" });
    expect(result).toBe(false);
    // No filters — stripped per macOS Tahoe parity rule (E3)
    expect(mockPick).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "pandoc",
        title: "Export Word Document",
      })
    );
    expect(mockPick).toHaveBeenCalledWith(
      expect.not.objectContaining({ filters: expect.anything() })
    );
  });

  it("exports successfully via Pandoc", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        available: true,
        path: "/usr/local/bin/pandoc",
        version: "3.1.2",
      })
      .mockResolvedValueOnce(undefined);
    mockPick.mockResolvedValueOnce("/tmp/output.docx");

    const result = await exportViaPandoc({ markdown: "# Hello World", format: "docx" });
    expect(result).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("export_via_pandoc", {
      markdown: "# Hello World",
      outputPath: "/tmp/output.docx",
      sourceDir: null,
    });
    expect(mockToast.success).toHaveBeenCalledWith("Exported successfully");
  });

  it("uses correct extension for each format", async () => {
    mockInvoke.mockResolvedValueOnce({
      available: true,
      path: "/usr/local/bin/pandoc",
      version: "3.1.2",
    });
    mockPick.mockResolvedValueOnce(null);

    await exportViaPandoc({ markdown: "content", format: "latex" });
    // No filters — stripped per macOS Tahoe parity rule (E3)
    expect(mockPick).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Export LaTeX",
        defaultPath: "document.tex",
      })
    );
    expect(mockPick).toHaveBeenCalledWith(
      expect.not.objectContaining({ filters: expect.anything() })
    );
  });

  it("shows error toast when Pandoc command fails", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        available: true,
        path: "/usr/local/bin/pandoc",
        version: "3.1.2",
      })
      .mockRejectedValueOnce("Unknown output format");
    mockPick.mockResolvedValueOnce("/tmp/output.xyz");

    const result = await exportViaPandoc({ markdown: "# Hello", format: "docx" });
    expect(result).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining("Pandoc export failed"),
      expect.objectContaining({ action: expect.any(Object) }),
    );
  });

  it("shows error toast when detection invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("IPC error"));

    const result = await exportViaPandoc({ markdown: "# Hello", format: "docx" });
    expect(result).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining("Pandoc export failed"),
      expect.objectContaining({ action: expect.any(Object) }),
    );
  });

  it("passes sourceDirectory to Rust backend", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        available: true,
        path: "/usr/local/bin/pandoc",
        version: "3.1.2",
      })
      .mockResolvedValueOnce(undefined);
    mockPick.mockResolvedValueOnce("/tmp/output.epub");

    await exportViaPandoc({
      markdown: "content",
      format: "epub",
      sourceDirectory: "/Users/test/docs",
    });

    expect(mockInvoke).toHaveBeenCalledWith("export_via_pandoc", {
      markdown: "content",
      outputPath: "/tmp/output.epub",
      sourceDir: "/Users/test/docs",
    });
  });

  it("uses defaultName and defaultDirectory for save dialog path", async () => {
    mockInvoke.mockResolvedValueOnce({
      available: true,
      path: "/usr/local/bin/pandoc",
      version: "3.1.2",
    });
    mockPick.mockResolvedValueOnce(null);

    await exportViaPandoc({
      markdown: "content",
      format: "docx",
      defaultName: "My Doc",
      defaultDirectory: "/Users/test/docs",
    });

    expect(mockPick).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "/Users/test/docs/My Doc.docx",
      })
    );
  });
});
