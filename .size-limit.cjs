/**
 * Bundle size budget for VMark.
 *
 * Each entry pins the maximum byte size of a built chunk. Limits sit ~5%
 * above current sizes so day-to-day bumps pass while accidental regressions
 * (e.g. a vendor chunk that was lazy becoming eagerly imported) trip CI.
 *
 * Two tiers:
 *   - "EAGER:"  preloaded on first paint via `<link rel="modulepreload">` or
 *               static imports from the entry chunk. Growth here directly
 *               slows app launch and increases install download size.
 *   - "LAZY:"   only loaded after a route or feature trigger (Settings,
 *               Source mode, export, workflow panel). Growth here is OK as
 *               long as the chunk stays out of the eager preload list.
 *
 * Run:
 *   pnpm size            check all chunks against limits
 *   pnpm size:why        explain what's inside a chunk (slow)
 *
 * If a limit fails:
 *   1. Run `pnpm size:why` (or open dist/ in source-map-explorer) to find
 *      what landed in the chunk.
 *   2. If the bump is intentional, raise the limit AND note in the comment
 *      what feature added the bytes — drift without a story is the bug.
 *   3. If accidental, fix the import (usually a static import that should
 *      be `await import(...)`).
 *
 * NOTE: filenames in dist/assets/ include content hashes (e.g.
 * `vendor-mermaid-2D5fMZtm.js`). The globs strip the hash. The single
 * exception is `index-BUAvxpLj*.js` which uses the full prefix because
 * three different `index-*` chunks exist and we want to lock onto the
 * smallest one (the actual entry chunk).
 *
 * @module .size-limit.cjs
 */

