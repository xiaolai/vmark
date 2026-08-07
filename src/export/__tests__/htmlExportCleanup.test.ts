// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Track calls to fs operations
const mkdirCalls: string[] = [];
const writeTextFileCalls: string[] = [];
const removeCalls: string[] = [];

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn(async (path: string) => {
    mkdirCalls.push(path);
  }),
  writeTextFile: vi.fn(async (path: string) => {
    writeTextFileCalls.push(path);
    // Simulate failure on standalone.html to trigger partial cleanup
    if (path.endsWith("standalone.html")) {
      throw new Error("Simulated write failure");
    }
  }),
  writeFile: vi.fn(),
  remove: vi.fn(async (path: string) => {
    removeCalls.push(path);
  }),
}));

vi.mock("../themeSnapshot", () => ({
  captureThemeCSS: () => "/* theme */",
  isDarkTheme: () => false,
}));

vi.mock("../resourceResolver", () => ({
  resolveResources: async (_html: string) => ({
    html: "<p>test</p>",
    report: { resources: [], missing: [] },
  }),
  getDocumentBaseDir: async () => "/tmp",
}));

vi.mock("../fontEmbedder", () => ({
  contentHasMath: () => false,
  getKaTeXFontFiles: () => [],
  getUserFontFile: () => null,
  downloadFont: async () => null,
  generateLocalFontCSS: () => "",
  generateEmbeddedFontCSS: () => "",
  fontDataToDataUri: () => "",
}));

vi.mock("../htmlSanitizer", () => ({
  sanitizeExportHtml: (html: string) => html,
}));

vi.mock("../htmlTemplates", () => ({
  generateIndexHtml: () => "<html>index</html>",
  generateStandaloneHtml: () => "<html>standalone</html>",
}));

vi.mock("../htmlExportStyles", () => ({
  getEditorContentCSS: () => "/* content */",
}));

vi.mock("../reader", () => ({
  getReaderCSS: () => "/* reader css */",
  getReaderJS: () => "/* reader js */",
}));

import { exportHtml } from "../htmlExport";

describe("exportHtml partial failure cleanup", () => {
  beforeEach(() => {
    mkdirCalls.length = 0;
    writeTextFileCalls.length = 0;
    removeCalls.length = 0;
  });

  it("does not remove the output directory on failure", async () => {
    const result = await exportHtml("<p>test</p>", {
      outputPath: "/users/me/MyReport",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Simulated write failure");

    // Must NOT remove the user's output directory
    expect(removeCalls).not.toContain("/users/me/MyReport");
  });

  it("only removes files created during the current export", async () => {
    const result = await exportHtml("<p>test</p>", {
      outputPath: "/users/me/MyReport",
    });

    expect(result.success).toBe(false);

    // index.html was written before the failure — it should be cleaned up
    expect(removeCalls).toContain("/users/me/MyReport/index.html");

    // reader assets were written before index.html
    expect(removeCalls).toContain(
      "/users/me/MyReport/assets/vmark-reader.css"
    );
    expect(removeCalls).toContain(
      "/users/me/MyReport/assets/vmark-reader.js"
    );

    // standalone.html failed to write — should NOT be in cleanup list
    expect(removeCalls).not.toContain(
      "/users/me/MyReport/standalone.html"
    );
  });

  it("cleans up in reverse creation order", async () => {
    await exportHtml("<p>test</p>", {
      outputPath: "/users/me/MyReport",
    });

    // Last created file should be removed first
    expect(removeCalls[0]).toBe("/users/me/MyReport/index.html");
  });
});
