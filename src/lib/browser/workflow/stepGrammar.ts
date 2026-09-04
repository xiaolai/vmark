/**
 * Executor step grammar (WI-NB6.1) — parse an `action:` step's text into a
 * structured, executable action, or explain why it cannot be executed
 * deterministically (so the run pauses for the model with a real reason).
 *
 * The grammar is exactly what `recorder.ts` emits, so a recorded workflow
 * round-trips (P-1). Three productions:
 *
 *   click  "<name>" [(<role>)]
 *   type   <value> into "<name>" [(<role>)]        value = "<literal>" | {<input>}
 *   navigate to <url>
 *
 * Two failure classes (audit 2026-09-03 W12):
 *   - `not-executable` — free prose, an unquoted name, a bare `navigate`: the
 *     model handles it.
 *   - `malformed-target` / `malformed-value` — a quoted run that is empty,
 *     unterminated, or followed by junk (an unescaped inner quote lands here).
 *     These used to fall through to an EMPTY name, which the act script matches
 *     against every unlabeled same-role control — so a malformed locator could
 *     click the wrong thing. Now it never yields a name at all.
 *
 * Quoted runs are scanned by hand, left to right, in one pass: the earlier
 * `/"((?:[^"\\]|\\.)*)"\s*$/` search was quadratic on a long run of `\"`
 * (every quote is a candidate start, every candidate backtracks to the end), and
 * a 60 KB hostile name froze the UI thread.
 *
 * Leaf-pure; the run executor turns the parsed action into an act through the
 * normal approval-gated path.
 *
 * @coordinates-with lib/browser/workflow/recorder.ts — the producer of this grammar
 * @coordinates-with services/workflow/runExecutor.ts — the consumer
 * @module lib/browser/workflow/stepGrammar
 */

/** A typed value for a `type` action: a literal string or an input reference. */
export type ActionValue = { kind: "literal"; text: string } | { kind: "input"; name: string };

/** A parsed, executable action. */
type ParsedAction =
  | { kind: "click"; name: string; role: string | undefined }
  | { kind: "type"; value: ActionValue; name: string; role: string | undefined }
  | { kind: "navigate"; url: string };

type ActionParseCode = "not-executable" | "malformed-target" | "malformed-value";

interface ActionParseFailure {
  ok: false;
  code: ActionParseCode;
  detail: string;
}

export type ActionParseResult = { ok: true; action: ParsedAction } | ActionParseFailure;

const fail = (code: ActionParseCode, detail: string): ActionParseFailure => ({ ok: false, code, detail });

/** Scan a JSON-style quoted run starting at `text[start] === '"'`. Returns the raw
 *  inner text and the index just past the closing quote, or null if unterminated.
 *  Linear: every character is visited once. */
function scanQuoted(text: string, start: number): { inner: string; end: number } | null {
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1; // skip the escaped character (a trailing lone backslash is unterminated)
      continue;
    }
    if (ch === '"') return { inner: text.slice(start + 1, i), end: i + 1 };
  }
  return null;
}

/** Reverse `recorder.quote` (JSON string escaping). An invalid escape or a raw
 *  control character is a MALFORMED value (null), not text kept literally — kept
 *  literally, it became an executable action the recorder never wrote. */
function unquote(inner: string): string | null {
  try {
    return JSON.parse(`"${inner}"`) as string;
  } catch {
    return null;
  }
}

/** Parse a whole target: `"<name>"` optionally followed by ` (<role>)`, nothing else. */
function parseTarget(raw: string): { name: string; role: string | undefined } | ActionParseFailure {
  const text = raw.trim();
  if (text[0] !== '"') return fail("not-executable", "a target must be a quoted name");
  const quoted = scanQuoted(text, 0);
  if (!quoted) return fail("malformed-target", "unterminated quoted name");
  const name = unquote(quoted.inner);
  if (name === null) return fail("malformed-target", "invalid escape or control character in the target name");
  if (name.trim() === "") return fail("malformed-target", "empty target name");
  const rest = text.slice(quoted.end).trim();
  if (rest === "") return { name, role: undefined };
  // The ARIA resolver accepts hyphenated roles (`doc-pagebreak`); so does this.
  const role = /^\(([a-z]+(?:-[a-z]+)*)\)$/.exec(rest);
  if (!role) return fail("malformed-target", `unexpected text after the target name: ${rest.slice(0, 40)}`);
  return { name, role: role[1] };
}

/** Parse a `type` value at the start of `text`: `"literal"` or `{input}`. Returns
 *  the value and the index just past it. */
function parseValueAt(text: string): { value: ActionValue; end: number } | ActionParseFailure {
  if (text[0] === '"') {
    const quoted = scanQuoted(text, 0);
    if (!quoted) return fail("malformed-value", "unterminated quoted value");
    const literal = unquote(quoted.inner);
    if (literal === null) return fail("malformed-value", "invalid escape or control character in the value");
    return { value: { kind: "literal", text: literal }, end: quoted.end };
  }
  const input = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(text);
  if (input) return { value: { kind: "input", name: input[1] }, end: input[0].length };
  return fail("not-executable", 'a type value must be a "literal" or an {input}');
}

function isFailure(x: object): x is ActionParseFailure {
  return "ok" in x && x.ok === false;
}

/** Parse the text of an `action:` step. */
export function parseAction(text: string): ActionParseResult {
  const t = text.trim();

  const nav = /^navigate to (\S.*)$/.exec(t);
  if (nav) return { ok: true, action: { kind: "navigate", url: nav[1].trim() } };

  if (t.startsWith("click ")) {
    const target = parseTarget(t.slice("click ".length));
    if (isFailure(target)) return target;
    return { ok: true, action: { kind: "click", name: target.name, role: target.role } };
  }

  if (t.startsWith("type ")) {
    const afterType = t.slice("type ".length).trimStart();
    const value = parseValueAt(afterType);
    if (isFailure(value)) return value;
    const sep = /^\s+into\s+/.exec(afterType.slice(value.end));
    if (!sep) return fail("malformed-value", "expected ` into ` after the value");
    const target = parseTarget(afterType.slice(value.end + sep[0].length));
    if (isFailure(target)) return target;
    return { ok: true, action: { kind: "type", value: value.value, name: target.name, role: target.role } };
  }

  return fail("not-executable", "not a click / type / navigate action");
}

