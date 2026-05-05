// WI-1.3 — ergonomic helpers over @actions/workflow-parser tokens.
//
// The parser exposes TemplateToken, MappingToken, SequenceToken,
// StringToken, etc. Walking workflow shapes via raw `.get(i).key.assertString`
// is verbose and error-prone. This module wraps the common access patterns.

// Token classes are exported from sub-paths of the parser package via its
// `exports` field's `./*` pattern.
import type { MappingToken } from "@actions/workflow-parser/templates/tokens/mapping-token";
import type { ScalarToken } from "@actions/workflow-parser/templates/tokens/scalar-token";
import type { SequenceToken } from "@actions/workflow-parser/templates/tokens/sequence-token";
import type { TemplateToken } from "@actions/workflow-parser/templates/tokens/template-token";
import type { SourceRange } from "../types";

// TokenType numeric values from @actions/workflow-parser. Keep in sync.
const TOKEN_TYPE = {
  String: 0,
  Sequence: 1,
  Mapping: 2,
  Boolean: 5,
  Number: 6,
  Null: 7,
} as const;

// ─── Type narrowing ─────────────────────────────────────────────────

/** Narrow a TemplateToken to MappingToken if it is one; else undefined. */
export function asMapping(t: TemplateToken | undefined): MappingToken | undefined {
  if (!t) return undefined;
  return (t as TemplateToken & { templateTokenType: number }).templateTokenType ===
    TOKEN_TYPE.Mapping
    ? (t as unknown as MappingToken)
    : undefined;
}

/** Narrow a TemplateToken to SequenceToken if it is one; else undefined. */
export function asSequence(t: TemplateToken | undefined): SequenceToken | undefined {
  if (!t) return undefined;
  return (t as TemplateToken & { templateTokenType: number }).templateTokenType ===
    TOKEN_TYPE.Sequence
    ? (t as unknown as SequenceToken)
    : undefined;
}

// ─── Scalar reading ─────────────────────────────────────────────────

interface ScalarReadable extends ScalarToken {
  value?: unknown;
}

function readScalar(t: TemplateToken | undefined): unknown {
  if (!t) return undefined;
  // ScalarToken subclasses (StringToken, BooleanToken, NumberToken, NullToken)
  // expose `.value`. Expression tokens don't and are returned as-is.
  const s = t as ScalarReadable;
  if ("value" in s) return s.value;
  return undefined;
}

/** Read a string value at `key`. Returns undefined if absent or non-string. */
export function getString(map: MappingToken, key: string): string | undefined {
  const v = readScalar(map.find(key));
  return typeof v === "string" ? v : undefined;
}

/**
 * Read either a plain string or an expression token's source text.
 * Used for fields like `outputs.<name>.value` that are typically `${{ }}`
 * expressions rather than plain literals.
 */
export function getStringOrExpression(
  map: MappingToken,
  key: string,
): string | undefined {
  const tok = map.find(key);
  if (!tok) return undefined;
  const direct = readScalar(tok);
  if (typeof direct === "string") return direct;
  // BasicExpressionToken / InsertExpressionToken expose `.expression`.
  const expr = (tok as TemplateToken & { expression?: unknown }).expression;
  if (typeof expr === "string") return `\${{ ${expr} }}`;
  // LiteralToken (mixed) may expose `.source` or have a raw text.
  const src = (tok as TemplateToken & { source?: unknown }).source;
  if (typeof src === "string") return src;
  return undefined;
}

export function getNumber(map: MappingToken, key: string): number | undefined {
  const v = readScalar(map.find(key));
  return typeof v === "number" ? v : undefined;
}

export function getBoolean(map: MappingToken, key: string): boolean | undefined {
  const v = readScalar(map.find(key));
  return typeof v === "boolean" ? v : undefined;
}

/**
 * Like `getBoolean` but also accepts the GitHub-Actions expression form
 * (e.g. `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`).
 * Returns the boolean when the value is a literal, the original
 * `${{ … }}` string when it's an expression, or undefined.
 */
