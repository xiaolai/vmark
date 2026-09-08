// @vitest-environment node
// Audit R3 #685/#689 — the branches extracted out of `exportHtmlStaged`.
//
// These were only reachable through a whole staged export before, which is why
// each of them shipped: a font whose primary CDN refuses and whose fallback
// succeeds, a download that REJECTS rather than returning nothing, two font
// settings naming one family, and a resource that resolves as a file copy and
// then fails to embed. They are asserted here directly so a regression is a
// unit failure rather than a silently wrong export folder.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  /** URLs `downloadFont` was asked for, in call order. */
  requested: [] as string[],
  /** URL -> bytes; a URL not listed here "fails" by returning null. */
  available: new Map<string, Uint8Array>(),
  /** URLs whose download REJECTS instead of returning null. */
  rejecting: new Set<string>(),
  katex: [] as { filename: string; url: string; fallbackUrl?: string }[],
  userFonts: new Map<string, { filename: string; url: string; fallbackUrl?: string }>(),
  written: [] as string[],
  folderMissing: [] as string[],
  singleMissing: [] as string[],
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async (path: string) => {
    state.written.push(path);
  }),
}));

vi.mock("../fontEmbedder", () => ({
  getKaTeXFontFiles: () => state.katex,
  getUserFontFile: (family: string) => state.userFonts.get(family) ?? null,
  downloadFont: async (url: string) => {
    state.requested.push(url);
    if (state.rejecting.has(url)) throw new Error(`refused ${url}`);
    return state.available.get(url) ?? null;
  },
  generateLocalFontCSS: (fonts: { filename: string }[], dir: string) =>
    `local:${dir}:${fonts.map((f) => f.filename).join(",")}`,
  generateEmbeddedFontCSS: (fonts: { file: { filename: string } }[]) =>
    `embedded:${fonts.map((f) => f.file.filename).join(",")}`,
  fontDataToDataUri: (data: Uint8Array) => `data:${data.length}`,
}));

vi.mock("../resourceResolver", () => ({
  resolveResources: async (_html: string, options: { mode: string }) => ({
    html: options.mode === "folder" ? "<p>folder</p>" : "<p>single</p>",
    report:
      options.mode === "folder"
        ? {
            resources: [
              { originalSrc: "cat.png", exportSrc: "assets/images/cat.png", isRemote: false, found: true },
              { originalSrc: "https://x/r.png", exportSrc: "https://x/r.png", isRemote: true, found: true },
              { originalSrc: "gone.png", exportSrc: "data:image/svg+xml,x", isRemote: false, found: false },
            ],
            resolved: [],
            missing: state.folderMissing.map((originalSrc) => ({ originalSrc })),
            totalSize: 4096,
          }
        : {
            resources: [],
            resolved: [],
            missing: state.singleMissing.map((originalSrc) => ({ originalSrc })),
            totalSize: 0,
          },
  }),
}));

import { prepareExportFonts, resolveExportResources } from "../htmlExportAssets";

function makeStage() {
  const tracked: string[] = [];
  return {
    root: "/stage",
    path: (relative: string) => `/stage/${relative}`,
    track: (relative: string) => tracked.push(relative),
    tracked,
  };
}

beforeEach(() => {
  state.requested.length = 0;
  state.available.clear();
  state.rejecting.clear();
  state.katex = [];
  state.userFonts.clear();
  state.written.length = 0;
  state.folderMissing.length = 0;
  state.singleMissing.length = 0;
});

