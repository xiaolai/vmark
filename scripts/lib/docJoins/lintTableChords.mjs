/**
 * Purpose: find every keyboard chord a guide page writes — in code spans and
 *   in bare prose, fenced blocks skipped — and spell it the way the docs
 *   renderer does, so the lint-table join can compare the page's chords with
 *   the shortcut defaults.
 *
 * The prose matcher and the token reader share ONE vocabulary of modifiers and
 * named keys, so a chord the matcher finds is a chord the reader can check.
 *
 * @coordinates-with scripts/lib/docJoins/lintTable.mjs — the join that checks these chords
 * @coordinates-with scripts/lib/keybindingFormat.mjs — keyTokens and prosemirrorToDocs, the shared key grammar
 * @module scripts/lib/docJoins/lintTableChords
 */
import { keyTokens, prosemirrorToDocs } from "../keybindingFormat.mjs";

const MODIFIER_NAMES = ["Mod", "Cmd", "Ctrl", "Alt", "Shift", "Option", "Meta", "Command", "Control"];
const MODIFIERS = new Set(MODIFIER_NAMES);
/** Keys with a NAME rather than a character — the vocabulary `chordTokens` accepts. */
const NAMED_KEYS = [
  "F\\d{1,2}", "Enter", "Return", "Esc", "Escape", "Tab", "Space", "Backspace",
  "Delete", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown",
];
const NAMED_KEY_RE = new RegExp(`^(?:${NAMED_KEYS.join("|")})$`);
/**
 * A chord written in bare prose: a modifier, then `-`/`+`-joined modifiers and
 * one key. Built from the SAME vocabularies `chordTokens` accepts — a
 * hand-written alternation listed only `F\d` and a single character, so a
 * stale `Cmd + Enter` or `Alt + PageDown` in prose matched nothing and was
 * never checked. Longer alternatives first, so `PageUp` is not
 * consumed as `P`.
 */
const PROSE_CHORD_RE = new RegExp(
  `\\b(?:${MODIFIER_NAMES.join("|")})(?:\\s?[-+]\\s?(?:${[...MODIFIER_NAMES, ...NAMED_KEYS].join("|")}|[A-Za-z0-9]))+\\b`,
  "g",
);
/** A backtick-run code span (`` `x` ``, ```` `` ` `` ````, ```` ``` ````) on one line. */
const CODE_SPAN_RE = /(`+)(.+?)\1(?!`)/g;

/** Tokens of a chord as written (`Alt + Mod + V`, `Cmd-Shift-L`, `F2`), or null when the text is not a chord. */
function chordTokens(text) {
  const s = text.trim();
  if (/^F\d{1,2}$/.test(s)) return [s];
  let tokens;
  if (s.includes("+")) tokens = s.split("+").map((t) => t.trim());
  else {
    // `keyTokens` refuses a malformed key (`prettier --check`, `-x`); for a
    // code span on a guide page that refusal just means "not a chord".
    try {
      // TRIMMED: the prose matcher accepts a space either side of the
      // separator, so `Cmd - Shift - L` reaches here as ["Cmd ", " Shift ",
      // " L"] — no token matched a modifier, the chord read as "not a chord",
      // and a stale one written that way was never checked.
      tokens = keyTokens(s).map((t) => t.trim());
    } catch {
      return null;
    }
  }
  if (tokens.length < 2 || tokens.some((t) => t === "")) return null;
  if (!tokens.some((t) => MODIFIERS.has(t))) return null;
  if (!tokens.every((t) => MODIFIERS.has(t) || NAMED_KEY_RE.test(t) || t.length === 1)) return null;
  return tokens;
}

/**
 * The docs spelling of a token list, produced BY `prosemirrorToDocs` rather
 * than by a second copy of its rule.
 *
 * The copy had already drifted, in the direction that matters: it upper-cased
 * a single ASCII letter (`t.length === 1 && /[a-z]/i`), while the renderer it
 * is compared against upper-cases any single Unicode LETTER by CODE POINT
 * (`/^\p{L}$/u` — the other side was already fixed, this one was not). So a
 * chord on a non-ASCII or astral key rendered one way by the shortcut
 * definition and another way by the page reader, and a page carrying the
 * CORRECT chord would have been reported stale.
 *
 * Round-tripping through the ProseMirror spelling is what makes one rule serve
 * both: `chordTokens` rejects empty tokens and multi-character tokens that are
 * not named keys, so `join("-")` is unambiguous — the minus KEY re-reads as the
 * `Mod--` form `keyTokens` already understands.
 */
export const docsChord = (tokens) => prosemirrorToDocs(tokens.join("-"));

/**
 * Every chord written on the page — code spans and bare prose, fenced blocks
 * skipped — with its line and text as written.
 *
 * The fence is tracked by its MARKER and LENGTH, per CommonMark: only a fence
 * of the same character and at least the opening length closes it. A boolean
 * toggle closed a ```` ``` ```` block on a `~~~` line inside it, and on a
 * shorter run of the same character, so the rest of the block was read as prose
 * and its example chords reported as stale.
 */
export function chordsInDoc(doc) {
  const out = [];
  let fence = null;
  doc.split("\n").forEach((line, i) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      const marker = m[1][0];
      const length = m[1].length;
      if (fence === null) fence = { marker, length };
      else if (marker === fence.marker && length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;
    for (const m of line.matchAll(CODE_SPAN_RE)) {
      const tokens = chordTokens(m[2]);
      if (tokens) out.push({ line: i + 1, text: m[2].trim(), tokens });
    }
    for (const m of line.replace(CODE_SPAN_RE, " ").matchAll(PROSE_CHORD_RE)) {
      const tokens = chordTokens(m[0]);
      if (tokens) out.push({ line: i + 1, text: m[0], tokens });
    }
  });
  return out;
}
