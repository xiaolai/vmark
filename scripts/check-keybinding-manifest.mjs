#!/usr/bin/env node
/**
 * Keybinding drift gate (WI-1.5 / Phase 8; gap audit #2).
 *
 * A keyboard shortcut with a native menu accelerator lives in THREE sources that
 * must agree (`.claude/rules/41-keyboard-shortcuts.md`):
 *   1. `src/stores/settingsStore/shortcutDefinitions.ts` — frontend defaults,
 *      the source of truth; the synced subset is DERIVED from it here (every
 *      entry with a `menuId`, minus the dynamically-bound ones)
 *   2. `src-tauri/src/menu/localized/*.rs` — the REAL Rust menu builder
 *      (`accel("<menu-id>", "<default-accel>")` call sites), pinned as a contract
 *      mirror in `src-tauri/src/menu/localized.test.rs`
 *      (`DEFAULT_ACCELERATORS` / `PLATFORM_ACCELERATORS`)
 *   3. `website/guide/shortcuts.md` — the human-readable docs table
 *
 * There used to be a fourth: a hand-written `keybindingManifest.ts` restating
 * each entry's keys, which this gate then compared against the definitions it
 * was copied from. That comparison could only fail if someone forgot to copy —
 * it caught clerical omissions, never drift. Everything that catches real drift
 * compares ACROSS LANGUAGES, and all of it survives derivation.
 *
 * For every synced entry this gate asserts:
 *   - the Rust CONTRACT MIRROR accelerator for the entry's `menuId` equals
 *     `prosemirrorToTauri(defaultKey)` (and `prosemirrorToTauri(defaultKeyOther)`
 *     for platform-conditional entries),
 *   - the REAL menu builder's `accel(...)` call site for that `menuId` equals the
 *     same value (closing the "checked against a test mirror, not the real menu"
 *     gap — a drift between the mirror and the real builder is now visible here,
 *     not only in the macOS-only Rust test), and
 *   - the docs table lists EVERY effective platform accelerator the entry binds
 *     — `defaultKeyMac ?? defaultKey` and `defaultKeyOther ?? defaultKey`,
 *     order-insensitively; a menu-backed shortcut must be documented.
 * It also asserts the reverse direction on BOTH Rust sources: every non-empty
 * accelerator the real menu builder binds, and every non-empty tuple the
 * contract mirror holds, must map to a synced entry (or an explicit
 * allow-listed id with a stated reason). Without the mirror half, a renamed or
 * deleted shortcut left its old tuple behind to validate against itself
 * (audit R3 #69).
 *
 * Nothing is EXECUTED — no TS runtime, no cargo — so the gate runs under plain
 * `node`; but the TypeScript sources are PARSED (`typescript`, the way this
 * repo's other AST gates read TS) and the Rust sources go through
 * `lib/rustSource.mjs`'s comment/literal lexer. Text scanning was the defect:
 * a definitions entry could hide its `id` behind a comment or a nested object,
 * a `...SPREAD` element contributed shortcuts nothing checked, and a
 * commented-out mirror tuple stood in for the contract (audit R2
 * #62/#64/#68). It fails closed: a missing file, an unreadable table, a parse
 * error, or an array element shape it does not understand exits non-zero.
 * Run via `pnpm lint:keybinding-manifest` (wired into check:all).
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { keyTokens, prosemirrorToDocs, prosemirrorToTauri } from "./lib/keybindingFormat.mjs";
import { arrayLiteralEnd } from "./lib/arrayLiteralEnd.mjs";
import { rustCode, rustSpans } from "./lib/rustSource.mjs";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFS_PATH = "src/stores/settingsStore/shortcutDefinitions.ts";
const RUST_PATH = "src-tauri/src/menu/localized.test.rs";
const LOCALIZED_DIR = "src-tauri/src/menu/localized";
const DOCS_PATH = "website/guide/shortcuts.md";

/**
 * Menu ids whose accelerator is registered dynamically, not via a static menu
 * accel. Each names the SOURCE that binds it, and that binding is verified to
 * still exist below: an exemption is a claim about live code, and an
 * un-checked one silently removes a real shortcut from every cross-language
 * comparison the moment the dynamic path is deleted (audit R2 #55).
 */
const DYNAMIC_MENU_IDS = new Map([
  ["search-genies", { source: "src/hooks/useGenieShortcuts.ts", reason: "accelerator registered at runtime by useGenieShortcuts" }],
]);

/**
 * Menu ids that the real menu builder binds a non-empty accelerator to but which
 * are intentionally NOT in the manifest: OS-standard editor commands with no
 * `menuId` entry in `shortcutDefinitions.ts` (not user-customizable). The reverse
 * "real accel with no manifest entry" report allow-lists these.
 */
const NON_MANIFEST_MENU_ACCELS = new Map([
  ["undo", "OS-standard Undo — predefined, not in the customizable shortcut registry"],
  ["redo", "OS-standard Redo — predefined, not in the customizable shortcut registry"],
  ["quit", "OS-standard Quit — predefined, not in the customizable shortcut registry"],
]);

/**
 * Manifest ids whose accelerator is documented only inside a COMPRESSED RANGE in
 * `website/guide/shortcuts.md` ("Heading 1-6 | `Mod + 1` through `Mod + 6`"), so
 * it has no individual accelerator cell. `heading-1` and `heading-6` DO render as
 * individual code spans and are checked normally; only the interior levels are
 * exempt from the docs presence check.
 *
 * The exemption is a CLAIM ABOUT THE DOCS, and it is verified against them —
 * the rule `DYNAMIC_MENU_IDS` already carries. Each entry was a permanent pass
 * granted on a range nothing read: delete the range row, narrow it to
 * `Mod + 1` through `Mod + 3`, or rename the id, and four menu-backed
 * shortcuts left every docs comparison with the gate still green (audit R3
 * #56). Now the range row must exist, its endpoints must share the entry's
 * modifiers, and the entry's own key must fall between them.
 */
const DOCS_RANGE_DOCUMENTED = new Map([
  ["heading-2", 'documented as the range "Mod + 1 through Mod + 6"'],
  ["heading-3", 'documented as the range "Mod + 1 through Mod + 6"'],
  ["heading-4", 'documented as the range "Mod + 1 through Mod + 6"'],
  ["heading-5", 'documented as the range "Mod + 1 through Mod + 6"'],
]);

