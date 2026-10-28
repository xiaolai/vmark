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

/**
 * The CodeMirror packages the app reaches through STATIC imports, and so the
 * only ones allowed on the cold-start path. `@codemirror/lang-markdown` (the
 * Source editor's language) statically imports lang-html, which imports
 * lang-css and lang-javascript — those four and their parsers are eager
 * whichever chunk holds them.
 */
const EAGER_CODEMIRROR_CORE: ReadonlySet<string> = new Set([
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@codemirror/commands",
  "@codemirror/autocomplete",
  "@codemirror/search",
  "@codemirror/lint",
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
]);

/** The primitives every Settings panel shares: buttons, inputs, layout, search context, tag input. */
const SETTINGS_PRIMITIVES =
  /\/src\/pages\/settings\/(?:components|buttons|inputs|layout|TagInput|SettingsSearchContext)\.tsx?$/;

/**
 * The agent-edit provenance core, by exact production basename. Its runtime
 * imports stay inside this set (its outward imports are type-only), so
 * pinning it moves only these modules — unlike the format surfaces, whose
 * private dependency subtrees rode along into a 1.07 MB chunk (see the
 * manualChunks test). `provenanceSessions.ts`, `sessionTypes.ts` (type-only)
 * and the collectors are deliberately NOT here: the sessions layer reaches
 * stores, persistence and journal services, and pinning it would drag them in.
 */
const AGENT_JOURNAL_PROVENANCE_CORE =
  /\/src\/services\/agentJournal\/provenance\/(?:session|pieces|accumulator|payload|codec|window|epochLease|certificates|intervals)\.ts$/;

/** What `chunkFileNames` reads of an emitted chunk. */
export interface ChunkNaming {
  name: string;
  moduleIds: readonly string[];
}

/**
 * The emitted FILE name of a chunk. Renaming here never changes what a chunk
 * holds — pinning a module in `manualChunks` does, by pulling its importers'
 * shared dependencies along (pinning the Settings primitives there made a
 * 22 kB chunk the entry, App and vendor-react all imported from).
 *
 *   - The Settings page emits as `SettingsPage-*`: its own name differs from
 *     the i18n `settings-*` locale chunks only by case, and size-limit globs
 *     match case-insensitively, so its budget swept them in.
 *   - The chunk of shared Settings primitives emits as `settingsPrimitives-*`.
 *     Rolldown names it after one of its modules (`components-*`), too
 *     generic for a budget glob. Matched by content: every app module in it
 *     is a primitive; a chunk that also holds anything else keeps its name,
 *     and the budget then fails loudly on finding no file.
 */
export function chunkFileNames(chunk: ChunkNaming): string {
  if (chunk.name === "Settings") return "assets/SettingsPage-[hash].js";
  const appModules = chunk.moduleIds.filter((id) => id.includes("/src/"));
  if (appModules.length > 0 && appModules.every((id) => SETTINGS_PRIMITIVES.test(id))) {
    return "assets/settingsPrimitives-[hash].js";
  }
  return "assets/[name]-[hash].js";
}

/**
 * The app-side pins, checked before any package dispatch: a module that must
 * land in a named chunk whatever imports it. Undefined when none applies.
 */
function sourcePin(id: string): string | undefined {
  // Vite's preload helper is a tiny runtime module. Left to Rollup it
  // gets co-located into whichever vendor chunk is convenient
  // (historically vendor-mermaid), which then drags that whole chunk
  // into the entry's static-import graph and onto the cold-start
  // modulepreload list. Pin it to vendor-react, which is always
  // eagerly loaded anyway.
  //
  // MEASURED: this pin no longer takes effect. The id
  // reaching here IS "\0vite/preload-helper.js" and this branch DOES return
  // "vendor-react", but vite 8 / rolldown emits the helper into
  // `vendor-codemirror-languages-*` regardless, and `vendor-react-*` imports
  // it back from there. Because that chunk statically imports
  // `vendor-codemirror`, every chunk containing a dynamic import transitively
  // reaches vendor-codemirror — which is why check-eager-chunks.mjs cannot
  // denylist the codemirror family. Relocating the helper under rolldown is
  // its own change (advancedChunks), not this one.
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
    // export code imports .css?raw / .woff2?inline (checked),
    // so this can't drag app CSS or fonts in.
    id.includes(".css?raw") ||
    id.includes(".woff2?inline")
  ) {
    return "htmlExportStyles";
  }
  // Still eager, on purpose — moved, not deferred. It rode the shared
  // `popupComponents` side chunk and pushed it past its budget; a named chunk
  // gives these bytes their own budget in .size-limit.cjs, so they cannot
  // hide in, or excuse growth of, popupComponents. Lazy-loading on first edit
  // was rejected: it puts a load between an edit and its provenance capture.
  if (AGENT_JOURNAL_PROVENANCE_CORE.test(id)) return "agentJournalProvenance";
  return undefined;
}

/** The package a `node_modules` id belongs to, read from its LAST `node_modules/` segment. */
function packageName(id: string): string {
  const parts = id.split("node_modules/");
  const pkgPath = parts[parts.length - 1] ?? "";
  return pkgPath.startsWith("@") ? pkgPath.split("/").slice(0, 2).join("/") : (pkgPath.split("/")[0] ?? "");
}

/** One vendor rule: the packages it matches, and their chunk (undefined: left to Rolldown). */
type VendorRule = readonly [matches: (pkg: string) => boolean, chunk: string | undefined];
const named = (...names: string[]) => (pkg: string) => names.includes(pkg);
const prefixed = (...prefixes: string[]) => (pkg: string) => prefixes.some((p) => pkg.startsWith(p));

