/**
 * Canonical value encoding (WI-4.2 / R8; split out of safety.ts in audit r3 #140)
 * — a deterministic, order-independent text form for a value, so equal inputs get
 * equal keys and different inputs never share one.
 *
 * NOT `JSON.stringify`: it flattens distinct values onto the same text — `NaN`,
 * `Infinity` and `null` all become `"null"`, `[undefined]` becomes `[null]`, a key
 * whose value is `undefined` disappears entirely, and `Map`/`Set` collapse to `{}`.
 * A key collision between two *different* writes is precisely the double-post the
 * safety module exists to prevent, so anything that cannot be encoded unambiguously
 * (symbol, function, class instance, accessor, cycle) throws instead of guessing;
 * `-0`, sparse-array holes, and non-enumerable properties are encoded distinctly so
 * they cannot silently share a key either.
 *
 * Three concerns, kept apart so each is pinned on its own:
 *   - `encodePrimitive` — the text for a null/undefined/boolean/number/bigint/string;
 *   - `classifyObject` + `sortedDataKeys` — which objects are encodable (plain
 *     object, array, Date) and the refusal of everything else;
 *   - `encodeCanonical` — the recursive composition, with the depth and cycle guards.
 *
 * @coordinates-with lib/browser/workflow/safety.ts — `idempotencyKey` prefixes this with the step id
 * @coordinates-with lib/browser/workflow/identity.ts — the workflow IR is serialised through this
 * @module lib/browser/workflow/canonicalEncode
 */

/** The value kinds with an unambiguous text of their own. */
export type Primitive = null | undefined | boolean | number | bigint | string;

/** The object kinds `encodeCanonical` accepts; `classifyObject` refuses everything else. */
export type ObjectKind = "plain" | "array" | "date";

/** Guard against an adversarially deep input blowing the stack while we build the
 *  raw key. Workflow inputs are flat records, so this ceiling is far above any real one. */
const MAX_ENCODE_DEPTH = 100;

/** Bound on an encodable array: above this the input is not a step's data. */
const MAX_ARRAY_LENGTH = 1_000_000;
const ARRAY_INDEX_RE = /^(0|[1-9]\d*)$/;

export function isPrimitive(value: unknown): value is Primitive {
  if (value === null) return true;
  const t = typeof value;
  return t === "undefined" || t === "boolean" || t === "number" || t === "bigint" || t === "string";
}

/** Encode a primitive. Every distinct value gets a distinct text: a non-finite number
 *  is tagged (`#NaN`) so it cannot collide with `null`, `-0` is kept apart from `0`,
 *  a bigint carries its `n`, and a string is JSON-quoted so `"null"` is not `null`. */
export function encodePrimitive(value: Primitive): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "string") return JSON.stringify(value);
  if (!Number.isFinite(value)) return `#${String(value)}`;
  return Object.is(value, -0) ? "-0" : JSON.stringify(value);
}

/**
 * Decide whether `obj` can be encoded, and as what. Throws for anything whose full
 * state cannot be read off its own string keys: a Map/Set/class instance, an array
 * subclass, an array with a symbol key or an own non-index property (either would
 * otherwise be ignored, letting two distinct inputs share a key), a Date subclass,
 * or a Date carrying own properties (a class instance in disguise).
 */
