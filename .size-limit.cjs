/**
 * Bundle size budget for VMark.
 *
 * Each entry pins the maximum byte size of a built chunk. Limits sit 5%
 * above current sizes — rounded up to 0.1 kB under 10 kB, 0.5 kB under
 * 100 kB, 1 kB above — so day-to-day bumps pass while accidental regressions
 * (e.g. a vendor chunk that was lazy becoming eagerly imported) trip CI. A
 * limit far above its chunk lets a regression of that size through
 * unnoticed, so a chunk that shrinks takes its limit down with it.
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
 * ONE positive glob per budget (negations are fine). size-limit fails when a
 * budget's globs match no file at all, which is what makes a renamed chunk
 * loud — but with two positive globs, one can go dead while the other keeps
 * the budget passing. scripts/check-size-budgets.test.mjs enforces the rule
 * and pins size-limit's no-match failure against the installed CLI.
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
    //
    // 20 → 200 kB with vite 8.2.1 → 8.3.1: its Rolldown merges shared chunks
    // into their importers, so the store/format/update-sync code the entry
    // statically imported from side chunks (documentStore, formats,
    // useUpdateSync, debounce, …) now lives IN it. Nothing new loads: the
    // whole cold-start closure went 3.05 → 3.09 MiB (+1.3%, dependency
    // bumps), and `pnpm lint:eager` now enforces that closure's total
    // (MAX_EAGER_BYTES), which is the number launch cost actually follows.
    // Actual 189.6 kB.
    //
    // Ratcheted 200 → 145 kB; actual 137.6 kB. The startup work that followed
    // took it to 146.2 kB without the limit following it down, and the JSON
    // tree view (react-json-view-lite, 7.9 kB) then left for its own lazy
    // chunk: the format adapters are registered in every window, but the tree
    // is needed only once a preview pane shows one.
    //
    // smol-toml (11.1 kB) then left too: the TOML validator, schema detector
    // and previews load the parser on first use (formats/adapters/
    // tomlParser.ts) into its own chunk, budgeted below, and re-run once it
    // arrives. 133.7 -> 123.3 kB.
    //
    // The lint engine (lintEngine/*, 11.8 kB) then moved IN from the eager
    // documentStore chunk: the lint store stopped importing the engine and
    // reaches it only through the format adapters' `lint`, which the entry
    // registers. documentStore shrank 29.9 -> 17.9 kB, and the cold-start
    // closure is unchanged (3.14 MB both builds, held by MAX_EAGER_BYTES).
    // 123.3 -> 136.4 kB.
    name: "EAGER: entry",
    path: "dist/assets/entry-*.js",
    // Re-measured 130 kB -> 144 kB (its size plus 5%, rounded up): actual 136.4 kB.
    limit: "144 kB",
    brotli: false,
  },

  {
    // React + react-dom + react-router. Preloaded by index.html.
    // 240 → 270 kB: React 19.2 → 19.3, whose react-dom client build is
    // ~30 kB larger minified (measured per module). Actual 256.9 kB.
    name: "EAGER: vendor-react",
    path: "dist/assets/vendor-react-*.js",
    limit: "270 kB",
    brotli: false,
  },
  {
    // @tauri-apps/api + plugin-* shims. Should stay tiny.
    name: "EAGER: vendor-tauri",
    path: "dist/assets/vendor-tauri-*.js",
    // Ratcheted 45 kB -> 34 kB (re-measured to its size plus 5%): actual 32.3 kB.
    limit: "34 kB",
    brotli: false,
  },
  {
    // Zustand + @tanstack/* (when present). ~4 kB today. The limit is
    // tight to catch a regression like "we accidentally pulled the whole
    // @tanstack/react-query package back in" before it ships; raise it
    // (with a note) when adding a real new state library.
    name: "EAGER: vendor-state",
    path: "dist/assets/vendor-state-*.js",
    // Ratcheted 10 kB -> 5.6 kB (re-measured to its size plus 5%): actual 5.3 kB.
    limit: "5.6 kB",
    brotli: false,
  },
  {
    // Tiptap + ProseMirror. Eager because the editor is the home screen.
    // Bumped 470 → 500 kB: Tiptap 3.18 → 3.27 (9 minor releases of the core
    // editor) added ~18 kB; actual ~488 kB.
    name: "EAGER: vendor-tiptap",
    path: "dist/assets/vendor-tiptap-*.js",
    // Ratcheted 500 kB -> 491 kB (re-measured to its size plus 5%): actual 467.6 kB.
    limit: "491 kB",
    brotli: false,
  },
  {
    // CodeMirror CORE only (EAGER_CODEMIRROR_CORE in scripts/manualChunks.ts).
    // The negation glob excludes the `vendor-codemirror-languages-*` chunk
    // below so growth in EITHER chunk fails its own budget rather than hiding
    // in the sum.
    // Ratcheted 1700 → 660 kB (B5, 2026-09-22; actual 626 kB): every grammar
    // language-data loads lazily used to be pinned here — 1.64 MB, of which
    // legacy-modes alone was 459 kB — and evaluating it cost +29 MB of
    // WebContent footprint per window vs +13 MB for the core. This budget is
    // what keeps them out: a pin that re-captures the grammars more than
    // doubles the chunk and fails here.
    name: "EAGER: vendor-codemirror",
    path: [
      "dist/assets/vendor-codemirror-*.js",
      "!dist/assets/vendor-codemirror-languages-*.js",
    ],
    limit: "660 kB",
    brotli: false,
  },
  {
    // @codemirror/language-data registry (~140 lang loaders). Tiny by itself
    // (~24 kB) but the per-language chunks it triggers add up. Pinning the
    // registry size guards against accidental eager imports of language modules.
    name: "EAGER: vendor-codemirror-languages",
    path: "dist/assets/vendor-codemirror-languages-*.js",
    // Ratcheted 30 kB -> 22 kB (re-measured to its size plus 5%): actual 20.6 kB.
    limit: "22 kB",
    brotli: false,
  },
  {
    // Mermaid + @mermaid-js/* + d3-* + dagre-d3-es + khroma. LAZY since
    // the preload-helper pinning (see vite.config.ts manualChunks): loads
    // on first diagram render, not at cold start.
    // Bumped 1750 → 2600 kB: Mermaid 11.12 → 11.16 added ~800 kB (new diagram
    // types + deps); actual ~2.49 MB. Acceptable because this chunk is lazy
    // (never in the cold-start path).
    // Bumped 2600 → 4400 kB: Mermaid 11.16 → 12.0 bundles ELK internally
    // (it became the default layout engine); actual 4.19 MB. VMark pins
    // `layout: "dagre"` so it does not USE elk, but v12 ships it either way —
    // the cost is not opt-out-able short of staying on v11. Still acceptable
    // on the same grounds as before, and more so here: VMark is a desktop app,
    // so this is bytes on disk rather than bytes over a network, and the chunk
    // is parsed only when a document actually contains a diagram.
    name: "LAZY: vendor-mermaid",
    path: "dist/assets/vendor-mermaid-*.js",
    limit: "4400 kB",
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
    // Ratcheted 1430 kB -> 1424 kB (re-measured to its size plus 5%): actual 1356.2 kB.
    limit: "1424 kB",
    brotli: false,
  },
  {
    // remark + unified + mdast + micromark. Eager because markdown
    // parsing happens on first open.
    name: "EAGER: vendor-markdown",
    path: "dist/assets/vendor-markdown-*.js",
    // Ratcheted 410 kB -> 136 kB (re-measured to its size plus 5%): actual 128.8 kB.
    limit: "136 kB",
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
    // 614 → 765 kB (vite 8.2.1 → 8.3.1): its Rolldown merges shared chunks
    // into their importers, so side chunks App statically imported now live
    // IN it — the same move that grew `entry`. The cold-start closure moved
    // 3.05 → 3.09 MiB, and `pnpm lint:eager` enforces that total now.
    // Actual 762.1 kB; smallest raise that fits, as above.
    // Ratcheted 765 → 731 kB; actual 695.6 kB. Classic zod (88 kB) rode this
    // chunk for the hot-exit session schemas and one non-empty-string check:
    // its chainable API cannot be tree-shaken, so two small consumers brought
    // the whole library to cold start. The schemas moved to `zod/mini` (24 kB
    // with the English messages) and the string check became a type guard.
    // The limit is the new size plus this file's usual 5%, which is what a
    // budget needs in order to catch a regression of that kind — classic zod
    // coming back is +64 kB — without tripping on the next ordinary feature.
    // 731 → 735 kB (#1591): the agent-edit ledger's eager capture path — the
    // journal status, document-identity and save-capture clients, which must
    // be loaded before the first edit so no edit goes unrecorded — landed the
    // chunk at 734.6 kB. Smallest raise that fits, as above.
    // The agent write path then took it to 773.6 kB. 26.3 kB of that was the
    // whole-text diff engine (diff-match-patch and the canonical diff), which
    // only a whole-text agent write needs: it is now imported on first use and
    // has a lazy chunk of its own. 735 → 747.5 kB for the rest, which runs on
    // every agent write: the request coordinator, page registration, request
    // ending and the selection certificate (#1591). Actual 747.3 kB; smallest
    // raise that fits, as above.
    // 747.5 → 751.5 kB (#1591): review and history additions that every
    // journal reply or controlled write decodes — the hunk review states the
    // history decoder validates (reviewTransitions), the expected head every
    // controlled prepare names (expectedHead), and the lazy wrapper that
    // keeps the review panel and the two-windows pair view out of this chunk
    // (lazyHistoryParts) — took it to 751,089 bytes. Smallest raise that fits.
    limit: "751.5 kB",
    brotli: false,
  },
  {
    // The shared side chunk Rolldown names after src/utils/popupComponents:
    // modules reached both from App-side code and from the lazy surfaces
    // land here, and index.html modulepreloads it. It was unbudgeted, so
    // weight could migrate into cold start without any per-chunk gate
    // noticing. Budgeted when the markdown paste extension and turndown
    // (htmlToMarkdown) left it: once the AI suggestion, genie and HTML paste
    // paths imported the slice builder in plugins/shared/markdownPasteSlice
    // instead of markdownPaste/tiptap, those modules were reachable only
    // from markdownSurface. 287,385 -> 264,644 bytes. Limit = new size times
    // the markdownSurface headroom ratio (285,000 / 267,339 = 1.0661), so the
    // 22.7 kB that left cannot come back silently.
    name: "EAGER: popupComponents (shared side chunk)",
    // Rolldown names this chunk after one of its modules. When
    // contentApplied moved to services/editor (services may not import
    // components) it became the chunk's name; the members and the budget
    // are unchanged (267,772 bytes). Then the WYSIWYG collector
    // (services/agentJournal/collectors/wysiwyg) joined it and it took that
    // name; contentApplied's glob matched nothing and size-limit failed loud.
    path: "dist/assets/wysiwygCollector-*.js",
    // Ratcheted 283 kB -> 280 kB (re-measured to its size plus 5%): actual 265.8 kB.
    // The agent-edit ledger's provenance core then landed here and took the
    // chunk to 284,325 bytes. It now has its own chunk and budget (below), so
    // this one is back to 267,270. Its size plus 5% rounds to 281 kB, which
    // would RAISE the limit, so it stays at 280 kB (4.8% headroom).
    // 280 → 281.5 kB (#1591): the WYSIWYG collector (block map, transaction
    // ledger, step correspondence) and the serializer's span map, 13.6 kB,
    // which must be loaded before the first WYSIWYG edit so none goes
    // unrecorded, took it to 281,436 bytes. Smallest raise that fits.
    // 281.5 → 291 kB: bytes MOVED in, nothing new. When the review panel
    // became a lazy chunk, Rolldown dissolved two side chunks index.html
    // already modulepreloaded — markmap (the markmap and graphviz plugins)
    // and popupHostDom (popup positioning, media path and security helpers,
    // unifiedHistory) — and about 9 kB of their modules landed here: 281,490
    // -> 290,524 bytes. The modulepreloaded total rose 14.6 kB, 12.2 kB of
    // it the App and provenance growth budgeted beside this; `pnpm lint:eager`
    // caps that total. Smallest raise that fits.
    limit: "291 kB",
    brotli: false,
  },
  {
    // The agent-edit provenance core (src/services/agentJournal/provenance:
    // session, pieces, accumulator, payload, codec, window, epochLease,
    // certificates, intervals), pinned by scripts/manualChunks.ts. Still
    // eager — App and popupComponents import it statically, and index.html
    // modulepreloads it. These bytes were MOVED out of popupComponents
    // (284,325 -> 267,270 there; 16,976 here), not added. A budget of its own
    // keeps them from hiding in, or excusing growth of, the shared side chunk.
    // Both budgets together allow 298 kB, under 5% over their combined
    // 284,246 bytes; `pnpm lint:eager` still caps the cold-start total.
    name: "EAGER: agentJournalProvenance (provenance core)",
    path: "dist/assets/agentJournalProvenance-*.js",
    // Size plus 5%, rounded up to 0.5 kB: actual 17.0 kB.
    // 18 → 19.5 kB: the decoder's hostile-input checks (exact keys at every
    // level, safe integers, the piece cap enforced during expansion) took it
    // to 19,040 bytes. Smallest raise that fits.
    // 19.5 → 20 kB: the capture id a save names (captureId) took it to
    // 19,785 bytes. Smallest raise that fits.
    // 20 → 21.5 kB: the window chain (windowChain), which keeps a frozen
    // window's copy until its freeze settles so a released revert can put it
    // back, took it to 21,198 bytes. Smallest raise that fits.
    limit: "21.5 kB",
    brotli: false,
  },

  // --- LAZY CHUNKS (off cold-start path) ---

  {
    // Plain `dagre` (workflow layout). Split out from vendor-mermaid by B1
    // so it only loads with WorkflowSidePanel.
    name: "LAZY: vendor-dagre (workflow only)",
    path: "dist/assets/vendor-dagre-*.js",
    // Ratcheted 100 kB -> 49 kB (re-measured to its size plus 5%): actual 46.4 kB.
    limit: "49 kB",
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
    // Ratcheted 80 kB -> 66 kB (re-measured to its size plus 5%): actual 62.7 kB.
    limit: "66 kB",
    brotli: false,
  },
  {
    // The markdown WYSIWYG surface, split out of the markdown ADAPTER by
    // WI-13 and reached only through `FormatConfig.wysiwygComponent`'s import
    // thunk. It was previously inside the eagerly-evaluated formats chunk, so
    // every window — Settings, PDF export — paid it at cold start. Budgeted
    // now that it is a chunk: unbudgeted is how weight migrates unnoticed.
    // ~188 kB at the split.
    //
    // 200 → 285 kB with vite 8.2.1 → 8.3.1 (its Rolldown merges shared chunks
    // into their importers): 60 app modules the Source-mode CodeMirror
    // plugins share with this surface now live IN this file instead of in
    // side chunks it statically imported. What opening a markdown document
    // loads (this chunk plus its static imports) went 2,876.6 → 2,894.4 kB,
    // 78 → 35 files: +0.6%, from the dependency bumps, not the move.
    // Actual 272.4 kB.
    //
    // 285 -> 309 kB: bytes moved IN, nothing new. The markdown paste
    // extension, htmlToMarkdown and turndown left the cold-start
    // popupComponents chunk (287,385 -> 264,644 bytes) when their App-side
    // importers switched to plugins/shared/markdownPasteSlice, so they now
    // live only here (267,339 -> 289,772 bytes). All chunks together shrank
    // about 0.3 kB, and the cold-start closure fell 3,246,541 -> 3,223,808
    // bytes (MAX_EAGER_BYTES lowered to match). Limit = new size times the
    // old headroom ratio (285,000 / 267,339 = 1.0661), and popupComponents
    // now has its own budget, so the move is a net tightening.
    name: "LAZY: markdownSurface",
    path: "dist/assets/markdownSurface-*.js",
    // Ratcheted 309 kB -> 307 kB (re-measured to its size plus 5%): actual 291.9 kB.
    limit: "307 kB",
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
    // Ratcheted 15 kB -> 11.5 kB (re-measured to its size plus 5%): actual 10.9 kB.
    limit: "11.5 kB",
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
    // Ratcheted 135 kB -> 1.5 kB (re-measured to its size plus 5%): actual 1.4 kB.
    limit: "1.5 kB",
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
    //
    // Ratcheted 105 → 15 kB; actual 13.5 kB. This chunk is now the Settings
    // SHELL — window chrome, navigation, search and the panel loader. Each
    // section's panel is a chunk of its own, loaded when the section is first
    // shown (pages/settings/panels.ts), and budgeted together below. Seven of
    // the bumps above were a toggle or a string landing on a chunk with no
    // room left; that pressure is gone from here, and a panel that is imported
    // statically again brings its bytes back to this chunk and fails this
    // limit.
    name: "LAZY: Settings page",
    path: "dist/assets/SettingsPage-*.js",
    // Ratcheted 15 kB -> 14.5 kB (re-measured to its size plus 5%): actual 13.6 kB.
    limit: "14.5 kB",
    brotli: false,
  },
  // The eleven Settings panels, one chunk per section, 102.6 kB together at
  // the split. A session loads the shell plus the sections it visits, and all
  // of the searchable ones on the first search. One budget per chunk, not one
  // glob over all of them: a panel chunk the bundler renamed would drop out of
  // a sum without failing it. Each limit is its size plus 5%, rounded as the
  // header says. The primitives the panels share have their own budget below.
  ...[
    ["AboutSettings", "11.5 kB"],
    ["AdvancedSettings", "7.1 kB"],
    // 3.6 → 4.0 kB: the Sidebar group (sidebar style, flat or card) adds
    // its Select row; actual 3.78 kB.
    ["AppearanceSettings", "4.0 kB"],
    ["EditorSettings", "9.6 kB"],
    ["FilesImagesSettings", "8.9 kB"],
    ["FormatsSettings", "5.2 kB"],
    ["IntegrationsSettings", "33.5 kB"],
    ["LanguageSettings", "8.7 kB"],
    ["MarkdownSettings", "5.1 kB"],
    // Re-measured 8.7 -> 9.4 kB: Remove Shortcut, Reassign on conflict and
    // the menu-sync notice are new behaviour in this panel (ShortcutRow.tsx,
    // KeyCapture.tsx); actual 8.88 kB.
    ["ShortcutsSettings", "9.4 kB"],
    ["TerminalSettings", "7.4 kB"],
  ].map(([chunk, limit]) => ({
    name: `LAZY: Settings panel ${chunk}`,
    path: `dist/assets/${chunk}-*.js`,
    limit,
    brotli: false,
  })),
  {
    // The primitives every Settings panel shares (settings/buttons, inputs,
    // layout, the search context, the tag input). Rolldown names the chunk
    // after one of its modules (`components-*`), too generic for a glob, so
    // vite.config.ts renames the emitted FILE by its content
    // (scripts/manualChunks.ts chunkFileNames) — what the chunk holds is
    // unchanged. 7.4 kB.
    name: "LAZY: settingsPrimitives",
    path: "dist/assets/settingsPrimitives-*.js",
    limit: "7.8 kB",
    brotli: false,
  },
  {
    // smol-toml, the TOML parser, loaded the first time a TOML document is
    // validated or previewed (formats/adapters/tomlParser.ts). It sat in the
    // entry chunk of every window while the adapters imported it statically;
    // check-eager-chunks.mjs requires it to stay off the cold-start path.
    // 11.1 kB.
    name: "LAZY: vendor-toml",
    path: "dist/assets/vendor-toml-*.js",
    limit: "12 kB",
    brotli: false,
  },
  {
    // react-json-view-lite plus VMark's styles for it: the tree the JSON, TOML
    // and YAML previews draw, loaded on first use (formats/adapters/
    // LazyJsonTree.tsx). 8.5 kB at the split.
    name: "LAZY: jsonTreeView",
    path: "dist/assets/jsonTreeView-*.js",
    limit: "9 kB",
    brotli: false,
  },
  {
    // Export pipeline (DOC/PDF/HTML). Lazy.
    name: "LAZY: useExportOperations",
    path: "dist/assets/useExportOperations-*.js",
    // Ratcheted 90 kB -> 83 kB (re-measured to its size plus 5%): actual 79.0 kB.
    limit: "83 kB",
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
