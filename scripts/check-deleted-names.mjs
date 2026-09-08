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
 * append to REGISTRY in `scripts/lib/deletedNamesRegistry.mjs` with the
 * deleting decision and the reason.
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
 * RUST ITEMS are covered too (WI-FL3.2): `[pub[(crate|super|self|in path)]]
 * [const] [async] [unsafe] [extern ["ABI"]] (fn|struct|enum|type|const|static|
 * mod|trait|union) [r#]Name`, with any whitespace the grammar allows inside
 * `pub ( crate )` / `pub(in  path )` and a raw identifier (`fn r#name`) treated
 * as the name it spells. Before that, a Rust name registered here was a
 * tombstone nothing could trip over — the grammar knew only `export`, so the
 * entry was green with no coverage at all. A CALL or a `use` of the name is
 * not a definition and does not fire. This is the SUPPORTED grammar, fixture-
 * tested form by form — not a Rust parser: an item produced by a macro, or
 * one whose keyword and name sit on different lines, is outside it.
 *
 * FAILS CLOSED, in both ways a tripwire can be quietly disarmed: a `git grep`
 * that could not LOOK (not a repository, an invalid pattern, git missing —
 * anything but its "no match" exit 1) and a registry entry the gate does not
 * understand (an unknown `kind`, a missing field) both exit 2 with a message,
 * never "nothing reappeared".
 *
 * A WRAPPED export clause (`export {\n  useX,\n} from "./x"`) is the one form a
 * line-based scan structurally cannot see, and prettier produces it for any
 * clause past the print width — so it is the ordinary shape of a barrel file.
 * It is covered by a two-stage check (`wrappedExportClausePattern`): git grep
 * finds files with a lone-identifier line, then each candidate is READ and
 * confirmed with a multiline `export { … }` match, so an import clause does
 * not fire. The header used to record this as a limitation left open on the
 * grounds that the registry was "eight entries long"; it is now a dozen symbol
 * tombstones and the premise expired (audit R2 #30).
 *
 * It searches the WORKING TREE, not just the index: `git grep --untracked`
 * covers a new-but-not-ignored file, so a re-created symbol fires on the run
 * that reintroduced it rather than on a later one (audit R2 #34) — the same
 * reasoning `check-no-nul-bytes.mjs` records. And a tombstoned PATH is probed
 * with `lstat`, so a broken symlink standing where the deleted file was counts
 * as the path being back (audit R2 #36); `existsSync` follows the link and
 * reported it gone.
 *
 * KNOWN LIMITATION — this is still git grep, so two things remain unseen:
 *   1. a re-export built at runtime (`Object.assign(exports, …)`);
 *   2. the difference between code and a comment or string that happens to
 *      contain the same text (false POSITIVE, i.e. it fails closed).
 * Closing 1 means a TypeScript program pass over the glob — worth doing if
 * this tripwire ever has to be authoritative.
 *
 * Usage:
 *   node scripts/check-deleted-names.mjs
 *   node scripts/check-deleted-names.mjs --root <dir> --registry <file.json>
 * Exit 0 held, 1 a deleted name reappeared, 2 the gate could not run (a
 * registry it cannot read or check), 64 bad arguments — the usage code every
 * sibling gate uses, so a caller can tell misuse from a real finding.
 */
import { lstatSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

import { REGISTRY } from "./lib/deletedNamesRegistry.mjs";


/** POSIX ERE word boundary — `git grep -E` has no portable `\b`. */
const EDGE = "[^A-Za-z0-9_$]";
const SP = "[[:space:]]";

/**
 * `name` as a LITERAL inside a POSIX ERE. `$` is legal in a TypeScript
 * identifier (`use$Store`); interpolated raw it reads as end-of-line, so the
 * pattern could never match and the tombstone was silently dead — a tripwire
 * failing open. Only ERE's own specials are escaped: `}` and `]` are ordinary
 * outside their constructs, and escaping them is undefined in POSIX.
 */
function ereEscape(name) {
  return name.replace(/[.*+?^$(){|[\\]/g, "\\$&");
}

/** Every export form that would re-introduce `name`, as `git grep -E` patterns. */
export function symbolPatterns(name) {
  const declarators = "function|const|let|var|class|type|interface|enum|namespace|module";
  const id = ereEscape(name);
  // Qualifiers that may sit between `export` and the declarator, in any order
  // the language allows: `export const enum X`, `export declare abstract class
  // X`, `export async function* x`. Written as a repeated alternation rather
  // than a fixed chain — the chain missed `const enum` outright (audit R2 #32).
  const quals = `((default|declare|async|abstract|const)${SP}+)*`;
  // `export type { X }` / `export type * as X from …` are the type-only
  // spellings, and the brace pattern anchored on `export` + `{` did not reach
  // past the `type` keyword — the commonest re-export form in this codebase.
  const clause = `(type${SP}+)?`;
  return [
    // export [default] [declare] [async] [abstract] [const] <declarator>[*] Name
    `export${SP}+${quals}(${declarators})[[:space:]*]+${id}(${EDGE}|$)`,
    // export default Name        — re-export of an existing binding
    `export${SP}+default${SP}+${id}(${EDGE}|$)`,
    // export import Name = require(…) / = A.B  (TypeScript import alias)
    `export${SP}+import${SP}+${id}${SP}*=`,
    // export [type] { Name }, export { X as Name }, export { a, Name } [from "…"]
    `export${SP}*${clause}\\{${SP}*${id}(${EDGE}|$)`,
    `export${SP}*${clause}\\{[^}]*${EDGE}${id}(${EDGE}|$)`,
    // export [type] * as Name from "…"
    `export${SP}*${clause}[*]${SP}+as${SP}+${id}(${EDGE}|$)`,
  ];
}

/**
 * A WRAPPED export clause names `name` — the one form `git grep` structurally
 * cannot see, because the clause spans lines:
 *
 *     export {
 *       useX,
 *     } from "./x";
 *
 * Prettier wraps any clause past the print width, so this is the ordinary
 * shape of a barrel file, not an exotic one. Two stages, so no file is read
 * that does not have to be: `git grep` finds files carrying a line that is
 * just the identifier (with an optional trailing comma or `as` alias), then
 * each candidate is READ and confirmed with a multiline match, so an import
 * clause or an array element does not fire.
 *
 * The header used to record this as a limitation deliberately left open "for a
 * coarse tripwire whose registry is eight entries long". The registry now
 * carries a dozen symbol tombstones, so the premise expired (audit R2 #30).
 */
export function wrappedExportClausePattern(name) {
  const id = ereEscape(name);
  // Either side of an alias: the wrapped line may be `usePopupStore,` or
  // `theStore as usePopupStore,` — the single-line patterns fire on both, so
  // the wrapped probe must too.
  const ident = "[A-Za-z0-9_$]+";
  return `^${SP}*(${ident}${SP}+as${SP}+)?${id}(${SP}+as${SP}+${ident})?${SP}*,?${SP}*$`;
}

/** `name` as a literal inside a JS RegExp (distinct from `ereEscape`'s POSIX set). */
const jsEscape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A real `export [type] { … <name> … }` clause, however many lines it spans. */
const clauseRe = (name) =>
  new RegExp(
    String.raw`export\s+(?:type\s+)?\{[^}]*(?:^|[^A-Za-z0-9_$])` +
      jsEscape(name) +
      String.raw`(?![A-Za-z0-9_$])[^}]*\}`,
    "m",
  );

/**
 * Every Rust item form that would re-introduce `name`. Scanned over `.rs`
 * files ONLY: `const name = 1;` is a private local in TypeScript, and the
 * TypeScript grammar above deliberately does not fire on those.
 */
export function rustSymbolPatterns(name) {
  const items = "fn|struct|enum|type|const|static|mod|trait|union";
  // Visibility: `pub`, `pub(crate|super|self)`, `pub(in some::path)` — with
  // whitespace allowed wherever the grammar allows it (`pub ( crate )`).
  const vis = `(pub(${SP}*\\(${SP}*(crate|super|self|in${SP}+[^)]+)${SP}*\\))?${SP}+)?`;
  // Function qualifiers, any combination and order the grammar allows:
  // `const`, `async`, `unsafe`, `extern` with or without an ABI string.
  // `const` doubles as an item keyword (`pub const NAME: u8`); the alternation
  // backtracks, so both readings are tried.
  const quals = `((const|async|unsafe|extern(${SP}+"[^"]*")?)${SP}+)*`;
  // A raw identifier names the same item: `fn r#name` IS `name` coming back.
  return [`^${SP}*${vis}${quals}(${items})${SP}+(r#)?${ereEscape(name)}(${EDGE}|$)`];
}

/** Files matched by `pathspec` containing any of `patterns`. Empty when git
 *  grep matches nothing — its exit 1, and ONLY that; any other failure throws.
 *
 *  `--untracked` searches the WORKING TREE's new-but-not-ignored files as well
 *  as the tracked ones. Without it a locally re-created symbol was invisible
 *  until it was staged, so the tripwire fired on the commit AFTER the one that
 *  reintroduced the name — or never, if the author never re-ran the gate
 *  (audit R2 #34). It honours `.gitignore`, so `node_modules/`, `dev-docs/`
 *  and build output stay out. */
function gitGrepFiles(patterns, pathspec, cwd) {
  const args = ["grep", "-lE", "--untracked"];
  for (const pattern of patterns) args.push("-e", pattern);
  args.push("--", pathspec);
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out.trim() === "" ? [] : out.trim().split("\n");
  } catch (error) {
    // git grep exits 1 for "no match" and nothing else. Not a repository, an
    // invalid pattern, a malformed pathspec, no git on PATH — those are the
    // gate failing to LOOK, and must never read as "nothing reappeared".
    if (error.status === 1) return [];
    const detail = String(error.stderr || error.message || "").trim();
    throw new Error(`git grep failed (exit ${error.status ?? "?"}) — the gate cannot verify the registry: ${detail}`);
  }
}

/** Files under `glob` that re-introduce `name`, in either language. */
export function findSymbolDefinitions(name, glob, cwd) {
  const ts = gitGrepFiles(symbolPatterns(name), glob, cwd);
  const rust = gitGrepFiles(rustSymbolPatterns(name), `:(glob)${glob}/**/*.rs`, cwd);
  // Stage 2 for the wrapped-clause form: confirm each candidate by reading it,
  // so a bare `useX,` line inside an IMPORT clause or an array is not a hit.
  const clause = clauseRe(name);
  const wrapped = gitGrepFiles([wrappedExportClausePattern(name)], glob, cwd).filter((file) => {
    try {
      return clause.test(readFileSync(join(cwd, file), "utf8"));
    } catch {
      // A candidate that cannot be read is the gate failing to LOOK, not an
      // absence — the same rule gitGrepFiles applies to grep's own failures.
      throw new Error(`cannot read ${file} while confirming a wrapped export clause for ${name}`);
    }
  });
  return [...new Set([...ts, ...rust, ...wrapped])];
}

/** Anything at `abs` — a file, a directory, or a BROKEN symlink. */
const pathEntryExists = (abs) => lstatSync(abs, { throwIfNoEntry: false }) !== undefined;

/** The fields each registry kind must carry; an entry outside this table is a tombstone the gate cannot check. */
const REGISTRY_FIELDS = { path: ["path"], symbol: ["name", "glob"] };

/** Throws on an entry the gate would otherwise silently skip — an unknown `kind` or a missing/blank field. */
export function validateRegistryEntry(entry, index) {
  const required = entry && typeof entry === "object" ? REGISTRY_FIELDS[entry.kind] : undefined;
  if (!required) {
    throw new Error(`registry entry ${index}: unknown kind ${JSON.stringify(entry?.kind)} (expected "path" or "symbol")`);
  }
  for (const field of [...required, "deletedBy", "reason"]) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") {
      throw new Error(`registry entry ${index} (${entry.kind}): missing string field "${field}"`);
    }
  }
}

/** Registry → human-readable failures. Pure apart from the filesystem/git reads. */
export function evaluateRegistry(registry, cwd) {
  const failures = [];
  registry.forEach(validateRegistryEntry);
  for (const entry of registry) {
    if (entry.kind === "path") {
      // `lstat`, not `existsSync`: the latter FOLLOWS a symlink, so a broken
      // one at the tombstoned path reported "gone" while git — and every
      // reader of the tree — sees the path back (audit R2 #36). Any entry at
      // the path is the path existing again, whatever it points at.
      if (pathEntryExists(join(cwd, entry.path))) {
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
    if (argv[i] === "--root" || argv[i] === "--registry") {
      // Both take a value; a flag at the end of the line is a usage error
      // (exit 64, like any bad argument), not a stack trace from `resolve()`.
      const value = argv[i + 1];
      if (value === undefined) {
        console.error(`❌ ${argv[i]} requires a value`);
        process.exit(64);
      }
      if (argv[i] === "--root") cwd = resolve(value);
      else {
        // A registry the gate cannot read is the gate failing to run (2),
        // not a finding and not a stack trace.
        try {
          registry = JSON.parse(readFileSync(resolve(value), "utf8"));
        } catch (error) {
          console.error(`❌ deleted-name gate could not run: cannot read registry ${value}: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(2);
        }
      }
      i++;
    } else {
      console.error(`❌ Unknown argument: ${argv[i]}`);
      process.exit(64);
    }
  }

  let failures;
  try {
    failures = evaluateRegistry(registry, cwd);
  } catch (error) {
    console.error(`❌ deleted-name gate could not run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  if (failures.length > 0) {
    console.error(
      `\n❌ ${failures.length} deleted name(s) reappeared:\n\n${failures.join("\n\n")}\n`,
    );
    console.error(
      "A decision declared these gone. Re-introducing one silently reverses that\n" +
        "decision — the ADR-009 failure mode. If the reversal is intended, update the\n" +
        "ADR/plan AND remove the entry from REGISTRY in\n" +
        "scripts/lib/deletedNamesRegistry.mjs.\n",
    );
    process.exit(1);
  }

  console.log(`✅ Deleted-name gate held (${registry.length} entries, none reappeared).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
