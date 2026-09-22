/**
 * Characterization tests for the Rollup manualChunks policy
 * (scripts/manualChunks.ts, consumed by vite.config.ts).
 *
 * The expectations below were derived from the in-config function as of
 * the vite 8 recalibration (htmlExportStyles pinning), then narrowed so only
 * the CodeMirror core rides vendor-codemirror (lazily-loaded grammars chunk by
 * import site). They lock the chunk assignments in place: any
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

  it("leaves the lazy format surfaces unassigned — they chunk by import site", () => {
    // WI-13 tried pinning these as named families so the eager gate could
    // denylist them. It backfired: rolldown's group matching pulls a matched
    // module's whole private dependency subtree into the group, so four
    // CodeMirror plugin modules produced a 1.07 MB chunk that vendor-react
    // then imported — a god-chunk that HID the 0.66 MB the lazy conversion
    // actually saved. Dynamic-import boundaries already name their own chunks
    // (`markdownSurface-*`, `yamlWorkflowRenderer-*`, …), which is what
    // check-eager-chunks.mjs LAZY_ONLY_CHUNK_PATTERNS matches instead.
    expect(
      manualChunks("/repo/src/lib/formats/adapters/markdownSurface.tsx"),
    ).toBeUndefined();
    expect(
      manualChunks("/repo/src/components/Editor/WorkflowPanel/GhaWorkflowWorkbench.tsx"),
    ).toBeUndefined();
    expect(manualChunks("/repo/src/plugins/codemirror/sourceGhaIrSync.ts")).toBeUndefined();
  });
});

describe("manualChunks — CodeMirror core vs lazily-loaded grammars", () => {
  it.each([
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/language",
    "@codemirror/commands",
    "@codemirror/autocomplete",
    "@codemirror/search",
    "@codemirror/lint",
    // lang-markdown is the Source editor's language, and it STATICALLY
    // imports lang-html, which imports lang-css and lang-javascript — so all
    // four are cold-start cost whichever chunk they land in.
    "@codemirror/lang-markdown",
    "@codemirror/lang-html",
    "@codemirror/lang-css",
    "@codemirror/lang-javascript",
    "@lezer/common",
    "@lezer/lr",
    "@lezer/highlight",
    "@lezer/markdown",
    "@lezer/html",
    "@lezer/css",
    "@lezer/javascript",
  ])("pins eager core %s to vendor-codemirror", (pkg) => {
    expect(manualChunks(pnpmId(pkg))).toBe("vendor-codemirror");
  });

  it.each([
    // Reached only through language-data's `load()` or sourceLanguage.ts's
    // `await import()`. Pinning them into vendor-codemirror made ~1 MB of
    // grammars cold-start cost: +29 MB WebContent footprint to evaluate the
    // chunk in WebKit, vs +13 MB for the core alone (measured 2026-09-22).
    "@codemirror/legacy-modes",
    "@codemirror/lang-cpp",
    "@codemirror/lang-php",
    "@codemirror/lang-rust",
    "@codemirror/lang-python",
    "@codemirror/lang-sql",
    "@codemirror/lang-yaml",
    "@lezer/cpp",
    "@lezer/php",
    "@lezer/rust",
    "@lezer/python",
    "@lezer/yaml",
  ])("leaves lazily-loaded grammar %s unassigned so it chunks by import site", (pkg) => {
    expect(manualChunks(pnpmId(pkg))).toBeUndefined();
  });

  it("leaves an unknown future CodeMirror package unassigned (fails lazy, not eager)", () => {
    expect(manualChunks(pnpmId("@codemirror/lang-newthing"))).toBeUndefined();
    expect(manualChunks(pnpmId("@lezer/newthing"))).toBeUndefined();
  });
});

describe("manualChunks — vendor dispatch (pnpm-style ids)", () => {
  it.each<[string, string | undefined]>([
    // CodeMirror registry (the grammar split is covered above)
    ["@codemirror/language-data", "vendor-codemirror-languages"],
    // Editor
    ["@tiptap/core", "vendor-tiptap"],
    ["prosemirror-state", "vendor-tiptap"],
    ["prosemirror-view", "vendor-tiptap"],
    // Sanitizer isolated so mermaid stays lazy
    ["dompurify", "vendor-dompurify"],
    // Workflow layout dagre isolated from mermaid's bundled fork
    ["@dagrejs/dagre", "vendor-dagre"],
    ["dagre", "vendor-dagre"],
    // React Flow named so the eager gate can denylist the family (WI-12)
    ["@xyflow/react", "vendor-xyflow"],
    ["@xyflow/system", "vendor-xyflow"],
    // Mermaid family stays together (circular-dependency safety)
    ["mermaid", "vendor-mermaid"],
    ["@mermaid-js/parser", "vendor-mermaid"],
    ["d3-selection", "vendor-mermaid"],
    ["d3", "vendor-mermaid"],
    ["dagre-d3-es", "vendor-mermaid"],
    ["khroma", "vendor-mermaid"],
    // Graphviz WASM — lazy, isolated so it never rides an eager chunk
    ["@viz-js/viz", "vendor-graphviz"],
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
