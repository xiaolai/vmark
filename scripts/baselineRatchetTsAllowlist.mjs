/**
 * Identity extraction for `scripts/i18nIdenticalAllowlist.ts`, the one baseline
 * that is TypeScript source rather than JSON.
 *
 * WHAT THIS REPLACED. The comparator used to be one regex —
 * `/\bns:\s*"([^"]*)"[\s\S]*?\bkey:\s*"([^"]*)"/g` — over the text after the
 * declaration. Three ways an exemption could be added without the ratchet
 * seeing it:
 *   - it only matched DOUBLE-quoted values, so `ns: 'x'` was not an entry;
 *   - it required `ns` to appear before `key`, so any other property order was
 *     not an entry (and, being lazy across entries, could pair one entry's `ns`
 *     with a later entry's `key` — an identity that belongs to neither);
 *   - the identity was (ns, key) only, so widening `locales` from one language
 *     to nine, or flipping `kind` from `json` to `yaml`, changed nothing.
 * Since every exemption is a standing claim that a string is UNTRANSLATABLE,
 * an invisible addition is exactly the failure this ratchet exists to prevent.
 *
 * So: parse the array literal structurally. Entries are split on balanced
 * brackets with string and comment awareness (reasons legitimately contain
 * quotes, braces and colons — one shipped reason contains `"{{index}} /
 * {{count}}"`), fields are read by name in any order and any quote style, and
 * the identity is (kind, ns, key, sorted locales). Reason text is deliberately
 * NOT part of the identity: rewording an explanation is not a new exemption.
 *
 * Structural failure — no declaration, an unbalanced literal — THROWS, so an
 * unreadable allowlist can never compare as "no exemptions". A single field
 * that is missing or is an expression this reader cannot evaluate becomes an
 * explicit `<missing:…>` / `<expr:…>` token instead: still a distinct, diffable
 * identity, so it surfaces rather than silently merging with a real one.
 *
 * @coordinates-with scripts/baselineRatchetModes.mjs — registers this as the
 *   `tsIdenticalAllowlist` custom comparator
 * @coordinates-with scripts/i18nIdenticalAllowlist.ts — the file it reads
 */

const CLOSERS = { "[": "]", "{": "}", "(": ")" };
const QUOTES = new Set(['"', "'", "`"]);

/** Index just past the string literal starting at `i`. */
function skipString(text, i) {
  const quote = text[i];
  i++;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (quote === "`" && c === "$" && text[i + 1] === "{") {
      i = matchingBracket(text, i + 1) + 1;
      continue;
    }
    i++;
  }
  return i;
}

