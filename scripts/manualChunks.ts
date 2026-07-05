/**
 * Rollup manualChunks policy for vite.config.ts.
 *
 * Extracted from the inline function in vite.config.ts so the chunk
 * assignment logic is unit-testable (scripts/manualChunks.test.ts locks
 * every branch with characterization cases). Behavior here is coupled to:
 *   - .size-limit.cjs           — budgets keyed to these chunk names
 *   - scripts/check-eager-chunks.mjs — cold-start modulepreload gate
 * Change chunk assignments only together with those gates.
 */

export function manualChunks(id: string): string | undefined {
  // Vite's preload helper is a tiny runtime module. Left to Rollup it
  // gets co-located into whichever vendor chunk is convenient
  // (historically vendor-mermaid), which then drags that whole chunk
  // into the entry's static-import graph and onto the cold-start
  // modulepreload list. Pin it to vendor-react, which is always
  // eagerly loaded anyway.
  if (id.includes("vite/preload-helper")) return "vendor-react";
  // Pin the CSS-as-JS export-style blob (~460 kB) to a stable chunk
  // name so .size-limit.cjs can budget it — rolldown otherwise merges
  // it into whichever lazy export chunk is convenient (it landed in
  // themeSnapshot-* on the vite 8 upgrade, silently escaping the gate).
  if (
    id.includes("/src/export/htmlExportStyles") ||
    id.includes("/src/export/editorCSSBundle") ||
    id.includes("/src/export/exportOverrides") ||
    id.includes("/src/export/katexFontEmbed") ||
    // The ?raw CSS strings and ?inline KaTeX fonts ARE the blob; only
    // export code imports .css?raw / .woff2?inline (checked 2026-07),
    // so this can't drag app CSS or fonts in.
    id.includes(".css?raw") ||
    id.includes(".woff2?inline")
  ) {
    return "htmlExportStyles";
  }
  if (!id.includes("node_modules")) return;

  const parts = id.split("node_modules/");
  const pkgPath = parts[parts.length - 1] ?? "";
  const pkgName = pkgPath.startsWith("@")
    ? pkgPath.split("/").slice(0, 2).join("/")
    : pkgPath.split("/")[0];

  // @lezer/* rides with vendor-codemirror: both are eager and always
  // co-loaded (code blocks render on first paint), and vite 8's
  // rolldown merges the two groups anyway — returning one name makes
  // that deterministic so the size budget matches a real chunk.
  if (pkgName.startsWith("@lezer/")) return "vendor-codemirror";
  if (pkgName === "@codemirror/language-data") return "vendor-codemirror-languages";
  // Keep all @codemirror packages together to avoid circular dependency issues
  // Previously splitting @codemirror/lang-* and @codemirror/language caused
  // "Cannot access 'kn' before initialization" in production builds
  if (pkgName.startsWith("@codemirror/")) return "vendor-codemirror";
  if (pkgName.startsWith("@tiptap/") || pkgName.startsWith("prosemirror")) return "vendor-tiptap";
  // DOMPurify is imported eagerly by src/utils/sanitize.ts. Without an
  // explicit chunk, Rollup co-locates it into vendor-mermaid, which then
  // forces a modulepreload of the entire ~1.7 MB mermaid chunk (and the
  // ~630 KB vendor-graph it pulls) on cold start — just to reach a ~20 KB
  // sanitizer. Isolating it keeps mermaid genuinely lazy.
  if (pkgName === "dompurify") return "vendor-dompurify";
  // `@dagrejs/dagre` (maintained fork; audit 20260612) is used only by workflow
  // layout (lib/workflow/layout.ts) which
  // is reached lazily through WorkflowSidePanel. Mermaid uses its own bundled
  // fork (`dagre-d3-es`), so isolating plain `dagre` is safe and removes ~150 KB
  // from the eagerly-loaded vendor-mermaid chunk.
  if (pkgName === "@dagrejs/dagre" || pkgName === "dagre") return "vendor-dagre";
  // Keep all mermaid-related packages together to avoid circular dependency issues.
  // Previously splitting mermaid, @mermaid-js/*, d3-*, dagre-d3-es caused
  // "this.clear is not a function" error in production builds.
  if (
    pkgName === "mermaid" ||
    pkgName.startsWith("@mermaid-js/") ||
    pkgName.startsWith("d3-") ||
    pkgName === "d3" ||
    pkgName === "dagre-d3-es" ||
    pkgName === "khroma"
  ) {
    return "vendor-mermaid";
  }
  // Graphviz WASM build (@viz-js/viz). Reached only through the graphviz
  // plugin's `await import(...)` — isolating it keeps the ~1.5 MB WASM blob
  // off the cold-start path (denylisted in scripts/check-eager-chunks.mjs,
  // budgeted as LAZY in .size-limit.cjs).
  if (pkgName === "@viz-js/viz") return "vendor-graphviz";
  // KaTeX stays in main bundle to preserve CSS cascade order.
  // Separate chunk would load before index.css, causing Tailwind's
  // preflight (border:0) to override KaTeX's border-style settings.
  // See: dev-docs/css-dev-prod-differences.md
  if (
    pkgName === "html2pdf.js" ||
    pkgName === "html2canvas" ||
    pkgName === "jspdf" ||
    pkgName === "canvg" ||
    pkgName === "svg-pathdata" ||
    pkgName === "stackblur-canvas"
  ) {
    if (pkgName === "html2canvas" || pkgName === "stackblur-canvas") return "vendor-html2canvas";
    if (pkgName === "jspdf") return "vendor-jspdf";
    if (pkgName === "html2pdf.js") return "vendor-html2pdf";
    return "vendor-export";
  }
  if (
    pkgName === "cytoscape" ||
    pkgName === "cytoscape-cose-bilkent" ||
    pkgName === "cytoscape-fcose" ||
    pkgName === "cose-base" ||
    pkgName === "layout-base"
  ) {
    return "vendor-graph";
  }
  if (pkgName.startsWith("@tauri-apps/")) return "vendor-tauri";
  if (pkgName === "react-router-dom" || pkgName === "react-router") return "vendor-react";
  if (pkgName === "react-dom" || pkgName === "react") return "vendor-react";
  if (pkgName === "zustand" || pkgName.startsWith("@tanstack/")) return "vendor-state";
  if (
    pkgName.startsWith("remark") ||
    pkgName.startsWith("unified") ||
    pkgName.startsWith("mdast") ||
    pkgName.startsWith("micromark")
  ) {
    return "vendor-markdown";
  }

  return undefined;
}
