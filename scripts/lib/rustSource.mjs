/**
 * Rust source → the part of it that is CODE.
 *
 * TWO entry points over ONE scanner. `rustSpans(src)` yields every comment and
 * literal as `{ kind, start, end, value }` — for a probe whose subject IS a
 * literal and which therefore needs the tokens, not a blanked copy — and
 * `rustCode(src)` is the blanker built on it. They share a scanner because the
 * second implementation of this grammar always drifts: the keybinding gate's
 * private copy knew nothing of nested block comments, raw strings or char
 * literals, so a lone `'"'` sent it into string mode and silently swallowed
 * every later call site in the file (audit R3 #58/#59).
 *
 * `rustCode(src)` returns `src` with every comment blanked to spaces (line
 * comments, and block comments — which NEST in Rust) and, unless
 * `keepStrings` is set, every string and char literal blanked too. Newlines
 * survive, so line numbers in the result still point at the same lines. What
 * remains is what the compiler reads as code, which is what a text probe has
 * to run over: a `provision::transition` in a doc comment is not a call site,
 * a `#[path = "x.test.rs"]` inside a block comment includes nothing, and a
 * `with_id(app, "save", …)` behind `//` labels no menu item (audit 20260907
 * #26, #31, #45). `keepStrings` is for probes whose subject IS a literal —
 * the `t!("menu.key")` label key; `keepComments` is the inverse, for a probe
 * whose subject IS the comments (the header-reference scanner) and that must
 * not read a `//!`-shaped line inside a raw string as one of them.
 *
 * Literal forms understood: `"…"` with `\` escapes, `b"…"`, `c"…"`, raw
 * strings `r"…"` / `r#"…"#` / `br#…#` / `cr#…#` (any number of `#`, no
 * escapes — `cr` is the C string literal stabilised in Rust 1.77), char and
 * byte literals `'x'` / `'😀'` / `'\n'` / `'\u{…}'` — told apart from lifetimes
 * and labels (`'a`, `'outer:`) by whether a closing quote follows ONE Unicode
 * scalar, so an astral body is a literal rather than a lifetime. Not a Rust parser:
 * it does not know tokens, only where comments and literals begin and end,
 * which is all that blanking them needs.
 *
 * @coordinates-with scripts/dod-syntax.mjs — the DoD probes over Rust files
 * @coordinates-with scripts/check-keybinding-manifest.mjs — the menu label scan
 * @coordinates-with scripts/lib/headerReferences.mjs — blanks Rust literals before its comment scan
 * @coordinates-with scripts/dod-syntax.test.mjs — the self-test
 * @module scripts/lib/rustSource
 */

const isIdentChar = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

/**
 * The number of `#`s in a raw-string opener at `i` (`r"` → 0, `br##"` → 2),
 * or -1 when `i` does not open one.
 *
 * The hashes are COUNTED to the opening quote rather than matched inside a
 * fixed 16-unit slice: that slice could not see a delimiter past 14 hashes for
 * `r` (13 for `br`), though Rust allows 255, so a longer one was mis-tokenised
 * as ordinary code (audit R2 #192). `c` is accepted beside `b` because
 * `cr"…"` / `cr#"…"#` are C string literals (stable since Rust 1.77);
 * unrecognised, `cr#"a"b"#` was read as an ordinary `"a"` and the rest of the
 * literal became code (audit R2 #191).
 */
function rawStringHashes(src, i) {
  let j = i;
  if (src[j] === "b" || src[j] === "c") j += 1;
  if (src[j] !== "r") return -1;
  j += 1;
  const from = j;
  while (src[j] === "#") j += 1;
  return src[j] === '"' ? j - from : -1;
}

/** `text` with everything but its newlines replaced by spaces. */
function blank(text) {
  return text.replace(/[^\n]/g, " ");
}

/** The end of the nested block comment opening at `i` (past its `*​/`), or `n`. */
function blockCommentEnd(src, i, n) {
  let depth = 1;
  let j = i + 2;
  while (j < n && depth > 0) {
    if (src[j] === "/" && src[j + 1] === "*") {
      depth += 1;
      j += 2;
    } else if (src[j] === "*" && src[j + 1] === "/") {
      depth -= 1;
      j += 2;
    } else {
      j += 1;
    }
  }
  return j;
}

