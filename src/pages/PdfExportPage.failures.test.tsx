// WI-RA21.7 — the PDF export page never strands the user.
//
// Two dead ends: a temp HTML file that exists but is empty left the page on
// "Loading…" forever (the empty string read as "not loaded yet"), and after a
// successful export a window that failed to close left the page disabled on
// its final progress stage with nothing to press.
//
// REAL: PdfExportPage, PdfExportContent and the settings panel. FAKED:
// `@tauri-apps/*` and `sonner` — the stateful disk holds the temp HTML file.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const tauri = vi.hoisted(() => ({
  close: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-fs", async () => (await import("@/test/statefulFsFake")).statefulFs.fsModule());
vi.mock("@tauri-apps/api/core", async () => (await import("@/test/statefulFsFake")).statefulFs.coreModule());
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ close: tauri.close }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(() => Promise.resolve()) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

import { statefulFs } from "@/test/statefulFsFake";
import { PdfExportPage } from "./PdfExportPage";

const TEMP_HTML = "/Users/test/.config/temp/vmark-export.html";

function openPage(): void {
  window.history.pushState(null, "", `/pdf-export?htmlPath=${encodeURIComponent(TEMP_HTML)}`);
  render(<PdfExportPage />);
}

beforeEach(() => {
  statefulFs.reset();
  statefulFs.stubCommand("set_native_theme", () => undefined);
  // The save panel is Rust's; it answers with the path `export_pdf` will accept.
  statefulFs.stubCommand("pick_export_target", () => "/Users/test/out.pdf");
  statefulFs.stubCommand("export_pdf", () => ({ warnings: [] }));
  tauri.close.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  window.history.pushState(null, "", "/");
});

describe("an empty temp file is an error, not an endless load", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", " \n\t "],
  ])("%s: the page says the HTML failed to load and offers no Export", async (_label, content) => {
    statefulFs.seed(TEMP_HTML, content);

    openPage();

    expect(await screen.findByText(/^Failed to load HTML: /)).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
  });

  it("a real document still opens the export panel", async () => {
    statefulFs.seed(TEMP_HTML, "<h1>Title</h1><p>Body</p>");

    openPage();

    expect(await screen.findByRole("button", { name: "Export PDF" })).toBeEnabled();
  });
});

describe("a window that cannot close after a successful export", () => {
  it("leaves the page usable instead of disabled on its last stage", async () => {
    statefulFs.seed(TEMP_HTML, "<h1>Title</h1>");
    tauri.close.mockRejectedValue(new Error("window close refused"));
    openPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Export PDF" }));

    await waitFor(() => expect(tauri.close).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Export PDF" })).toBeEnabled();
  });

  it("a window that closes is not re-armed (one export per window)", async () => {
    statefulFs.seed(TEMP_HTML, "<h1>Title</h1>");
    openPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Export PDF" }));

    await waitFor(() => expect(tauri.close).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
  });
});
