/**
 * Purpose: the spans of a TypeScript test file that count as evidence for
 *   `--test-reach` — what its registered cases, the suites holding them and
 *   their hooks (`testRoots`) READ or EXECUTE.
 *
 * Two relations, kept apart:
 *   - reading a value: an identifier bound to a variable whose initializer is
 *     not a function keeps that declaration's text (a fixture, a table);
 *   - invoking a body: a function's text counts only when retained code CALLS
 *     it — inline (an IIFE) or by a plain name bound immutably to one
 *     same-file function (`functionValue`, dodSyntaxInvoke.mjs).
 * Every retained span excludes the functions and classes nested in it, so a
 * body nested in an accepted root — an unused arrow, a stored helper, a
 * fixture object's method, a callback handed to some other call — stays blank
 * unless a supported call runs it. Code that provably never runs — after an
 * unconditional exit, or on the side of a literal condition that rules it out
 * (dodSyntaxTsDead.mjs) — is neither kept nor followed, and a variable
 * declared there is no fixture: reading it reads no initializer. Method calls, `new`,
 * and calls through a `let` or a property are not followed. A call through a
 * PARAMETER is followed only to the function values bound to it, and only
 * when that parameter is a plain identifier, not rest, never reassigned:
 *   - a kept call of a same-file function (inline or immutably bound) binds
 *     its parameter i to argument i when that argument is a function value
 *     (a spread argument stops the binding, its positions being unknown);
 *   - a case registered by `it.each(<array literal>)` binds its body's
 *     parameter i to element i of every row (the row itself for i = 0 when
 *     a row is not an array literal); a spread in the table or a row, and
 *     `for` tables (one argument, the row) bind nothing.
 * A bound function runs once kept code calls its parameter: a callback the
 * helper only stores, calls under a dead branch, or calls in a nested
 * function nothing invokes stays blank.
 *
 * @coordinates-with scripts/lib/dodSyntaxReach.mjs — tsTestReach blanks everything else
 * @coordinates-with scripts/lib/dodSyntaxRegister.mjs — the roots and the bodies they run
 * @coordinates-with scripts/lib/dodSyntaxInvoke.mjs — immutable function bindings
 * @coordinates-with scripts/lib/dodSyntaxTsDead.mjs — code that never runs
 * @module scripts/lib/dodSyntaxTsReach
 */
import ts from "typescript";
import { functionValue, isFunctionLike, isFunctionValue, reassigned, unwrap } from "./dodSyntaxInvoke.mjs";
import { oneFileChecker, testRoots } from "./dodSyntaxRegister.mjs";
import { isDead, underDeadCode } from "./dodSyntaxTsDead.mjs";

/** The symbol an identifier binds to; a `{ name }` shorthand binds to the value it reads. */
function boundSymbol(checker, id) {
  const parent = id.parent;
  if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === id) {
    return checker.getShorthandAssignmentValueSymbol(parent);
  }
  return checker.getSymbolAtLocation(id);
}

/** The variable declaration a (possibly destructured) binding belongs to, or null. */
function variableOf(d) {
  let n = d;
  while (n && (ts.isBindingElement(n) || ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))) n = n.parent;
  return n && ts.isVariableDeclaration(n) ? n : null;
}

/** The function value `expr` names: inline or immutably bound, else null. */
const valueOf = (expr, ctx) => {
  const u = unwrap(expr);
  return isFunctionValue(u) ? u : functionValue(u, ctx);
};

/** Binds the body `fn` of the case `call`'s parameters to the function values its `it.each` rows pass there. */
function tableCallbacks(call, fn, ctx, bind) {
  const head = call.expression;
  if (!fn || !ts.isCallExpression(head) || !ts.isPropertyAccessExpression(head.expression) || head.expression.name.text !== "each") return;
  const table = head.arguments[0] && unwrap(head.arguments[0]);
  if (!table || !ts.isArrayLiteralExpression(table) || table.elements.some(ts.isSpreadElement)) return;
  fn.parameters.forEach((p, i) => {
    for (const row of table.elements.map(unwrap)) {
      const rowArray = ts.isArrayLiteralExpression(row);
      if (rowArray && row.elements.some(ts.isSpreadElement)) continue;
      const el = rowArray ? row.elements[i] : i === 0 ? row : undefined;
      const value = el && valueOf(el, ctx);
      if (value) bind(p, value);
    }
  });
}

/**
 * [start, end) pairs of evidence in `sf`, from its registered cases, suite
 * titles and hooks — or from the subset of `testRoots(sf)` the caller passes
 * as `roots` (one case alone, for a named witness).
 */
export function tsEvidenceSpans(sf, roots = testRoots(sf)) {
  const checker = oneFileChecker(sf);
  const ctx = { checker, changed: reassigned(sf, checker) };
  const { cases, suiteTitles, hooks, bodies } = roots;
  if (cases.length === 0) return [];
  const spans = [];
  const seen = new Set();
  const queue = [];
  const add = (node) => {
    if (node && !seen.has(node)) {
      seen.add(node);
      queue.push(node);
    }
  };
  /** Parameter → the function values bound to it; the parameters kept code calls. */
  const bound = new Map();
  const called = new Set();
  const bind = (p, value) => {
    if (!p || !ts.isIdentifier(p.name) || p.dotDotDotToken || ctx.changed.has(p)) return;
    if (!bound.has(p)) bound.set(p, new Set());
    bound.get(p).add(value);
    if (called.has(p)) add(value);
  };
  const callParameter = (d) => {
    called.add(d);
    for (const v of bound.get(d) ?? []) add(v);
  };
  for (const c of cases) tableCallbacks(c, bodies.get(c), ctx, bind);
  /** Keep `node`'s text minus every nested function or class and all dead code; follow the calls and reads in what is kept. */
  const retain = (node) => {
    let from = node.getStart(sf);
    const walk = (n) => {
      if (n !== node && (isFunctionLike(n) || isDead(n))) {
        spans.push([from, n.getStart(sf)]);
        from = n.end;
        return;
      }
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        const fn = valueOf(callee, ctx);
        add(fn);
        if (fn) {
          const spread = n.arguments.findIndex(ts.isSpreadElement);
          n.arguments.slice(0, spread === -1 ? undefined : spread).forEach((a, i) => {
            const value = valueOf(a, ctx);
            if (value) bind(fn.parameters[i], value);
          });
        }
        if (ts.isIdentifier(callee)) for (const d of checker.getSymbolAtLocation(callee)?.declarations ?? []) if (ts.isParameter(d)) callParameter(d);
      }
      if (ts.isIdentifier(n)) {
        for (const d of boundSymbol(checker, n)?.declarations ?? []) {
          const v = variableOf(d);
          if (v?.initializer && !isFunctionLike(unwrap(v.initializer)) && !underDeadCode(v)) add(v);
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    spans.push([from, node.end]);
  };
  for (const c of [...cases, ...hooks]) {
    add(c);
    add(bodies.get(c));
  }
  for (const t of suiteTitles) add(t);
  while (queue.length > 0) retain(queue.pop());
  return spans;
}
