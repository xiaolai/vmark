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
    //
    // Ratcheted 1300 → 20 kB by WI-13; actual 14.3 kB. The 1219 kB the old
    // limit was calibrated against is long gone — later chunking work moved
    // that code into App and the vendor chunks, and nobody lowered the number,
    // so this budget has been ~90x above reality and could not have failed on
    // anything. WI-13 itself ADDS ~4 kB here (10.4 → 14.3): the format
    // adapters' import thunks compile to dynamic-import glue that lives in the
    // entry chunk. That is the trade — 4 kB of glue in exchange for 0.66 MB
    // off the cold-start closure — and it is the reason the headroom is 40%
    // rather than the file's usual 5%: more lazy boundaries mean more glue.
    name: "EAGER: entry",
    path: "dist/assets/entry-*.js",
    limit: "20 kB",
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
    //
    // Ratcheted 1400 → 610 kB by WI-12; actual 577 kB. The 1400 came from
    // Phase 2 (WI-2.6) of the GHA workflow viewer, whose stated reason was
    // that xyflow + dagre (~150 kB) rode this chunk eagerly because
    // GhaWorkflowSidePanel had to be eager-mounted (a React 19 + Suspense +
    // xyflow setState loop in disappearLayoutEffects). Neither half still
    // holds: WorkflowCanvas moved the Suspense boundary next to the canvas
    // instead of the panel mount and the loop went away, and WI-12 did the
    // same for KbGraphView — the last static xyflow import in this chunk.
    // The budget follows the justification down.
    //
    // NOTE this number is the App chunk alone. It never measured the App
    // chunk's static GRAPH, which is where the real cold-start weight was:
    // one static import of xyflow pulled vendor-mermaid + vendor-graph in
    // behind it. `pnpm lint:eager` is what checks that now.
    name: "EAGER: App",
    path: "dist/assets/App-*.js",
    // 610 → 612 kB (2026-08-29): the UI-consistency plan's eager additions —
    // the confirmAction dialog funnel and commandErrorMessage at the toast
    // boundary (type-aware gate: String(detail) on a typed rejection renders
    // "[object Object]") — landed the chunk 23 B over. Kept tight so the next
    // unjustified growth still trips.
    // 612 → 614 kB (2026-09-05, #1357): the file explorer's rescan scheduler —
    // debounce, no-starvation bound and back-off under churn, replacing the
    // rescan-per-event loop that pinned a core — landed the chunk 1.17 kB over.
    // Same discipline: the smallest raise that fits, so growth without a reason
    // still trips.
    limit: "614 kB",
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
    // CodeMirror Source-mode wrapper. Lazy via React.lazy in the markdown
    // surface. Bumped 140 → 145 kB after Phase A/B GHA features (WI-A.1
    // expression autocomplete, WI-B.2 goto-def, WI-B.3 cursor sync).
    // Each adds a small CodeMirror extension; total ~1 kB minified.
    //
    // Ratcheted 145 → 80 kB by WI-13; actual 70.9 kB (69.5 kB before, so the
    // WI moved ~1.4 kB in, not out — the old limit was simply stale).
    name: "LAZY: SourceEditor",
    path: "dist/assets/SourceEditor-*.js",
    limit: "80 kB",
    brotli: false,
  },
  {
    // The markdown WYSIWYG surface, split out of the markdown ADAPTER by
    // WI-13 and reached only through `FormatConfig.wysiwygComponent`'s import
    // thunk. It was previously inside the eagerly-evaluated formats chunk, so
    // every window — Settings, PDF export — paid it at cold start. Budgeted
    // now that it is a chunk: unbudgeted is how weight migrates unnoticed.
    // ~188 kB at the split.
    name: "LAZY: markdownSurface",
    path: "dist/assets/markdownSurface-*.js",
    limit: "200 kB",
    brotli: false,
  },
  {
    // The yaml adapter's gha-workflow schemaRenderer (workflow IR parse +
    // the workbench mount), lazy since WI-13 for the same reason: the yaml
    // adapter is always registered, so a static reference was cold start for
    // every window. ~10 kB at the split; the workbench and xyflow it mounts
    // are their own chunks.
    name: "LAZY: yamlWorkflowRenderer",
    path: "dist/assets/yamlWorkflowRenderer-*.js",
    limit: "15 kB",
    brotli: false,
  },
  {
    // @xyflow/react itself. Named as its own chunk by WI-12 (scripts/
    // manualChunks.ts) so check-eager-chunks.mjs can denylist the family —
    // unassigned it landed in an incidentally-named `style-*` chunk that no
    // gate could target without also matching htmlExportStyles.
    // LAZY: every graph surface (workflow canvas, KB graph) is behind a
    // React.lazy boundary. Keeping it that way matters more than its own
    // 120 kB — xyflow's d3-* dependencies chunk into vendor-mermaid, so one
    // static import of it drags ~3.1 MB onto cold start.
    name: "LAZY: vendor-xyflow",
    path: "dist/assets/vendor-xyflow-*.js",
    limit: "130 kB",
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
    // Bumped 99 → 101 kB: the "Preserve blank lines" toggle in EditorSettings
    // plus the WhitespaceSettings extraction (a new module boundary, added to
    // keep EditorSettings.tsx under its file-size baseline) pushed this ~98 B
    // over the old 99 kB ceiling; +2 kB restores headroom.
    // Bumped 101 → 103 kB: the `ConfigUnreadable` diagnostic state (a config
    // VMark cannot parse is no longer reported as "not installed", so the row
    // gains an icon arm, a Recheck action and its strings) plus the
    // mcpConfigMessages extraction — a new module boundary added to keep
    // McpConfigInstaller.tsx under its file-size baseline — pushed this ~53 B
    // over the old 101 kB ceiling. Same shape as the 99 → 101 bump above, and
    // the same trade: a size-limit byte cost paid to satisfy the file-size
    // gate. +2 kB restores headroom.
    // Bumped 103 → 105 kB: the type-aware lint adoption turned every silently
    // dropped promise on the settings pages into a routed one — `void x()`
    // became `void x().catch((e) => log(...))`, which costs a logger import and
    // a message string per site across McpConfigInstaller, IntegrationsSettings,
    // RestProviderConfigFields, AboutSettings and ModelComboBox. Measured 66 B
    // over the old 103 kB ceiling. The bytes buy error reports that previously
    // vanished, so this is a real feature paying a real cost, not drift; +2 kB
    // restores headroom on the same schedule as the two bumps above.
    name: "LAZY: Settings page",
    path: "dist/assets/SettingsPage-*.js",
    limit: "105 kB",
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
