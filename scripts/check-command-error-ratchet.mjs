#!/usr/bin/env node
/**
 * `Result<T, String>` command ratchet (WI-14).
 *
 * Rule 50 §10 used to canonize `Result<T, String>` for every Tauri command, so
 * the only thing that crossed the IPC boundary was prose. The frontend then
 * recovered the failure class by matching TEXT — a `"PARENT_MISSING:"` prefix
 * in the save path, `String(error).includes("APPROVAL_REQUIRED")` in the MCP
 * browser handlers — and ~370 raw-English `format!` sites stayed invisible to
 * `lint:i18n`. `CommandError` (`src-tauri/src/command_error.rs`) replaces it.
 *
 * A crate-wide migration lands over many PRs, and the C1 lesson is that one
 * without a ratchet stalls at "some of it". So: a per-file count of the
 * remaining legacy signatures, frozen at today's reality, two-way (house
 * standard) — a NEW legacy command fails the gate, and a file that improved
 * fails until the win is written down, because an unrecorded win is silent
 * headroom for the next regression.
 *
 * Counting is a real Rust lex, not a regex over raw text: comments and string
 * literals must not count (the baseline would be unfalsifiable), and a plain
 * `fn` returning `Result<T, String>` must not count (ordinary Rust is not this
 * gate's business).
 *
 * The attribute is matched with BALANCED arguments, not as the exact string
 * `#[tauri::command]`: `#[tauri::command(rename_all = "snake_case")]` and
 * `#[tauri::command(async)]` are the same attribute, and an exact-string match
 * made every parameterized command invisible to the ratchet.
 *
 * The return type is matched with its PATH NORMALIZED, so
 * `std::result::Result<_, String>` and `Result<_, ::std::string::String>` count
 * exactly as the bare spelling does.
 *
 * KNOWN LIMITATION — type aliases are not resolved. `type CmdResult<T> =
 * Result<T, String>;` followed by `-> CmdResult<u8>` is a legacy signature this
 * gate does not see, because resolving it needs real name resolution (a `syn`
 * pass over the crate), which is out of scope for a JS-side lexer. The crate
 * has no such alias today; if one is introduced, extend the lexer with the
 * alias names rather than pretending the count is complete.
 *
 * Usage:
 *   node scripts/check-command-error-ratchet.mjs [--root <dir>] [--baseline <file>]
 *   node scripts/check-command-error-ratchet.mjs --write-baseline
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ─── Pure, testable core ───

const SCAN_ROOT = ["src-tauri", "src"];
/** `#[tauri::command`, tolerating the whitespace rustfmt would never write but
 *  the language allows. `\b` stops it matching `#[tauri::command_bogus]`. */
const COMMAND_ATTRIBUTE_START = /#\[\s*tauri\s*::\s*command\b/g;

/**
 * Blank out comments so nothing inside them can be counted, preserving byte
 * offsets and newlines so reported positions stay meaningful.
 *
 * Handles what this crate actually contains: nested block comments (Rust
 * allows them), `"…"` and `b"…"` strings with escapes, `r#"…"#` raw strings,
 * and `'c'` char literals — which must be told apart from lifetimes (`'_`,
 * `'static`), or `State<'_, Surface>` would swallow the rest of the file.
 */
