/**
 * Purpose: WI-#4 — minimal static evaluator for GHA `if:` expressions.
 *   Given a simulated context (e.g., `github.event_name == 'push'`),
 *   returns true/false for paths the evaluator can fully resolve, or
 *   "unknown" when any operand depends on context we can't simulate
 *   (secrets, functions, runtime outputs).
 *
 *   Intentionally a STRICT subset:
 *     - Literals: true, false, single-quoted strings
 *     - Property access: identifier(.identifier)*
 *     - Operators: ==, !=, &&, ||, !, parens
 *
 *   Anything outside this subset (function calls, ternaries, JSON
 *   helpers, secret refs) returns "unknown" — better silent than
 *   wrong. Deliberately small footprint until @actions/expressions
 *   ContextProvider lands (deferred WI-5.2).
 *
 * @module lib/ghaWorkflow/eval/staticIf
 */

export interface SimContext {
  github: {
    event_name: string;
    ref?: string;
    actor?: string;
    repository?: string;
  };
}

export type EvalResult = boolean | "unknown";

class ParseError extends Error {}
class UnknownError extends Error {}

class Tokenizer {
  private i = 0;
  constructor(private readonly src: string) {}
  peek(): string {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++;
    return this.src[this.i] ?? "";
  }
  eof(): boolean {
    return this.peek() === "";
  }
  tryConsume(s: string): boolean {
    this.peek();
    if (this.src.slice(this.i, this.i + s.length) === s) {
      this.i += s.length;
      return true;
    }
    return false;
  }
  expect(s: string): void {
    if (!this.tryConsume(s)) throw new ParseError(`expected '${s}'`);
  }
  consumeIdent(): string | null {
    this.peek();
    const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(this.src.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }
  consumeString(): string | null {
    this.peek();
    if (this.src[this.i] !== "'") return null;
    let j = this.i + 1;
    while (j < this.src.length && this.src[j] !== "'") j++;
    if (j >= this.src.length) throw new ParseError("unterminated string");
    const out = this.src.slice(this.i + 1, j);
    this.i = j + 1;
    return out;
  }
}

type Value = boolean | string | "unknown";

function resolveProperty(path: string[], ctx: SimContext): Value {
  if (path.length === 0) throw new UnknownError();
  if (path[0] !== "github") throw new UnknownError();
  if (path.length !== 2) throw new UnknownError();
  const key = path[1];
  const allowed: Array<keyof SimContext["github"]> = [
    "event_name",
    "ref",
    "actor",
    "repository",
  ];
  if (!allowed.includes(key as keyof SimContext["github"])) {
    throw new UnknownError();
  }
  const v = ctx.github[key as keyof SimContext["github"]];
  return v == null ? "unknown" : v;
}

function eqValues(a: Value, b: Value): EvalResult {
  if (a === "unknown" || b === "unknown") return "unknown";
  return a === b;
}

class Parser {
  constructor(
    private readonly tk: Tokenizer,
    private readonly ctx: SimContext,
  ) {}

  /** OR is the lowest-precedence binary. */
  parseOr(): EvalResult {
    let left = this.parseAnd();
    while (this.tk.tryConsume("||")) {
      const right = this.parseAnd();
      if (left === true || right === true) {
        left = true;
      } else if (left === false && right === false) {
        left = false;
      } else {
        left = "unknown";
      }
    }
    return left;
  }

  parseAnd(): EvalResult {
    let left = this.parseEq();
    while (this.tk.tryConsume("&&")) {
      const right = this.parseEq();
      if (left === false || right === false) {
        left = false;
      } else if (left === true && right === true) {
        left = true;
      } else {
        left = "unknown";
      }
    }
    return left;
  }

  parseEq(): EvalResult {
    const left = this.parsePrimary();
    if (this.tk.tryConsume("==")) {
      const right = this.parsePrimary();
      return eqValues(left, right);
    }
    if (this.tk.tryConsume("!=")) {
      const right = this.parsePrimary();
      const eq = eqValues(left, right);
      if (eq === "unknown") return "unknown";
      return !eq;
    }
    if (typeof left === "boolean") return left;
    if (left === "unknown") return "unknown";
    // Bare strings as conditions don't make sense for `if:`
    throw new UnknownError();
  }

  parsePrimary(): Value {
    if (this.tk.tryConsume("!")) {
      const inner = this.parsePrimary();
      if (inner === "unknown") return "unknown";
      if (typeof inner === "boolean") return !inner;
      throw new UnknownError();
    }
    if (this.tk.tryConsume("(")) {
      const v = this.parseOr();
      this.tk.expect(")");
      return v;
    }
    const str = this.tk.consumeString();
    if (str !== null) return str;
    if (this.tk.tryConsume("true")) return true;
    if (this.tk.tryConsume("false")) return false;
    const ident = this.tk.consumeIdent();
    if (ident === null) throw new ParseError("unexpected token");
    const path = [ident];
    while (this.tk.tryConsume(".")) {
      const next = this.tk.consumeIdent();
      if (!next) throw new ParseError("expected identifier after '.'");
      path.push(next);
    }
    // If followed by `(`, it's a function call — out of scope.
    if (this.tk.peek() === "(") throw new UnknownError();
    return resolveProperty(path, this.ctx);
  }
}

export function evaluateIf(
  ifText: string | undefined,
  ctx: SimContext,
): EvalResult {
  if (!ifText) return "unknown";
  let trimmed = ifText.trim();
  // Strip ${{ }} wrapping if present.
  const m = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(trimmed);
  if (m) trimmed = m[1];
  if (!trimmed) return "unknown";
  try {
    const tk = new Tokenizer(trimmed);
    const parser = new Parser(tk, ctx);
    const result = parser.parseOr();
    if (!tk.eof()) return "unknown";
    return result;
  } catch (e) {
    if (e instanceof ParseError || e instanceof UnknownError) {
      return "unknown";
    }
    return "unknown";
  }
}
