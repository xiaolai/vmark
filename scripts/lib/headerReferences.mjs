/**
 * Header-reference grammar and collection (WI-FL0.2) — the pure half of
 * `scripts/check-header-references.mjs`.
 *
 * Purpose: read the three reference grammars a file header can carry
 * (`@coordinates-with <target>`, `@module <self-path>`, `Plan: <file>`), decide
 * per reference whether it resolves (target resolution is delegated to
 * `headerReferenceTargets.mjs`), and compare the unresolved set with the
 * identity baseline two-way. Everything here is a function of a root directory
 * and file contents — no process globals, no exit codes — so the self-test can
 * drive each grammar against fixture trees in a temp dir.
 *
 * Key decisions:
 *   - Comment scanning is BLOCK-AWARE: a `*`-prefixed line counts only inside
 *     a block comment whose opening `/*` starts a line — and it runs over the
 *     source with every LITERAL blanked first (`literalsBlanked`): TypeScript
 *     and JavaScript through the TypeScript parser (strings, template heads /
 *     middles / tails, regexes, JSX text), Rust through `rustSource.mjs`. So a
 *     header quoted inside a test's template literal is never read as the
 *     test's own header, however its lines start, and a `@generated` quoted in
 *     one cannot skip the file that quotes it (audit 20260907 #84 — with the
 *     line model alone, a `/*` that opened a line inside a template literal was
 *     a comment, and a `@generated` there within the first 20 lines skipped
 *     every real header in the file). A hand-rolled backtick tokenizer was
 *     rejected for the reason the parser is right: a stray backtick flips its
 *     parity and every header after it goes silently unread. The parser is
 *     invoked only for a source that contains a backtick — a single-line
 *     literal cannot put `/*` or `//` at the start of a line, so the files
 *     that need it are the ones that can hold a multi-line literal.
 *   - `@module` is tree-relative for the app and server trees and REPO-relative
 *     for the tooling trees (`scripts/`, `e2e/`, `.claude/hooks/`) — measured,
 *     not chosen: every `scripts/*.mjs` header writes `scripts/<name>`. An
 *     `index.*` file may name its directory (that IS its import specifier).
 *     Rust accepts `/` or `::`, and the `#[path = "…"] mod x;` mounted path.
 *   - `dev-docs/` targets are maintainer-local: checked only where the tree
 *     exists, probed by its `dev-docs/README.md` index — the marker a real
 *     dev-docs carries and no test fixture creates (clean-dev.test.mjs
 *     fabricates fixtures under the REAL `dev-docs/` in this tier, so a bare
 *     directory probe is the race check-ui-phase.sh records). Absent, they
 *     are neither findings nor stale entries, so CI stays green.
 *   - A file is GENERATED (skipped) only when a comment line in its first 20
 *     lines starts with `@generated` — not the word in a string, a template
 *     literal or prose.
 *   - A retired plan (its file deleted) is written `Origin: <title> plan
 *     (<date>, retired) <WI-…/§ as before>`, never `Plan:` with a dead path:
 *     `Origin:` is prose to this gate, so the WI ids stay for rule 60 §2 and
 *     nothing has to resolve.
 *
 * @coordinates-with scripts/lib/headerReferenceTargets.mjs — resolves one target against the tree
 * @coordinates-with scripts/lib/rustSource.mjs — blanks Rust literals before the comment scan
 * @coordinates-with scripts/check-header-references.mjs — the CLI over these functions
 * @coordinates-with scripts/check-header-references.test.mjs — drives every grammar here
 * @module scripts/lib/headerReferences
 */
import path from "node:path";
import ts from "typescript";

import { rustCode } from "./rustSource.mjs";
import {
  TREES,
  buildTailIndex,
  dependencyNames,
  fsAt,
  isRustDirFile,
  resolvePathTarget,
  resolveRustModuleTarget,
  stripExtension,
  treeFor,
  walkSources,
} from "./headerReferenceTargets.mjs";

const posix = path.posix;

