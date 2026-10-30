// WI-RA14C.5 — the PDF export flow on the webview side: from "Export → PDF" on
// a document to the arguments the Rust `export_pdf` command receives.
//
// REAL: the command bus and `export.pdfNative`, the stores, the off-screen
// ExportSurface (production Tiptap extensions) that renders the markdown, the
// sanitizer, `openPdfExportWindow`, and the page the export window hosts —
// PdfExportPage with the URL it reads, its theme hook, its options, its
// progress listener and its HTML template. The page has no preview by design,
// so the rendered document is asserted in the `html` handed to the renderer.
// FAKED: `@tauri-apps/*` and `sonner` only. The fake disk carries the temp HTML
// file between the two windows; `openExportWindow` builds the page URL the way
// `pdf_export_window.rs` does.
// NOT HERE: the native render (hidden WKWebView / WebView2 / WebKitGTK → PDF
// bytes, then the outline and page-number stamp) and the native save panel are
// outside jsdom — `e2e/journeys/42-pdf-export.mjs` covers the render. The panel
// is Rust's (`pick_export_target`), which records its answer as the one path
// `export_pdf` will write; the stubs below keep that contract, so a page that
// rewrote the answer would be refused here as it is in the app. The `.pdf`
// suffix a bare typed name gains is Rust's, pinned in
// `src-tauri/src/export_target/mod.test.rs`.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

const tauri = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  toasts: [] as Array<{ kind: string; message: unknown; description?: unknown }>,
  window: {
    scaleFactor: () => Promise.resolve(2),
    outerPosition: () => Promise.resolve({ x: 200, y: 100 }),
    outerSize: () => Promise.resolve({ width: 2000, height: 1600 }),
    close: vi.fn(() => Promise.resolve()),
  },
  /** The save panel's answer to each `pick_export_target`. */
  savePanel: vi.fn<(args: Record<string, unknown>) => string | null>(),
  /** The answer Rust recorded — the only path `export_pdf` accepts. */
  chosen: null as string | null,
}));

vi.mock("@tauri-apps/plugin-fs", async () => (await import("@/test/statefulFsFake")).statefulFs.fsModule());
vi.mock("@tauri-apps/api/core", async () => (await import("@/test/statefulFsFake")).statefulFs.coreModule());
vi.mock("@tauri-apps/api/path", async () => {
  const { posix } = await import("node:path");
  const lift = <A extends unknown[]>(fn: (...a: A) => string) => (...a: A) => Promise.resolve(fn(...a));
  return { join: lift(posix.join), dirname: lift(posix.dirname), basename: lift(posix.basename), normalize: lift(posix.normalize) };
});
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => tauri.window }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    const set = tauri.listeners.get(name) ?? new Set();
    tauri.listeners.set(name, set.add(handler));
    return Promise.resolve(() => void set.delete(handler));
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(() => Promise.resolve()) }));
vi.mock("sonner", () => {
  const record = (kind: string) => (message: unknown, opts?: { description?: unknown }) =>
    tauri.toasts.push({ kind, message, description: opts?.description });
  return { toast: { error: record("error"), success: record("success"), warning: record("warning") } };
});

import { openPath } from "@tauri-apps/plugin-opener";
import { statefulFs } from "@/test/statefulFsFake";
import { executeCommand, _resetCommandBus } from "@/services/commands/CommandBus";
import { registerExportCommands } from "@/services/commands/exportCommands";
import { useSettingsStore } from "@/stores/settingsStore";
import { PdfExportPage } from "@/pages/PdfExportPage";
import { bootstrapFormats } from "@/lib/formats/registryBootstrap";
import { WINDOW, ROOT, resetTier0, openDocInTab, newUntitledTab, editDoc } from "./harness";

interface WindowArgs { htmlPath: string; defaultName?: string; x?: number; y?: number }
interface ExportArgs {
  html: string; outputPath: string; headings: Array<{ level: number; text: string }>;
  page: Record<string, number>; pageNumbers: Record<string, unknown> | null;
}

const TEMP_HTML = "/Users/test/.config/temp/vmark-export-tier0.html";
/** CRLF on disk, CJK, and one of each block the PDF must carry as real markup. */
const MARKDOWN =
  "# 季度报告 Q3\r\n\r\n第一段：中文正文。\r\n\r\n## Details\r\n\r\n```js\r\nconst x = 1;\r\n```\r\n\r\n| 名称 | 数量 |\r\n| --- | --- |\r\n| 苹果 | 3 |\r\n";

let windowsOpened: WindowArgs[];
let exportsStarted: ExportArgs[];
/** What the Rust `export_pdf` command answers with; replaced per test. */
let exportReply: () => unknown;

