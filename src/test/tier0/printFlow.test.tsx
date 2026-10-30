// The Print flow on the webview side: from File → Print on a document to the
// HTML the Rust `print_document` command receives, and what the user is told
// for each outcome the system dialog reports.
//
// REAL: the command bus and `export.pdf`, the stores, the open flow, the
// off-screen ExportSurface render (no live editor is mounted here, so the
// markdown branch runs), local-image inlining against the document's folder,
// the print stylesheet, the outcome reader and the toasts it raises.
// FAKED: `@tauri-apps/*` and `sonner` only.
// NOT HERE: the helper webview and the platform print dialog are native —
// `src-tauri/src/pdf_export/renderer` owns them. The live-editor branch is
// pinned in `src/export/__tests__/printLiveEditor.test.ts`, local-image
// inlining in `src/export/__tests__/exportToPdfImages.test.ts`.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const toasts = vi.hoisted(() => [] as Array<{ kind: string; message: unknown }>);

vi.mock("@tauri-apps/plugin-fs", async () => (await import("@/test/statefulFsFake")).statefulFs.fsModule());
vi.mock("@tauri-apps/api/core", async () => (await import("@/test/statefulFsFake")).statefulFs.coreModule());
vi.mock("@tauri-apps/api/path", async () => {
  const { posix } = await import("node:path");
  const lift = <A extends unknown[]>(fn: (...a: A) => string) => (...a: A) => Promise.resolve(fn(...a));
  return { join: lift(posix.join), dirname: lift(posix.dirname), basename: lift(posix.basename), normalize: lift(posix.normalize) };
});
vi.mock("sonner", () => {
  const record = (kind: string) => (message: unknown) => toasts.push({ kind, message });
  return { toast: { error: record("error"), success: record("success"), warning: record("warning") } };
});

import { statefulFs } from "@/test/statefulFsFake";
import { executeCommand, _resetCommandBus } from "@/services/commands/CommandBus";
import { registerExportCommands } from "@/services/commands/exportCommands";
import { bootstrapFormats } from "@/lib/formats/registryBootstrap";
import { WINDOW, ROOT, resetTier0, openDocInTab, newUntitledTab } from "./harness";

let printed: string[];
/** What the Rust `print_document` command answers with; replaced per test. */
let printReply: () => unknown;

/**
 * File → Print on the active document. The command mounts its own off-screen
 * React root, so it runs outside `act` (see `pdfExport.test.tsx`).
 */
async function choosePrint(): Promise<void> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
  const previous = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await executeCommand("export.pdf", undefined, { windowLabel: WINDOW });
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

beforeAll(() => bootstrapFormats());

beforeEach(() => {
  resetTier0();
  _resetCommandBus();
  registerExportCommands();
  toasts.length = 0;
  printed = [];
  printReply = () => ({ status: "completed" });
  statefulFs.stubCommand("print_document", ({ html }) => (printed.push(String(html)), printReply()));
});

describe("Print — from the document to the print dialog", () => {
  it("hands the dialog the document as rendered markup and confirms a completed job", async () => {
    await openDocInTab(`${ROOT}/notes.md`, "# 打印 Title\n\nBody text.\n");

    await choosePrint();

    expect(printed).toHaveLength(1);
    const doc = parse(printed[0]);
    expect(doc.querySelector("h1")?.textContent).toBe("打印 Title");
    expect(doc.body.textContent).toContain("Body text.");
    expect(doc.body.textContent).not.toContain("# 打印");
    expect(printed[0]).toMatch(/@page\s*{\s*margin: 1\.5cm;\s*}/);
    expect(toasts).toEqual([{ kind: "success", message: "Print job completed" }]);
  });

  it.each([
    ["cancelled", "the user closed the dialog"],
    ["unknown", "the platform cannot say (Windows)"],
  ])("says nothing when the dialog reports %s — %s", async (status) => {
    printReply = () => ({ status });
    await openDocInTab(`${ROOT}/notes.md`, "# Doc\n");

    await choosePrint();

    expect(printed).toHaveLength(1);
    expect(toasts).toEqual([]);
  });

  it("reports a failed print", async () => {
    printReply = () => Promise.reject({ code: "internal", message: "the print job failed" });
    await openDocInTab(`${ROOT}/notes.md`, "# Doc\n");

    await choosePrint();

    expect(toasts).toEqual([{ kind: "error", message: "Print failed" }]);
  });

  it("opens no dialog for an empty document", async () => {
    newUntitledTab();

    await choosePrint();

    expect(printed).toEqual([]);
    expect(toasts.map((t) => t.kind)).toEqual(["error"]);
  });
});
