/**
 * Purpose: TypeScript code that provably never runs — what evidence traversal
 *   (dodSyntaxTsReach.mjs) must neither keep nor follow calls from, though it
 *   sits inside a body that does run:
 *   - a statement after one that always leaves its block (`return`, `throw`,
 *     `break`, `continue`, a block or `if` whose every path does);
 *   - the branch a LITERAL condition rules out (`literalTruth`,
 *     dodSyntaxInvoke.mjs): `if`/`?:` on a literal, the right side of
 *     `false && …`, `true || …` or a non-nullish literal `?? …`;
 *   - the body of `while`/`for` on a false literal (and that `for`'s update
 *     clause), and of a `for…of` over an empty array literal.
 * `underDeadCode` asks the same of a node's ancestors up to its function: a
 * hoisted `var` declared there is read as `undefined`, never as its
 * initializer.
 * A condition that is not a literal may hold, so the code under it is kept:
 * this marks DEAD code, not conditional code.
 *
 * @coordinates-with scripts/lib/dodSyntaxTsReach.mjs — skips these nodes
 * @coordinates-with scripts/lib/dodSyntaxInvoke.mjs — literal conditions
 * @module scripts/lib/dodSyntaxTsDead
 */
import ts from "typescript";
import { literalTruth, unwrap } from "./dodSyntaxInvoke.mjs";

/** True when every path through statement `st` leaves the enclosing block. */
function alwaysLeaves(st) {
  if (ts.isReturnStatement(st) || ts.isThrowStatement(st) || ts.isBreakStatement(st) || ts.isContinueStatement(st)) return true;
  if (ts.isBlock(st)) return st.statements.some(alwaysLeaves);
  if (ts.isIfStatement(st)) {
    const truth = literalTruth(st.expression);
    if (truth === true) return alwaysLeaves(st.thenStatement);
    if (truth === false) return st.elseStatement !== undefined && alwaysLeaves(st.elseStatement);
    return st.elseStatement !== undefined && alwaysLeaves(st.thenStatement) && alwaysLeaves(st.elseStatement);
  }
  return false;
}

const NULLISH = (e) => e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === "undefined") || ts.isVoidExpression(e);

/** True when `node` never runs although its parent may: see the module header. */
export function isDead(node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
    const at = p.statements.indexOf(node);
    return at > 0 && p.statements.slice(0, at).some(alwaysLeaves);
  }
  if (ts.isIfStatement(p) || ts.isConditionalExpression(p)) {
    const truth = literalTruth(ts.isIfStatement(p) ? p.expression : p.condition);
    if (truth === undefined) return false;
    const live = ts.isIfStatement(p) ? (truth ? p.thenStatement : p.elseStatement) : (truth ? p.whenTrue : p.whenFalse);
    const branches = ts.isIfStatement(p) ? [p.thenStatement, p.elseStatement] : [p.whenTrue, p.whenFalse];
    return branches.includes(node) && node !== live;
  }
  if (ts.isBinaryExpression(p) && node === p.right) {
    const left = unwrap(p.left);
    const op = p.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return literalTruth(left) === false;
    if (op === ts.SyntaxKind.BarBarToken) return literalTruth(left) === true;
    if (op === ts.SyntaxKind.QuestionQuestionToken) return literalTruth(left) !== undefined && !NULLISH(left);
    return false;
  }
  if ((ts.isWhileStatement(p) || ts.isForStatement(p)) && (node === p.statement || (ts.isForStatement(p) && node === p.incrementor))) {
    const cond = ts.isWhileStatement(p) ? p.expression : p.condition;
    return cond !== undefined && literalTruth(cond) === false;
  }
  if (ts.isForOfStatement(p) && node === p.statement) {
    const over = unwrap(p.expression);
    return ts.isArrayLiteralExpression(over) && over.elements.length === 0;
  }
  return false;
}

/** True when `node` or an ancestor below its enclosing function never runs. */
export function underDeadCode(node) {
  for (let n = node; n && !ts.isSourceFile(n); n = n.parent) {
    if (isDead(n)) return true;
    if (n !== node && ts.isFunctionLike(n)) return false;
  }
  return false;
}
