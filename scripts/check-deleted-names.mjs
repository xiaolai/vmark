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
 * SYMBOL DETECTION covers the export forms the codebase actually uses (see
 * `symbolPatterns`): plain and `async` functions, generators, `const`/`let`/
 * `var`, classes (incl. `abstract`), `type`/`interface`/`enum`, `declare`
 * variants, `export default`, `export { X as Name }` re-exports and
 * `export * as Name from …`. The first version matched only
 * `export (function|const|class|type|interface) Name`, so a deleted symbol
 * could come back as `export async function`, or be re-exported from a new
 * file under its old name, without the gate noticing.
 *
 * KNOWN LIMITATION — this is git grep, so it is line-based and not syntax-
 * aware. Three things it still cannot see, stated rather than implied:
 *   1. an export clause split across lines (`export {\n  useX,\n}`);
 *   2. a re-export built at runtime (`Object.assign(exports, …)`);
 *   3. the difference between code and a comment or string that happens to
 *      contain the same text (false POSITIVE, i.e. it fails closed).
 * Closing 1 and 2 means a TypeScript program pass over the glob — worth doing
 * if this tripwire ever has to be authoritative, and deliberately not done for
 * a coarse tripwire whose registry is eight entries long.
 *
 * Usage:
 *   node scripts/check-deleted-names.mjs
 *   node scripts/check-deleted-names.mjs --root <dir> --registry <file.json>
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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
    path: "src/services/keybinding/keybindingManifest.ts",
    deletedBy: "audit-fix #29 (settled with Codex, thread 019fdb16)",
    reason:
      "A hand-copied restatement of every menu-backed shortcut's keys, with zero " +
      "runtime importers. The drift gate compared it against the definitions it " +
      "was copied FROM, so it could only catch a forgotten copy, never drift. " +
      "scripts/check-keybinding-manifest.mjs now derives the synced set from " +
      "DEFAULT_SHORTCUTS; every cross-language check is unchanged. " +
      "Re-adding it would restore the duplication, not any coverage.",
  },
  {
    kind: "symbol",
    name: "KEYBINDING_MANIFEST",
    glob: "src",
    deletedBy: "audit-fix #29 (settled with Codex, thread 019fdb16)",
    reason: "The manifest array itself — see the path entry above.",
  },
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
  {
    kind: "path",
    path: "src/stores/browserStore.ts",
    deletedBy: "architecture review E4 / WI-6 (plan-20260803-161713, ledger D9)",
    reason:
      "Unwired hibernation-cap store; the webview leak its cap would bound was " +
      "REFUTED — the active-page-only surface lifecycle bounds live views at 1, " +
      "strictly tighter. Pinned by src/components/Browser/browserLifecycleBound.test.tsx. " +
      "Wiring the cap was explicitly rejected (plan Deferred section).",
  },
  {
    kind: "symbol",
    name: "useBrowserStore",
    glob: "src/stores",
    deletedBy: "architecture review E4 / WI-6 (plan-20260803-161713, ledger D9)",
    reason: "The hibernation store must not come back under another filename either.",
  },
  {
    kind: "path",
    path: "src/stores/_shimHelper.ts",
    deletedBy: "architecture review C1 / WI-9 (plan-20260803-161713)",
    reason:
      "T09 revert: the slice-shim engine (WeakMap merge cache, action-filtering " +
      "setState, getInitialState aliased to getState — a Zustand-semantics " +
      "deviation) is gone. Every popup store is a standalone create() store now.",
  },
  {
    kind: "path",
    path: "src/stores/popupStore.ts",
    deletedBy: "architecture review C1 / WI-9 (plan-20260803-161713)",
    reason:
      "T09 revert: the merged 15-slice popup mega-store facade was deleted; " +
      "each slice was re-inlined as its own standalone store.",
  },
  {
    kind: "symbol",
    name: "usePopupStore",
    glob: "src/stores",
    deletedBy: "architecture review C1 / WI-9 (plan-20260803-161713)",
    reason: "The merged popup store must not come back under another filename either.",
  },
  {
    kind: "symbol",
    name: "formatSelection",
    glob: "src",
    deletedBy: "WI-CJKF1.1 (dev-docs/plans/20260821-cjk-formatter-correctness.md)",
    reason:
      "An unprotected CJK format pass — applyRules with no findProtectedRegions " +
      "and no verifyIntegrity, documented as 'assumes no markdown structure to " +
      "preserve'. Nothing could establish that assumption: its only caller handed " +
      "it a SLICE OF THE DOCUMENT, so Cmd+A then Cmd+Shift+F in Source mode " +
      "rewrote every fenced code block (straight quotes became curly, breaking " +
      "string literals) and every YAML `title:` (into `title：`). formatMarkdown " +
      "takes exactly the same input safely. A 'plain text' variant must not come " +
      "back — the safety difference is invisible at the call site.",
  },
];

