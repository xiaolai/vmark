/**
 * Purpose: read the four code registries README.md restates — MCP providers,
 *   shortcut definitions, UI languages, and the theme catalog with its
 *   Windows/Linux subset — as plain values, from source text (WI-FL0.5).
 *
 * Text, not imports, on purpose: `providers.rs` is Rust, and a gates-tier
 * script has no business evaluating `LanguageSettings.tsx` (React) to read one
 * constant. So each parser LOCATES its declaration at the start of a line and
 * walks the bracket that follows with strings and comments skipped — a
 * commented-out entry is not an entry, a `{` inside a string is not an object,
 * and the walk stops at the matching close so a later array is not counted.
 *
 * Every parser THROWS when its declaration is missing or empty. A parser that
 * returned [] or 0 would let a moved declaration read as "nothing to check";
 * the caller (`readmeClaims.run`) turns the throw into a finding naming the
 * file. `countShortcutDefinitions` counts object literals, which is what
 * `grep -c defaultKey` cannot: three `ShortcutDefinition` members share the
 * prefix, so the grep said 130 where the array holds 127 (on adoption).
 *
 * @coordinates-with scripts/lib/docJoins/readmeClaims.mjs — the only consumer; re-exports these
 * @coordinates-with src-tauri/src/mcp_config/providers.rs — PROVIDERS
 * @coordinates-with src/stores/settingsStore/shortcutDefinitions.ts — DEFAULT_SHORTCUTS
 * @coordinates-with src/pages/settings/LanguageSettings.tsx — ALL_LANGUAGES
 * @coordinates-with src/theme/themes/index.ts — themes catalog
 * @coordinates-with src/theme/themeAvailability.ts — NON_MAC_THEME_IDS
 * @module scripts/lib/docJoins/readmeRegistries
 */

// ── bracket scanning (strings and comments skipped) ────────────────────────

const OPENERS = { "[": "]", "{": "}", "(": ")" };
const CLOSERS = new Set(Object.values(OPENERS));
const JS_QUOTES = new Set(['"', "'", "`"]);
/** Rust: only `"` opens a string — a bare `'` is a lifetime, not a quote. */
const RUST_QUOTES = new Set(['"']);

/** Index just past the string literal opening at `i`, honouring backslash escapes. */
function skipString(source, i) {
  const quote = source[i];
  for (let j = i + 1; j < source.length; j++) {
    if (source[j] === "\\") j++;
    else if (source[j] === quote) return j + 1;
  }
  throw new Error(`unterminated string literal at offset ${i}`);
}

/** Index just past the comment opening at `i`, or -1 when `i` does not open one. */
function skipComment(source, i) {
  if (source[i] !== "/") return -1;
  if (source[i + 1] === "/") {
    const newline = source.indexOf("\n", i);
    return newline === -1 ? source.length : newline;
  }
  if (source[i + 1] === "*") {
    const end = source.indexOf("*/", i + 2);
    if (end === -1) throw new Error(`unterminated block comment at offset ${i}`);
    return end + 2;
  }
  return -1;
}

/**
 * Walk the bracket opening at `open` to its match. Returns the inner text with
 * comments blanked (so a commented-out entry is not an entry) and the number
 * of `{` that open DIRECTLY inside it — the object literals of an array.
 */
function scanBracket(source, open, quotes = JS_QUOTES) {
  if (OPENERS[source[open]] === undefined) {
    throw new Error(`expected a bracket at offset ${open}, found ${JSON.stringify(source[open])}`);
  }
  let depth = 0;
  let objects = 0;
  let body = "";
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    const afterComment = skipComment(source, i);
    if (afterComment !== -1) {
      body += " ";
      i = afterComment;
      continue;
    }
    if (quotes.has(ch)) {
      const end = skipString(source, i);
      body += source.slice(i, end);
      i = end;
      continue;
    }
    if (OPENERS[ch] !== undefined) {
      depth += 1;
      if (depth === 2 && ch === "{") objects += 1;
    } else if (CLOSERS.has(ch)) {
      depth -= 1;
      if (depth === 0) return { end: i, objects, body: body.slice(1) };
    }
    body += ch;
    i += 1;
  }
  throw new Error(`unterminated ${source[open]} opened at offset ${open}`);
}