export function stripCommentsAndStrings(source) {
  const out = new Array(source.length).fill("");
  const keep = (i) => {
    out[i] = source[i];
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out[i] = source[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      let depth = 0;
      while (i < source.length) {
        if (source[i] === "/" && source[i + 1] === "*") {
          depth++;
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (source[i] === "*" && source[i + 1] === "/") {
          depth--;
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          if (depth === 0) break;
          continue;
        }
        out[i] = source[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    // Raw string: r"…", r#"…"#, br##"…"##
    const raw = /^b?r(#*)"/.exec(source.slice(i, i + 16));
    if (raw && (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1]))) {
      const hashes = raw[1];
      const terminator = `"${hashes}`;
      let j = i + raw[0].length;
      const end = source.indexOf(terminator, j);
      const stop = end === -1 ? source.length : end + terminator.length;
      for (; i < stop; i++) out[i] = source[i] === "\n" ? "\n" : " ";
      continue;
    }

    if (ch === '"') {
      out[i] = " ";
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out[i] = " ";
          out[i + 1] = source[i + 1] === "\n" ? "\n" : " ";
          i += 2;
          continue;
        }
        const done = source[i] === '"';
        out[i] = source[i] === "\n" ? "\n" : " ";
        i++;
        if (done) break;
      }
      continue;
    }

    // `'x'` / `'\n'` is a char literal; `'a` / `'_` / `'static` is a lifetime.
    if (ch === "'") {
      const escaped = next === "\\";
      const closeAt = escaped ? source.indexOf("'", i + 2) : i + 2;
      const isChar = escaped
        ? closeAt !== -1 && closeAt - i <= 8
        : source[closeAt] === "'";
      if (isChar) {
        for (; i <= closeAt; i++) out[i] = " ";
        continue;
      }
    }

    keep(i);
    i++;
  }
  return out.join("");
}

/** Split `A, B` at depth 0 of `<>`/`()`/`[]`. */
function splitGenericArgs(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * The declared return type of the `fn` beginning at or after `from`, or null.
 * Reads to the body brace at depth 0, so a multi-line signature and a generic
 * `Ok` type are both fine.
 */
function returnTypeOf(text, from) {
  const fn = /\bfn\b/.exec(text.slice(from));
  if (!fn) return null;
  let i = from + fn.index + 2;
  let depth = 0;
  let arrow = -1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && ch === "-" && text[i + 1] === ">") {
      arrow = i + 2;
      break;
    } else if (depth === 0 && (ch === "{" || ch === ";")) return "";
  }
  if (arrow === -1) return null;
  let angle = 0;
  for (let j = arrow; j < text.length; j++) {
    const ch = text[j];
    if (ch === "<") angle++;
    else if (ch === ">") angle--;
    else if (angle === 0 && (ch === "{" || ch === ";")) return text.slice(arrow, j).trim();
  }
  return null;
}

/** Drop a leading `::a::b::` path so `std::result::Result` reads as `Result`
 *  and `::std::string::String` reads as `String`. Generic args are untouched. */
function unqualify(type) {
  return type.replace(/^(?:::)?(?:[A-Za-z_]\w*\s*::\s*)+/, "");
}

/** True when a return type is `Result<_, String>` — the legacy shape, in any
 *  path spelling (`std::result::Result<_, ::std::string::String>` counts). */
export function isLegacyStringResult(returnType) {
  const match = /^Result\s*<([\s\S]*)>$/.exec(unqualify((returnType ?? "").trim()));
  if (!match) return false;
  const args = splitGenericArgs(match[1]);
  return args.length === 2 && unqualify(args[1]) === "String";
}

/**
 * Byte offsets just past each `#[tauri::command…]` attribute, with balanced
 * `(...)` arguments consumed so `#[tauri::command(rename_all = "snake_case")]`
 * is the same attribute as the bare form. An attribute whose shape is not
 * understood still yields a position (fail closed — the fn after it is then
 * examined), rather than being dropped.
 */
export function commandAttributeEnds(text) {
  const ends = [];
  COMMAND_ATTRIBUTE_START.lastIndex = 0;
  let match;
  while ((match = COMMAND_ATTRIBUTE_START.exec(text)) !== null) {
    let i = match.index + match[0].length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "(") {
      let depth = 0;
      for (; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) {
          i++;
          break;
        }
      }
      while (i < text.length && /\s/.test(text[i])) i++;
    }
    ends.push(text[i] === "]" ? i + 1 : i);
  }
  return ends;
}

/** Count `#[tauri::command]` fns returning `Result<_, String>` in one file. */
export function countLegacyCommands(source) {
  const text = stripCommentsAndStrings(source);
  let count = 0;
  for (const at of commandAttributeEnds(text)) {
    if (isLegacyStringResult(returnTypeOf(text, at))) count++;
  }
  return count;
}

/**
 * Blank JS/TS comments, preserving string and template literals — the opposite
 * trade-off from `stripCommentsAndStrings`, because the command name being
 * matched IS a string literal. Skips over quoted spans so a `//` inside a URL
 * is not read as a comment.
 */
export function stripJsComments(source) {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      for (i++; i < source.length; i++) {
        out += source[i];
        if (source[i] === "\\") {
          i++;
          if (i < source.length) out += source[i];
        } else if (source[i] === quote) break;
      }
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j++) out += source[j] === "\n" ? "\n" : " ";
      i = stop - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Names of `#[tauri::command]` fns whose error type is `CommandError`. */
export function typedCommandNames(source) {
  const text = stripCommentsAndStrings(source);
  const names = [];
  for (const at of commandAttributeEnds(text)) {
    const returnType = returnTypeOf(text, at);
    const match = /^Result\s*<([\s\S]*)>$/.exec(unqualify((returnType ?? "").trim()));
    if (!match) continue;
    const args = splitGenericArgs(match[1]);
    if (args.length !== 2 || unqualify(args[1]) !== "CommandError") continue;
    // The fn name sits between the attribute and the parameter list.
    const decl = /\bfn\s+([A-Za-z_]\w*)/.exec(text.slice(at, at + 400));
    if (decl) names.push(decl[1]);
  }
  return names;
}