/**
 * "Export → PDF" on the window's active document, through the command bus.
 * The command mounts its OWN off-screen React root and resolves only once that
 * root has rendered, so it cannot run inside `act` (which holds renders back
 * until its callback settles); the flag says so rather than leaving a warning.
 */
async function chooseExportPdf(): Promise<boolean> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
  const previous = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await executeCommand("export.pdfNative", undefined, { windowLabel: WINDOW });
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

/** Open a document from disk and choose Export → PDF on it. */
async function requestExport(markdown = MARKDOWN): Promise<void> {
  await openDocInTab(`${ROOT}/report.md`, markdown);
  await chooseExportPdf();
}

/** What Rust does with `open_pdf_export_window`: load the page at this URL. */
async function openExportWindow(): Promise<{ user: UserEvent; exportButton: HTMLElement }> {
  const args = windowsOpened.at(-1);
  if (!args) throw new Error("no export window was requested");
  const name = args.defaultName ? `&defaultName=${encodeURIComponent(args.defaultName)}` : "";
  window.history.pushState(null, "", `/pdf-export?htmlPath=${encodeURIComponent(args.htmlPath)}${name}`);
  cleanup(); // the app replaces a previous export window, never stacks them
  render(<PdfExportPage />);
  return { user: userEvent.setup(), exportButton: await screen.findByRole("button", { name: "Export PDF" }) };
}

/** One export per window, as in the app: success closes it and never re-arms the button. */
async function exportOnce(configure: (user: UserEvent) => Promise<void> = async () => {}): Promise<ExportArgs> {
  const { user, exportButton } = await openExportWindow();
  await configure(user);
  const before = exportsStarted.length;
  await user.click(exportButton);
  await waitFor(() => expect(exportsStarted).toHaveLength(before + 1));
  return exportsStarted[before];
}

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const texts = (doc: Document, selector: string) => Array.from(doc.querySelectorAll(selector), (el) => el.textContent);
const option = (name: string) => screen.getByRole("combobox", { name });
const open = (user: UserEvent, section: string) => user.click(screen.getByRole("button", { name: section }));
const points = (value: number) => expect.closeTo(value, 2);

beforeAll(() => bootstrapFormats());

beforeEach(() => {
  resetTier0();
  _resetCommandBus();
  registerExportCommands();
  windowsOpened = [];
  exportsStarted = [];
  exportReply = () => ({ warnings: [] });
  tauri.toasts.length = 0;
  tauri.listeners.clear();
  tauri.window.close.mockClear();
  tauri.savePanel.mockReset().mockReturnValue("/Users/test/Documents/report.pdf");
  tauri.chosen = null;
  vi.mocked(openPath).mockClear();
  useSettingsStore.setState((s) => ({ appearance: { ...s.appearance, theme: "paper", followSystemAppearance: false } }));
  statefulFs.stubCommand("set_native_theme", () => undefined); // OS chrome only
  statefulFs.stubCommand("write_temp_html", ({ html }) => (statefulFs.seed(TEMP_HTML, String(html)), TEMP_HTML));
  statefulFs.stubCommand("open_pdf_export_window", (args) => (windowsOpened.push(args as unknown as WindowArgs), "pdf-export"));
  statefulFs.stubCommand("pick_export_target", (args) => (tauri.chosen = tauri.savePanel(args)));
  statefulFs.stubCommand("export_pdf", (args) => {
    // Rust spends the recorded choice: one export per answer, that path only.
    const chosen = tauri.chosen;
    tauri.chosen = null;
    if (args.outputPath !== chosen) {
      return Promise.reject({ code: "permission-denied", message: "Export only to the location chosen in the save dialog." });
    }
    exportsStarted.push(args as unknown as ExportArgs);
    return exportReply();
  });
});

afterEach(() => {
  cleanup();
  window.history.pushState(null, "", "/");
  document.documentElement.classList.remove("dark-theme", "dark");
});

