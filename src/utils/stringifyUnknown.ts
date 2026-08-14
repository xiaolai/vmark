/**
 * stringifyUnknown — render an `unknown` as text without ever emitting the
 * string `"[object Object]"`.
 *
 * `String(value)` is the reflex, and on a plain object it produces
 * `"[object Object]"` — a string that names no value, survives every type
 * check, and reaches the user looking like a message. `.claude/rules/50` records
 * four of these SHIPPING when `String(error)` met a typed `CommandError`; the
 * `lint:command-errors` ratchet catches that class only at command boundaries,
 * and `no-base-to-string` catches the rest.
 *
 * The ordering below is deliberate:
 *
 *   - `null`/`undefined` render as `""`, not `"null"`. Every caller here is
 *     filling a field a user reads; the literal word "null" is worse than blank.
 *   - An `Error` renders as its message, matching `errorMessage()`.
 *   - An object carrying its OWN `toString` (a `Date`, `URL`, `RegExp`, or any
 *     class that defined one) is rendered with it — that method exists precisely
 *     to answer this question, and JSON would discard it.
 *   - Everything else goes through `JSON.stringify`, so a plain object arrives
 *     as readable content rather than a type name.
 *   - A circular structure makes `JSON.stringify` throw; the fallback is
 *     `Object.prototype.toString`, which at least names the kind.
 *
 * @module utils/stringifyUnknown
 */

/** Render any value as text, never as `"[object Object]"`. */
export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "symbol") return value.description ?? "Symbol()";
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  if (value instanceof Error) return value.message;

  const ownToString = (value as { toString?: unknown }).toString;
  if (typeof ownToString === "function" && ownToString !== Object.prototype.toString
      && ownToString !== Array.prototype.toString) {
    return String(value as { toString(): string });
  }

  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    /* circular or non-serialisable — fall through */
  }
  return Object.prototype.toString.call(value);
}
