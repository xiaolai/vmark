// @vitest-environment node
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
const mockToastError = vi.fn();
const mockOpenUrl = vi.fn();

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
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...a: unknown[]) => mockOpenUrl(...a),
}));
vi.mock("@/export/pandocExport", () => ({
  PANDOC_FORMAT_KEYS: ["docx", "epub"] as const,
  exportViaPandoc: (...a: unknown[]) => mockExportViaPandoc(...a),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: (...a: unknown[]) => mockToastError(...a), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import {
  executeCommand,
  listCommands,
  getCommand,
  searchCommands,
  _resetCommandBus,
} from "./CommandBus";
import {
  registerExportCommands,
  registerPandocFormatCommands,
} from "./exportCommands";

beforeEach(() => {
  _resetCommandBus();
  [mockGetActiveDocument, mockFlush, mockExportToHtml, mockCopyAsHtml, mockExportViaPandoc, mockToastError, mockOpenUrl]
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
    // Simulate Vite HMR: the registrar module re-instantiates while
    // CommandBus's REGISTRY survives. Owner registration is replace-own, so a
    // second call converges on exactly this batch rather than colliding.
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
  // Audit R2 (#704): the path travels with the content — it is what a relative
  // image in the copied markup resolves against.
  it("copies the active document's content, with the path it is relative to", async () => {
    await executeCommand("export.copyHtml", undefined, { windowLabel: "main" });

    expect(mockCopyAsHtml).toHaveBeenCalledWith("# Hi", "/docs/note.md");
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
    expect(mockToastError).toHaveBeenCalled();
  });
});

// Audit #896 — a command whose prerequisite is absent must SAY so, not report a
// successful dispatch and do nothing. `when` is honoured by the palette's
// search and by executeCommand alike.
describe("availability: no active document", () => {
  beforeEach(() => {
    mockGetActiveDocument.mockReturnValue(null);
  });

  it("refuses the dispatch instead of reporting success", async () => {
    await expect(
      executeCommand("export.html", undefined, { windowLabel: "main" }),
    ).resolves.toBe(false);
    expect(mockExportToHtml).not.toHaveBeenCalled();
  });

  it("drops the document exports out of the palette, keeping the Pandoc hint", () => {
    const ids = searchCommands("export", { windowLabel: "main" }).map((r) => r.command.id);
    expect(ids).not.toContain("export.html");
    expect(ids).not.toContain("export.copyHtml");
    expect(ids).toContain("export.pandocHint");
  });

  it("offers them again once a document is open", () => {
    mockGetActiveDocument.mockReturnValue({ content: "# Hi", filePath: "/docs/note.md" });
    const ids = searchCommands("export", { windowLabel: "main" }).map((r) => r.command.id);
    expect(ids).toContain("export.html");
  });
});

// Audit #895 — the flush used to run BEFORE the re-entry guard, so a click the
// guard rejected still mutated the document store under the export already
// running.
describe("the re-entry guard covers the WYSIWYG flush", () => {
  it("a refused second export does not flush again", async () => {
    let release!: () => void;
    mockExportToHtml.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    const first = executeCommand("export.html", undefined, { windowLabel: "main" });
    try {
      // Wait until the first export is genuinely in flight. The handler reaches
      // its exporter through a dynamic import, so "the lock is held" is several
      // microtasks after the call — and releasing before then would leave the
      // window's export guard locked for every later test in this file.
      await vi.waitFor(() => expect(mockExportToHtml).toHaveBeenCalled());

      await executeCommand("export.copyHtml", undefined, { windowLabel: "main" });

      expect(mockFlush).toHaveBeenCalledTimes(1);
      expect(mockCopyAsHtml).not.toHaveBeenCalled();
    } finally {
      release();
      await first;
    }
  });

  it("contains a throwing flusher instead of rejecting the dispatch", async () => {
    mockFlush.mockImplementationOnce(() => {
      throw new Error("editor gone");
    });

    await expect(
      executeCommand("export.html", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(mockToastError).toHaveBeenCalled();
  });
});

// Audit #897 — the eager exports only logged their failures while the Pandoc
// path toasted its own, so one shared envelope had already drifted in two.
describe("failure reporting is the same for every export", () => {
  it("toasts an eager export failure, not only a log line", async () => {
    mockExportToHtml.mockRejectedValue(new Error("disk full"));

    await expect(
      executeCommand("export.html", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it("toasts a lazy-chunk load failure the same way", async () => {
    mockCopyAsHtml.mockRejectedValue(new Error("Failed to fetch dynamically imported module"));

    await executeCommand("export.copyHtml", undefined, { windowLabel: "main" });

    expect(mockToastError).toHaveBeenCalledTimes(1);
  });
});

// Audit #900 — the Pandoc hint opened a URL with no catch at all: a refusal
// from the opener plugin was neither logged nor shown, and rejected the
// dispatch on its way out.
describe("export.pandocHint", () => {
  it("opens the install page", async () => {
    mockOpenUrl.mockResolvedValue(undefined);

    await expect(
      executeCommand("export.pandocHint", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(mockOpenUrl).toHaveBeenCalledWith("https://pandoc.org/installing.html");
  });

  it("reports a refusal from the opener instead of rejecting", async () => {
    mockOpenUrl.mockRejectedValue(new Error("no handler registered for https"));

    await expect(
      executeCommand("export.pandocHint", undefined, { windowLabel: "main" }),
    ).resolves.toBe(true);
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });
});