describe("PDF export — from the document to the renderer", () => {
  it("hands the renderer the document as rendered markup, with the chosen path and default geometry", async () => {
    tauri.savePanel.mockReturnValue("/Users/test/Documents/季度报告.pdf");
    await requestExport();
    // Centred over the calling window, in LOGICAL pixels (scale factor 2).
    expect(windowsOpened).toEqual([{ htmlPath: TEMP_HTML, defaultName: "季度报告 Q3", x: 380, y: 130 }]);

    const sent = await exportOnce();
    await waitFor(() => expect(tauri.window.close).toHaveBeenCalledTimes(1));

    expect(tauri.savePanel.mock.calls[0]?.[0]).toMatchObject({ kind: "pdf", defaultPath: "季度报告 Q3.pdf" });
    const doc = parse(sent.html);
    expect(texts(doc, ".export-surface-editor h1")).toEqual(["季度报告 Q3"]);
    expect(texts(doc, ".export-surface-editor > p")).toContain("第一段：中文正文。");
    expect(texts(doc, "pre code.language-js")).toEqual(["const x = 1;"]);
    expect(texts(doc, "table th")).toEqual(["名称", "数量"]);
    expect(texts(doc, "table td")).toEqual(["苹果", "3"]);
    // Markup, not markdown: no fence, no pipe row, no ATX marker, no CR.
    for (const raw of ["```", "| 名称", "# 季度报告", "\r"]) expect(doc.body.textContent).not.toContain(raw);
    expect(sent.html).toMatch(/@page\s*{\s*size: A4 portrait;\s*margin: 25\.4mm 25\.4mm 25\.4mm 25\.4mm;/);
    // The panel returned a bare name; the suffix is guaranteed before Rust sees it.
    expect(sent.outputPath).toBe("/Users/test/Documents/季度报告.pdf");
    expect(sent.headings).toEqual([{ level: 1, text: "季度报告 Q3" }, { level: 2, text: "Details" }]);
    expect(sent.page).toEqual({
      widthPt: 595.28, heightPt: 841.89,
      marginTopPt: points(72), marginRightPt: points(72), marginBottomPt: points(72), marginLeftPt: points(72),
    });
    expect(sent.pageNumbers).toEqual({
      position: "bottom-center", format: "plain", skipFirst: false, fontSizePt: points(9.35),
      bottomMarginPt: points(72), sideMarginPt: points(72), verboseTemplate: "Page {n} of {total}", inkRgb: [0, 0, 0],
    });
    expect(exportsStarted).toHaveLength(1);
    expect(tauri.toasts).toEqual([{ kind: "success", message: "PDF exported successfully", description: undefined }]);
    expect(openPath).toHaveBeenCalledWith(sent.outputPath);
  });

  it("sends the options changed in the page: size, orientation, margins, typography, page numbers", async () => {
    await requestExport();
    const sent = await exportOnce(async (user) => {
      await user.selectOptions(option("Size"), "letter");
      await user.selectOptions(option("Orientation"), "landscape");
      await user.selectOptions(option("Margins"), "narrow");
      // Margin fields in DOM order: top, left, right, bottom.
      await user.type(screen.getAllByRole("spinbutton")[1], "40", { initialSelectionStart: 0, initialSelectionEnd: 4 });
      await open(user, "Typography");
      await user.selectOptions(option("Font Size"), "14");
      await open(user, "Page Numbers");
      await user.selectOptions(option("Position"), "bottom-right");
      await user.selectOptions(option("Format"), "verbose");
      await user.click(screen.getByRole("switch", { name: "Skip first page" }));
    });

    expect(sent.page).toEqual({
      widthPt: 792, heightPt: 612, // Letter, turned
      marginTopPt: points(36), marginRightPt: points(36), marginBottomPt: points(36), marginLeftPt: points(113.39),
    });
    expect(sent.pageNumbers).toMatchObject({
      position: "bottom-right", format: "verbose", skipFirst: true, fontSizePt: points(11.9),
      bottomMarginPt: points(36), sideMarginPt: points(36),
    });
    // The stylesheet the webview paginates with says the same thing as the data.
    expect(sent.html).toMatch(/@page\s*{\s*size: letter landscape;\s*margin: 12\.7mm 12\.7mm 12\.7mm 40mm;/);
    expect(sent.html).toContain("--editor-font-size: 14pt;");
  });

  it("the editor's dark theme travels only when asked for, and page numbers can be turned off", async () => {
    useSettingsStore.setState((s) => ({ appearance: { ...s.appearance, theme: "night" } }));
    await requestExport();

    const forcedLight = await exportOnce();
    expect(parse(forcedLight.html).documentElement.className).toBe("");
    expect(forcedLight.pageNumbers).toMatchObject({ inkRgb: [0, 0, 0] });

    const asEdited = await exportOnce(async (user) => {
      await open(user, "Appearance");
      await user.click(screen.getByRole("switch", { name: "Use Editor Theme" }));
    });
    expect(parse(asEdited.html).documentElement.className).toBe("dark-theme");
    // A dark page needs light ink, or the stamped number is invisible.
    expect(asEdited.pageNumbers).toMatchObject({ inkRgb: [0.78, 0.78, 0.78] });

    const unnumbered = await exportOnce(async (user) => {
      await open(user, "Page Numbers");
      await user.selectOptions(option("Position"), "none");
    });
    expect(unnumbered.pageNumbers).toBeNull();
  });

  it("a very long document renders, reaches the page and exports every section", async () => {
    const sections = Array.from({ length: 300 }, (_, i) => `## 第 ${i + 1} 节\n\n段落 ${i + 1}：${"长文本。".repeat(20)}\n`);
    await requestExport(`# Long\n\n${sections.join("\n")}`);

    const sent = await exportOnce();

    expect(sent.headings).toHaveLength(301);
    expect(sent.headings.at(-1)).toEqual({ level: 2, text: "第 300 节" });
    expect(texts(parse(sent.html), ".export-surface-editor h2")).toHaveLength(300);
  });
});

describe("PDF export — refusals and failures", () => {
  it("a cancelled save panel starts nothing and leaves the page ready", async () => {
    tauri.savePanel.mockReturnValueOnce(null);
    await requestExport();
    const { user, exportButton } = await openExportWindow();

    await user.click(exportButton);
    await waitFor(() => expect(tauri.savePanel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(exportButton).toBeEnabled());
    expect(exportsStarted).toEqual([]);
    expect(tauri.toasts).toEqual([]);
    expect(tauri.window.close).not.toHaveBeenCalled();
    expect(exportButton).toHaveTextContent("Export PDF");

    await user.click(exportButton); // the panel answers this time
    await waitFor(() => expect(exportsStarted).toHaveLength(1));
  });

  it("a rejected render says why, keeps the window, and a retry exports the same document", async () => {
    exportReply = () => Promise.reject({ code: "not-found", message: "The destination folder does not exist." });
    await requestExport();
    const { user, exportButton } = await openExportWindow();

    await user.click(exportButton);
    await waitFor(() => expect(tauri.toasts).toHaveLength(1));
    expect(tauri.toasts[0]).toEqual({
      kind: "error", message: "PDF export failed", description: "The destination folder does not exist.",
    });
    expect(tauri.window.close).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
    await waitFor(() => expect(exportButton).toBeEnabled());
    expect(exportButton).toHaveTextContent("Export PDF");

    exportReply = () => ({ warnings: ["page-numbers-failed"] });
    await user.click(exportButton);
    await waitFor(() => expect(tauri.window.close).toHaveBeenCalledTimes(1));
    expect(exportsStarted).toHaveLength(2);
    expect(exportsStarted[1].html).toBe(exportsStarted[0].html);
    // A best-effort step that failed is named, not reported as plain success.
    expect(tauri.toasts[1]).toMatchObject({ kind: "warning", message: "PDF exported, but page numbers could not be added." });
  });

  it("a second Export while one is in flight is not doubled, and the button follows the Rust stages", async () => {
    let finish: (outcome: unknown) => void = () => {};
    exportReply = () => new Promise((resolve) => { finish = resolve; });
    await requestExport();
    const { user, exportButton } = await openExportWindow();

    await user.click(exportButton);
    await waitFor(() => expect(exportsStarted).toHaveLength(1));
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveTextContent("Preparing…");
    act(() => tauri.listeners.get("pdf-export-progress")?.forEach((fn) => fn({ payload: { stage: "rendering" } })));
    expect(exportButton).toHaveTextContent("Generating PDF…");

    await user.click(exportButton);
    expect(exportsStarted).toHaveLength(1);
    expect(tauri.savePanel).toHaveBeenCalledTimes(1);

    await act(async () => finish({ warnings: [] }));
    await waitFor(() => expect(tauri.window.close).toHaveBeenCalledTimes(1));
  });

  it("choosing Export twice at once opens one export window, not two", async () => {
    await openDocInTab(`${ROOT}/report.md`, MARKDOWN);
    await Promise.all([chooseExportPdf(), chooseExportPdf()]);
    expect(windowsOpened).toHaveLength(1);
  });

  it.each(["", "  \n\t\n"])("an empty document (%j) is refused before anything is rendered", async (content) => {
    editDoc(newUntitledTab(), content);
    expect(await chooseExportPdf()).toBe(true);
    expect(windowsOpened).toEqual([]);
    expect(statefulFs.has(TEMP_HTML)).toBe(false);
    expect(tauri.toasts).toEqual([{ kind: "error", message: "No content to export!", description: undefined }]);
  });

  it("with no document open the command is refused outright", async () => {
    expect(await chooseExportPdf()).toBe(false);
    expect(windowsOpened).toEqual([]);
    expect(tauri.toasts).toEqual([]);
  });

  it("the page says so when it has no HTML to export, instead of offering Export", async () => {
    render(<PdfExportPage />);
    expect(await screen.findByText("No HTML path provided")).toBeInTheDocument();
    cleanup();
    window.history.pushState(null, "", `/pdf-export?htmlPath=${encodeURIComponent("/Users/test/.config/temp/gone.html")}`);
    render(<PdfExportPage />);
    expect(await screen.findByText(/^Failed to load HTML: /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
  });
});
