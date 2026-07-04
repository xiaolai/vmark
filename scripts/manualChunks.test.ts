/**
 * Characterization tests for the Rollup manualChunks policy
 * (scripts/manualChunks.ts, consumed by vite.config.ts).
 *
 * The expectations below were derived from the in-config function as of
 * the vite 8 recalibration (htmlExportStyles pinning, @lezer →
 * vendor-codemirror). They lock the chunk assignments in place: any
 * behavioral drift during refactors must show up here, because
 * .size-limit.cjs budgets and scripts/check-eager-chunks.mjs assumptions
 * are keyed to these exact chunk names.
 */

import { describe, it, expect } from "vitest";
import { manualChunks } from "./manualChunks";

/** Build a pnpm-style node_modules id for a package-internal file. */
function pnpmId(pkg: string, file = "dist/index.js"): string {
  const flat = pkg.replace("/", "+");
  return `/repo/node_modules/.pnpm/${flat}@1.0.0/node_modules/${pkg}/${file}`;
}

describe("manualChunks — special pins (checked before node_modules dispatch)", () => {
  it("pins Vite's preload helper to vendor-react", () => {
    expect(manualChunks("\0vite/preload-helper.js")).toBe("vendor-react");
  });

  it.each([
    "/repo/src/export/htmlExportStyles.ts",
    "/repo/src/export/editorCSSBundle.ts",
    "/repo/src/export/exportOverrides.ts",
    "/repo/src/export/katexFontEmbed.ts",
    "/repo/src/styles/editor.css?raw",
    "/repo/src/assets/fonts/KaTeX_Main-Regular.woff2?inline",
  ])("pins the export-style blob member %s to htmlExportStyles", (id) => {
    expect(manualChunks(id)).toBe("htmlExportStyles");
  });

  it("leaves ordinary app source unassigned", () => {
    expect(manualChunks("/repo/src/components/Editor/TiptapEditor.tsx")).toBeUndefined();
    expect(manualChunks("/repo/src/main.tsx")).toBeUndefined();
  });
});

describe("manualChunks — vendor dispatch (pnpm-style ids)", () => {
  it.each<[string, string | undefined]>([
    // CodeMirror family — @lezer rides with vendor-codemirror (vite 8)
    ["@lezer/common", "vendor-codemirror"],
    ["@lezer/highlight", "vendor-codemirror"],
    ["@codemirror/language-data", "vendor-codemirror-languages"],
    ["@codemirror/view", "vendor-codemirror"],
    ["@codemirror/lang-markdown", "vendor-codemirror"],
    // Editor
    ["@tiptap/core", "vendor-tiptap"],
    ["prosemirror-state", "vendor-tiptap"],
    ["prosemirror-view", "vendor-tiptap"],
    // Sanitizer isolated so mermaid stays lazy
    ["dompurify", "vendor-dompurify"],
    // Workflow layout dagre isolated from mermaid's bundled fork
    ["@dagrejs/dagre", "vendor-dagre"],
    ["dagre", "vendor-dagre"],
    // Mermaid family stays together (circular-dependency safety)
    ["mermaid", "vendor-mermaid"],
    ["@mermaid-js/parser", "vendor-mermaid"],
    ["d3-selection", "vendor-mermaid"],
    ["d3", "vendor-mermaid"],
    ["dagre-d3-es", "vendor-mermaid"],
    ["khroma", "vendor-mermaid"],
    // Export/PDF family
    ["html2canvas", "vendor-html2canvas"],
    ["stackblur-canvas", "vendor-html2canvas"],
    ["jspdf", "vendor-jspdf"],
    ["html2pdf.js", "vendor-html2pdf"],
    ["canvg", "vendor-export"],
    ["svg-pathdata", "vendor-export"],
    // Graph layout
    ["cytoscape", "vendor-graph"],
    ["cytoscape-cose-bilkent", "vendor-graph"],
    ["cytoscape-fcose", "vendor-graph"],
    ["cose-base", "vendor-graph"],
    ["layout-base", "vendor-graph"],
    // Platform + app state
    ["@tauri-apps/api", "vendor-tauri"],
    ["@tauri-apps/plugin-dialog", "vendor-tauri"],
    ["react", "vendor-react"],
    ["react-dom", "vendor-react"],
    ["react-router", "vendor-react"],
    ["react-router-dom", "vendor-react"],
    ["zustand", "vendor-state"],
    ["@tanstack/react-virtual", "vendor-state"],
    // Markdown pipeline
    ["remark-parse", "vendor-markdown"],
    ["unified", "vendor-markdown"],
    ["mdast-util-from-markdown", "vendor-markdown"],
    ["micromark-core-commonmark", "vendor-markdown"],
    // KaTeX intentionally stays in the main bundle (CSS cascade order)
    ["katex", undefined],
    // Anything else falls through
    ["lodash", undefined],
  ])("%s → %s", (pkg, expected) => {
    expect(manualChunks(pnpmId(pkg))).toBe(expected);
  });

  it("resolves the package name from the LAST node_modules segment", () => {
    // .pnpm ids contain node_modules twice — the real package path wins.
    expect(
      manualChunks(
        "/repo/node_modules/.pnpm/@lezer+common@1.0.0/node_modules/@lezer/common/dist/index.js"
      )
    ).toBe("vendor-codemirror");
  });

  it("non-pnpm (hoisted) node_modules paths work too", () => {
    expect(manualChunks("/repo/node_modules/react-dom/index.js")).toBe("vendor-react");
    expect(manualChunks("/repo/node_modules/@tiptap/core/dist/index.js")).toBe("vendor-tiptap");
  });

  it("degenerate trailing node_modules/ id is unassigned", () => {
    expect(manualChunks("/repo/node_modules/")).toBeUndefined();
  });
});
