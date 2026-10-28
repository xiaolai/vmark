/**
 * Purpose: which same-file functions TypeScript code is KNOWN to run — shared
 *   by registration (`testRoots`, dodSyntaxTs.mjs) and evidence traversal
 *   (dodSyntaxTsReach.mjs). A function value is resolved by the compiler's
 *   binder, never by spelling, and only through bindings that cannot change:
 *   a function declaration nothing reassigns, or a `const` bound to a function
 *   expression, an arrow, or another such binding. A `let`/`var`, a parameter,
 *   a property, a name with several declarations, or any binding WRITTEN
 *   anywhere but its declaration — an assignment, compound assignment,
 *   destructuring assignment, `for (x of …)` head or `++`/`--` — resolves to
 *   nothing.
 *
 * Invocation is read in STRAIGHT-LINE code only: the statements of a body up
 * to the first that may leave it (`return`, `throw`, or a compound statement
 * holding one). Code under `if`, a loop, `switch` or `try` may not run, so it
 * is not read as running.
 *
 * @coordinates-with scripts/lib/dodSyntaxTs.mjs — the registration walker
 * @coordinates-with scripts/lib/dodSyntaxTsReach.mjs — the evidence walker
 * @module scripts/lib/dodSyntaxInvoke
 */
import ts from "typescript";

export const isFunctionLike = (node) => ts.isFunctionLike(node) || ts.isClassLike(node);
export const unwrap = (e) => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e);
export const isFunctionValue = (e) => ts.isArrowFunction(e) || ts.isFunctionExpression(e);

const isAssignment = (kind) => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
const COUNTERS = new Set([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken]);

/** The symbols an assignment target writes: a name, or the names a destructuring pattern holds. */
function written(target, checker) {
  const t = unwrap(target);
  if (ts.isIdentifier(t)) return [checker.getSymbolAtLocation(t)];
  if (ts.isBinaryExpression(t) && t.operatorToken.kind === ts.SyntaxKind.EqualsToken) return written(t.left, checker);
  if (ts.isSpreadElement(t) || ts.isSpreadAssignment(t)) return written(t.expression, checker);
  if (ts.isArrayLiteralExpression(t)) return t.elements.flatMap((e) => written(e, checker));
  if (ts.isObjectLiteralExpression(t)) {
    return t.properties.flatMap((p) => {
      if (ts.isShorthandPropertyAssignment(p)) return [checker.getShorthandAssignmentValueSymbol(p)];
      if (ts.isPropertyAssignment(p)) return written(p.initializer, checker);
      return ts.isSpreadAssignment(p) ? written(p.expression, checker) : [];
    });
  }
  return [];
}

/** The declarations of every binding `sf` writes outside its declaration — a binding that can change. */
export function reassigned(sf, checker) {
  const out = new Set();
  const write = (target) => { for (const s of written(target, checker)) for (const d of s?.declarations ?? []) out.add(d); };
  const visit = (n) => {
    if (ts.isBinaryExpression(n) && isAssignment(n.operatorToken.kind)) write(n.left);
    else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && COUNTERS.has(n.operator)) write(n.operand);
    else if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) write(n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const isConst = (d) => ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0;

/**
 * The function `expr` denotes through a binding that cannot change, or null.
 * `ctx` is `{ checker, changed }` (`changed`: the `reassigned` set).
 */
export function functionValue(expr, ctx, seen = new Set()) {
  const e = unwrap(expr);
  if (isFunctionValue(e)) return e;
  if (!ts.isIdentifier(e)) return null;
  const declarations = ctx.checker.getSymbolAtLocation(e)?.declarations ?? [];
  if (declarations.length !== 1) return null;
  const [d] = declarations;
  if (seen.has(d) || ctx.changed.has(d)) return null;
  seen.add(d);
  if (ts.isFunctionDeclaration(d) && d.body) return d;
  if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && isConst(d) && d.initializer) return functionValue(d.initializer, ctx, seen);
  return null;
}

/**
 * The truth value of a condition written as a literal — `true`, `false`, a
 * number, a string, `null`, `undefined`, `void …`, an empty array or object
 * literal, or `!` of one — else undefined: a condition this probe does not know.
 */
export function literalTruth(expr) {
  const e = unwrap(expr);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isIdentifier(e) && e.text === "undefined") return false;
  if (ts.isVoidExpression(e)) return false;
  if (ts.isNumericLiteral(e)) return Number(e.text) !== 0;
  if (ts.isStringLiteralLike(e)) return e.text !== "";
  if (ts.isArrayLiteralExpression(e) || ts.isObjectLiteralExpression(e)) return true;
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    const v = literalTruth(e.operand);
    return v === undefined ? undefined : !v;
  }
  return undefined;
}

/** True when `node` holds a `return` or `throw` of its own function (not of a nested one). */
function mayExit(node) {
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true;
  if (isFunctionLike(node)) return false;
  return ts.forEachChild(node, mayExit) === true;
}

/** The statements of `body` (a block, a source file, or an arrow's expression) that run in straight line. */
export function straightLine(body) {
  if (!ts.isBlock(body) && !ts.isSourceFile(body)) return [body];
  const out = [];
  for (const st of body.statements) {
    if (ts.isReturnStatement(st) || ts.isThrowStatement(st)) break;
    out.push(st);
    if (mayExit(st)) break;
  }
  return out;
}

/** Array methods that run their callback once per element, every element, before they return. */
const ITERATORS = new Set(["forEach", "map", "flatMap", "filter"]);

/**
 * The callback argument of `call` when `call` is an iterator method on a
 * non-empty array LITERAL without spread — the one receiver whose method is
 * known to be Array's and to run its callback at least once. Otherwise null.
 */
export function arrayLiteralCallback(call) {
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken || !ITERATORS.has(callee.name.text)) return null;
  const receiver = unwrap(callee.expression);
  if (!ts.isArrayLiteralExpression(receiver) || receiver.elements.length === 0) return null;
  if (receiver.elements.some((el) => ts.isSpreadElement(el) || ts.isOmittedExpression(el))) return null;
  return call.arguments[0] ?? null;
}