/**
 * `String(e)` / `String(err)` / `String(error)`, or the `errorMessage()` helper
 * — which is literally `error instanceof Error ? … : String(error)`, so it is
 * the same defect under a second name (rule 50 §10 names it). The `(?<!command)`
 * guard keeps `commandErrorMessage`, the CORRECT helper, from matching.
 */
const STRINGIFIED_ERROR =
  /\bString\(\s*(?:e|err|error)\d?\s*\)|(?<!command)\berrorMessage\(\s*(?:e|err|error)\d?\s*\)/;
const INVOKE_CALL = /\binvoke\s*(?:<[^>]*>)?\s*\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/gi;

/**
 * Frontend files that invoke a TYPED command and render its rejection with
 * `String(...)`. A `CommandError` is a plain object, so that yields the literal
 * "[object Object]" — see WI-DP2.6, which found four such boundaries by hand.
 *
 * Deliberately silent for files that only invoke LEGACY commands: `String(e)`
 * is CORRECT while the command still returns `Result<T, String>`, and flagging
 * it would demand a change that is wrong until the conversion lands.
 */
export function findStringifiedTypedErrors(files, typedCommands) {
  const hits = [];
  for (const { path: file, source } of files) {
    // NOT `source.includes("commandErrorMessage")` — a file can use the correct
    // helper at one boundary and `String(e)` at another, which is how
    // McpConfigInstaller looked mid-fix. Judge the offending call, not the file.
    // An explicit, REASONED exemption. The check is file-level, so it cannot see
    // which error a helper was applied to; a file that invokes a typed command
    // and separately stringifies (say) a JSON.parse failure is correct as
    // written. The reason is required — a bare marker is a mute button, the same
    // rule the i18n allowlist and the caret-only focus marker carry.
    if (/\/\/[^\S\n]*command-error-ok:[^\S\n]*\S/.test(source)) continue;
    // Comments blanked, strings KEPT — the command name lives inside a string
    // literal, so the Rust stripper (which blanks both) would erase the very
    // thing being matched.
    const code = stripJsComments(source);
    if (!STRINGIFIED_ERROR.test(code)) continue;
    INVOKE_CALL.lastIndex = 0;
    let match;
    while ((match = INVOKE_CALL.exec(code)) !== null) {
      if (typedCommands.has(match[1])) {
        hits.push({ file, command: match[1] });
        break;
      }
    }
  }
  return hits;
}