export const KINDS = ["coordinates-with", "module-self", "plan"];
const TAGS = [
  { kind: "coordinates-with", re: /^\s*@coordinates-with\s+(\S.*)$/ },
  { kind: "module-self", re: /^\s*@module\s+(\S.*)$/ },
  { kind: "plan", re: /^\s*Plan:\s*(\S.*)$/ },
];

const LITERAL_KINDS = [
  ts.isStringLiteral,
  ts.isNoSubstitutionTemplateLiteral,
  ts.isTemplateHead,
  ts.isTemplateMiddle,
  ts.isTemplateTail,
  ts.isRegularExpressionLiteral,
  ts.isJsxText,
];

/**
 * `source` with every literal's characters blanked to spaces, newlines kept,
 * so the line model below sees only what the language reads as comments.
 * `file` picks the tokenizer: Rust through `rustCode`, anything else through
 * the TypeScript parser — skipped when the source holds no backtick, since
 * only a template literal can span lines in TS/JS (see the header).
 */
function literalsBlanked(source, file) {
  if (file.endsWith(".rs")) return rustCode(source, { keepComments: true });
  // Shell has no multi-line literal that a `#` comment scan can misread, and
  // no tokenizer here; the line model below reads it directly.
  if (file.endsWith(".sh")) return source;
  // Parse whenever the source can hold a literal that SPANS LINES — the only
  // way literal text can put `//` or `/*` at the start of one. A backtick is
  // not the only such literal: JSX TEXT spans lines with no backtick at all,
  // and so does a backslash line continuation inside a quoted string, so a
  // `@generated`-shaped line in either used to skip the whole file
  // (audit R2 #179).
  if (!source.includes("`") && !/\\\r?\n/.test(source) && !/\.[jt]sx$/.test(file)) return source;
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : /\.(m?js|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind);
  // UTF-16 CODE UNITS, not code points: TypeScript AST offsets are UTF-16, so
  // `[...source]` misaligned every blanking range after the first astral
  // character — an emoji or a rare CJK glyph — and could expose literal text
  // as a comment (audit R2 #180).
  const chars = source.split("");
  const visit = (node) => {
    if (LITERAL_KINDS.some((is) => is(node))) {
      for (let i = node.getStart(sf); i < node.end; i++) if (chars[i] !== "\n") chars[i] = " ";
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return chars.join("");
}

/** Net block-comment depth change over one line: `/*` opens, `*​/` closes, each consumed once. */
function blockDelta(text) {
  let delta = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "/" && text[i + 1] === "*") {
      delta += 1;
      i++;
    } else if (text[i] === "*" && text[i + 1] === "/") {
      delta -= 1;
      i++;
    }
  }
  return delta;
}

/**
 * Comment-shaped lines with their comment markers stripped (see header).
 * With a `file`, literals are blanked first so a quoted comment is not one.
 *
 * RUST BLOCK COMMENTS NEST, and TypeScript's do not — so Rust is tracked by
 * DEPTH and everything else by the first `*​/`. A boolean for both left the
 * scan reading the tail of an outer Rust comment as code after an inner one
 * closed, and every reference in it went unchecked (audit R2 #181). Measured
 * over every `.rs` file in this tree on adoption: the two models select the
 * identical line set, so this is correct-for-the-grammar rather than a fix for
 * a live miss.
 */