export function classifyObject(obj: object): ObjectKind {
  const proto: unknown = Object.getPrototypeOf(obj);
  if (Array.isArray(obj)) {
    if (proto !== Array.prototype) {
      throw new TypeError(`encodeCanonical: cannot encode a "${obj.constructor?.name ?? "array"}" value.`);
    }
    // An idempotency-key input never legitimately carries a million elements; a
    // sparse array with a huge `length` would otherwise be iterated slot by slot.
    if ((obj as unknown[]).length > MAX_ARRAY_LENGTH) {
      throw new TypeError(`encodeCanonical: cannot encode an array longer than ${MAX_ARRAY_LENGTH}.`);
    }
    // An array index is a canonical numeric string BELOW 2^32 − 1: "4294967295" is a
    // plain property on an array (it is never reached by `length`), so it would be
    // silently dropped and `[]` and `{4294967295: x}`-on-an-array would collide.
    const isIndex = (k: string) => ARRAY_INDEX_RE.test(k) && Number(k) < 4294967295;
    if (Reflect.ownKeys(obj).some((k) => typeof k === "symbol" || (k !== "length" && !isIndex(k)))) {
      throw new TypeError("encodeCanonical: cannot encode an array with non-index properties.");
    }
    // An index that is an ACCESSOR is a side effect wearing an array slot: reading it
    // to encode it would run code, and the key would depend on what the getter did.
    for (const k of Object.getOwnPropertyNames(obj)) {
      const desc = Object.getOwnPropertyDescriptor(obj, k);
      if (k !== "length" && desc && (desc.get || desc.set)) {
        throw new TypeError("encodeCanonical: cannot encode an array with accessor elements.");
      }
    }
    return "array";
  }
  if (obj instanceof Date) {
    if (proto !== Date.prototype || Reflect.ownKeys(obj).length > 0) {
      throw new TypeError("encodeCanonical: cannot encode a Date subclass or a Date with own properties.");
    }
    return "date";
  }
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`encodeCanonical: cannot encode a "${obj.constructor?.name ?? "object"}" value.`);
  }
  return "plain";
}

/**
 * The own string keys of a plain object, sorted. `Reflect.ownKeys` (not
 * `Object.keys`) so a symbol key or a non-enumerable property cannot silently vanish
 * and collide with `{}`: symbol keys and accessors are rejected — an accessor is
 * stateful/side-effecting, which a deterministic key must not be — while
 * non-enumerable own DATA properties are kept, so they stay distinct.
 */
export function sortedDataKeys(record: object): string[] {
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key === "symbol") throw new TypeError("encodeCanonical: cannot encode an object with symbol keys.");
    const desc = Object.getOwnPropertyDescriptor(record, key);
    if (desc && (desc.get || desc.set)) {
      throw new TypeError("encodeCanonical: cannot encode an object with accessor properties.");
    }
    keys.push(key);
  }
  return keys.sort();
}

/** Canonical text for any encodable value. Throws (rather than returning an ambiguous
 *  text) on a value it cannot encode, a cycle, or nesting past `MAX_ENCODE_DEPTH`. */
export function encodeCanonical(value: unknown): string {
  return canonical(value, new Set(), 0);
}

function canonical(value: unknown, seen: Set<object>, depth: number): string {
  if (depth > MAX_ENCODE_DEPTH) {
    throw new TypeError("encodeCanonical: input nested deeper than the encoder allows.");
  }
  if (isPrimitive(value)) return encodePrimitive(value);
  // `null` is a primitive, so only a symbol or a function reaches this refusal.
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`encodeCanonical: cannot encode a value of type "${typeof value}".`);
  }
  if (seen.has(value)) throw new TypeError("encodeCanonical: cannot encode a cyclic value.");
  seen.add(value);
  try {
    return encodeObject(value, seen, depth);
  } finally {
    // Only ancestors are "seen" — the same object twice in a tree is not a cycle.
    seen.delete(value);
  }
}

function encodeObject(obj: object, seen: Set<object>, depth: number): string {
  switch (classifyObject(obj)) {
    case "array":
      return encodeArray(obj as unknown[], seen, depth);
    case "date":
      return encodeDate(obj as Date);
    case "plain":
      return encodePlainObject(obj as Record<string, unknown>, seen, depth);
  }
}

/** Encode by index over the FULL length so a hole is distinct from `undefined` and
 *  `Array(1)` cannot collide with `[]` (the default `.map` skips holes). */
function encodeArray(arr: unknown[], seen: Set<object>, depth: number): string {
  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    parts.push(i in arr ? canonical(arr[i], seen, depth + 1) : "#hole");
  }
  return `[${parts.join(",")}]`;
}

/** `classifyObject` has already refused a subclass or a Date with own properties. */
function encodeDate(date: Date): string {
  const t = date.getTime();
  return `Date(${Number.isNaN(t) ? "invalid" : date.toISOString()})`;
}

function encodePlainObject(record: Record<string, unknown>, seen: Set<object>, depth: number): string {
  const body = sortedDataKeys(record)
    .map((k) => `${JSON.stringify(k)}:${canonical(record[k], seen, depth + 1)}`)
    .join(",");
  return `{${body}}`;
}