module.exports = [
  // --- EAGERLY PRELOADED CHUNKS (cold-start cost) ---

  {
    // React + react-dom + react-router. Preloaded by index.html.
    // ~228 kB at last check.
    name: "EAGER: vendor-react",
    path: "dist/assets/vendor-react-*.js",
    limit: "240 kB",
    brotli: false,
  },
  {
    // @tauri-apps/api + plugin-* shims. Should stay tiny.
    name: "EAGER: vendor-tauri",
    path: "dist/assets/vendor-tauri-*.js",
    limit: "45 kB",
    brotli: false,
  },
  {
    // Zustand + @tanstack/* (when present). ~4 kB today. The limit is
    // tight to catch a regression like "we accidentally pulled the whole
    // @tanstack/react-query package back in" before it ships; raise it
    // (with a note) when adding a real new state library.
    name: "EAGER: vendor-state",
    path: "dist/assets/vendor-state-*.js",
    limit: "10 kB",
    brotli: false,
  },
  {
    // Tiptap + ProseMirror. Eager because the editor is the home screen.
    // ~446 kB at last check.
    name: "EAGER: vendor-tiptap",
    path: "dist/assets/vendor-tiptap-*.js",
    limit: "470 kB",
    brotli: false,
  },
  {
    // CodeMirror core. Eager today; narrowing language-data is a separate
    // (B5) win. The negation glob excludes the `vendor-codemirror-languages-*`
    // chunk below so growth in EITHER chunk fails its own budget rather
    // than hiding in the sum.
    name: "EAGER: vendor-codemirror",
    path: [
      "dist/assets/vendor-codemirror-*.js",
      "!dist/assets/vendor-codemirror-languages-*.js",
    ],
    limit: "1050 kB",
    brotli: false,
  },
  {
    // @codemirror/language-data registry (~140 lang loaders). Tiny by itself
    // (~24 kB) but the per-language chunks it triggers add up. Pinning the
    // registry size guards against accidental eager imports of language modules.
    name: "EAGER: vendor-codemirror-languages",
    path: "dist/assets/vendor-codemirror-languages-*.js",
    limit: "30 kB",
    brotli: false,
  },
  {
    // @lezer/* parsers used by the codeBlock highlighter. Eager because
    // code blocks render on first paint.
    name: "EAGER: vendor-lezer",
    path: "dist/assets/vendor-lezer-*.js",
    limit: "650 kB",
    brotli: false,
  },
  {
    // Mermaid + @mermaid-js/* + d3-* + dagre-d3-es + khroma. Eagerly
    // preloaded because vendor-mermaid exports a small `_` helper that
    // the entry chunk statically imports — see dev-docs/archive/
    // large-file-performance-investigation.md and the B1 fix that split
    // plain `dagre` out. 1694 kB after the split. Reducing further means
    // moving that `_` helper out of vendor-mermaid into a small util chunk.
    name: "EAGER: vendor-mermaid",
    path: "dist/assets/vendor-mermaid-*.js",
    limit: "1750 kB",
    brotli: false,
  },
  {
    // cytoscape + cose-base + layout-base. Pulled in by mermaid for some
    // diagram types. Eagerly preloaded today via the vendor-mermaid graph.
    name: "EAGER: vendor-graph",
    path: "dist/assets/vendor-graph-*.js",
    limit: "660 kB",
    brotli: false,
  },
  {
    // remark + unified + mdast + micromark. Eager because markdown
    // parsing happens on first open.
    name: "EAGER: vendor-markdown",
    path: "dist/assets/vendor-markdown-*.js",
    limit: "410 kB",
    brotli: false,
  },
  {
    // Top-level App.tsx chunk + transitively-imported hooks (~30 hooks).
    // ~1196 kB. The audit's B2 finding is to split this by window kind
    // (main/document/settings); doing so should drop this to ~700 kB.
    //
    // Bumped from 1250 to 1400 kB by Phase 2 (WI-2.6) of the GHA workflow
    // viewer: GhaWorkflowSidePanel must be eager-mounted to avoid a React
    // 19 + Suspense + xyflow setState loop in disappearLayoutEffects.
    // See dev-docs/plans/20260504-github-actions-workflow-viewer.md ADR-1
    // for the lazy-vs-eager tradeoff. xyflow + dagre add ~150 kB eager.
    // The Suspense workaround can be re-attempted after a future xyflow
    // release that addresses the strict-mode compatibility issue.
    name: "EAGER: App",
    path: "dist/assets/App-*.js",
    limit: "1400 kB",
    brotli: false,
  },

  // --- LAZY CHUNKS (off cold-start path) ---

  {
    // Plain `dagre` (workflow layout). Split out from vendor-mermaid by B1
    // so it only loads with WorkflowSidePanel.
    name: "LAZY: vendor-dagre (workflow only)",
    path: "dist/assets/vendor-dagre-*.js",
    limit: "100 kB",
    brotli: false,
  },
  {
    // CodeMirror Source-mode wrapper. Lazy via React.lazy in Editor.tsx.
    // Bumped 140 → 145 kB after Phase A/B GHA features (WI-A.1
    // expression autocomplete, WI-B.2 goto-def, WI-B.3 cursor sync).
    // Each adds a small CodeMirror extension; total ~1 kB minified.
    name: "LAZY: SourceEditor",
    path: "dist/assets/SourceEditor-*.js",
    limit: "145 kB",
    brotli: false,
  },
  {
    // React Flow / @xyflow workflow panel. Lazy.
    name: "LAZY: WorkflowSidePanel",
    path: "dist/assets/WorkflowSidePanel-*.js",
    limit: "135 kB",
    brotli: false,
  },
  {
    // Settings route. Lazy via App.tsx.
    name: "LAZY: Settings page",
    path: "dist/assets/Settings-*.js",
    limit: "90 kB",
    brotli: false,
  },
  {
    // Export pipeline (DOC/PDF/HTML). Lazy.
    name: "LAZY: useExportOperations",
    path: "dist/assets/useExportOperations-*.js",
    limit: "90 kB",
    brotli: false,
  },
  {
    // CSS-as-JS string blob for HTML export. Lazy via the export flow.
    name: "LAZY: htmlExportStyles",
    path: "dist/assets/htmlExportStyles-*.js",
    limit: "470 kB",
    brotli: false,
  },
];
