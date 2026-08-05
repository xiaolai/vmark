/**
 * Shared helpers for the workflow-corpus test suites.
 *
 * `cstParser.test.ts` and `corpusRoundtrip.test.ts` both enumerate workflow
 * YAML and compare comment/anchor preservation across a round trip. The two
 * grew private copies of these helpers that had already diverged, so they
 * live here once.
 *
 * `anchorUsage` is CST-based on purpose. The regex it replaces (`&[\w-]+`)
 * did not identify YAML anchors at all: it matched shell redirects (`2>&1`
 * → `&1`) and HTML entities (`&amp;`), so equal counts could survive an
 * anchor rename or an alias retarget.
 *
 * @coordinates-with @/lib/ghaWorkflow/save/cstParser — parseAsCst
 * @module test/ghaCorpusHelpers
 */
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { isAlias, isNode, visit } from "yaml";
import { parseAsCst } from "@/lib/ghaWorkflow/save/cstParser";

/**
 * Normalize a filesystem path to forward slashes.
 *
 * `join` yields `\` on Windows, but every path literal in these suites is
 * written with `/` — so a baseline lookup keyed on the raw path missed every
 * entry there while passing on macOS and Linux.
 */
export function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** Every `.yml`/`.yaml` file under `dir`, recursively, with `/` separators. */
export function walkWorkflows(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walkWorkflows(p));
    else if (f.endsWith(".yml") || f.endsWith(".yaml")) out.push(toPosix(p));
  }
  return out;
}

/**
 * Comment texts (line and inline), with an approximate quoted-string guard.
 * The same heuristic runs on both sides of a comparison, so over-counts
 * cancel.
 */
export function commentSet(yamlString: string): Set<string> {
  const out = new Set<string>();
  for (const line of yamlString.split("\n")) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "#" && !inSingle && !inDouble) {
        const text = line.slice(i + 1).trim();
        if (text) out.add(text);
        break;
      }
    }
  }
  return out;
}

/** Anchors declared, and the anchors aliases point at, in document order. */
export interface AnchorUsage {
  anchors: string[];
  aliases: string[];
}

/**
 * Real anchor/alias identity, read from the parsed document rather than
 * guessed from text — so a renamed anchor or a retargeted alias is visible.
 */
export function anchorUsage(yamlString: string): AnchorUsage {
  const doc = parseAsCst(yamlString);
  const anchors: string[] = [];
  const aliases: string[] = [];
  visit(doc, (_key, node) => {
    if (isAlias(node)) {
      aliases.push(node.source);
      return;
    }
    if (isNode(node) && node.anchor) anchors.push(node.anchor);
  });
  return { anchors, aliases };
}
