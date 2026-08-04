#!/usr/bin/env node
/**
 * Eager-chunk regression gate (audit 20260612 H9; extended by WI-12).
 *
 * "Lazy chunk became eager" regressions were previously invisible: a stray
 * static import drags a heavyweight chunk onto the cold-start path and nothing
 * fails.
 *
 * WHAT WI-12 CHANGED — and why the previous version could not have caught
 * anything under App. The gate used to read `dist/index.html` alone. Vite emits
 * `<link rel=modulepreload>` only for the ENTRY chunk's static import graph;
 * `src/main.tsx` reaches the application through `await import("./App")` inside
 * `bootstrap()`, so every chunk under App is fetched at cold start but appears
 * nowhere in index.html. Measured on the pre-WI-12 build: App statically
 * imported the xyflow chunk, which statically imports vendor-mermaid (2.4 MB),
 * which statically imports vendor-graph (660 kB) — three denylisted-or-heavy
 * chunks on the boot path, with `lint:eager` green. The HTML list was never the
 * cold-start graph; it was the prefix of it that Vite happens to annotate.
 *
 * So the gate now walks the real thing: the static-import closure of
 * dist/assets, seeded from BOTH the HTML's eager assets AND the boot chunks
 * named in BOOT_CHUNK_PATTERNS. A boot chunk is one the entry awaits
 * unconditionally before first paint; App is the only one today, and the
 * pattern is spelled out here rather than inferred so that renaming it fails
 * the gate closed instead of silently emptying the seed set.
 *
 * HTML parsing stays attribute-order and quote-style agnostic (Codex audit: a
 * rel/href reorder or quote change in Vite's output must not silently disable
 * the gate). Both `<link rel=modulepreload href>` and `<script src>` count.
 *
 * Run after `pnpm build` (wired into check:all as lint:eager).
 * Helpers are exported for scripts/check-eager-chunks.test.ts.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Chunk families that must NEVER be reachable statically at cold start.
export const DENYLIST = [
  "vendor-mermaid",
  "vendor-graph",
  "vendor-graphviz",
  "vendor-export",
  // WI-12: @xyflow/react (123 kB) and @dagrejs/dagre (39 kB) belong to graph
  // surfaces that are all lazily mounted. xyflow additionally drags
  // vendor-mermaid in through its d3-* dependencies, so a static edge to it
  // costs ~3 MB, not 123 kB.
  "vendor-xyflow",
  "vendor-dagre",
];

/**
 * WI-13 — app-source modules that must reach the app ONLY through a dynamic
 * import, checked by existence AND by closure membership.
 *
 * The DENYLIST above cannot express this class. It matches chunk NAMES, and a
 * vendor family keeps its name whether it is eager or lazy — but an app module
 * that regresses to a static import stops being a chunk at all: rolldown
 * merges it into its importer, the name vanishes from dist/assets, and a
 * name-matching gate reports "clean" precisely when the regression happened.
 * That is the same fail-open shape `BOOT_CHUNK_PATTERNS` exists to close.
 *
 * So each pattern is checked twice: the chunk must EXIST (a missing one means
 * a static import inlined it) and must NOT be statically reachable at cold
 * start (a present one may still have been pulled onto the boot graph).
 *
 * All six are format-registry surfaces. `bootstrapFormats()` runs in every
 * window — Settings, PDF export — before `import("./App")`, so an adapter's
 * static import is cold-start cost for windows that never open an editor.
 * Measured on the pre-WI-13 build: 4.52 MB across 71 chunks, of which the
 * markdown WYSIWYG surface and the GHA workflow machinery were ~0.66 MB.
 *
 * NOT covered here, deliberately: `vendor-codemirror` and `vendor-tiptap`.
 * Both remain on the cold-start closure through paths outside the format
 * registry that this gate's own walk exposes — App's static graph reaches
 * @tiptap/pm through lintEngine → utils/headingSlug, and every chunk holding a
 * dynamic import reaches vendor-codemirror through the vite preload helper
 * (see scripts/manualChunks.ts). Listing them would be a gate that can never
 * go green rather than one that catches a regression.
 */
