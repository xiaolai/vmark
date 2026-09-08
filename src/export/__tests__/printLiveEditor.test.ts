// Audit 20260907 (#346) — under document split (#1081) there are two
// `.ProseMirror` editors in the DOM, and `document.querySelector` returned the
// FIRST one whatever the focused pane was: printing from the right pane printed
// the left pane's document. The live source is now the focused pane's WYSIWYG
// editor (editorStore's `active` slice) and ONLY when it is registered for the
// window's active tab — the document being printed. Round 2: the DOM is never
// consulted. With the focused pane in Source mode nothing is registered, and
// the single `.ProseMirror` left in the DOM is the OTHER pane's document; the
// active document's markdown is rendered instead, which is always right.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";

const { mockInvoke, mockRender } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockRender: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("../resourceResolver", () => ({
  resolveResources: (html: string) =>
    Promise.resolve({ html, report: { resources: [], resolved: [], missing: [], totalSize: 0 } }),
  getDocumentBaseDir: () => Promise.resolve("/docs"),
}));
vi.mock("../renderMarkdownToHtml", () => ({
  renderMarkdownToHtml: (...args: unknown[]) => mockRender(...args),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: vi.fn(), errorDetail: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("../themeSnapshot", () => ({ captureThemeCSS: () => "", isDarkTheme: () => false }));
vi.mock("../htmlExportStyles", () => ({ getEditorContentCSS: () => "" }));
vi.mock("../pdfHtmlTemplate", () => ({
  getKatexCSS: () => "",
  getForceLightThemeCSS: () => "",
  getSharedContentCSS: () => "",
  // The print document forces every <details> open in the MARKUP, because the
  // shared CSS above styles `details[open]` (see printDocument.test.ts).
  expandDetails: (html: string) => html,
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { exportToPdf } from "../useExportOperations";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";

function installEditor(innerHTML: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "ProseMirror";
  el.innerHTML = innerHTML;
  document.body.appendChild(el);
  return el;
}

function registerFocusedEditor(dom: HTMLElement, tabId: string): void {
  useEditorStore
    .getState()
    .setActiveWysiwygEditor({ view: { dom } } as unknown as TiptapEditor, tabId);
}

/** The window's active tab — what `export.pdf` resolves and prints. */
function activateTab(tabId: string): void {
  const tab = { id: tabId, kind: "document", filePath: `/docs/${tabId}.md`, formatId: "markdown", title: tabId } as unknown as DocumentTab;
  useTabStore.setState({ tabs: { main: [tab] }, activeTabId: { main: tabId } } as never);
}

function printedHtml(): string {
  const [, args] = mockInvoke.mock.calls[0] as [string, { html: string }];
  return args.html;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  useEditorStore.getState().clearActiveEditors();
  useTabStore.setState({ tabs: {}, activeTabId: {} } as never);
  mockInvoke.mockResolvedValue({ status: "unknown" });
  mockRender.mockResolvedValue("<p>rendered-from-markdown</p>");
});

describe("exportToPdf — which editor is printed live (#346)", () => {
  it("prints the focused pane's editor, not the first .ProseMirror in the DOM", async () => {
    installEditor("<p>left pane</p>");
    const right = installEditor("<p>right pane</p>");
    registerFocusedEditor(right, "tab-right");
    activateTab("tab-right");

    await exportToPdf({ markdown: "right pane", sourceFilePath: "/docs/right.md" });

    expect(printedHtml()).toContain("<p>right pane</p>");
    expect(printedHtml()).not.toContain("<p>left pane</p>");
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("with two editors and no focused WYSIWYG pane, renders the active document's markdown", async () => {
    installEditor("<p>left pane</p>");
    installEditor("<p>right pane</p>");
    activateTab("tab-right");

    await exportToPdf({ markdown: "# active doc", sourceFilePath: "/docs/active.md" });

    expect(mockRender).toHaveBeenCalledWith("# active doc", true);
    expect(printedHtml()).toContain("<p>rendered-from-markdown</p>");
    expect(printedHtml()).not.toContain("<p>left pane</p>");
  });

  // Round 2: the focused pane is in Source mode, so no WYSIWYG editor is
  // registered — and the one `.ProseMirror` in the DOM is the OTHER pane's
  // document. The DOM used to be trusted whenever it was unambiguous.
  it("with the focused pane in Source mode, never prints the background pane's single editor", async () => {
    installEditor("<p>background wysiwyg pane</p>");
    activateTab("tab-source");

    await exportToPdf({ markdown: "# source pane doc", sourceFilePath: "/docs/source.md" });

    expect(mockRender).toHaveBeenCalledWith("# source pane doc", true);
    expect(printedHtml()).toContain("<p>rendered-from-markdown</p>");
    expect(printedHtml()).not.toContain("background wysiwyg pane");
  });

  it("a registration left over for another tab is not printed for the active one", async () => {
    const stale = installEditor("<p>stale pane</p>");
    registerFocusedEditor(stale, "tab-stale");
    activateTab("tab-active");

    await exportToPdf({ markdown: "# active doc", sourceFilePath: "/docs/active.md" });

    expect(mockRender).toHaveBeenCalledWith("# active doc", true);
    expect(printedHtml()).not.toContain("stale pane");
  });

  it("single pane: the registered editor for the active tab is printed live", async () => {
    const only = installEditor("<p>only pane</p>");
    registerFocusedEditor(only, "tab-only");
    activateTab("tab-only");

    await exportToPdf({ markdown: "only pane", sourceFilePath: "/docs/only.md" });

    expect(printedHtml()).toContain("<p>only pane</p>");
    expect(mockRender).not.toHaveBeenCalled();
  });
});
