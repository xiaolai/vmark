#!/usr/bin/env node
/**
 * Deleted-name gate.
 *
 * ADR-009 deleted `src/stores/editorStore.ts`; a later refactor re-created that
 * filename for a different concept and nothing caught it, so an "Accepted" ADR's
 * central decision was silently reversed (`dev-docs/audit/20260722-adr-reality-audit.md`).
 *
 * This gate gives that lesson teeth going forward: when an ADR/plan declares a
 * file or exported symbol deleted, a later change that re-introduces it fails
 * CI. It is deliberately forward-looking — `editorStore.ts` itself is NOT listed,
 * because it is already back and load-bearing; forbidding it now would be
 * dishonest. The registry holds deletions that ARE still in force.
 *
 * To add an entry when you delete something an ADR/plan relies on staying gone:
 * append to REGISTRY with the deleting decision and the reason.
 *
 * Usage: node scripts/check-deleted-names.mjs
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each entry is either:
 *   { kind: "path", path, deletedBy, reason }   — this file must not exist
 *   { kind: "symbol", name, glob, deletedBy, reason } — this exported symbol
 *     must not be defined anywhere matching `glob` (a production-source pattern)
 */
const REGISTRY = [
  {
    kind: "path",
    path: "src/plugins/registry.ts",
    deletedBy: "ADR-015 / WI-3.3",
    reason:
      "The plugin manifest registry was non-load-bearing dead metadata. " +
      "Composition goes through lib/extensions/resolve.ts now.",
  },
  {
    kind: "path",
    path: "src/plugins/manifests.ts",
    deletedBy: "ADR-015 / WI-3.3",
    reason: "Central manifest registration; every manifest was a 3-field stub.",
  },
  {
    kind: "symbol",
    name: "pluginsFor",
    glob: "src/plugins",
    deletedBy: "ADR-015 / WI-3.3",
    reason: "Dead registry lookup with zero production callers.",
  },
];

const failures = [];

for (const entry of REGISTRY) {
  if (entry.kind === "path") {
    if (existsSync(join(root, entry.path))) {
      failures.push(
        `  ${entry.path} was deleted by ${entry.deletedBy} but exists again.\n` +
          `    ${entry.reason}`,
      );
    }
    continue;
  }

  if (entry.kind === "symbol") {
    // Look for a definition of the symbol (export function/const/class) in the
    // scoped source glob. Grep is enough — this is a coarse tripwire, not a parser.
    let hits = "";
    try {
      hits = execSync(
        `git grep -lE "export (function|const|class|type|interface) ${entry.name}\\\\b" -- '${entry.glob}'`,
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      hits = ""; // git grep exits non-zero when nothing matches
    }
    if (hits) {
      failures.push(
        `  \`${entry.name}\` was deleted by ${entry.deletedBy} but is defined again in:\n` +
          hits
            .split("\n")
            .map((f) => `    ${f}`)
            .join("\n") +
          `\n    ${entry.reason}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(
    `\n❌ ${failures.length} deleted name(s) reappeared:\n\n${failures.join("\n\n")}\n`,
  );
  console.error(
    "A decision declared these gone. Re-introducing one silently reverses that\n" +
      "decision — the ADR-009 failure mode. If the reversal is intended, update the\n" +
      "ADR/plan AND remove the entry from scripts/check-deleted-names.mjs.\n",
  );
  process.exit(1);
}

console.log(`✅ Deleted-name gate held (${REGISTRY.length} entries, none reappeared).`);