/** Read a file or die (fail-closed). */
function readOrDie(rel) {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch (err) {
    fail(`cannot read ${rel}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const errors = [];
function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

/**
 * Scan every `accel(...)` call site in a real menu-builder source. Ports the
 * paren-depth scanner from `localized.test.rs::scan_accel_calls` so nested
 * `cfg!(...)` parens don't end a call early. Returns an array of
 * `{ id, accel }` where `accel` is either a string (static literal) or
 * `{ mac, other }` (the `if cfg!(target_os = "macos") { … } else { … }` form).
 *
 * Comments and literals come from `lib/rustSource.mjs`'s `rustSpans` — the
 * repo's ONE Rust tokenizer — rather than from a loop in this file. The loop
 * that lived here was a second implementation of the same grammar and had
 * drifted exactly as a copy does: it closed a NESTED block comment at the first
 * `*​/`, knew nothing of raw strings (`r#"a"b"#`, whose unescaped quote opened
 * an ordinary string), and did not recognise char literals at all — so a single
 * `'"'` anywhere in a menu file sent it into string mode and every later
 * `accel(...)` disappeared from the check with nothing to fail on
 * (audit R3 #58/#59). Skipping a span is also what keeps a commented-out or
 * quoted call from being read as a real one, which is the promise this scan
 * already made.
 */
function scanAccelCalls(src, rel) {
  const spans = new Map();
  for (const span of rustSpans(src)) spans.set(span.start, span);
  const calls = [];
  let i = 0;
  while (i < src.length) {
    const span = spans.get(i);
    // A comment or a literal is never a call site.
    if (span) {
      i = span.end;
      continue;
    }
    // Require a call boundary: the char before `accel` must not be an identifier
    // char (so `AccelFn`, `my_accel(` etc. never match).
    if (!src.startsWith("accel(", i) || /[A-Za-z0-9_]/.test(i > 0 ? src[i - 1] : " ")) {
      i += 1;
      continue;
    }
    let j = i + "accel(".length;
    let depth = 1;
    const lits = [];
    const litSpans = [];
    while (depth > 0) {
      // An unterminated comment or literal runs to end of input (rustSpans), so
      // this is also the fail-closed exit for a file that no longer parses.
      if (j >= src.length) fail(`${rel}: unterminated accel(...) call — fail closed`);
      const inner = spans.get(j);
      if (inner) {
        if (inner.kind === "string") {
          lits.push(inner.value);
          litSpans.push([inner.start, inner.end]);
        }
        j = inner.end;
        continue;
      }
      const c = src[j];
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      j += 1;
    }
    if (lits.length === 2) {
      calls.push({ id: lits[0], accel: lits[1] });
    } else if (lits.length === 4) {
      if (lits[1] !== "macos") {
        fail(`${rel}: accel("${lits[0]}", …) has an unexpected cfg! target "${lits[1]}" (expected "macos")`);
      }
      // Four literals with "macos" second is NOT enough to know which branch is
      // which: `if !cfg!(target_os = "macos") { A } else { B }` has exactly the
      // same literals in the same order and means the opposite, and so does a
      // shape with the branches swapped (audit R2 #60). Check the TEXT BETWEEN
      // the literals — over code, so a comment between arguments is whitespace.
      const between = (a, b) => rustCode(src.slice(litSpans[a][1], litSpans[b][0]), { keepStrings: true });
      const bad =
        !/^\s*,\s*if\s+cfg!\s*\(\s*target_os\s*=\s*$/.test(between(0, 1)) ||
        !/^\s*\)\s*\{\s*$/.test(between(1, 2)) ||
        !/^\s*\}\s*else\s*\{\s*$/.test(between(2, 3));
      if (bad) {
        fail(
          `${rel}: accel("${lits[0]}", …) is not the platform-conditional shape this gate reads ` +
            '(`if cfg!(target_os = "macos") { <macOS> } else { <other> }`). A negated cfg!, a ' +
            "swapped pair of branches or a nested conditional carries the same four literals and " +
            "means something else, so the gate fails closed rather than assuming the polarity.",
        );
      }
      calls.push({ id: lits[0], accel: { mac: lits[2], other: lits[3] } });
    } else {
      fail(
        `${rel}: accel(…) call for "${lits[0] ?? "?"}" has ${lits.length} string ` +
          `literals (expected 2 for a static accel or 4 for the macOS/else form). ` +
          `The gate fails closed on any unrecognised accel(...) shape.`,
      );
    }
    i = j;
  }
  return calls;
}

/**
 * Parse every real menu-builder source (`localized/*.rs`, excluding `*.test.rs`)
 * into `{ realDefault, realPlatform, files }`:
 *   - `realDefault: Map<id, accelString>` for static `accel("id", "…")` sites, and
 *   - `realPlatform: Map<id, { mac, other }>` for the platform-conditional form.
 * On a duplicate id (e.g. `preferences`/`quit`/`save-all-quit` appear in both the
 * macOS App menu and the non-macOS File-menu tail) the values MUST agree — a
 * conflict fails the gate.
 */
function parseRealMenu() {
  const realDefault = new Map();
  const realPlatform = new Map();
  let files;
  try {
    files = readdirSync(join(ROOT, LOCALIZED_DIR)).filter(
      (f) => f.endsWith(".rs") && !f.endsWith(".test.rs"),
    );
  } catch (err) {
    fail(`cannot read ${LOCALIZED_DIR}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (files.length === 0) fail(`${LOCALIZED_DIR}: no menu-builder .rs sources found`);
  for (const file of files.sort()) {
    const rel = `${LOCALIZED_DIR}/${file}`;
    const src = readOrDie(rel);
    for (const { id, accel } of scanAccelCalls(src, rel)) {
      if (typeof accel === "string") {
        const prior = realDefault.get(id);
        if (prior !== undefined && prior !== accel) {
          fail(`${rel}: accel("${id}", …) = ${JSON.stringify(accel)} conflicts with an earlier site ${JSON.stringify(prior)}`);
        }
        if (realPlatform.has(id)) {
          fail(`${rel}: "${id}" is a static accel here but platform-conditional elsewhere`);
        }
        realDefault.set(id, accel);
      } else {
        const prior = realPlatform.get(id);
        if (prior !== undefined && (prior.mac !== accel.mac || prior.other !== accel.other)) {
          fail(`${rel}: platform accel("${id}", …) conflicts with an earlier site`);
        }
        if (realDefault.has(id)) {
          fail(`${rel}: "${id}" is platform-conditional here but a static accel elsewhere`);
        }
        realPlatform.set(id, accel);
      }
    }
  }
  if (realDefault.size === 0) fail(`${LOCALIZED_DIR}: parsed zero static accel(...) sites`);
  return { realDefault, realPlatform };
}

// --- Docs (website/guide/shortcuts.md) accelerator extraction ---

const MOD_TOKENS = new Set(["Mod", "Alt", "Ctrl", "Shift", "Cmd", "Option"]);
const GRAVE = "`key"; // canonical token for the backtick key
/** Sentinel that survives fence-stripping, standing in for a backtick KEY. */
const DOC_BT_SENTINEL = "\u0001";
const NAMED_KEYS = new Set([
  "Up", "Down", "Left", "Right", "Enter", "Escape", "Esc", "Tab",
  "Backspace", "Space", "Delete", "Home", "End", "PageUp", "PageDown",
]);

/** Canonicalise one accelerator token (case-fold single letters, unify backtick). */
function canonToken(t) {
  if (t === "`" || t === DOC_BT_SENTINEL) return GRAVE;
  if (t.length === 1 && /[a-z]/i.test(t)) return t.toUpperCase();
  return t;
}

/**
 * Order-insensitive canonical form of an accelerator token list: modifiers are
 * sorted (so `Mod-Alt-]` and the docs' `Alt + Mod + ]` compare equal — the docs
 * legitimately normalise modifier order), then the non-modifier key(s) appended.
 */
function canonAccel(tokens) {
  const canon = tokens.map(canonToken);
  const mods = canon.filter((t) => MOD_TOKENS.has(t)).sort();
  const keys = canon.filter((t) => !MOD_TOKENS.has(t));
  return [...mods, ...keys].join("+");
}

/** Is `t` a plausible accelerator token (modifier, single key, F-key, or named key)? */
function isAccelToken(t) {
  if (t === DOC_BT_SENTINEL) return true;
  if (MOD_TOKENS.has(t)) return true;
  if (/^F\d{1,2}$/.test(t)) return true;
  if (NAMED_KEYS.has(t)) return true;
  return t.length === 1; // single char: letter, digit, or punctuation key
}

/** Add one docs cell/code-span's accelerator (if it parses as one) to `set`. */
function addDocsAccel(set, cell) {
  const trimmed = cell.replace(/_[^_]*_/g, "").trim(); // drop italic annotations
  if (!trimmed) return;
  const toks = trimmed.includes("+")
    ? trimmed.split("+").map((t) => t.trim()).filter(Boolean)
    : [trimmed];
  if (toks.length === 0 || !toks.every(isAccelToken)) return;
  set.add(canonAccel(toks));
}

/**
 * Build the set of canonical accelerators present in the docs table. Two passes:
 *   1. every inline code span (`` `Mod + 1` ``) — catches range cells that list
 *      several accelerators in one table cell, and
 *   2. every `|`-delimited table cell after fence-stripping — catches un-fenced
 *      accelerators and single-key cells (`` `F4` `` in the F-key reference).
 * The backtick KEY (rendered as the code span `` `` ` `` ``) is swapped for a
 * sentinel first so fence-stripping can't erase it.
 */
function buildDocsAccelSet(raw, rel) {
  const withSentinel = raw.replace(/``\s*`\s*``/g, ` ${DOC_BT_SENTINEL} `);
  const set = new Set();
  for (const m of withSentinel.matchAll(/`([^`\n]+)`/g)) addDocsAccel(set, m[1]);
  const stripped = withSentinel.replace(/`+/g, " ");
  for (const line of stripped.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    for (const cell of line.split("|")) addDocsAccel(set, cell);
  }
  if (set.size === 0) fail(`${rel}: parsed zero accelerators from the docs table`);
  return set;
}

/**
 * An accelerator's modifiers and its single key, or null when it is not a
 * one-key chord — the shape a compressed range can talk about.
 */
function accelParts(tokens) {
  const canon = tokens.map(canonToken);
  const keys = canon.filter((t) => !MOD_TOKENS.has(t));
  if (keys.length !== 1 || keys[0].length !== 1) return null;
  return { mods: canon.filter((t) => MOD_TOKENS.has(t)).sort().join("+"), key: keys[0] };
}

/**
 * Every compressed range the docs table writes as `` `A` through `B` `` in one
 * cell, as `{ mods, from, to, text }`. Only chords that differ in exactly their
 * one key can form a range, so a pair with different modifiers is not one.
 */
function docsRanges(raw) {
  const out = [];
  for (const m of raw.matchAll(/`([^`\n]+)`\s+through\s+`([^`\n]+)`/g)) {
    const from = accelParts(m[1].split("+").map((t) => t.trim()).filter(Boolean));
    const to = accelParts(m[2].split("+").map((t) => t.trim()).filter(Boolean));
    if (from && to && from.mods === to.mods && from.key <= to.key) {
      out.push({ mods: from.mods, from: from.key, to: to.key, text: `${m[1]} through ${m[2]}` });
    }
  }
  return out;
}

/** The documented range covering `tokens`, or null. */
function coveringRange(ranges, tokens) {
  const p = accelParts(tokens);
  if (!p) return null;
  return ranges.find((r) => r.mods === p.mods && r.from <= p.key && p.key <= r.to) ?? null;
}

/** Unescape a JS/TS double-quoted string body into its runtime value. */
function unquote(rawBody) {
  return JSON.parse(`"${rawBody}"`);
}

/**
 * Every DEPTH-1 string field of one object literal, in SOURCE ORDER (a
 * duplicate key keeps the LAST assignment, which is the value JavaScript
 * builds). Read from the parser, not from a regex over the literal's text: a
 * `// id: "x"` inside the entry, and an `id` inside a NESTED object, both
 * satisfied the old boundary-anchored search and stood in for the real
 * property (audit R2 #62).
 *
 * A SPREAD or a COMPUTED key fails the gate rather than being skipped: either
 * can override a literal that is right there in the source, so the value this
 * function would report is not the value the app uses.
 */
function objectStringFields(obj, rel, name) {
  const fields = new Map();
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p) || (p.name !== undefined && ts.isComputedPropertyName(p.name))) {
      fail(
        `${rel}: ${name} contains an entry with a ${ts.isSpreadAssignment(p) ? "spread" : "computed key"}. ` +
          "Either can override a literal property, so the accelerator this gate would check " +
          "is not necessarily the one the app binds — it fails closed instead.",
      );
    }
    if (!ts.isPropertyAssignment(p)) continue;
    if (!ts.isIdentifier(p.name) && !ts.isStringLiteralLike(p.name)) continue;
    fields.set(p.name.text, ts.isStringLiteralLike(p.initializer) ? p.initializer.text : undefined);
  }
  return fields;
}

/**
 * Parse an array of `{ ... }` object literals from a TS source region.
 * `region` must already be narrowed to the array body (`arrayBody`).
 *
 * PARSED, not brace-counted. The hand-rolled splitter collected the balanced
 * `{ … }` groups it found and IGNORED every other array element, so a
 * `...MORE_SHORTCUTS`, a bare identifier or a `makeEntry("x")` contributed
 * definitions the drift check never saw — and the entry-count guard compared
 * two numbers that both excluded them, so it could not notice (audit R2 #64).
 * Every element must now be an object literal, or the gate fails closed.
 */
function parseObjectLiterals(region, rel, name) {
  const sf = ts.createSourceFile(`${name}.ts`, `(${region}])`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length > 0) {
    fail(`${rel}: ${name} does not parse: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}`);
  }
  let arr;
  const findArray = (node) => {
    if (arr) return;
    if (ts.isArrayLiteralExpression(node)) arr = node;
    else ts.forEachChild(node, findArray);
  };
  findArray(sf);
  if (!arr) fail(`${rel}: ${name} — no array literal to read`);
  const out = [];
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) {
      fail(
        `${rel}: ${name} holds an array element that is not an object literal: ` +
          `${el.getText(sf).replace(/\s+/g, " ").slice(0, 160)}\n  The gate fails closed: ` +
          "a spread, an identifier or a factory call hides every shortcut it contributes.",
      );
    }
    const fields = objectStringFields(el, rel, name);
    const id = fields.get("id");
    if (id === undefined) {
      const menuId = fields.get("menuId");
      const hint = menuId
        ? ` — this entry has menuId "${menuId}" but no extractable string \`id\``
        : " — no extractable string \`id\`";
      fail(
        `${rel}: ${name} contains an object literal the drift gate cannot parse${hint}. ` +
          `Fragment: ${el.getText(sf).replace(/\s+/g, " ").trim().slice(0, 160)}\n  The gate fails closed: give the entry a plain ` +
          "\`id: \"…\"\` property so its accelerator can be verified.",
      );
    }
    out.push({
      id,
      label: fields.get("label"),
      defaultKey: fields.get("defaultKey"),
      defaultKeyMac: fields.get("defaultKeyMac"),
      defaultKeyOther: fields.get("defaultKeyOther"),
      menuId: fields.get("menuId"),
    });
  }
  // Belt-and-suspenders: one parsed entry per array element (unreachable after
  // the per-element fail() above, but makes the invariant explicit).
  if (out.length !== arr.elements.length) {
    fail(
      `${rel}: ${name} parsed ${out.length} entries from ${arr.elements.length} array ` +
        "elements — the gate fails closed on any dropped entry",
    );
  }
  return out;
}

/**
 * The `[` that opens `ident`'s array declaration in TypeScript, from the
 * PARSER — not from a regex over raw text.
 *
 * A declaration-shaped comment or string anchored the regex: `// const
 * DEFAULT_SHORTCUTS: Shortcut[] = [` in a header, or the same text inside a
 * template literal, matched before the real declaration and handed the parse an
 * array that is not the one the app builds (audit R3 #65). The parser has no
 * such ambiguity, and it already has to succeed here — `arrayLiteralEnd` refuses
 * a source with parse diagnostics — so this costs one extra parse and no new
 * failure mode. `as const` / `satisfies` / parentheses are unwrapped, since each
 * wraps the array without changing which array it is.
 */
function tsDeclarationOpen(src, ident, rel) {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length > 0) {
    fail(`${rel}: does not parse: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}`);
  }
  let open = -1;
  const unwrap = (node) => {
    let n = node;
    while (
      n !== undefined &&
      (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n))
    ) {
      n = n.expression;
    }
    return n;
  };
  const visit = (node) => {
    if (open !== -1) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === ident) {
      const init = unwrap(node.initializer);
      if (init !== undefined && ts.isArrayLiteralExpression(init)) {
        open = init.getStart(sf);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return open;
}

/**
 * The `[` that opens `ident`'s array declaration in Rust
 * (`const NAME: &[(&str, &str)] = &[`).
 *
 * Matched over fully-blanked CODE — `rustCode` blanks comments AND literals
 * while preserving offsets — for the same reason as the TypeScript side: this
 * gate's Rust input already arrives with `keepStrings: true`, so a
 * declaration-shaped string would still have anchored it (audit R3 #65).
 */
function rustDeclarationOpen(src, ident) {
  const decl = new RegExp(`(?:const|let|var|static)\\s+${ident}\\b[^=\\n]*=\\s*&?\\s*\\[`);
  const m = decl.exec(rustCode(src));
  return m ? m.index + m[0].length - 1 : -1;
}

/** Narrow source to the body of `const NAME ... = [ ... ];`. */
function arrayBody(src, name, rel) {
  // Anchor on the DECLARATION, not the first mention of the name. `indexOf`
  // matched the name inside the file's header comment and then took whatever
  // `[` came next — which stayed correct only while no other array happened to
  // be declared in between. Adding one (the category table) silently made this
  // parse the wrong array and report zero definitions.
  // Callers used to pass "const NAME" to dodge the comment-mention problem;
  // the declaration anchor makes the identifier alone sufficient either way.
  // The END is the BALANCED closing bracket (strings and comments skipped —
  // scripts/lib/arrayLiteralEnd.mjs), not the first textual `];`: a comment
  // mentioning `];` inside the array used to truncate the parse and drop every
  // later entry from the check with nothing to fail on.
  const ident = name.trim().split(/\s+/).pop();
  const open = rel.endsWith(".rs") ? rustDeclarationOpen(src, ident) : tsDeclarationOpen(src, ident, rel);
  if (open === -1) fail(`${rel}: could not find a declaration of ${ident}`);
  // The scanner is language-specific: TS regex literals and nested templates,
  // Rust nested block comments and raw strings each need their own tokenizer,
  // and one hand-rolled loop was wrong for both (audit R2 #136/#138/#139/#140).
  const close = arrayLiteralEnd(src, open, { lang: rel.endsWith(".rs") ? "rust" : "ts" });
  if (close === -1) fail(`${rel}: no balanced array closing after ${name}`);
  return src.slice(open, close);
}

// --- Load frontend definitions ---
const defsSrc = readOrDie(DEFS_PATH);
const defs = parseObjectLiterals(
  arrayBody(defsSrc, "DEFAULT_SHORTCUTS", DEFS_PATH),
  DEFS_PATH,
  "DEFAULT_SHORTCUTS",
);

// --- Derive the synced subset ---
// Every definition carrying a `menuId`, minus the dynamically-bound ones. This
// used to be a hand-copied file (`keybindingManifest.ts`) that the gate then
// compared against these same definitions — an equality between two copies of
// one value, which cannot fail unless someone forgets to copy. What actually
// catches drift is the comparison against the OTHER languages: the Rust mirror,
// the real menu builder, and the docs table. Those run against the derived set
// unchanged.
const manifest = defs
  .filter((d) => d.menuId && !DYNAMIC_MENU_IDS.has(d.menuId))
  .map((d) => ({
    id: d.id,
    label: d.label,
    defaultKey: d.defaultKey,
    defaultKeyMac: d.defaultKeyMac,
    defaultKeyOther: d.defaultKeyOther,
    menuId: d.menuId,
  }));
// Zero DEFINITIONS first, then zero DERIVED entries. The other order made the
// definitions check unreachable — no definitions implies no manifest, so the
// manifest `fail()` always fired first and reported a derivation problem for
// what is really a parse that read nothing (audit R3 #66).
if (defs.length === 0) fail(`${DEFS_PATH}: parsed zero shortcut definitions`);
if (manifest.length === 0) fail(`${DEFS_PATH}: derived zero menu-backed shortcuts`);
const defById = new Map(defs.map((d) => [d.id, d]));

// --- Load Rust contract tables ---
// Comments are blanked (nested-aware, offsets preserved) before the tuple
// regexes run: a commented-out tuple counted as the contract, so a mirror
// whose live entry had been deleted could still validate against the comment
// left behind (audit R2 #68). `keepStrings` because the accelerators ARE the
// string literals this reads.
const rustSrc = rustCode(readOrDie(RUST_PATH), { keepStrings: true });
const rustDefaultBody = arrayBody(rustSrc, "const DEFAULT_ACCELERATORS", RUST_PATH);
const rustPlatformBody = arrayBody(rustSrc, "const PLATFORM_ACCELERATORS", RUST_PATH);

/**
 * Every element of a contract array must be read by `re`. Matching and moving
 * on lets a tuple shape this parser does not understand vanish silently — and
 * an id missing from the mirror is only caught when a manifest entry names it,
 * so a mirror-only entry disappeared with nothing to fail on (audit R2 #68).
 */
function readTuples(body, re, name) {
  const matches = [...body.matchAll(re)];
  const marks = body.split("");
  for (const m of matches) for (let i = m.index; i < m.index + m[0].length; i++) marks[i] = " ";
  const residue = marks.join("").replace(/[\s,[\]]+/g, "");
  if (residue !== "") {
    fail(
      `${RUST_PATH}: ${name} holds array element text this gate did not read: ` +
        `${JSON.stringify(residue.slice(0, 120))} — the gate fails closed rather than ` +
        "checking the tuples it happened to understand.",
    );
  }
  return matches;
}

// Duplicate ids in either contract table (or an id in BOTH) silently overwrote
// earlier entries via Map.set — a wrong-then-right duplicate would let the gate
// validate against the surviving tuple and pass. Fail closed on any duplicate
// (audit-fix, round 3).
const rustDefault = new Map();
for (const m of readTuples(rustDefaultBody, /\("([a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)"\)/g, "DEFAULT_ACCELERATORS")) {
  if (rustDefault.has(m[1])) fail(`${RUST_PATH}: duplicate id "${m[1]}" in DEFAULT_ACCELERATORS`);
  rustDefault.set(m[1], unquote(m[2]));
}
const rustPlatform = new Map();
for (const m of readTuples(rustPlatformBody, /\("([a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\)/g, "PLATFORM_ACCELERATORS")) {
  if (rustPlatform.has(m[1])) fail(`${RUST_PATH}: duplicate id "${m[1]}" in PLATFORM_ACCELERATORS`);
  if (rustDefault.has(m[1])) {
    fail(`${RUST_PATH}: id "${m[1]}" appears in BOTH DEFAULT_ACCELERATORS and PLATFORM_ACCELERATORS`);
  }
  rustPlatform.set(m[1], { mac: unquote(m[2]), other: unquote(m[3]) });
}
if (rustDefault.size === 0) fail(`${RUST_PATH}: parsed zero DEFAULT_ACCELERATORS entries`);
if (rustPlatform.size === 0) fail(`${RUST_PATH}: parsed zero PLATFORM_ACCELERATORS entries`);

// --- Load the REAL Rust menu builder (accel(...) call sites) ---
const { realDefault, realPlatform } = parseRealMenu();

// --- Load the docs table accelerators ---
const docsSrc = readOrDie(DOCS_PATH);
const docsAccels = buildDocsAccelSet(docsSrc, DOCS_PATH);
const docsRangeCells = docsRanges(docsSrc);

// --- Dynamic-exemption liveness: the binding each exemption cites must exist ---
for (const [id, { source, reason }] of DYNAMIC_MENU_IDS) {
  const src = readOrDie(source);
  if (!src.includes(`"${id}"`)) {
    errors.push(
      `stale DYNAMIC_MENU_IDS entry "${id}": ${source} no longer names it (${reason}). ` +
        "The exemption removes the id from every check here, so a dead dynamic binding " +
        "would take the shortcut out of the gate with nothing to fail on — delete the " +
        "exemption so the id is checked statically, or point it at the new binding.",
    );
  }
}

const manifestMenuIds = new Set(manifest.map((e) => e.menuId).filter(Boolean));

// Range-exemption liveness, the other direction: an exempt id that is no longer
// a menu-backed shortcut is a rename the map outlived, and it would go on
// exempting whatever takes that id next (the rule LABEL_EXEMPT/UNPAIRED_OK
// already carry).
for (const id of DOCS_RANGE_DOCUMENTED.keys()) {
  if (!manifestMenuIds.has(id)) {
    errors.push(`stale DOCS_RANGE_DOCUMENTED entry "${id}": no such menu id in the manifest — remove it.`);
  }
}

// Two definitions on ONE native command: the menu binds one accelerator, so
// the second definition's key can never reach it through the menu — and when
// both keys coincide every per-entry check below passes twice. Reject.
{
  const byMenuId = new Map();
  for (const e of manifest) {
    if (byMenuId.has(e.menuId)) errors.push(`manifest: menuId "${e.menuId}" is claimed by both "${byMenuId.get(e.menuId)}" and "${e.id}"`);
    else byMenuId.set(e.menuId, e.id);
  }
}

// --- Per-entry checks ---
const seenIds = new Set();
for (const entry of manifest) {
  const { id, menuId } = entry;
  if (seenIds.has(id)) {
    errors.push(`manifest: duplicate id "${id}"`);
    continue;
  }
  seenIds.add(id);

  if (!menuId) {
    errors.push(`manifest "${id}": missing menuId`);
    continue;
  }

  const def = defById.get(id);
  if (!def) {
    // Unreachable while the set is derived from `defs`; kept as a fail-closed
    // guard so a future re-plumbing of the source cannot skip entries silently.
    errors.push(`"${id}": no matching entry in ${DEFS_PATH}`);
    continue;
  }
  const manKey = entry.defaultKey ?? "";
  const manOther = entry.defaultKeyOther;
  // `defaultKeyMac` is runtime-wired (settingsStore/shortcuts.ts resolves it on
  // macOS) but no entry uses it yet. Still validate it so the day one appears, the
  // gate compares the macOS surfaces against the override rather than defaultKey
  // (audit-fix, round 3). `macKey`/`manMac` below feed the macOS Rust + real-menu
  // checks; they collapse to `manKey` while defaultKeyMac is absent.
  const defMac = def.defaultKeyMac;
  const manMac = entry.defaultKeyMac;
  if (defMac !== manMac) {
    errors.push(
      `"${id}": manifest defaultKeyMac ${JSON.stringify(manMac)} !== ` +
        `${DEFS_PATH} ${JSON.stringify(defMac)}`,
    );
  }
  const macKey = manMac ?? manKey;
  if ((def.menuId ?? "") !== menuId) {
    errors.push(`"${id}": manifest menuId "${menuId}" !== ${DEFS_PATH} "${def.menuId ?? ""}"`);
  }

  // 2. Matches the Rust menu accelerator contract.
  if (rustPlatform.has(menuId)) {
    const { mac, other } = rustPlatform.get(menuId);
    const gotMac = prosemirrorToTauri(macKey);
    const gotOther = prosemirrorToTauri(manOther ?? "");
    if (gotMac !== mac) {
      errors.push(`"${id}" (${menuId}): macOS accel ${JSON.stringify(gotMac)} !== Rust ${JSON.stringify(mac)}`);
    }
    if (gotOther !== other) {
      errors.push(`"${id}" (${menuId}): other accel ${JSON.stringify(gotOther)} !== Rust ${JSON.stringify(other)}`);
    }
  } else if (rustDefault.has(menuId)) {
    const got = prosemirrorToTauri(manKey);
    const want = rustDefault.get(menuId);
    if (got !== want) {
      errors.push(`"${id}" (${menuId}): accel ${JSON.stringify(got)} !== Rust ${JSON.stringify(want)}`);
    }
  } else {
    errors.push(`"${id}" (${menuId}): menuId absent from Rust DEFAULT_ACCELERATORS / PLATFORM_ACCELERATORS`);
  }

  // 3. Matches the REAL menu builder's accel(...) call site (not just the mirror).
  const wantAccel = prosemirrorToTauri(manKey);
  const wantAccelMac = prosemirrorToTauri(macKey);
  if (manOther !== undefined) {
    const rp = realPlatform.get(menuId);
    if (!rp) {
      errors.push(
        `"${id}" (${menuId}): manifest is platform-conditional but the real menu ` +
          `builder (${LOCALIZED_DIR}) has no platform-conditional accel("${menuId}", …) site`,
      );
    } else {
      const wantOther = prosemirrorToTauri(manOther);
      if (rp.mac !== wantAccelMac) {
        errors.push(`"${id}" (${menuId}): real menu macOS accel ${JSON.stringify(rp.mac)} !== prosemirrorToTauri(defaultKeyMac ?? defaultKey) ${JSON.stringify(wantAccelMac)}`);
      }
      if (rp.other !== wantOther) {
        errors.push(`"${id}" (${menuId}): real menu other accel ${JSON.stringify(rp.other)} !== prosemirrorToTauri(defaultKeyOther) ${JSON.stringify(wantOther)}`);
      }
    }
  } else if (realDefault.has(menuId)) {
    const got = realDefault.get(menuId);
    if (got !== wantAccel) {
      errors.push(`"${id}" (${menuId}): real menu accel ${JSON.stringify(got)} !== prosemirrorToTauri(defaultKey) ${JSON.stringify(wantAccel)}`);
    }
  } else if (realPlatform.has(menuId)) {
    errors.push(`"${id}" (${menuId}): real menu builder is platform-conditional but the manifest entry is not`);
  } else {
    errors.push(`"${id}" (${menuId}): no accel("${menuId}", …) call site in the real menu builder ${LOCALIZED_DIR}`);
  }

  // 4. Documented in the website shortcuts table (order-insensitive).
  //
  // Every EFFECTIVE platform key, not just `defaultKey`. `defaultKeyMac`
  // overrides on macOS and `defaultKeyOther` off it, so what a user can press
  // is `defaultKeyMac ?? defaultKey` on one platform and
  // `defaultKeyOther ?? defaultKey` on the other. The leg used to read
  // `defaultKey` and `defaultKeyOther` only, so a macOS override went
  // undocumented with nothing to fail on — and, worse, an entry with an EMPTY
  // `defaultKey` skipped the whole leg even when the macOS override was a real
  // chord (audit R3 #70). No entry uses `defaultKeyMac` today, which is exactly
  // why the gap was invisible; the Rust legs above already read `macKey`.
  const docKeys = [...new Set([macKey, manOther ?? manKey])].filter((k) => k !== undefined && k !== "");
  if (docKeys.length === 0) {
    // Deliberately unbound: docs render it as "—" / "Menu only" / "(customizable)".
    // Nothing to locate; the empty accelerator is already covered above.
  } else if (DOCS_RANGE_DOCUMENTED.has(menuId)) {
    // Documented only inside a compressed range cell — an allowed exception,
    // but only while the docs actually carry a range that covers it.
    for (const key of docKeys) {
      if (coveringRange(docsRangeCells, keyTokens(key))) continue;
      errors.push(
        `stale DOCS_RANGE_DOCUMENTED entry "${menuId}" (${DOCS_RANGE_DOCUMENTED.get(menuId)}): ` +
          `no "\`A\` through \`B\`" cell in ${DOCS_PATH} covers "${prosemirrorToDocs(key)}". ` +
          "The exemption removes the id from the docs check entirely, so a deleted or " +
          "narrowed range would take the shortcut out of the gate with nothing to fail on — " +
          "restore the range, or delete the exemption so the accelerator is documented on its own row.",
      );
    }
  } else {
    for (const key of docKeys) {
      if (docsAccels.has(canonAccel(keyTokens(key)))) continue;
      errors.push(
        `"${id}" (${menuId}): accelerator "${prosemirrorToDocs(key)}" is missing ` +
          `from the docs table ${DOCS_PATH} — a menu-backed shortcut must be documented`,
      );
    }
  }
}

// --- Reverse: every non-empty accel the real menu binds maps to a manifest entry ---
function reportOrphanRealAccel(id, accelDesc) {
  if (manifestMenuIds.has(id)) return;
  if (DYNAMIC_MENU_IDS.has(id)) return;
  if (NON_MANIFEST_MENU_ACCELS.has(id)) return;
  errors.push(
    `real menu builder binds ${accelDesc} to menu id "${id}", which is absent from ` +
      `the synced set — give it a menuId entry in ${DEFS_PATH} (or allow-list ` +
      `it in NON_MANIFEST_MENU_ACCELS with a reason)`,
  );
}
for (const [id, accel] of realDefault) {
  if (accel === "") continue; // unbound-by-default menu item: nothing to reconcile
  reportOrphanRealAccel(id, JSON.stringify(accel));
}
for (const [id, { mac, other }] of realPlatform) {
  if (mac === "" && other === "") continue;
  reportOrphanRealAccel(id, `${JSON.stringify(mac)}/${JSON.stringify(other)}`);
}

// --- Reverse: every CONTRACT MIRROR tuple maps to a manifest entry too ------
//
// The per-entry legs above walk the manifest and look each id UP in the mirror,
// so an id the mirror carries and nothing else does was never examined: a
// renamed or deleted shortcut left its old tuple behind in
// `localized.test.rs`, where it kept validating against itself while the gate
// reported green (audit R3 #69). The real-menu direction has had this check
// since the leg was written; the mirror is the same shape and needed the same
// one, with the same allow-lists — an id excluded from the manifest on purpose
// is excluded from both directions or from neither.
function reportOrphanMirrorAccel(id, table, accelDesc) {
  if (manifestMenuIds.has(id)) return;
  if (DYNAMIC_MENU_IDS.has(id)) return;
  if (NON_MANIFEST_MENU_ACCELS.has(id)) return;
  errors.push(
    `${RUST_PATH}: ${table} holds ${accelDesc} for menu id "${id}", which is absent from ` +
      `the synced set — the tuple is stale (delete it), or the id needs a menuId entry in ` +
      `${DEFS_PATH} (or an allow-list entry in NON_MANIFEST_MENU_ACCELS with a reason)`,
  );
}
for (const [id, accel] of rustDefault) {
  if (accel === "") continue; // unbound-by-default menu item — same rule as the real-menu leg
  reportOrphanMirrorAccel(id, "DEFAULT_ACCELERATORS", JSON.stringify(accel));
}
for (const [id, { mac, other }] of rustPlatform) {
  if (mac === "" && other === "") continue;
  reportOrphanMirrorAccel(id, "PLATFORM_ACCELERATORS", `${JSON.stringify(mac)}/${JSON.stringify(other)}`);
}

// --- Label parity (WI-UI4.3): ONE label per command ------------------------
//
// The native menu's en.yml label (minus a trailing ellipsis) must equal the
// shortcutDefinitions label for every menu-backed id: the palette, Settings
// shortcuts and toolbar tooltips all read the definitions label, so a menu
// that says something else is the "two names, one command" drift this gate
// exists to kill. Exemptions carry a reason, in the compressed-range style.
// A SUBMENU item inherits its parent's noun ("Insert → Image"), while the
// flat surfaces (palette, Settings, tooltips) must stand alone ("Insert
// Image"). Byte equality would force verbose menus or ambiguous flat labels,
// so the submenu-context class is exempt BY ID with the folding stated.
// Each exemption RECORDS BOTH labels it exempts (the menu side and the
// definitions side): an exemption that accepted any non-equal pair would let
// EITHER label drift to anything while staying green. A change on either side
// of an exempt id now fails until the recorded tuple is updated — the drift
// gets reviewed, not absorbed.
const LABEL_EXEMPT = new Map([
  ["image", { menu: "Image", defs: "Insert Image", reason: "Insert submenu supplies the verb — flat label folds it in (Insert Image)" }],
  ["video", { menu: "Video", defs: "Insert Video", reason: "Insert submenu supplies the verb (Insert Video)" }],
  ["audio", { menu: "Audio", defs: "Insert Audio", reason: "Insert submenu supplies the verb (Insert Audio)" }],
  ["diagram", { menu: "Diagram", defs: "Insert Diagram", reason: "Insert submenu supplies the verb (Insert Diagram)" }],
  ["graphviz-diagram", { menu: "Graphviz Diagram", defs: "Insert Graphviz Diagram", reason: "Insert submenu supplies the verb (Insert Graphviz Diagram)" }],
  ["mindmap", { menu: "Mindmap", defs: "Insert Mindmap", reason: "Insert submenu supplies the verb (Insert Mindmap)" }],
  ["info-note", { menu: "Note", defs: "Insert Note", reason: "Info Box submenu supplies the noun (Insert Note)" }],
  ["info-tip", { menu: "Tip", defs: "Insert Tip", reason: "Info Box submenu supplies the noun (Insert Tip)" }],
  ["info-warning", { menu: "Warning", defs: "Insert Warning", reason: "Info Box submenu supplies the noun (Insert Warning)" }],
  ["info-important", { menu: "Important", defs: "Insert Important", reason: "Info Box submenu supplies the noun (Insert Important)" }],
  ["info-caution", { menu: "Caution", defs: "Insert Caution", reason: "Info Box submenu supplies the noun (Insert Caution)" }],
  ["collapsible-block", { menu: "Collapsible Block", defs: "Insert Collapsible Block", reason: "Insert menu supplies the verb (Insert Collapsible Block)" }],
  ["export-html", { menu: "HTML", defs: "Export HTML", reason: "Export submenu supplies the verb (Export HTML)" }],
  ["export-pdf-native", { menu: "PDF", defs: "Export PDF", reason: "Export submenu supplies the verb (Export PDF)" }],
  ["transform-uppercase", { menu: "UPPERCASE", defs: "Transform to UPPERCASE", reason: "Transform submenu supplies the verb (Transform to UPPERCASE)" }],
  ["transform-lowercase", { menu: "lowercase", defs: "Transform to lowercase", reason: "Transform submenu supplies the verb (Transform to lowercase)" }],
  ["transform-title-case", { menu: "Title Case", defs: "Transform to Title Case", reason: "Transform submenu supplies the verb (Transform to Title Case)" }],
  ["format-cjk", { menu: "Format Selection", defs: "Format CJK Selection", reason: "CJK submenu supplies the noun — flat canonical is Format CJK Selection (WI-UI4.3)" }],
  ["format-cjk-file", { menu: "Format Entire File", defs: "Format CJK File", reason: "CJK submenu supplies the noun — flat canonical is Format CJK File (WI-UI4.3)" }],
  ["new", { menu: "New", defs: "New File", reason: "the File MENU column supplies the noun (New); the flat label stands alone (New File)" }],
  ["save-all-quit", { menu: "Save All and Exit", defs: "Save All and Quit", reason: "the non-macOS File-menu tail says Exit — that platform's word for Quit — while the macOS App-menu site says Quit and matches the flat label; a second live site the scan used to mask (audit 20260907 #45)" }],
]);

// Manifest ids with NO Rust label pair, each with a stated reason. Any other
// unpaired id fails — silent skips are how a builder rewrite would blind the
// whole leg while it kept reporting green. EMPTY today: every manifest id
// pairs (the one dynamic id, search-genies, is excluded from the manifest by
// DYNAMIC_MENU_IDS before this leg runs).
const UNPAIRED_OK = new Map([]);

function menuLabelPairs() {
  const pairs = new Map(); // menu id -> Set<en.yml key>, one per LIVE builder site
  for (const file of readdirSync(join(ROOT, LOCALIZED_DIR)).filter((f) => f.endsWith(".rs") && !f.endsWith(".test.rs"))) {
    const rel = `${LOCALIZED_DIR}/${file}`;
    // `with_id(app, "<id>", &t!("menu.<key>")` — id and label key co-occur in
    // one builder call. Scanned over CODE (comments blanked, literals kept), so
    // a commented-out site labels nothing; and EVERY live key is kept, so the
    // label leg checks each one. Keeping the first let a second site's label
    // (the non-macOS File-menu tail's "Save All and Exit") hide behind the
    // macOS App-menu site's for months (audit 20260907 #45).
    // TWO PASSES, the rule `headerReferences.pathMountedModulePaths` and
    // `dod-syntax.rustModIncludes` already apply to the same shape: the match
    // runs over code with LITERALS KEPT (the id and the key ARE literals), and
    // the fully-blanked copy then says whether the surrounding call is real
    // CODE. With one pass, builder-shaped text inside a raw string
    // (`r#""save", &t!("menu.save")"#`) labelled a menu item that no builder
    // ever calls (audit R2 #71). `&t!(` survives blanking only outside a
    // literal, so its offset is the discriminator.
    const source = readOrDie(rel);
    const code = rustCode(source, { keepStrings: true });
    const bare = rustCode(source);
    for (const m of code.matchAll(/"([a-z0-9-]+)",\s*&t!\("([A-Za-z0-9_.]+)"\)/g)) {
      const callAt = m.index + m[0].indexOf("&t!(");
      if (bare.slice(callAt, callAt + 4) !== "&t!(") continue;
      if (!pairs.has(m[1])) pairs.set(m[1], new Set());
      pairs.get(m[1]).add(m[2]);
    }
  }
  return pairs;
}

/**
 * `menu.<key>` → label, read from the `menu:` block of `src-tauri/locales/en.yml`.
 *
 * SECTION-SCOPED. The scan used to take every two-space-indented key in the
 * file and prefix it `menu.`, so the 100+ keys under `errors:`, `window:` and
 * `cli:` became phantom `menu.*` entries — and since `errors:` comes after
 * `menu:`, a key sharing a dotted tail would have OVERWRITTEN the real label
 * (audit R2 #72). Duplicates are refused rather than silently kept-last, and
 * the double-quoted scalar is UNQUOTED, so `\"` and `\\` compare as the text
 * the app renders rather than as their source spelling.
 *
 * A `menu:` value that is not a double-quoted scalar is left out on purpose:
 * the consumer reports `en.yml has no such key`, which is the loud outcome —
 * this gate refuses to guess how an unquoted or folded scalar renders.
 */
function enYmlLabels() {
  const raw = readOrDie("src-tauri/locales/en.yml");
  const labels = new Map();
  let inMenu = false;
  for (const line of raw.split("\n")) {
    if (/^[^\s#]/.test(line)) {
      inMenu = /^menu:\s*$/.test(line);
      continue;
    }
    if (!inMenu) continue;
    const m = /^\s{2}([A-Za-z0-9_.]+):\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (!m) continue;
    const key = `menu.${m[1]}`;
    if (labels.has(key)) fail(`src-tauri/locales/en.yml: duplicate key "${m[1]}" under menu: — one key, one label`);
    labels.set(key, unquote(m[2]));
  }
  return labels;
}

{
  const pairs = menuLabelPairs();
  const ymlLabels = enYmlLabels();
  for (const entry of manifest) {
    const keys = pairs.get(entry.menuId);
    if (!keys) {
      // No silent skips: every unpaired id is either in the reasoned
      // allowlist or a failure. A builder rewrite that breaks
      // menuLabelPairs()'s pattern now fails on the FIRST id, not never.
      if (!UNPAIRED_OK.has(entry.menuId)) {
        errors.push(
          `menu id "${entry.menuId}" has no label pair in the Rust builder — ` +
            `menuLabelPairs() missed it (pattern drift?), or add a reasoned UNPAIRED_OK entry.`,
        );
      }
      continue;
    }
    if (UNPAIRED_OK.has(entry.menuId)) {
      errors.push(`stale UNPAIRED_OK entry "${entry.menuId}": the id pairs now — remove the exemption.`);
    }
    // Every live site's label, canonicalised. A platform-conditional item
    // (the macOS App menu and the non-macOS File-menu tail) has two.
    const menuLabels = [];
    for (const key of keys) {
      const menuLabel = ymlLabels.get(key);
      if (menuLabel === undefined) errors.push(`menu id "${entry.menuId}" labels via t!("${key}") but en.yml has no such key`);
      else menuLabels.push({ key, label: menuLabel.replace(/…$/, "").trim() });
    }
    const exempt = LABEL_EXEMPT.get(entry.menuId);
    if (exempt) {
      // An exemption whose fold has quietly become byte-equal at EVERY site no
      // longer exempts anything — delete it rather than let it mask drift.
      if (menuLabels.every((m) => m.label === entry.label)) {
        errors.push(
          `stale LABEL_EXEMPT entry "${entry.menuId}": menu and definitions labels are now identical ` +
            `(${JSON.stringify(entry.label)}) — remove the exemption.`,
        );
        continue;
      }
      for (const m of menuLabels) {
        if (m.label !== entry.label && m.label !== exempt.menu) {
          errors.push(
            `LABEL_EXEMPT entry "${entry.menuId}" recorded menu label ${JSON.stringify(exempt.menu)} ` +
              `but the menu now says ${JSON.stringify(m.label)} (en.yml ${m.key}) — re-review the exemption and update its recorded label.`,
          );
        }
      }
      if (entry.label !== exempt.defs) {
        errors.push(
          `LABEL_EXEMPT entry "${entry.menuId}" recorded definitions label ${JSON.stringify(exempt.defs)} ` +
            `but ${DEFS_PATH} now says ${JSON.stringify(entry.label)} — re-review the exemption and update its recorded label.`,
        );
      }
      continue;
    }
    for (const m of menuLabels) {
      if (m.label !== entry.label) {
        errors.push(
          `label drift for "${entry.menuId}": menu says ${JSON.stringify(m.label)} (en.yml ${m.key}) ` +
            `but ${DEFS_PATH} says ${JSON.stringify(entry.label)} — one command, one label (WI-UI4.3)`,
        );
      }
    }
  }
  // Exemption liveness, the other direction: an exempt id that no longer
  // exists in the manifest is a rename the map silently outlived.
  const manifestIds = new Set(manifest.map((e) => e.menuId));
  for (const id of [...LABEL_EXEMPT.keys(), ...UNPAIRED_OK.keys()]) {
    if (!manifestIds.has(id)) {
      errors.push(`stale exemption "${id}": no such menu id in the manifest — remove it.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`\n❌ Keybinding drift gate found ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    `\n  ${DEFS_PATH}, the real Rust menu builder (${LOCALIZED_DIR}), and the ` +
      `docs table (${DOCS_PATH})\n  have diverged. ` +
      "Reconcile all three per .claude/rules/41-keyboard-shortcuts.md.",
  );
  process.exit(1);
}

console.log(
  `✅ Keybinding drift gate passed (${manifest.length} menu-backed shortcuts aligned ` +
    `across ${DEFS_PATH}, the real Rust menu builder, and the docs table).`,
);