export const LAZY_ONLY_CHUNK_PATTERNS = [
  {
    re: /^markdownSurface-[^/]*\.js$/,
    why: "markdown adapter's wysiwygComponent thunk (the Tiptap WYSIWYG surface)",
  },
  {
    re: /^yamlWorkflowRenderer-[^/]*\.js$/,
    why: "yaml adapter's gha-workflow schemaRenderer (workbench + workflow IR parser)",
  },
  {
    re: /^sourceGhaIrSync-[^/]*\.js$/,
    why: "yaml adapter's loadExtraExtensions — GHA IR sync",
  },
  {
    re: /^sourceWorkflowCompletion-[^/]*\.js$/,
    why: "yaml adapter's loadExtraExtensions — ${{ }} completion",
  },
  {
    re: /^sourceWorkflowCursorSync-[^/]*\.js$/,
    why: "yaml adapter's loadExtraExtensions — cursor→canvas sync",
  },
  {
    re: /^sourceWorkflowGoto-[^/]*\.js$/,
    why: "yaml adapter's loadExtraExtensions — uses: goto-def",
  },
];

/**
 * Check the lazy-only patterns against a chunk listing and a closure.
 * Returns one finding per violation: `missing` (no chunk matched — a static
 * import inlined the module) or `eager` (matched but on the boot graph).
 */
export function findLazyOnlyViolations(names, reachable, patterns = LAZY_ONLY_CHUNK_PATTERNS) {
  const violations = [];
  for (const { re, why } of patterns) {
    const matches = names.filter((n) => re.test(n));
    if (matches.length === 0) {
      violations.push({ kind: "missing", pattern: String(re), why });
      continue;
    }
    for (const chunk of matches) {
      if (reachable.has(chunk)) {
        violations.push({ kind: "eager", pattern: String(re), why, chunk });
      }
    }
  }
  return violations;
}

/**
 * Chunks the entry awaits unconditionally at boot. Their static graph is
 * cold-start even though Vite emits no modulepreload link for them.
 * `src/main.tsx` → `bootstrap()` → `await import("./App")`.
 */
export const BOOT_CHUNK_PATTERNS = [/^App-[^/]*\.js$/];

/**
 * Parse one HTML tag's attributes into a lowercase-keyed map.
 * Handles double-quoted, single-quoted, and unquoted values in any order.
 */
function parseAttributes(tag) {
  const attrs = {};
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const m of tag.matchAll(re)) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

/** True when a rel attribute's space-separated token list contains `token`. */
function relContains(rel, token) {
  return (rel ?? "").toLowerCase().split(/\s+/).includes(token);
}

/**
 * Collect every asset URL the document loads eagerly at cold start:
 * modulepreload link hrefs first, then script srcs (matches the original
 * reporting order).
 */
export function collectEagerAssets(html) {
  const preloads = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    if (relContains(attrs.rel, "modulepreload") && attrs.href) {
      preloads.push(attrs.href);
    }
  }
  const scripts = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    if (attrs.src) scripts.push(attrs.src);
  }
  return [...preloads, ...scripts];
}

/** Filter asset names/URLs down to those in a denylisted chunk family. */
export function findOffenders(eager, denylist = DENYLIST) {
  return eager.filter((href) => denylist.some((name) => href.includes(name)));
}

/**
 * Sibling chunk files a built chunk imports STATICALLY.
 *
 * Rolldown emits dynamic imports as `import(`./x.js`)` and static ones as
 * `import … from "./x.js"` / `import "./x.js"` / `export … from "./x.js"`.
 * Rather than trying to match every static form, count each specifier's
 * occurrences and subtract the ones sitting inside `import(...)`: a specifier
 * left with a positive count has at least one static edge. Under-counting is
 * the safe direction only for false NEGATIVES, so the subtraction is per
 * specifier, not a set difference — a chunk imported both ways still counts.
 */
