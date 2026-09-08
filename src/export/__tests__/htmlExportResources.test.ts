// @vitest-environment node
// Audit 20260907 — two things exportHtml got wrong around resources:
//   #340: both templates kept their default `includeKaTeX = true`, so a
//         document with no math still shipped a CDN stylesheet in index.html
//         and the full KaTeX payload in standalone.html;
//   #336: the images `resolveResources` copies into assets/images/ were not in
//         `createdPaths`, so the failure cleanup that claims to remove what the
//         export created left them behind.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  hasMath: false,
  failStandalone: false,
  /** Sources the STANDALONE (embedding) pass reports missing (audit #337). */
  standaloneMissing: [] as string[],
  fontDownloads: [] as string[],
  removeCalls: [] as string[],
  /** The lock's own bytes: release reads them back to check it is still ours. */
  lockText: null as string | null,
  renameCalls: [] as [string, string][],
  indexOptions: [] as Record<string, unknown>[],
  standaloneOptions: [] as Record<string, unknown>[],
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  // The user's document folder pre-exists; everything inside it is created.
  exists: vi.fn(async (path: string) => path === "/out/Doc"),
  // Nothing this suite publishes over exists, so `lstat` is never reached for
  // a real path; it refuses one that is not there, like the real command.
  lstat: vi.fn(async (path: string) => {
    throw new Error(`ENOENT: ${path}`);
  }),
  mkdir: vi.fn(async () => {}),
  writeTextFile: vi.fn(async (path: string, text: string) => {
    if (state.failStandalone && path.endsWith("standalone.html")) {
      throw new Error("Simulated write failure");
    }
    if (path.endsWith(".vmark-export.lock")) state.lockText = text;
  }),
  writeFile: vi.fn(),
  rename: vi.fn(async (from: string, to: string) => {
    state.renameCalls.push([from, to]);
  }),
  copyFile: vi.fn(),
  remove: vi.fn(async (path: string) => {
    state.removeCalls.push(path);
    if (path.endsWith(".vmark-export.lock")) state.lockText = null;
  }),
  readTextFile: vi.fn(async (path: string) => {
    // The destination lock is the only file this suite reads back:
    // `releaseExportLock` refuses to remove a lock that is not its own (#332).
    if (path.endsWith(".vmark-export.lock") && state.lockText !== null) return state.lockText;
    throw new Error("ENOENT");
  }),
}));

vi.mock("@/utils/debug", () => ({ exportWarn: vi.fn() }));

vi.mock("../themeSnapshot", () => ({
  captureThemeCSS: () => "",
  isDarkTheme: () => false,
}));

vi.mock("../resourceResolver", () => ({
  resolveResources: async (_html: string, options: { mode: string }) => ({
    html: "<p>test</p>",
    report:
      options.mode === "folder"
        ? {
            resources: [
              { originalSrc: "cat.png", resolvedPath: "/docs/cat.png", exportSrc: "assets/images/cat.png", isRemote: false, found: true },
              { originalSrc: "https://x.example/r.png", resolvedPath: "", exportSrc: "https://x.example/r.png", isRemote: true, found: true },
              { originalSrc: "gone.png", resolvedPath: "/docs/gone.png", exportSrc: "data:image/svg+xml,placeholder", isRemote: false, found: false },
            ],
            resolved: [],
            missing: [{ originalSrc: "gone.png" }],
            totalSize: 0,
          }
        : {
            resources: [],
            resolved: [],
            missing: state.standaloneMissing.map((originalSrc) => ({ originalSrc })),
            totalSize: 0,
          },
  }),
  getDocumentBaseDir: async () => "/docs",
}));

vi.mock("../fontEmbedder", () => ({
  contentHasMath: () => state.hasMath,
  getKaTeXFontFiles: () => [],
  // Every web-font family resolves to ONE file, so two settings naming the
  // same family yield the same FontFile (audit #339).
  getUserFontFile: (family: string) =>
    family === "Inter" ? { filename: "Inter.woff2", url: "https://fonts.example/Inter.woff2" } : null,
  downloadFont: async (url: string) => {
    state.fontDownloads.push(url);
    return new Uint8Array([1, 2, 3]);
  },
  generateLocalFontCSS: () => "",
  generateEmbeddedFontCSS: () => "",
  fontDataToDataUri: () => "",
}));

vi.mock("../htmlSanitizer", () => ({
  sanitizeExportHtml: (html: string) => html,
}));

vi.mock("../htmlTemplates", () => ({
  generateIndexHtml: (_content: string, options: Record<string, unknown>) => {
    state.indexOptions.push(options);
    return "<html>index</html>";
  },
  generateStandaloneHtml: (_content: string, options: Record<string, unknown>) => {
    state.standaloneOptions.push(options);
    return "<html>standalone</html>";
  },
}));