/** Offset of the bracket that ends the first match of `pattern`, or throw naming `label`. */
function locate(source, label, pattern) {
  const m = pattern.exec(source);
  if (!m) throw new Error(`${label} not found`);
  return m.index + m[0].length - 1;
}

// ── registry parsers ───────────────────────────────────────────────────────

/** `[{ name, id, legacy }]` for every live entry of the `PROVIDERS` slice. */
export function parseProviders(rustSource) {
  const open = locate(
    rustSource,
    "PROVIDERS slice (`const PROVIDERS: &[ProviderConfig] = &[`)",
    /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?const\s+PROVIDERS\b[^=\n]*=\s*&?\[/m,
  );
  const { body } = scanBracket(rustSource, open, RUST_QUOTES);
  const entries = [];
  for (const m of body.matchAll(/ProviderConfig\s*\{([^}]*)\}/g)) {
    const fields = m[1];
    const name = /\bname:\s*"([^"]*)"/.exec(fields)?.[1];
    const providerId = /\bid:\s*"([^"]*)"/.exec(fields)?.[1];
    const legacy = /\blegacy:\s*(true|false)\b/.exec(fields)?.[1];
    if (name === undefined || providerId === undefined || legacy === undefined) {
      throw new Error(`PROVIDERS entry lacks name, id or legacy: ${fields.replace(/\s+/g, " ").trim()}`);
    }
    entries.push({ name, id: providerId, legacy: legacy === "true" });
  }
  if (entries.length === 0) throw new Error("PROVIDERS slice has no ProviderConfig entries");
  return entries;
}

/** `[{ value, label }]` for every entry of `ALL_LANGUAGES`. */
export function parseLanguages(tsxSource) {
  const open = locate(
    tsxSource,
    "ALL_LANGUAGES array (`const ALL_LANGUAGES = [`)",
    /^[ \t]*(?:export\s+)?const\s+ALL_LANGUAGES\b[^=\n]*=\s*\[/m,
  );
  const { body } = scanBracket(tsxSource, open);
  const entries = [...body.matchAll(/\{\s*value:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*,?\s*\}/g)].map((m) => ({
    value: m[1],
    label: m[2],
  }));
  if (entries.length === 0) throw new Error("ALL_LANGUAGES has no { value, label } entries");
  return entries;
}

/** The member names of the `themes` catalog map, in declaration order. */
export function parseThemeIds(tsSource) {
  const open = locate(
    tsSource,
    "themes catalog (`export const themes = {`)",
    /^[ \t]*export\s+const\s+themes\b[^=\n]*=\s*\{/m,
  );
  const { body } = scanBracket(tsSource, open);
  const ids = body
    .split(",")
    .map((member) => member.trim())
    .filter(Boolean)
    .map((member) => {
      const key = member.split(":")[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) throw new Error(`themes catalog member is not an identifier: ${member}`);
      return key;
    });
  if (ids.length === 0) throw new Error("themes catalog is empty");
  return ids;
}

/** The string literals of `NON_MAC_THEME_IDS` — the themes Windows and Linux offer. */
export function parseNonMacThemeIds(tsSource) {
  const open = locate(
    tsSource,
    "NON_MAC_THEME_IDS array",
    /^[ \t]*(?:export\s+)?const\s+NON_MAC_THEME_IDS\b[^=\n]*=\s*(?:Object\.freeze\(\s*)?\[/m,
  );
  const { body } = scanBracket(tsSource, open);
  const ids = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (ids.length === 0) throw new Error("NON_MAC_THEME_IDS has no string literals");
  return ids;
}

/** Object literals directly inside `DEFAULT_SHORTCUTS` — one per shortcut. */
export function countShortcutDefinitions(tsSource) {
  const open = locate(
    tsSource,
    "DEFAULT_SHORTCUTS array (`export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [`)",
    /^[ \t]*(?:export\s+)?const\s+DEFAULT_SHORTCUTS\b[^=\n]*=\s*\[/m,
  );
  return scanBracket(tsSource, open).objects;
}