export function staticImportsOf(code) {
  const counts = new Map();
  for (const m of code.matchAll(/(['"`])(\.\/[^'"`\s]+\.js)\1/g)) {
    counts.set(m[2], (counts.get(m[2]) ?? 0) + 1);
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*(['"`])(\.\/[^'"`\s]+\.js)\1\s*\)/g)) {
    counts.set(m[2], (counts.get(m[2]) ?? 0) - 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 0).map(([spec]) => spec.slice(2));
}

/** Build `chunk name → statically imported chunk names` from `[name, code]` pairs. */
export function buildStaticGraph(entries) {
  return new Map(entries.map(([name, code]) => [name, staticImportsOf(code)]));
}

/**
 * Breadth-first static closure from `seeds`, remembering the shortest path to
 * each reachable chunk so a failure can name the import chain, not just the
 * offender. Unknown seeds are ignored (a hashed asset may be a stylesheet).
 */
export function staticClosurePaths(seeds, graph) {
  const paths = new Map();
  const queue = [];
  for (const seed of seeds) {
    if (graph.has(seed) && !paths.has(seed)) {
      paths.set(seed, [seed]);
      queue.push(seed);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of graph.get(current) ?? []) {
      if (paths.has(next)) continue;
      paths.set(next, [...paths.get(current), next]);
      queue.push(next);
    }
  }
  return paths;
}

/** Chunk names matching the boot patterns, in listing order. */
export function findBootChunks(names, patterns = BOOT_CHUNK_PATTERNS) {
  return patterns.map((re) => ({ re, matches: names.filter((n) => re.test(n)) }));
}

function main() {
  const INDEX = "dist/index.html";
  const ASSETS = "dist/assets";
  if (!existsSync(INDEX)) {
    console.error(`check-eager-chunks: ${INDEX} not found — run pnpm build first.`);
    process.exit(64);
  }

  const names = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
  const graph = buildStaticGraph(
    names.map((name) => [name, readFileSync(path.join(ASSETS, name), "utf8")]),
  );

  const html = readFileSync(INDEX, "utf8");
  const htmlSeeds = collectEagerAssets(html).map((href) => path.basename(href));

  const boot = findBootChunks(names);
  const missing = boot.filter((b) => b.matches.length === 0);
  if (missing.length > 0) {
    console.error(
      "❌ Boot chunk not found in dist/assets: " +
        missing.map((b) => String(b.re)).join(", ") +
        "\n   The entry awaits these before first paint; with none present the\n" +
        "   gate would only see index.html again and silently stop covering the\n" +
        "   cold-start graph. Update BOOT_CHUNK_PATTERNS if the chunk was renamed.",
    );
    process.exit(1);
  }

  const seeds = [...htmlSeeds, ...boot.flatMap((b) => b.matches)];
  const reachable = staticClosurePaths(seeds, graph);
  const offenders = findOffenders([...reachable.keys()]);

  const lazyOnly = findLazyOnlyViolations(names, reachable);
  if (lazyOnly.length > 0) {
    console.error("❌ Lazy-only chunks violated (WI-13 — format-registry surfaces):");
    for (const violation of lazyOnly) {
      if (violation.kind === "missing") {
        console.error(`  ${violation.pattern} — NO CHUNK EMITTED`);
        console.error(`    ${violation.why}`);
        console.error(
          "    A module reached only by `import(...)` gets its own chunk. None\n" +
            "    here means a STATIC import inlined it into its importer, which is\n" +
            "    the regression this rule exists to catch — the chunk name simply\n" +
            "    disappears, so a name-matching denylist would report clean.",
        );
      } else {
        console.error(`  ${violation.chunk} — statically reachable at cold start`);
        console.error(`    ${violation.why}`);
        console.error(`    via ${reachable.get(violation.chunk).join(" → ")}`);
      }
    }
    console.error(
      "\nThe format registry must register METADATA eagerly and load surfaces\n" +
        "at first mount: bootstrapFormats() runs in EVERY window before App.",
    );
    process.exit(1);
  }

  if (offenders.length > 0) {
    console.error("❌ Lazy chunks regressed to eager (reachable statically at cold start):");
    for (const offender of offenders) {
      console.error(`  ${offender}`);
      console.error(`    via ${reachable.get(offender).join(" → ")}`);
    }
    console.error(
      "\nA static import somewhere now reaches these chunks. The chain above\n" +
        "names the first hop; find the source import with:\n" +
        "  pnpm size:why\nand convert it back to `await import(...)`.",
    );
    process.exit(1);
  }

  let closureBytes = 0;
  for (const chunk of reachable.keys()) {
    closureBytes += statSync(path.join(ASSETS, chunk)).size;
  }
  console.log(
    `✅ Eager-chunk check passed (${reachable.size} chunks / ` +
      `${(closureBytes / 1024 / 1024).toFixed(2)} MB statically reachable at cold start, ` +
      `none denylisted; ${LAZY_ONLY_CHUNK_PATTERNS.length} lazy-only surfaces verified).`,
  );
}

// CLI entry — run only when invoked directly, never when imported by tests.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