function walk(dir, rootLen, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, rootLen, out);
    // `*.test.rs` is the crate's test-module convention (`#[path]`-included);
    // a fixture command there is not part of the shipped IPC surface.
    else if (entry.name.endsWith(".rs") && !entry.name.endsWith(".test.rs")) {
      out.push(full.slice(rootLen).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Scan a repo root and return `{ "src-tauri/src/x.rs": count }` for count > 0. */
export function scanTree(root) {
  const scanDir = path.join(root, ...SCAN_ROOT);
  if (!existsSync(scanDir)) return {};
  const counts = {};
  for (const rel of walk(scanDir, root.length + 1, []).sort()) {
    const count = countLegacyCommands(readFileSync(path.join(root, rel), "utf8"));
    if (count > 0) counts[rel] = count;
  }
  return counts;
}

/** Frontend sources that could receive a command rejection (tests excluded). */
function walkFrontend(dir, rootLen, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "locales") continue;
      walkFrontend(full, rootLen, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full.slice(rootLen).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Every typed command name in the crate, and the frontend files that stringify one. */
export function scanStringifiedTypedErrors(root) {
  const crateDir = path.join(root, ...SCAN_ROOT);
  if (!existsSync(crateDir)) return [];
  const typed = new Set();
  for (const rel of walk(crateDir, root.length + 1, [])) {
    for (const name of typedCommandNames(readFileSync(path.join(root, rel), "utf8"))) {
      typed.add(name);
    }
  }
  const files = walkFrontend(path.join(root, "src"), root.length + 1, []).map((rel) => ({
    path: rel,
    source: readFileSync(path.join(root, rel), "utf8"),
  }));
  return findStringifiedTypedErrors(files, typed);
}

/** Fail loudly on malformed baseline data — never read a bad file as "empty". */
export function validateBaseline(raw, label) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label}: expected a JSON object with a "files" map`);
  }
  const files = raw.files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new Error(`${label}: "files" must be an object of {path: count}`);
  }
  for (const [file, count] of Object.entries(files)) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(
        `${label}: count for ${file} must be a positive integer, got ${JSON.stringify(count)}`,
      );
    }
  }
  return files;
}

/** Two-way per-file comparison. */
export function compareCounts(actual, baseline) {
  const raised = [];
  const lowered = [];
  const gone = [];
  for (const [file, count] of Object.entries(actual)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) raised.push({ file, count, allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = actual[file];
    if (count === undefined) gone.push({ file, allowed });
    else if (count < allowed) lowered.push({ file, count, allowed });
  }
  return { raised, lowered, gone };
}

// ─── CLI shell ───

const BASELINE_HEADER = [
  "Remaining `Result<T, String>` #[tauri::command] signatures per file — the WI-14 CommandError migration ratchet.",
  "Checked by scripts/check-command-error-ratchet.mjs (pnpm lint:command-errors, in check:all).",
  "Two-way: a NEW legacy signature fails the gate, and a file that improved fails until its number is lowered here — an unrecorded win is silent headroom for the next regression.",
  "Numbers only go DOWN. Migrate the command to Result<T, CommandError> (see .claude/rules/50-codebase-conventions.md §10), then lower or delete its entry.",
  "Registered in the WI-16 ratchet manifest (scripts/check-baseline-ratchet.mjs), which re-compares this file against the merge base in CI — so a commit cannot raise its own floor.",
];

function parseArgs(argv) {
  const args = { root: null, baseline: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--baseline") args.baseline = argv[++i];
    else if (argv[i] === "--write-baseline") args.write = true;
    else {
      console.error(`❌ Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(
    args.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const baselinePath = path.resolve(
    args.baseline ?? path.join(root, "scripts", "command-error-baseline.json"),
  );

  const actual = scanTree(root);
  const total = Object.values(actual).reduce((sum, n) => sum + n, 0);

  if (args.write) {
    writeFileSync(
      baselinePath,
      JSON.stringify({ "//": BASELINE_HEADER, files: actual }, null, 2) + "\n",
    );
    console.log(`✍️  Wrote ${total} remaining legacy command(s) to ${baselinePath}`);
    return;
  }

  let baseline;
  try {
    baseline = validateBaseline(JSON.parse(readFileSync(baselinePath, "utf8")), baselinePath);
  } catch (error) {
    console.error(`❌ Cannot read the command-error baseline (${baselinePath}): ${error.message}`);
    console.error("   The gate fails closed — fix the baseline, never delete it to pass.");
    process.exit(1);
  }

  const { raised, lowered, gone } = compareCounts(actual, baseline);

  const stringified = scanStringifiedTypedErrors(root);

  if (raised.length === 0 && lowered.length === 0 && gone.length === 0 && stringified.length === 0) {
    console.log(
      `✅ CommandError ratchet held (${total} legacy Result<T, String> command(s) remain, none added).`,
    );
    return;
  }

  if (stringified.length > 0) {
    console.error(
      `\n❌ ${stringified.length} frontend file(s) render a TYPED command's error with String():\n`,
    );
    for (const { file, command } of stringified) console.error(`   ${file} — invokes ${command}`);
    console.error(
      "\n   A CommandError is a plain object, so String(error) renders the literal\n" +
        '   "[object Object]". Use commandErrorMessage() (rule 50 §10). This shipped\n' +
        "   to users at four boundaries before WI-DP2.6 caught it by hand.",
    );
  }

  if (raised.length > 0) {
    console.error(`\n❌ ${raised.length} file(s) gained a legacy Result<T, String> command:\n`);
    for (const { file, count, allowed } of raised) {
      console.error(`   ${file} — ${count} found, ${allowed} allowed`);
    }
    console.error(
      "\n   New commands return Result<T, CommandError> (rule 50 §10). The frontend\n" +
        "   branches on `code`; a String forces it back to matching message text.",
    );
  }

  if (lowered.length > 0) {
    console.error(`\n❌ ${lowered.length} file(s) improved — record the win:\n`);
    for (const { file, count, allowed } of lowered) {
      console.error(`   ${file} — ${count} found, baseline still says ${allowed}`);
    }
  }

  if (gone.length > 0) {
    console.error(`\n❌ ${gone.length} baselined file(s) no longer have legacy commands:\n`);
    for (const { file, allowed } of gone) console.error(`   ${file} — baseline says ${allowed}`);
    console.error("\n   Delete these entries so the improvement cannot become headroom.");
  }

  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
