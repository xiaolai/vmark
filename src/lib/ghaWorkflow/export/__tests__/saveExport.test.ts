// RW-7 (L3) — wire GHA workflow export to UI
//
// Tests the side-effecting export glue: clipboard copy for Mermaid, and
// data-URI → bytes → Tauri save-dialog → writeFile for SVG/PNG. The pure
// render functions (toMermaid / exportCanvas) have their own tests; here
// we only verify the I/O wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));
vi.mock("../toImage", () => ({
  exportCanvas: vi.fn(),
}));

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { exportCanvas } from "../toImage";
import { copyMermaid, saveImage } from "../saveExport";

const mockSave = save as unknown as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>;
const mockExportCanvas = exportCanvas as unknown as ReturnType<typeof vi.fn>;

describe("copyMermaid", () => {
  const writeText = vi.fn(async () => undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it("writes the mermaid string to the clipboard and returns true", async () => {
    const ok = await copyMermaid("flowchart TD\n  a-->b");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("flowchart TD\n  a-->b");
  });

  it("returns false when the clipboard write rejects", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const ok = await copyMermaid("x");
    expect(ok).toBe(false);
  });
});

describe("saveImage", () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockWriteFile.mockReset();
    mockExportCanvas.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders PNG, prompts a save dialog, and writes decoded base64 bytes", async () => {
    // "data:image/png;base64," + base64("PNG") => "UE5H"
    mockExportCanvas.mockResolvedValue("data:image/png;base64,UE5H");
    mockSave.mockResolvedValue("/tmp/workflow.png");

    const result = await saveImage("png");

    expect(result).toBe("saved");
    expect(mockExportCanvas).toHaveBeenCalledWith("png");
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "workflow.png" }),
    );
    const [, bytes] = mockWriteFile.mock.calls[0];
    expect(Array.from(bytes as Uint8Array)).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  });

  it("decodes a URL-encoded (non-base64) SVG data URI", async () => {
    mockExportCanvas.mockResolvedValue(
      "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E",
    );
    mockSave.mockResolvedValue("/tmp/workflow.svg");

    const result = await saveImage("svg");

    expect(result).toBe("saved");
    const [, bytes] = mockWriteFile.mock.calls[0];
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe("<svg></svg>");
  });

  it("returns 'cancelled' and does not write when the dialog is dismissed", async () => {
    mockExportCanvas.mockResolvedValue("data:image/png;base64,UE5H");
    mockSave.mockResolvedValue(null);

    const result = await saveImage("png");

    expect(result).toBe("cancelled");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("propagates a render failure so the caller can surface it", async () => {
    mockExportCanvas.mockRejectedValue(new Error("no viewport"));
    await expect(saveImage("svg")).rejects.toThrow(/viewport/);
  });
});