vi.mock("../htmlExportStyles", () => ({
  getEditorContentCSS: () => "",
}));

vi.mock("../reader", () => ({
  getReaderCSS: () => "",
  getReaderJS: () => "",
}));

import { exportHtml } from "../htmlExport";

beforeEach(() => {
  state.hasMath = false;
  state.failStandalone = false;
  state.standaloneMissing.length = 0;
  state.fontDownloads.length = 0;
  state.removeCalls.length = 0;
  state.lockText = null;
  state.renameCalls.length = 0;
  state.indexOptions.length = 0;
  state.standaloneOptions.length = 0;
});

describe("exportHtml — KaTeX ships only when the document has math (#340)", () => {
  it("a document without math gets includeKaTeX: false in BOTH templates", async () => {
    const result = await exportHtml("<p>no math</p>", { outputPath: "/out/Doc" });
    expect(result.success).toBe(true);
    expect(state.indexOptions[0]).toMatchObject({ includeKaTeX: false });
    expect(state.standaloneOptions[0]).toMatchObject({ includeKaTeX: false });
  });

  it("a document with math keeps KaTeX in both", async () => {
    state.hasMath = true;
    await exportHtml('<span class="katex">x</span>', { outputPath: "/out/Doc" });
    expect(state.indexOptions[0]).toMatchObject({ includeKaTeX: true });
    expect(state.standaloneOptions[0]).toMatchObject({ includeKaTeX: true });
  });
});

// Since #332/#334 the export is staged: the image the resolver copied lives
// under the staging tree, goes with that tree on failure, and is published
// by rename on success — so it is the export's file in both directions.
describe("exportHtml — copied images belong to the export (#336)", () => {
  const STAGING = /^\/out\/Doc\/\.vmark-export-[^/]+$/;
  /** The destination lock's own removal (#332) — counted apart from the tree. */
  const LOCK = "/out/Doc/.vmark-export.lock";
  const treeRemovals = () => state.removeCalls.filter((p) => p !== LOCK);

  it("a failed export removes only its staging tree — the copied image with it, nothing at the destination", async () => {
    state.failStandalone = true;
    const result = await exportHtml("<p>test</p>", { outputPath: "/out/Doc" });
    expect(result.success).toBe(false);
    expect(treeRemovals()).toHaveLength(1);
    expect(treeRemovals()[0]).toMatch(STAGING);
    expect(state.renameCalls).toEqual([]);
    expect(state.removeCalls).toContain(LOCK);
  });

  it("a successful export publishes the copied image and not the remote or missing ones", async () => {
    const result = await exportHtml("<p>test</p>", { outputPath: "/out/Doc" });
    expect(result.success).toBe(true);
    const published = state.renameCalls.map(([, to]) => to);
    expect(published).toContain("/out/Doc/assets/images/cat.png");
    expect(published.filter((p) => p.includes("r.png"))).toEqual([]);
    expect(published.filter((p) => p.includes("gone.png"))).toEqual([]);
    // Only the staging tree is removed, after the publish.
    expect(treeRemovals()).toHaveLength(1);
    expect(treeRemovals()[0]).toMatch(STAGING);
    expect(state.removeCalls).toContain(LOCK);
  });
});

// Audit 20260907 (#337): the standalone (embedding) pass returned its own
// report, and exportHtml threw it away — a resource that failed only while
// being embedded was neither counted nor warned about.
describe("exportHtml — diagnostics from both resolution passes (#337)", () => {
  it("counts and warns about a resource missing only during embedding", async () => {
    state.standaloneMissing.push("embed-only.png");
    const result = await exportHtml("<p>test</p>", { outputPath: "/out/Doc" });
    expect(result.success).toBe(true);
    expect(result.missingCount).toBe(2);
    expect(result.warnings).toContain("2 resource(s) not found");
  });

  it("does not double-count a resource missing in both passes", async () => {
    state.standaloneMissing.push("gone.png");
    const result = await exportHtml("<p>test</p>", { outputPath: "/out/Doc" });
    expect(result.missingCount).toBe(1);
    expect(result.warnings).toContain("1 resource(s) not found");
  });
});

// Audit 20260907 (#339): the document and monospace font settings naming the
// same web font pushed the same FontFile twice — two downloads, two writes,
// two @font-face rules and a doubled size.
describe("exportHtml — a font shared by both settings is exported once (#339)", () => {
  it("downloads one file when fontFamily and monoFontFamily coincide", async () => {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const result = await exportHtml("<p>test</p>", {
      outputPath: "/out/Doc",
      fontSettings: { fontFamily: "Inter", monoFontFamily: "Inter" },
    });
    expect(result.success).toBe(true);
    expect(state.fontDownloads).toEqual(["https://fonts.example/Inter.woff2"]);
    expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(1);
  });
});
