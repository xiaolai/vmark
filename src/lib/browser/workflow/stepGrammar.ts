/**
 * Executor step grammar (WI-NB6.1) — parse an `action:` step's text into a
 * structured, executable action, or null when the text is not something the
 * runner can perform deterministically (so the run pauses for the model).
 *
 * The grammar is exactly what `recorder.ts` emits, so a recorded workflow
 * round-trips (P-1). Three productions:
 *
 *   click  "<name>" [(<role>)]
 *   type   <value> into "<name>" [(<role>)]        value = "<literal>" | {<input>}
 *   navigate to <url>
 *
 * Anything else — a bare `navigate`, an unquoted name, free prose, a `goal:` —
 * returns null. Leaf-pure; the run executor turns the parsed action into an act
 * through the normal approval-gated path.
 *
 * @coordinates-with lib/browser/workflow/recorder.ts — the producer of this grammar
 * @coordinates-with services/workflow/runExecutor.ts — the consumer
 * @module lib/browser/workflow/stepGrammar
 */

/** A typed value for a `type` action: a literal string or an input reference. */
export type ActionValue = { kind: "literal"; text: string } | { kind: "input"; name: string };

/** A parsed, executable action. */
export type ParsedAction =
  | { kind: "click"; name: string; role: string | undefined }
  | { kind: "type"; value: ActionValue; name: string; role: string | undefined }
  | { kind: "navigate"; url: string };

/** A `"name"` or `"name" (role)` target at the END of the text. Returns the
 *  name, the optional role, and the index where the target began. */
function parseTargetSuffix(text: string): { name: string; role: string | undefined; start: number } | null {
  // Optional trailing ` (role)`, role = a bare ARIA token.
  const roleMatch = /\s*\(([a-z]+)\)\s*$/.exec(text);
  const role = roleMatch ? roleMatch[1] : undefined;
  const beforeRole = roleMatch ? text.slice(0, roleMatch.index) : text.replace(/\s+$/, "");
  // The name is the LAST quoted run (recorder JSON-quotes it, so no bare `"` inside).
  const nameMatch = /"((?:[^"\\]|\\.)*)"\s*$/.exec(beforeRole);
  if (!nameMatch) return null;
  const name = unquote(nameMatch[1]);
  return { name, role, start: nameMatch.index };
}

/** Reverse `recorder.quote` (JSON string escaping). */
function unquote(inner: string): string {
  try {
    return JSON.parse(`"${inner}"`) as string;
  } catch {
    return inner;
  }
}

/** Parse a `type` value: a `"literal"` or `{inputName}`. */
function parseValue(raw: string): ActionValue | null {
  const trimmed = raw.trim();
  const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
  if (literal) return { kind: "literal", text: unquote(literal[1]) };
  const input = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(trimmed);
  if (input) return { kind: "input", name: input[1] };
  return null;
}

/** Parse the text of an `action:` step, or null if it is not executable. */
export function parseActionText(text: string): ParsedAction | null {
  const t = text.trim();

  const nav = /^navigate to (\S.*)$/.exec(t);
  if (nav) return { kind: "navigate", url: nav[1].trim() };

  const click = /^click (.+)$/.exec(t);
  if (click) {
    const target = parseTargetSuffix(click[1]);
    return target ? { kind: "click", name: target.name, role: target.role } : null;
  }

  const type = /^type (.+?) into (.+)$/.exec(t);
  if (type) {
    const value = parseValue(type[1]);
    const target = parseTargetSuffix(type[2]);
    if (!value || !target) return null;
    return { kind: "type", value, name: target.name, role: target.role };
  }

  return null;
}
