// @vitest-environment node
// slidevFormatFromPath — the export format follows the chosen extension,
// case-insensitively, and anything unrecognised is a PDF (WI-7.2).
// activeDeckPath is exercised through useContentServer.test.ts (previewSlides /
// exportSlides), where the tab and navigation stores are already faked.
import { describe, expect, it } from "vitest";
import { deckExportDefaultPath, slidevFormatFromPath } from "./slidevDeck";

describe("slidevFormatFromPath", () => {
  it("derives the format from the output extension", () => {
    expect(slidevFormatFromPath("/o/deck.pdf")).toBe("pdf");
    expect(slidevFormatFromPath("/o/deck.PNG")).toBe("png");
    expect(slidevFormatFromPath("/o/deck.pptx")).toBe("pptx");
  });

  it("falls back to PDF for an unknown or missing extension", () => {
    expect(slidevFormatFromPath("/o/deck")).toBe("pdf");
    expect(slidevFormatFromPath("/o/deck.key")).toBe("pdf");
    expect(slidevFormatFromPath("")).toBe("pdf");
  });

  it("reads only the last extension, so a dotted directory does not decide it", () => {
    expect(slidevFormatFromPath("/o.pptx/deck.png")).toBe("png");
    expect(slidevFormatFromPath("/o/deck.tar.pptx")).toBe("pptx");
  });
});

// Audit #761 — the old `replace(/\.[^.]+$/, ".pdf")` let `[^.]` match a path
// separator, so the extension it replaced could belong to a DIRECTORY.
describe("deckExportDefaultPath", () => {
  it("replaces the final segment's extension", () => {
    expect(deckExportDefaultPath("/ws/deck.md")).toBe("/ws/deck.pdf");
    expect(deckExportDefaultPath("/ws/deck.tar.md")).toBe("/ws/deck.tar.pdf");
    expect(deckExportDefaultPath("C:\\ws\\deck.md")).toBe("C:\\ws\\deck.pdf");
  });

  it("never rewrites a dotted DIRECTORY", () => {
    // `/ws.v1/deck` used to become `/ws.pdf` — a different directory.
    expect(deckExportDefaultPath("/ws.v1/deck")).toBe("/ws.v1/deck.pdf");
    expect(deckExportDefaultPath("C:\\ws.v1\\deck")).toBe("C:\\ws.v1\\deck.pdf");
  });

  it("appends to an extensionless name instead of leaving it bare", () => {
    expect(deckExportDefaultPath("/ws/deck")).toBe("/ws/deck.pdf");
    expect(deckExportDefaultPath("deck")).toBe("deck.pdf");
  });

  it("treats a leading dot as part of the name, not an extension", () => {
    expect(deckExportDefaultPath("/ws/.deck")).toBe("/ws/.deck.pdf");
    expect(deckExportDefaultPath(".deck")).toBe(".deck.pdf");
  });
});
