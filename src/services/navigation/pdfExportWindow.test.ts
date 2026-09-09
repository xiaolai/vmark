// @vitest-environment node
/**
 * The Export PDF window is opened through Rust, not built here (#1377).
 *
 * It used to be `new WebviewWindow("pdf-export", …)`. Tauri's JS window options
 * carry no `menu` field, and off macOS the menu bar belongs to each window — so
 * a 440x640 utility dialog opened with the whole File/Edit/Format/Insert/View/
 * Help bar attached, none of whose actions apply to it. The Settings window was
 * never affected because it is built in Rust and passes an empty
 * `Menu::new(app)` under `cfg(not(target_os = "macos"))`.
 *
 * So the creation moved to `window_manager/pdf_export_window.rs`, and what is
 * left here is the measurement Rust cannot do: the centring position, which
 * needs the CALLING window's scale factor and geometry.
 *
 * @coordinates-with src-tauri/src/window_manager/pdf_export_window.rs
 * @module services/navigation/pdfExportWindow.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock, currentWindow } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  currentWindow: {
    scaleFactor: vi.fn(async () => 2),
    outerPosition: vi.fn(async () => ({ x: 200, y: 100 })),
    outerSize: vi.fn(async () => ({ width: 2000, height: 1400 })),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => currentWindow,
  // Present so an accidental reintroduction is visible as a call, not a crash.
  WebviewWindow: vi.fn(),
}));

import { openPdfExportWindow } from "./pdfExportWindow";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) =>
    cmd === "write_temp_html" ? "/tmp/export.html" : "pdf-export",
  );
  vi.mocked(WebviewWindow).mockClear();
});

describe("openPdfExportWindow", () => {
  it("asks Rust to open the window instead of constructing one here", async () => {
    await openPdfExportWindow({ renderedHtml: "<p>x</p>", defaultName: "Doc" });

    const call = invokeMock.mock.calls.find(([cmd]) => cmd === "open_pdf_export_window");
    expect(call, "open_pdf_export_window was never invoked").toBeDefined();
    expect(call![1]).toMatchObject({ htmlPath: "/tmp/export.html", defaultName: "Doc" });
  });

  it("never constructs a WebviewWindow — that is the defect (#1377)", () => {
    // A JS-built window cannot be given a menu, so this is the whole fix.
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("writes the HTML to a temp file before opening", async () => {
    await openPdfExportWindow({ renderedHtml: "<p>hello</p>" });

    const order = invokeMock.mock.calls.map(([cmd]) => cmd);
    expect(order.indexOf("write_temp_html")).toBeLessThan(
      order.indexOf("open_pdf_export_window"),
    );
  });

  it("converts the centring position from physical to logical pixels", async () => {
    await openPdfExportWindow({ renderedHtml: "<p>x</p>" });

    // Retina, so every physical value halves first:
    //   x = 200/2  + (2000/2 - 440)/2 = 100 + 280 = 380
    //   y = 100/2  + (1400/2 - 640)/2 =  50 +  30 =  80
    // Sending physical pixels would put the dialog off-centre on every scaled
    // display, which is why this measurement stays in the frontend — Rust has
    // no handle on the CALLING window's scale factor.
    const [, args] = invokeMock.mock.calls.find(([c]) => c === "open_pdf_export_window")!;
    expect(args).toMatchObject({ x: 380, y: 80 });
  });

  it("omits the position when the caller's geometry cannot be read", async () => {
    currentWindow.scaleFactor.mockRejectedValueOnce(new Error("no window"));

    await openPdfExportWindow({ renderedHtml: "<p>x</p>" });

    // Rust centres the window when no position arrives. Sending a half-derived
    // coordinate would place it somewhere neither deliberate nor centred.
    const [, args] = invokeMock.mock.calls.find(([c]) => c === "open_pdf_export_window")!;
    expect(args).not.toHaveProperty("x");
    expect(args).not.toHaveProperty("y");
  });

  it("omits an empty defaultName rather than sending a blank one", async () => {
    await openPdfExportWindow({ renderedHtml: "<p>x</p>" });

    const [, args] = invokeMock.mock.calls.find(([c]) => c === "open_pdf_export_window")!;
    expect(args).not.toHaveProperty("defaultName");
  });
});