export function commentLines(source, file = "") {
  const out = [];
  let depth = 0;
  const shell = file.endsWith(".sh");
  const nests = file.endsWith(".rs");
  const lines = (file ? literalsBlanked(source, file) : source).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    if (shell) {
      // `#` is shell's only comment marker; there is no block form.
      if (t.startsWith("#")) out.push({ line: i + 1, text: t.replace(/^#+!?/, "") });
      continue;
    }
    if (depth > 0) {
      const close = t.indexOf("*/");
      out.push({ line: i + 1, text: (close >= 0 ? t.slice(0, close) : t).replace(/^\*+/, "") });
      depth = nests ? Math.max(0, depth + blockDelta(t)) : close >= 0 ? 0 : depth;
    } else if (t.startsWith("/*")) {
      const close = t.indexOf("*/", 2);
      out.push({ line: i + 1, text: (close >= 0 ? t.slice(2, close) : t.slice(2)).replace(/^\*+/, "") });
      depth = nests ? Math.max(0, blockDelta(t)) : close < 0 ? 1 : 0;
    } else if (t.startsWith("//")) {
      out.push({ line: i + 1, text: t.replace(/^\/\/[!/]?/, "") });
    }
  }
  return out;
}

/**
 * The target token of a tag: the first whitespace-delimited word, minus a
 * leading parenthesised qualifier (`(future) src-tauri …`), an attached
 * em-dash description, code-span or quote wrapping, and trailing punctuation.
 *
 * Stripped to a FIXED POINT, not in one pass. A single pass ran wrapper removal
 * before punctuation removal, so a combined form — `"foo.rs",` in a prose list,
 * or `` `foo.ts`. `` at the end of a sentence — kept its closing quote or
 * backtick and could never resolve: the reference was reported unresolved and
 * the wrong remedy suggested (audit R3 #182). Looping terminates because every
 * iteration either removes a character or changes nothing.
 */
export function firstTarget(rest) {
  const tokens = rest.trim().split(/\s+/);
  if (tokens.length > 1 && /^\(.*\)$/.test(tokens[0])) tokens.shift();
  let target = tokens[0].split("—")[0];
  for (let prev; prev !== target; ) {
    prev = target;
    target = target
      .replace(/^[`"']+/, "")
      .replace(/[`"']+$/, "")
      .replace(/[,;:.)]+$/, "");
  }
  return target;
}

/** Every reference a file's comments carry: `{ kind, target, line, file }`. */
export function extractReferences(source, filePath) {
  const refs = [];
  for (const { line, text } of commentLines(source, filePath)) {
    for (const { kind, re } of TAGS) {
      const m = re.exec(text);
      if (!m) continue;
      const target = firstTarget(m[1]);
      if (target) refs.push({ kind, target, line, file: filePath });
      break;
    }
  }
  return refs;
}

export function identityKey(ref) {
  return `${ref.file}|${ref.kind}|${ref.target}`;
}

/**
 * `dev-docs/` is gitignored — a reference into it can only be checked where it
 * exists.
 *
 * Matched by SEGMENT. The prefix/substring form required a following slash, so
 * the directory itself — a bare `dev-docs`, `../dev-docs`, or `website/dev-docs`
 * — was not classified maintainer-local and became an unresolvable finding on
 * every machine that does not have the folder, i.e. CI (audit R3 #183). A
 * segment test also cannot be fooled by a `dev-docs-archive/` sibling, which
 * `startsWith` would have needed the slash to exclude anyway.
 */
export function isMaintainerLocal(target) {
  const t = target.replace(/^(\.\.?\/)+/, "");
  return t.split("/").includes("dev-docs");
}

export function isMaintainerLocalKey(key) {
  return isMaintainerLocal(key.split("|").slice(2).join("|"));
}

/** The file-derived module stem: `hot_exit/dedup.rs` → `hot_exit/dedup`, `x/mod.rs` → `x`. */
function moduleStem(file, tree) {
  const rel = posix.relative(tree.moduleBase, file);
  if (tree.lang === "rust" && isRustDirFile(rel)) {
    const dir = posix.dirname(rel);
    return dir === "." ? "" : dir;
  }
  return stripExtension(rel);
}

/** `#[path = "<this file>"] mod name;` in a sibling: the module path Rust actually gives the file. */
function pathMountedModulePaths(file, tree, fs) {
  const dir = posix.dirname(file);
  const base = posix.basename(file);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(String.raw`#\[path\s*=\s*"${escaped}"\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;`, "g");
  const out = [];
  if (!fs.isDir(dir)) return out;
  for (const sibling of fs.listDir(dir)) {
    if (!sibling.endsWith(".rs") || sibling === base) continue;
    const siblingFile = posix.join(dir, sibling);
    if (!fs.isFile(siblingFile)) continue;
    // Over CODE, not raw text: a `#[path = "…"] mod x;` inside a doc comment
    // or quoted in a string minted a module alias that let an invalid
    // `@module` header resolve (audit R2 #184). `keepStrings` because the path
    // IS a literal; the fully-blanked copy then tells a real attribute from
    // one that lived inside a literal — the two-pass rule dod-syntax.mjs's
    // rustModIncludes already applies to the same grammar.
    const siblingSource = fs.read(siblingFile);
    const code = rustCode(siblingSource, { keepStrings: true });
    const bare = rustCode(siblingSource);
    for (const m of code.matchAll(re)) {
      if (bare[m.index] !== "#") continue;
      const parent = moduleStem(siblingFile, tree);
      out.push(parent ? `${parent}::${m[1]}` : m[1]);
    }
  }
  return out;
}

/** Every `@module` value the file may legitimately carry. */
export function expectedModulePaths(file, fs, trees = TREES) {
  const tree = treeFor(file, trees);
  const stem = moduleStem(file, tree);
  const out = new Set([stem]);
  if (tree.lang === "rust") {
    out.add(stem.replaceAll("/", "::"));
    for (const alt of pathMountedModulePaths(file, tree, fs)) {
      out.add(alt);
      out.add(alt.replaceAll("::", "/"));
    }
  } else if (posix.basename(stem) === "index") {
    // `import x from "@/lib/cjkFormatter"` names the directory: that is the module.
    out.add(posix.dirname(stem));
  }
  out.delete("");
  out.delete(".");
  return out;
}

/** The shared resolution context for one root; `trees` threads through indexing, dependencies and tree lookup. */
export function resolutionContext(root, trees = TREES) {
  const fs = fsAt(root);
  return { root, fs, trees, devDocsPresent: fs.isFile("dev-docs/README.md"), index: buildTailIndex(fs, trees), deps: dependencyNames(fs, trees) };
}

/**
 * Decide one reference. `ctx` is a `resolutionContext(root)` (or `{ root }`, built on demand).
 * Returns `{ status: "resolved", via }`, `{ status: "unresolved", reason }` or `{ status: "skipped", reason }`.
 */
export function resolveReference(ref, ctx) {
  if (!ctx.fs) ctx = { ...resolutionContext(ctx.root, ctx.trees), ...(ctx.devDocsPresent === undefined ? {} : { devDocsPresent: ctx.devDocsPresent }) };
  const trees = ctx.trees ?? TREES;
  const tree = treeFor(ref.file, trees);
  if (ref.kind === "module-self") {
    const expected = expectedModulePaths(ref.file, ctx.fs, trees);
    if (expected.has(ref.target)) return { status: "resolved", via: "location" };
    return { status: "unresolved", reason: `@module says "${ref.target}" but this file is "${[...expected][0] ?? ""}"` };
  }
  if (isMaintainerLocal(ref.target) && !ctx.devDocsPresent) {
    return { status: "skipped", reason: "maintainer-local target and dev-docs/ is absent" };
  }
  if (ref.target.includes("::")) return resolveRustModuleTarget(ref.target, ref, tree, ctx);
  return resolvePathTarget(ref.target, ref, tree, ctx);
}

/** A `@generated` directive on a comment line within the first 20 lines — the word in a string, a template literal or prose is not one. */
const isGenerated = (source, file) => commentLines(source, file).some(({ line, text }) => line <= 20 && /^\s*@generated\b/.test(text));

/** Resolve one file's references: the unresolved ones, with the per-reference statistics recorded in `stats`. */
function scanFile(file, source, ctx, stats) {
  const findings = [];
  for (const ref of extractReferences(source, file)) {
    stats.references[ref.kind]++;
    const r = resolveReference(ref, ctx);
    if (r.status === "skipped") {
      stats.maintainerLocalSkipped++;
      continue;
    }
    if (isMaintainerLocal(ref.target)) stats.maintainerLocalChecked++;
    if (r.status === "resolved") stats.resolvedVia[r.via]++;
    else findings.push({ ...ref, key: identityKey(ref), reason: r.reason });
  }
  return findings;
}

/** Every unresolved reference under `root`, sorted by identity key, plus scan statistics. */
export function collectFindings(root, { trees = TREES } = {}) {
  const ctx = resolutionContext(root, trees);
  const stats = {
    files: 0,
    generatedSkipped: 0,
    references: Object.fromEntries(KINDS.map((k) => [k, 0])),
    resolvedVia: { location: 0, tail: 0, dependency: 0 },
    maintainerLocalSkipped: 0,
    maintainerLocalChecked: 0,
    devDocsPresent: ctx.devDocsPresent,
  };
  const findings = [];
  for (const tree of trees) {
    if (!ctx.fs.isDir(tree.dir)) continue;
    for (const file of walkSources(ctx.fs, tree.dir)) {
      const source = ctx.fs.read(file);
      if (isGenerated(source, file)) {
        stats.generatedSkipped++;
        continue;
      }
      stats.files++;
      findings.push(...scanFile(file, source, ctx, stats));
    }
  }
  findings.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { findings, stats };
}

/**
 * Two-way identity comparison. `unlisted` fails (a new stale header), `stale`
 * fails (a fixed header still carried — record the win). `ignored` are
 * maintainer-local entries that cannot be verified because `dev-docs/` is absent.
 */
export function compareWithBaseline(findings, baseline, { devDocsPresent = true } = {}) {
  const actual = new Set(findings.map((f) => f.key ?? identityKey(f)));
  const listed = new Set(baseline.entries);
  const unlisted = [...actual].filter((k) => !listed.has(k)).sort();
  const gone = [...listed].filter((k) => !actual.has(k)).sort();
  const ignored = devDocsPresent ? [] : gone.filter(isMaintainerLocalKey);
  const stale = devDocsPresent ? gone : gone.filter((k) => !isMaintainerLocalKey(k));
  return { unlisted, stale, ignored };
}

/**
 * Validate a parsed baseline document; throws on anything but unique
 * `<file>|<kind>|<target>` strings with a non-empty file and target and a kind
 * from `KINDS` — an entry with a typo'd kind could never match a finding, and
 * would sit in the list as a stale entry nothing explains.
 */
export function validateBaseline(doc, label = "baseline") {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.entries)) throw new Error(`${label}: expected { "entries": [...] }`);
  const seen = new Set();
  for (const e of doc.entries) {
    const parts = typeof e === "string" ? e.split("|") : [];
    const [file, kind] = parts;
    const target = parts.slice(2).join("|");
    if (parts.length < 3 || !file || !target || !KINDS.includes(kind)) {
      throw new Error(`${label}: entry is not a "<file>|<kind>|<target>" key with a kind in ${KINDS.join("|")}: ${JSON.stringify(e)}`);
    }
    if (seen.has(e)) throw new Error(`${label}: duplicate entry ${e}`);
    seen.add(e);
  }
  return { entries: doc.entries };
}

export const BASELINE_HEADER = [
  "Header-reference identity baseline (WI-FL0.2): every header reference that did not resolve when this was measured, as <file>|<kind>|<target>.",
  "Checked by scripts/check-header-references.mjs (pnpm lint:header-refs, in check:static). Two-way: an unlisted finding fails, and a listed entry that no longer occurs fails until it is deleted (record the win).",
  "Entries only get REMOVED — fix the header (the target moved, was renamed or deleted); never append here. dev-docs/ entries are verified only where that directory exists.",
];

export function formatBaseline(entries) {
  return `${JSON.stringify({ "//": BASELINE_HEADER, entries: [...new Set(entries)].sort() }, null, 2)}\n`;
}