export function getBooleanOrExpression(
  map: MappingToken,
  key: string,
): boolean | string | undefined {
  const tok = map.find(key);
  if (!tok) return undefined;
  const direct = readScalar(tok);
  if (typeof direct === "boolean") return direct;
  const expr = (tok as TemplateToken & { expression?: unknown }).expression;
  if (typeof expr === "string") return `\${{ ${expr} }}`;
  const src = (tok as TemplateToken & { source?: unknown }).source;
  if (typeof src === "string") return src;
  return undefined;
}

/** Get a mapping at `key`, or undefined if absent or wrong shape. */
export function getMapping(
  map: MappingToken,
  key: string,
): MappingToken | undefined {
  return asMapping(map.find(key));
}

/** Get a sequence at `key`, or undefined if absent or wrong shape. */
export function getSequence(
  map: MappingToken,
  key: string,
): SequenceToken | undefined {
  return asSequence(map.find(key));
}

/**
 * Read a string array at `key`. If the value is a single string, wraps it
 * into [string] (GitHub Actions allows both shapes for branch/tag/path
 * filters and other lists).
 */
export function getStringArray(
  map: MappingToken,
  key: string,
): string[] | undefined {
  const tok = map.find(key);
  if (!tok) return undefined;

  const single = readScalar(tok);
  if (typeof single === "string") return [single];

  const seq = asSequence(tok);
  if (!seq) return undefined;

  const out: string[] = [];
  for (let i = 0; i < seq.count; i++) {
    const v = readScalar(seq.get(i));
    if (typeof v === "string") out.push(v);
  }
  return out;
}

/**
 * Read a `Record<string, string>` at `key`. Numbers and booleans get
 * stringified; expression tokens (`${{ ... }}`) are preserved as their
 * source text — important for outputs.<name>.value etc. that are usually
 * expressions rather than literal strings. Mapping/sequence values are
 * dropped (caller wanted a flat record).
 */
export function getRecord(
  map: MappingToken,
  key: string,
): Record<string, string> | undefined {
  const inner = getMapping(map, key);
  if (!inner) return undefined;

  const out: Record<string, string> = {};
  for (let i = 0; i < inner.count; i++) {
    const pair = inner.get(i);
    const k = readScalar(pair.key);
    if (typeof k !== "string") continue;

    const v = readScalar(pair.value);
    if (typeof v === "string") {
      out[k] = v;
      continue;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      out[k] = String(v);
      continue;
    }
    // Expression token? Preserve the source as ${{ expression }}.
    const expr = (pair.value as { expression?: unknown }).expression;
    if (typeof expr === "string") {
      out[k] = `\${{ ${expr} }}`;
    }
  }
  return out;
}

// ─── Position ───────────────────────────────────────────────────────

interface RangedToken {
  range?: { start: { line: number; column: number }; end: { line: number; column: number } };
}

/** Convert a parser TokenRange to our SourceRange shape. */
export function rangeOf(t: TemplateToken | undefined): SourceRange | undefined {
  if (!t) return undefined;
  const ranged = t as unknown as RangedToken;
  if (!ranged.range) return undefined;
  return {
    startLine: ranged.range.start.line,
    startCol: ranged.range.start.column,
    endLine: ranged.range.end.line,
    endCol: ranged.range.end.column,
  };
}

/** Convenience: extract range or fall back to a 1:1-1:1 zero range. */
export function rangeOrZero(t: TemplateToken | undefined): SourceRange {
  return (
    rangeOf(t) ?? { startLine: 1, startCol: 1, endLine: 1, endCol: 1 }
  );
}

// ─── Iteration ──────────────────────────────────────────────────────

/** Iterate `(key, value)` pairs of a MappingToken. Skips non-string keys. */
export function* mappingEntries(
  map: MappingToken,
): Generator<[string, TemplateToken], void, void> {
  for (let i = 0; i < map.count; i++) {
    const pair = map.get(i);
    const k = readScalar(pair.key);
    if (typeof k === "string") yield [k, pair.value];
  }
}