/**
 * The char literal starting at `i`, or -1 when the quote opens a LIFETIME or a
 * label instead. Returns the index past the closing quote.
 *
 * The body is one Unicode SCALAR, not one UTF-16 unit: `'😀'` is two units, so
 * a `src[i + 2] === "'"` test read it as a lifetime and left the literal
 * unblanked — its contents then counted as code for every probe built on this
 * lexer (audit R3 #193). An ESCAPED body (`'\''`, `'\n'`, `'\u{1F600}'`) runs
 * to the next quote instead, since the escape decides its own length.
 */
function charLiteralEnd(src, i, n) {
  if (src[i + 1] === "\\") {
    let j = i + 3;
    while (j < n && src[j] !== "'") j += 1;
    return Math.min(j + 1, n);
  }
  const cp = src.codePointAt(i + 1);
  if (cp === undefined) return -1;
  const width = cp > 0xffff ? 2 : 1;
  return src[i + 1 + width] === "'" ? i + 2 + width : -1;
}

/**
 * Every comment and literal in `src`, in source order, as
 * `{ kind, start, end, value }` — `kind` is `"comment"`, `"string"` or
 * `"char"`, and `value` is a STRING literal's decoded content (see below).
 *
 * This is the tokenizer; `rustCode` is one consumer of it. A probe that needs
 * the literals THEMSELVES — the keybinding gate's `accel("id", "Accel")` scan
 * — needs their spans, not a blanked copy, and used to carry its own
 * hand-rolled comment/string loop for that. That copy had drifted exactly the
 * way a second lexer does: no nested block comments, no raw strings, and no
 * char literals, so a lone `'"'` flipped it into string mode and every later
 * `accel(...)` in the file vanished from the check with nothing to fail on
 * (audit R3 #58/#59).
 *
 * `value` applies Rust's `\` escapes the way the crate's own contract test
 * reads them: a backslash takes the FOLLOWING character literally (`\"` → `"`,
 * `\\` → `\`), so `\n` decodes to the letter `n` rather than a newline. A raw
 * string has no escapes and its content is verbatim.
 *
 * Unterminated comments and literals run to the end of the input rather than
 * resynchronising — a probe over the remainder of a file that no longer parses
 * should see nothing, not something.
 */
export function* rustSpans(src) {
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      yield { kind: "comment", start: i, end };
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = blockCommentEnd(src, i, n);
      yield { kind: "comment", start: i, end };
      i = end;
      continue;
    }
    if ((c === "r" || ((c === "b" || c === "c") && d === "r")) && !isIdentChar(src[i - 1])) {
      const hashes = rawStringHashes(src, i);
      if (hashes >= 0) {
        const close = `"${"#".repeat(hashes)}`;
        const headLength = (c === "r" ? 1 : 2) + hashes + 1;
        const at = src.indexOf(close, i + headLength);
        const end = at === -1 ? n : at + close.length;
        const body = at === -1 ? src.slice(i + headLength) : src.slice(i + headLength, at);
        yield { kind: "string", start: i, end, value: body };
        i = end;
        continue;
      }
    }
    if (c === '"') {
      let j = i + 1;
      let value = "";
      while (j < n && src[j] !== '"') {
        if (src[j] === "\\") j += 1;
        if (j < n) value += src[j];
        j += 1;
      }
      const end = Math.min(j + 1, n);
      yield { kind: "string", start: i, end, value };
      i = end;
      continue;
    }
    if (c === "'") {
      const end = charLiteralEnd(src, i, n);
      if (end !== -1) {
        yield { kind: "char", start: i, end };
        i = end;
        continue;
      }
      // A lifetime or a label: the quote is code.
    }
    i += 1;
  }
}

/**
 * Comments blanked; string and char literals blanked as well unless
 * `keepStrings`. Offsets and newlines are preserved, so a match in the result
 * points at the same place in the input.
 */
export function rustCode(src, { keepStrings = false, keepComments = false } = {}) {
  let out = "";
  let at = 0;
  for (const span of rustSpans(src)) {
    out += src.slice(at, span.start);
    const text = src.slice(span.start, span.end);
    const keep = span.kind === "comment" ? keepComments : keepStrings;
    out += keep ? text : blank(text);
    at = span.end;
  }
  return out + src.slice(at);
}