/** Index just past a comment starting at `i`, or `i` when there is none. */
function skipComment(text, i) {
  if (text[i] !== "/") return i;
  if (text[i + 1] === "/") {
    let j = i;
    while (j < text.length && text[j] !== "\n") j++;
    return j;
  }
  if (text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return i;
}

/** Index of the bracket closing the one at `start`. Throws when unbalanced. */
function matchingBracket(text, start) {
  const open = text[start];
  const close = CLOSERS[open];
  if (!close) throw new Error(`not a bracket at offset ${start}`);
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (QUOTES.has(c)) {
      i = skipString(text, i);
      continue;
    }
    const afterComment = skipComment(text, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
    i++;
  }
  throw new Error(`unbalanced "${open}" starting at offset ${start}`);
}

/** Split at top-level commas, skipping strings, comments and nested brackets. */
function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (QUOTES.has(c)) {
      i = skipString(text, i);
      continue;
    }
    const afterComment = skipComment(text, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (CLOSERS[c]) {
      i = matchingBracket(text, i) + 1;
      continue;
    }
    if (c === ",") {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** `name: value` split at the FIRST top-level colon, or null. */
function splitField(text) {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (QUOTES.has(c)) {
      i = skipString(text, i);
      continue;
    }
    const afterComment = skipComment(text, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (CLOSERS[c]) {
      i = matchingBracket(text, i) + 1;
      continue;
    }
    if (c === ":") return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    i++;
  }
  return null;
}

/** The text of a quoted literal, in any quote style, or null. */
function unquote(value) {
  const q = value[0];
  if (!QUOTES.has(q) || value.length < 2) return null;
  if (skipString(value, 0) !== value.length) return null; // concatenation, etc.
  return value.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** Every string literal inside `text`, in order. */
function stringLiteralsIn(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (QUOTES.has(text[i])) {
      const end = skipString(text, i);
      out.push(text.slice(i, end).slice(1, -1).replace(/\\(.)/g, "$1"));
      i = end;
      continue;
    }
    const afterComment = skipComment(text, i);
    i = afterComment !== i ? afterComment : i + 1;
  }
  return out;
}

/** `const NAME = ["a", "b"]` bindings, so `locales: ALL_LOCALES` resolves. */
function arrayConstsIn(source) {
  const consts = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*\[/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    try {
      consts.set(m[1], stringLiteralsIn(source.slice(open + 1, matchingBracket(source, open))));
    } catch {
      // Unbalanced const is not this comparator's business; the entry that
      // references it will resolve to an <expr:…> token instead.
    }
  }
  return consts;
}

function localesOf(rawValue, consts) {
  if (rawValue === undefined) return ["<missing:locales>"];
  if (rawValue.startsWith("[")) {
    const literals = stringLiteralsIn(rawValue);
    const spreads = [...rawValue.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)].flatMap(
      (m) => consts.get(m[1]) ?? [`<expr:${m[1]}>`],
    );
    return [...literals, ...spreads].sort();
  }
  if (/^[A-Za-z_$][\w$]*$/.test(rawValue)) {
    return [...(consts.get(rawValue) ?? [rawValue])].sort();
  }
  return [`<expr:${rawValue.replace(/\s+/g, " ")}>`];
}

/** Offset of the `[` that opens the initializer of the declaration at `decl`,
 *  or -1. Walks to the assignment `=` first, string- and comment-aware. */
function arrayAfterAssignment(source, decl) {
  let i = decl;
  while (i < source.length) {
    const c = source[i];
    if (QUOTES.has(c)) {
      i = skipString(source, i);
      continue;
    }
    const afterComment = skipComment(source, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (c === ";") return -1; // declaration ended without an initializer
    if (c === "=" && source[i + 1] !== "=" && source[i + 1] !== ">" && !"=!<>".includes(source[i - 1])) {
      break;
    }
    i++;
  }
  i++;
  while (i < source.length) {
    const afterComment = skipComment(source, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    return source[i] === "[" ? i : -1;
  }
  return -1;
}

function scalarOf(rawValue, field) {
  if (rawValue === undefined) return `<missing:${field}>`;
  const literal = unquote(rawValue);
  return literal ?? `<expr:${rawValue.replace(/\s+/g, " ")}>`;
}

/**
 * Offset of `const <declName>` OUTSIDE strings and comments, or -1.
 *
 * A bare `indexOf(declName)` treated `// EXPECTED_DELTAS = []` in a comment
 * as the declaration and returned an EMPTY identity set — and since removals
 * pass, that silently disabled the ledger ratchet (audit round 1). This walk
 * reuses the string/comment skippers so only real source can match.
 */
function declarationIndex(source, declName) {
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (QUOTES.has(c)) {
      i = skipString(source, i);
      continue;
    }
    const afterComment = skipComment(source, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (source.startsWith("const ", i)) {
      const rest = source.slice(i + 6).replace(/^\s+/, "");
      // Identifier boundary required: `const EXPECTED_DELTAS_OLD` must not
      // match a lookup for EXPECTED_DELTAS (verify round 1).
      const after = rest[declName.length];
      if (rest.startsWith(declName) && (after === undefined || !/[\w$]/.test(after))) {
        return i + 6 + (source.slice(i + 6).length - rest.length);
      }
    }
    i++;
  }
  return -1;
}

/**
 * Generic form of the parser below: the identity set of
 * `const <declName> = [ {…}, … ]`, one JSON-tuple identity per entry, fields
 * read by name in any order and quote style. Built for the spec-ledger
 * ratchet entries (WI-0.3), which pin TS ledgers the same way this module
 * already pins the i18n allowlist.
 */
export function tsObjectArrayIdentities(source, declName, fieldNames, label) {
  const decl = declarationIndex(source, declName);
  if (decl === -1) throw new Error(`${label}: no ${declName} declaration found`);
  const open = arrayAfterAssignment(source, decl);
  if (open === -1) throw new Error(`${label}: ${declName} has no array literal`);
  const body = source.slice(open + 1, matchingBracket(source, open));
  const out = new Set();
  for (const entry of splitTopLevel(body)) {
    if (!entry.startsWith("{")) {
      throw new Error(`${label}: ${declName} entry is not an object literal: ${entry.slice(0, 40)}…`);
    }
    const inner = entry.slice(1, matchingBracket(entry, 0));
    const fields = new Map();
    for (const field of splitTopLevel(inner)) {
      const pair = splitField(field);
      if (pair) fields.set(unquote(pair[0]) ?? pair[0], pair[1]);
    }
    out.add(JSON.stringify(fieldNames.map((f) => scalarOf(fields.get(f), f))));
  }
  return out;
}

/**
 * The identity set of `const <declName> = { "key": [ {…}, … ], … }` — a
 * record of entry arrays, one `recordKey | <field>` identity per entry.
 * Shape of `fidelity/fidelityLedger.ts`.
 */
export function tsRecordOfArraysIdentities(source, declName, fieldName, label) {
  const decl = declarationIndex(source, declName);
  if (decl === -1) throw new Error(`${label}: no ${declName} declaration found`);
  // Walk to the `{` that opens the record literal (same assignment walk as
  // arrays, different opener).
  let i = decl;
  while (i < source.length && source[i] !== "=") {
    if (QUOTES.has(source[i])) i = skipString(source, i);
    else i = skipComment(source, i) !== i ? skipComment(source, i) : i + 1;
  }
  while (i < source.length && source[i] !== "{") i++;
  if (i >= source.length) throw new Error(`${label}: ${declName} has no object literal`);
  const body = source.slice(i + 1, matchingBracket(source, i));
  const out = new Set();
  for (const recordEntry of splitTopLevel(body)) {
    const pair = splitField(recordEntry);
    if (!pair) continue;
    const recordKey = unquote(pair[0]) ?? pair[0];
    const value = pair[1];
    if (!value.startsWith("[")) {
      throw new Error(`${label}: ${declName}["${recordKey}"] is not an array literal`);
    }
    const inner = value.slice(1, matchingBracket(value, 0));
    for (const item of splitTopLevel(inner)) {
      if (!item.startsWith("{")) {
        throw new Error(`${label}: entry under "${recordKey}" is not an object literal`);
      }
      const itemInner = item.slice(1, matchingBracket(item, 0));
      const fields = new Map();
      for (const field of splitTopLevel(itemInner)) {
        const p = splitField(field);
        if (p) fields.set(unquote(p[0]) ?? p[0], p[1]);
      }
      out.add(JSON.stringify([recordKey, scalarOf(fields.get(fieldName), fieldName)]));
    }
  }
  return out;
}

/**
 * The identity set of `scripts/i18nIdenticalAllowlist.ts`: one
 * `kind | ns | key | locales` string per exemption.
 */
export function tsIdenticalAllowlistIdentities(source, label) {
  const decl = declarationIndex(source, "IDENTICAL_ALLOWLIST");
  if (decl === -1) throw new Error(`${label}: no IDENTICAL_ALLOWLIST declaration found`);
  // The array is the one after `=`, NOT the first `[` after the name: the
  // declaration is annotated `: IdenticalException[]`, whose empty brackets
  // would otherwise parse as an allowlist with no entries.
  const open = arrayAfterAssignment(source, decl);
  if (open === -1) throw new Error(`${label}: IDENTICAL_ALLOWLIST has no array literal`);

  let body;
  try {
    body = source.slice(open + 1, matchingBracket(source, open));
  } catch (error) {
    throw new Error(`${label}: cannot read the IDENTICAL_ALLOWLIST array (${error.message})`);
  }

  const consts = arrayConstsIn(source);
  const out = new Set();
  for (const entry of splitTopLevel(body)) {
    if (!entry.startsWith("{")) {
      throw new Error(`${label}: allowlist entry is not an object literal: ${entry.slice(0, 40)}…`);
    }
    const inner = entry.slice(1, matchingBracket(entry, 0));
    const fields = new Map();
    for (const field of splitTopLevel(inner)) {
      const pair = splitField(field);
      if (pair) fields.set(unquote(pair[0]) ?? pair[0], pair[1]);
    }
    const kind = scalarOf(fields.get("kind"), "kind");
    const ns = scalarOf(fields.get("ns"), "ns");
    const key = scalarOf(fields.get("key"), "key");
    out.add(`${kind} | ${ns} | ${key} | ${localesOf(fields.get("locales"), consts).join(",")}`);
  }
  return out;
}
