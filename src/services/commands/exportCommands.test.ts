/**
 * Tests for the export command registrar (ADR-012).
 *
 * Covers registration invariants (full command set, HMR-safe idempotency),
 * representative run paths (active-document lookup, export args, error
 * containment), and the lazy Pandoc format command registration.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mockGetActiveDocument = vi.fn();
const mockFlush = vi.fn();
const mockExportToHtml = vi.fn();
const mockCopyAsHtml = vi.fn();
const mockExportViaPandoc = vi.fn();
const mockSonnerError = vi.fn();

vi.mock("@/services/navigation/activeDocument", () => ({
  getActiveDocument: (...a: unknown[]) => mockGetActiveDocument(...a),
}));
vi.mock("@/utils/wysiwygFlush", () => ({
  flushActiveWysiwygNow: (...a: unknown[]) => mockFlush(...a),
}));
vi.mock("@/export/useExportOperations", () => ({
  exportToHtml: (...a: unknown[]) => mockExportToHtml(...a),
  exportToPdf: vi.fn(),
  exportToPdfNative: vi.fn(),
  copyAsHtml: (...a: unknown[]) => mockCopyAsHtml(...a),
}));
vi.mock("@/export/pandocExport", () => ({
  PANDOC_FORMAT_KEYS: ["docx", "epub"] as const,
  exportViaPandoc: (...a: unknown[]) => mockExportViaPandoc(...a),
}));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockSonnerError(...a) } }));

import { executeCommand, listCommands, getCommand, _resetCommandBus } from "./CommandBus";
import {
  registerExportCommands,
  registerPandocFormatCommands,
  __resetExportCommandsRegistration,
} from "./exportCommands";

beforeEach(() => {
  _resetCommandBus();
  __resetExportCommandsRegistration();
  [mockGetActiveDocument, mockFlush, mockExportToHtml, mockCopyAsHtml, mockExportViaPandoc, mockSonnerError]
    .forEach((m) => m.mockReset());
  mockGetActiveDocument.mockReturnValue({ content: "# Hi", filePath: "/docs/note.md" });
  registerExportCommands();
});

afterEach(() => _resetCommandBus());

describe("registerExportCommands", () => {
  it("registers the 5 export commands", () => {
    const ids = listCommands().map((c) => c.id);
    expect(ids).toEqual([
      "export.html",
      "export.pdf",
      "export.pdfNative",
      "export.copyHtml",
      "export.pandocHint",
    ]);
  });

  it("is idempotent — a second call does not throw on duplicate ids", () => {
    expect(() => registerExportCommands()).not.toThrow();
    expect(getCommand("export.html")).toBeDefined();
  });
});

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("does not throw when the module flag resets but the bus registry survives", () => {
    const before = listCommands().length;
    // Simulate Vite HMR: the registrar module re-instantiates (module-local
    // `registered` flag resets) while CommandBus's REGISTRY survives.
    __resetExportCommandsRegistration();
    expect(() => registerExportCommands()).not.toThrow();
    expect(listCommands().length).toBe(before);
  });
});

describe("export.html run path (representative export handler)", () => {
  it("flushes WYSIWYG and exports the active document with derived name/dir", async () => {
    await executeCommand("export.html", undefined, { windowLabel: "main" });

    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockExportToHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: "# Hi",
        defaultDirectory: "/docs",
        sourceFilePath: "/docs/note.md",
      }),
    );
  });

  it("does nothing when there is no active document", async () => {
    mockGetActiveDocument.mockReturnValue(null);

    await executeCommand("export.html", undefined, { windowLabel: "main" });

    expect(mockExportToHtml).not.toHaveBeenCalled();
  });

  it("contains export failures (logged, command resolves)", async () => {
    mockExportToHtml.mockRejectedValue(new Error("disk full"));

    await expect(
      executeCommand("export.html", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
  });
});

describe("export.copyHtml run path", () => {
  it("copies the active document's content", async () => {
    await executeCommand("export.copyHtml", undefined, { windowLabel: "main" });

    expect(mockCopyAsHtml).toHaveBeenCalledWith("# Hi");
  });
});

describe("registerPandocFormatCommands (lazy per-format registration)", () => {
  it("registers one command per Pandoc format and returns the keys", async () => {
    const keys = await registerPandocFormatCommands();

    expect(keys).toEqual(["docx", "epub"]);
    expect(getCommand("export.pandoc-docx")).toBeDefined();
    expect(getCommand("export.pandoc-epub")).toBeDefined();
  });

  it("is idempotent — re-registration (menu remount) does not throw or duplicate", async () => {
    await registerPandocFormatCommands();
    const before = listCommands().length;

    await expect(registerPandocFormatCommands()).resolves.toEqual(["docx", "epub"]);
    expect(listCommands().length).toBe(before);
  });

  it("executes a format command with the resolved export args", async () => {
    await registerPandocFormatCommands();

    await executeCommand("export.pandoc-docx", undefined, { windowLabel: "main" });

    expect(mockExportViaPandoc).toHaveBeenCalledWith({
      markdown: "# Hi",
      format: "docx",
      defaultName: expect.any(String),
      defaultDirectory: "/docs",
      sourceDirectory: "/docs",
    });
  });

  it("toasts a localized error when the Pandoc export fails", async () => {
    await registerPandocFormatCommands();
    mockExportViaPandoc.mockRejectedValue(new Error("pandoc missing"));

    await expect(
      executeCommand("export.pandoc-epub", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(mockSonnerError).toHaveBeenCalled();
  });
});