/** POSIX ERE word boundary — `git grep -E` has no portable `\b`. */
const EDGE = "[^A-Za-z0-9_$]";
const SP = "[[:space:]]";

/** Every export form that would re-introduce `name`, as `git grep -E` patterns. */
export function symbolPatterns(name) {
  const declarators = "function|const|let|var|class|type|interface|enum";
  return [
    // export [default] [declare] [async] [abstract] <declarator>[*] Name
    `export${SP}+(default${SP}+)?(declare${SP}+)?(async${SP}+)?(abstract${SP}+)?(${declarators})[[:space:]*]+${name}(${EDGE}|$)`,
    // export default Name        — re-export of an existing binding
    `export${SP}+default${SP}+${name}(${EDGE}|$)`,
    // export { Name }, export { X as Name }, export { a, Name } [from "…"]
    `export${SP}*\\{${SP}*${name}(${EDGE}|$)`,
    `export${SP}*\\{[^}]*${EDGE}${name}(${EDGE}|$)`,
    // export * as Name from "…"
    `export${SP}*[*]${SP}+as${SP}+${name}(${EDGE}|$)`,
  ];
}

/** Files under `glob` that re-introduce `name`. Empty when git grep matches
 *  nothing (it exits non-zero, which is not an error here). */
export function findSymbolDefinitions(name, glob, cwd) {
  const args = ["grep", "-lE"];
  for (const pattern of symbolPatterns(name)) args.push("-e", pattern);
  args.push("--", glob);
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() === "" ? [] : out.trim().split("\n");
  } catch {
    return [];
  }
}

/** Registry → human-readable failures. Pure apart from the filesystem/git reads. */
export function evaluateRegistry(registry, cwd) {
  const failures = [];
  for (const entry of registry) {
    if (entry.kind === "path") {
      if (existsSync(join(cwd, entry.path))) {
        failures.push(
          `  ${entry.path} was deleted by ${entry.deletedBy} but exists again.\n` +
            `    ${entry.reason}`,
        );
      }
      continue;
    }
    if (entry.kind === "symbol") {
      const hits = findSymbolDefinitions(entry.name, entry.glob, cwd);
      if (hits.length > 0) {
        failures.push(
          `  \`${entry.name}\` was deleted by ${entry.deletedBy} but is defined again in:\n` +
            hits.map((f) => `    ${f}`).join("\n") +
            `\n    ${entry.reason}`,
        );
      }
    }
  }
  return failures;
}

function main() {
  const argv = process.argv.slice(2);
  let cwd = root;
  let registry = REGISTRY;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") cwd = resolve(argv[++i]);
    else if (argv[i] === "--registry") registry = JSON.parse(readFileSync(resolve(argv[++i]), "utf8"));
    else {
      console.error(`❌ Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }

  const failures = evaluateRegistry(registry, cwd);
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

  console.log(`✅ Deleted-name gate held (${registry.length} entries, none reappeared).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