/** The vendor families, in order: the first rule that matches decides. */
const VENDOR_RULES: readonly VendorRule[] = [
  [named("@codemirror/language-data"), "vendor-codemirror-languages"],
  // Only the CodeMirror CORE is eager — everything the Source editor reaches
  // through static imports. It stays one chunk: splitting @codemirror/lang-*
  // from @codemirror/language into separate NAMED chunks once caused
  // "Cannot access 'kn' before initialization" in production builds.
  [(pkg) => EAGER_CODEMIRROR_CORE.has(pkg), "vendor-codemirror"],
  // Every other grammar is reached only through language-data's `load()` or
  // sourceLanguage.ts's `await import()`. Pinning them here made ~1 MB of
  // grammars (legacy-modes alone is 448 kB) cold-start cost in every window:
  // +29 MB WebContent footprint to evaluate the chunk in WebKit, against
  // +13 MB for the core alone (measured). Left unassigned, each
  // chunks by its import site and imports the core one way, so no cycle can
  // form. An unknown future package lands here too — lazy is the safe default.
  [prefixed("@codemirror/", "@lezer/"), undefined],
  [prefixed("@tiptap/", "prosemirror"), "vendor-tiptap"],
  // DOMPurify is imported eagerly by src/utils/sanitize.ts. Without an
  // explicit chunk, Rollup co-locates it into vendor-mermaid, which then
  // forces a modulepreload of the entire ~1.7 MB mermaid chunk (and the
  // ~630 KB vendor-graph it pulls) on cold start — just to reach a ~20 KB
  // sanitizer. Isolating it keeps mermaid genuinely lazy.
  [named("dompurify"), "vendor-dompurify"],
  // The TOML parser is imported on first use (lib/formats/adapters/
  // tomlParser.ts). Naming it lets check-eager-chunks.mjs require that it
  // stays off the cold-start path — it sat in the entry chunk of every window
  // while the adapters imported it statically.
  [named("smol-toml"), "vendor-toml"],
  // `@dagrejs/dagre` (maintained fork) is used only by workflow
  // layout (lib/workflow/layout.ts) which
  // is reached lazily through WorkflowSidePanel. Mermaid uses its own bundled
  // fork (`dagre-d3-es`), so isolating plain `dagre` is safe and removes ~150 KB
  // from the eagerly-loaded vendor-mermaid chunk.
  [named("@dagrejs/dagre", "dagre"), "vendor-dagre"],
  // @xyflow/react (React Flow) is reached only through lazily-mounted graph
  // surfaces (workflow canvas, KB graph). Left unassigned it lands in an
  // incidentally-named chunk (`style-*`, from its stylesheet import), which
  // check-eager-chunks.mjs cannot denylist without also matching
  // htmlExportStyles. Naming the family is what makes the eager gate able to
  // see it — and it drags weight: xyflow's d3-drag/d3-selection/d3-zoom
  // dependencies chunk into vendor-mermaid, so anything that statically
  // imports xyflow also pulls ~3 MB of mermaid + cytoscape.
  [prefixed("@xyflow/"), "vendor-xyflow"],
  // Keep all mermaid-related packages together to avoid circular dependency issues.
  // Previously splitting mermaid, @mermaid-js/*, d3-*, dagre-d3-es caused
  // "this.clear is not a function" error in production builds.
  [(pkg) => named("mermaid", "d3", "dagre-d3-es", "khroma")(pkg) || prefixed("@mermaid-js/", "d3-")(pkg), "vendor-mermaid"],
  // Graphviz WASM build (@viz-js/viz). Reached only through the graphviz
  // plugin's `await import(...)` — isolating it keeps the ~1.5 MB WASM blob
  // off the cold-start path (denylisted in scripts/check-eager-chunks.mjs,
  // budgeted as LAZY in .size-limit.cjs).
  [named("@viz-js/viz"), "vendor-graphviz"],
  // KaTeX stays in main bundle to preserve CSS cascade order.
  // Separate chunk would load before index.css, causing Tailwind's
  // preflight (border:0) to override KaTeX's border-style settings.
  // The PDF export stack, split by library.
  [named("html2canvas", "stackblur-canvas"), "vendor-html2canvas"],
  [named("jspdf"), "vendor-jspdf"],
  [named("html2pdf.js"), "vendor-html2pdf"],
  [named("canvg", "svg-pathdata"), "vendor-export"],
  [named("cytoscape", "cytoscape-cose-bilkent", "cytoscape-fcose", "cose-base", "layout-base"), "vendor-graph"],
  [prefixed("@tauri-apps/"), "vendor-tauri"],
  [named("react-router-dom", "react-router", "react-dom", "react"), "vendor-react"],
  [(pkg) => pkg === "zustand" || pkg.startsWith("@tanstack/"), "vendor-state"],
  [prefixed("remark", "unified", "mdast", "micromark"), "vendor-markdown"],
];

/** The chunk a module is pinned to: an app-side pin, else its vendor family, else Rolldown's choice. */
export function manualChunks(id: string): string | undefined {
  const pinned = sourcePin(id);
  if (pinned !== undefined) return pinned;
  if (!id.includes("node_modules")) return undefined;
  const pkg = packageName(id);
  return VENDOR_RULES.find(([matches]) => matches(pkg))?.[1];
}
