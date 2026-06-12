// WI-2.3 — tests for the file-link → editor-jump wiring (G5).
// Verifies the activate callback opens a tab, seeds the doc, and carries the
// :line nav; plus the oversized-file and stat-failure guards. Link *detection*
// is covered by fileLinkProvider.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Terminal } from "@xterm/xterm";

const h = vi.hoisted(() => ({
  captured: { fn: null as null | ((filePath: string, line?: number) => void) },
  stat: vi.fn(async (_p: string) => ({ size: 1024 })),
  readTextFile: vi.fn(async (_p: string) => "file contents"),
  createTab: vi.fn(() => "tab-1"),
  initDocument: vi.fn(),
  setPendingContentSearchNav: vi.fn(),
}));

vi.mock("./fileLinkProvider", () => ({
  createFileLinkProvider: (
    _term: unknown,
    onActivate: (filePath: string, line?: number) => void,
  ) => {
    h.captured.fn = onActivate;
    return { provideLinks: vi.fn() };
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ stat: h.stat, readTextFile: h.readTextFile }));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ createTab: h.createTab }) },
}));
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ initDocument: h.initDocument }) },
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/hooks/contentSearchNavigation", () => ({
  setPendingContentSearchNav: h.setPendingContentSearchNav,
}));

import { setupFileLinks } from "./setupFileLinks";

function makeTerm(): Terminal {
  return { registerLinkProvider: vi.fn(), writeln: vi.fn() } as unknown as Terminal;
}

describe("setupFileLinks — activate wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.captured.fn = null;
    h.stat.mockResolvedValue({ size: 1024 });
    h.readTextFile.mockResolvedValue("file contents");
  });

  it("opens a tab, seeds the document, and carries the :line nav", async () => {
    const term = makeTerm();
    setupFileLinks(term);
    expect(h.captured.fn).toBeTypeOf("function");

    h.captured.fn!("/work/src/main.ts", 42);
    await vi.waitFor(() =>
      expect(h.setPendingContentSearchNav).toHaveBeenCalledWith("tab-1", 42, ""),
    );
    expect(h.createTab).toHaveBeenCalledWith("main", "/work/src/main.ts");
    expect(h.initDocument).toHaveBeenCalledWith("tab-1", "file contents", "/work/src/main.ts");
  });

  it("does not set nav when no line / line 0 is parsed", async () => {
    const term = makeTerm();
    setupFileLinks(term);
    h.captured.fn!("/work/src/main.ts");
    await vi.waitFor(() => expect(h.createTab).toHaveBeenCalled());
    expect(h.setPendingContentSearchNav).not.toHaveBeenCalled();

    vi.clearAllMocks();
    h.captured.fn!("/work/src/main.ts", 0);
    await vi.waitFor(() => expect(h.createTab).toHaveBeenCalled());
    expect(h.setPendingContentSearchNav).not.toHaveBeenCalled();
  });

  it("refuses files over the 10MB cap (no read, no tab, warns)", async () => {
    h.stat.mockResolvedValue({ size: 11 * 1024 * 1024 });
    const term = makeTerm();
    setupFileLinks(term);
    h.captured.fn!("/work/huge.log", 1);
    await vi.waitFor(() =>
      expect(term.writeln).toHaveBeenCalledWith(expect.stringContaining("File too large")),
    );
    expect(h.readTextFile).not.toHaveBeenCalled();
    expect(h.createTab).not.toHaveBeenCalled();
  });

  it("surfaces a stat failure into the terminal and opens nothing", async () => {
    h.stat.mockRejectedValue(new Error("permission denied"));
    const term = makeTerm();
    setupFileLinks(term);
    h.captured.fn!("/work/secret", 1);
    await vi.waitFor(() =>
      expect(term.writeln).toHaveBeenCalledWith(expect.stringContaining("Cannot open file")),
    );
    expect(h.createTab).not.toHaveBeenCalled();
  });
});