describe("resolveExportResources", () => {
  it("tracks only the local images the folder pass actually copied (#336)", async () => {
    const stage = makeStage();
    await resolveExportResources("<p>x</p>", "/docs", stage);
    // The remote image was never written and the missing one is a data-URI
    // placeholder, so neither is a file publication could move.
    expect(stage.tracked).toEqual(["assets/images/cat.png"]);
  });

  it("merges the missing sets of BOTH passes (#337)", async () => {
    state.folderMissing = ["gone.png"];
    state.singleMissing = ["gone.png", "unembeddable.png"];
    const result = await resolveExportResources("<p>x</p>", "/docs", makeStage());
    expect([...result.missing.keys()].sort()).toEqual(["gone.png", "unembeddable.png"]);
  });

  it("returns each pass's own body and the resolver's copied bytes", async () => {
    const result = await resolveExportResources("<p>x</p>", "/docs", makeStage());
    expect(result.indexContent).toBe("<p>folder</p>");
    expect(result.standaloneContent).toBe("<p>single</p>");
    expect(result.resourceCount).toBe(3);
    expect(result.bytesWritten).toBe(4096);
  });
});

describe("prepareExportFonts", () => {
  it("ships no KaTeX fonts for a document with no math (#340)", async () => {
    state.katex = [{ filename: "KaTeX.woff2", url: "https://cdn/katex.woff2" }];
    const result = await prepareExportFonts(false, undefined, makeStage());
    expect(state.requested).toEqual([]);
    expect(result).toEqual({ localCSS: "", embeddedCSS: "", bytesWritten: 0, warnings: [] });
  });

  it("downloads one file when both font settings name the same family (#339)", async () => {
    state.userFonts.set("Inter", { filename: "Inter.woff2", url: "https://cdn/inter" });
    state.available.set("https://cdn/inter", new Uint8Array([1, 2, 3]));
    const stage = makeStage();
    const result = await prepareExportFonts(
      false,
      { fontFamily: "Inter", monoFontFamily: "Inter" },
      stage,
    );
    expect(state.requested).toEqual(["https://cdn/inter"]);
    expect(stage.tracked).toEqual(["assets/fonts/Inter.woff2"]);
    expect(result.bytesWritten).toBe(3);
  });

  it("falls back to the secondary CDN when the primary returns nothing", async () => {
    state.katex = [
      { filename: "K.woff2", url: "https://primary/k", fallbackUrl: "https://fallback/k" },
    ];
    state.available.set("https://fallback/k", new Uint8Array([9]));
    const result = await prepareExportFonts(true, undefined, makeStage());
    expect(state.requested).toEqual(["https://primary/k", "https://fallback/k"]);
    expect(result.warnings).toEqual([]);
    expect(result.localCSS).toBe("local:assets/fonts:K.woff2");
    expect(result.embeddedCSS).toBe("embedded:K.woff2");
  });

  it("warns — and does not throw — when both URLs return nothing", async () => {
    state.katex = [
      { filename: "K.woff2", url: "https://primary/k", fallbackUrl: "https://fallback/k" },
    ];
    const result = await prepareExportFonts(true, undefined, makeStage());
    expect(result.warnings).toEqual(["Failed to download font: K.woff2"]);
    expect(result.localCSS).toBe("");
    expect(result.embeddedCSS).toBe("");
  });

  it("keeps the fonts that arrived when another download REJECTS", async () => {
    // `Promise.allSettled`, not `Promise.all`: one CDN throwing must not
    // abandon a font that downloaded fine.
    state.katex = [
      { filename: "Bad.woff2", url: "https://primary/bad" },
      { filename: "Good.woff2", url: "https://primary/good" },
    ];
    state.rejecting.add("https://primary/bad");
    state.available.set("https://primary/good", new Uint8Array([1, 2]));
    const stage = makeStage();
    const result = await prepareExportFonts(true, undefined, stage);
    expect(stage.tracked).toEqual(["assets/fonts/Good.woff2"]);
    expect(result.localCSS).toBe("local:assets/fonts:Good.woff2");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("refused https://primary/bad");
  });

  it("writes each font under the stage, never under the destination", async () => {
    state.katex = [{ filename: "K.woff2", url: "https://primary/k" }];
    state.available.set("https://primary/k", new Uint8Array([7]));
    await prepareExportFonts(true, undefined, makeStage());
    expect(state.written).toEqual(["/stage/assets/fonts/K.woff2"]);
  });
});
