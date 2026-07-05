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
 * `vendor-mermaid-2D5fMZtm.js`). The globs strip the hash. The entry chunk
 * is named `entry-<hash>.js` via rollupOptions.output.entryFileNames so it
 * can be budgeted without a rot-prone hash-pinned glob (audit 20260612 H9 —
 * the previous `index-BUAvxpLj*` glob silently stopped matching and the
 * entry chunk went unbudgeted).
 *
 * @module .size-limit.cjs
 */

module.exports = [
  // --- EAGERLY PRELOADED CHUNKS (cold-start cost) ---
  {
    // The application entry chunk itself (app code that isn't in a vendor
    // or App chunk). 1219 kB at audit 20260612; budget with modest headroom
    // so regressions surface instead of migrating here invisibly.
    name: "EAGER: entry",
    path: "dist/assets/entry-*.js",
    limit: "1300 kB",
    brotli: false,
  },

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
    // Bumped 470 → 500 kB: Tiptap 3.18 → 3.27 (9 minor releases of the core
    // editor) added ~18 kB; actual ~488 kB.
    name: "EAGER: vendor-tiptap",
    path: "dist/assets/vendor-tiptap-*.js",
    limit: "500 kB",
    brotli: false,
  },
  {
    // CodeMirror core + @lezer/* parsers. Eager today; narrowing language-data
    // is a separate (B5) win. The negation glob excludes the
    // `vendor-codemirror-languages-*` chunk below so growth in EITHER chunk
    // fails its own budget rather than hiding in the sum.
    // Absorbed the former vendor-lezer budget (650 kB): vite 8's rolldown
    // merges the always-co-loaded @lezer group into this chunk, so the two
    // budgets are now one (1050 + 650 -> 1700; actual 1.64 MB post-merge).
    name: "EAGER: vendor-codemirror",
    path: [
      "dist/assets/vendor-codemirror-*.js",
      "!dist/assets/vendor-codemirror-languages-*.js",
    ],
    limit: "1700 kB",
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
    // Mermaid + @mermaid-js/* + d3-* + dagre-d3-es + khroma. LAZY since
    // the preload-helper pinning (see vite.config.ts manualChunks): loads
    // on first diagram render, not at cold start.
    // Bumped 1750 → 2600 kB: Mermaid 11.12 → 11.16 added ~800 kB (new diagram
    // types + deps); actual ~2.49 MB. Acceptable because this chunk is lazy
    // (never in the cold-start path).
    name: "LAZY: vendor-mermaid",
    path: "dist/assets/vendor-mermaid-*.js",
    limit: "2600 kB",
    brotli: false,
  },
  {
    // cytoscape + cose-base + layout-base. Pulled in by mermaid for some
    // diagram types — LAZY, rides vendor-mermaid's dynamic import.
    name: "LAZY: vendor-graph",
    path: "dist/assets/vendor-graph-*.js",
    limit: "660 kB",
    brotli: false,
  },
  {
    // @viz-js/viz (Graphviz WASM, base64-inlined). LAZY: loads on the
    // first ```dot / ```graphviz render via the graphviz plugin's dynamic
    // import; denylisted in check-eager-chunks.mjs. ~1.36 MB at addition
    // (v3.28); ~5% headroom.
    name: "LAZY: vendor-graphviz",
    path: "dist/assets/vendor-graphviz-*.js",
    limit: "1430 kB",
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
    // Bumped 90 → 92 kB: fix(#946) adds the openInNewTab toggle (+label/description)
    // to EditorSettings, nudging this chunk ~150 B over the old 90 kB ceiling.
    // Bumped 92 → 94 kB: the HTML allow-list controls (Allowed-tags select +
    // custom-tags field in MarkdownSettings) and the top/left terminal-position
    // options in TerminalSettings added ~0.8 kB.
    // Bumped 94 → 95 kB: lucide-react v1 removed brand icons, so AboutSettings
    // now ships the GitHub mark as a local inline SVG (GithubMark.tsx), pushing
    // this chunk ~38 B over the old 94 kB ceiling.
    // Bumped 95 → 97 kB: the split-pane "Default view mode" Select in
    // FormatsSettings (Source/Split/Preview) pushed this ~140 B over the old
    // 95 kB ceiling; +2 kB restores headroom.
    // Bumped 97 → 99 kB: vite 8 (rolldown) emits ~2 kB more module-wrapper
    // overhead on this chunk than rollup did for identical source inputs
    // (95.35 → 97.5 kB across the bundler swap alone); +1.5 kB headroom.
    name: "LAZY: Settings page",
    path: "dist/assets/Settings-*.js",
    limit: "99 kB",
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
    // CSS-as-JS string blob for HTML export (raw editor/plugin CSS + inline
    // KaTeX fonts). Lazy via the export flow. The chunk is pinned by name in
    // vite.config.ts manualChunks — rolldown otherwise renames/merges it and
    // the budget silently stops matching anything.
    // Bumped 470 → 480 kB: vite 8 (rolldown) module-wrapper overhead on the
    // base64 font strings (461.6 → 472.8 kB across the bundler swap alone).
    name: "LAZY: htmlExportStyles",
    path: "dist/assets/htmlExportStyles-*.js",
    limit: "480 kB",
    brotli: false,
  },
];
