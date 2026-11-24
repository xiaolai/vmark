#!/usr/bin/env node
/**
 * Eager-chunk regression gate (extended to walk the static-import closure).
 *
 * "Lazy chunk became eager" regressions were previously invisible: a stray
 * static import drags a heavyweight chunk onto the cold-start path and nothing
 * fails.
 *
 * WHAT THE EXTENSION CHANGED — and why the previous version could not have caught
 * anything under App. The gate used to read `dist/index.html` alone. Vite emits
 * `<link rel=modulepreload>` only for the ENTRY chunk's static import graph;
 * `src/main.tsx` reaches the application through `await import("./App")` inside
 * `bootstrap()`, so every chunk under App is fetched at cold start but appears
 * nowhere in index.html. Measured on the build before it: App statically
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
 *
 * @coordinates-with scripts/lib/eagerChunkGraph.mjs — HTML parsing and the static chunk graph
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isMainModule } from "./lib/isMainModule.mjs";
import { buildStaticGraph, collectEagerAssets, staticClosurePaths } from "./lib/eagerChunkGraph.mjs";

export {
  collectEagerAssets,
  staticImportsOf,
  buildStaticGraph,
  staticClosurePaths,
} from "./lib/eagerChunkGraph.mjs";

// Chunk families that must NEVER be reachable statically at cold start.
export const DENYLIST = [
  "vendor-mermaid",
  "vendor-graph",
  "vendor-graphviz",
  "vendor-export",
  // @xyflow/react (123 kB) and @dagrejs/dagre (39 kB) belong to graph
  // surfaces that are all lazily mounted. xyflow additionally drags
  // vendor-mermaid in through its d3-* dependencies, so a static edge to it
  // costs ~3 MB, not 123 kB.
  "vendor-xyflow",
  "vendor-dagre",
];

/**
 * Lazy-only chunks — app-source modules that must reach the app ONLY through a dynamic
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
 * All seven are format-registry surfaces. `bootstrapFormats()` runs in every
 * window — Settings, PDF export — before `import("./App")`, so an adapter's
 * static import is cold-start cost for windows that never open an editor.
 * Measured before these were made lazy: 4.52 MB across 71 chunks, of which the
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
  {
    re: /^vendor-toml-[^/]*\.js$/,
    why: "toml adapters' parser (smol-toml), loaded on first TOML validate/preview (tomlParser.ts)",
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
 * Byte budget for everything statically reachable at cold start.
 *
 * The per-chunk EAGER budgets in .size-limit.cjs cannot tell "more code" from
 * "the same code in fewer files": vite 8.3 (rolldown 1.2.11) merged shared
 * chunks into their importers, so `entry` went 14.6 → 185 kB while the
 * closure went 3.05 → 3.09 MiB. This bounds what launch actually loads,
 * whatever shape the bundler gives it. ~5% above the measured 3.09 MiB.
 *
 * Lowered 3,407,872 → 3,384,010 bytes when the markdown paste extension and
 * turndown stopped being reachable from App-side code (they moved out of the
 * cold-start popupComponents chunk into the lazy markdownSurface chunk). The
 * measured closure went 3,246,541 → 3,223,808 bytes; the headroom ratio over
 * the measurement is unchanged (1.0497).
 *
 * Lowered 3,384,010 → 3,310,399 bytes when classic zod left the App chunk
 * (the hot-exit schemas use `zod/mini`) and the JSON tree view left the entry
 * chunk for a lazy one. The measured closure went 3,223,808 → 3,153,662
 * bytes; same ratio again.
 *
 * Lowered 3,310,399 → 3,305,484 bytes when smol-toml left the entry chunk for
 * the lazy `vendor-toml` chunk (the TOML parser now loads on first use). The
 * measured closure is 3,148,980 bytes; same ratio again.
 *
 * Raised 3,305,484 → 3,310,871 bytes by the i18next 27.1.3 bump. A clean
 * build of main against a clean build of the bump differs by +5,387 bytes in
 * one reachable chunk only: the shared `commandError` chunk, which bundles
 * i18next, went 44,590 → 49,977 bytes (its fallback-language and plural
 * resolver code). The measured closure went 3,304,577 → 3,309,964 bytes. The
 * new cap preserves the 907 bytes of headroom main had left
 * (3,305,484 − 3,304,577), so the gate is not loosened beyond the measured
 * growth. No import moved.
 */
export const MAX_EAGER_BYTES = 3_310_871;

/** A failure message when `closureBytes` exceeds `max`, else null. */
export function eagerBudgetViolation(closureBytes, max = MAX_EAGER_BYTES) {
  if (closureBytes <= max) return null;
  const mib = (n) => (n / 1024 / 1024).toFixed(2);
  return (
    `❌ Cold start statically loads ${mib(closureBytes)} MiB, over the ${mib(max)} MiB budget.\n` +
    "Find what joined the entry's static closure with `pnpm size:why`; if the growth is\n" +
    "intended, raise MAX_EAGER_BYTES and say what added the bytes."
  );
}

/**
 * Chunks the entry awaits unconditionally at boot. Their static graph is
 * cold-start even though Vite emits no modulepreload link for them.
 * `src/main.tsx` → `bootstrap()` → `await import("./App")`.
 */
export const BOOT_CHUNK_PATTERNS = [/^App-[^/]*\.js$/];

/** Filter asset names/URLs down to those in a denylisted chunk family. */
export function findOffenders(eager, denylist = DENYLIST) {
  return eager.filter((href) => denylist.some((name) => href.includes(name)));
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
  const overBudget = eagerBudgetViolation(closureBytes);
  if (overBudget) {
    console.error(overBudget);
    process.exit(1);
  }
  console.log(
    `✅ Eager-chunk check passed (${reachable.size} chunks / ` +
      `${(closureBytes / 1024 / 1024).toFixed(2)} MB statically reachable at cold start, ` +
      `none denylisted; ${LAZY_ONLY_CHUNK_PATTERNS.length} lazy-only surfaces verified).`,
  );
}

// CLI entry — run only when invoked directly, never when imported by tests.
if (isMainModule(import.meta.url)) {
  main();
}
