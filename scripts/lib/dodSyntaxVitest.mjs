/**
 * Purpose: the vitest registration calls `testRoots` (dodSyntaxTs.mjs)
 *   recognises — a closed grammar, not a spelling match. A registration is a
 *   call whose root identifier is `it`/`test` (a case), `describe`/`suite` (a
 *   suite) or a lifecycle hook, BOUND to vitest: imported from "vitest" under
 *   its own name, or undeclared (the repo's vitest configs set
 *   `globals: true`). A local declaration, a rename, an import from another
 *   package or a namespace import is not vitest's.
 *
 * Between the root and the registering call, only these modifiers:
 *   - property modifiers: cases `skip`, `todo`, `only`, `concurrent`,
 *     `sequential`, `fails`; suites `skip`, `todo`, `only`, `concurrent`,
 *     `sequential`, `shuffle` (`skip`/`todo` make the registration inert);
 *   - called modifiers: `skipIf(c)`, `runIf(c)`, whose condition must be a
 *     literal (`literalTruth`, dodSyntaxInvoke.mjs): `skipIf(true)` and
 *     `runIf(false)` make the registration inert; any other condition is
 *     outside the grammar, since whether the case runs is not known here;
 *   - table forms, last in the chain: `each(table)`, `for(table)` — an empty
 *     array literal table registers nothing, so it is inert.
 * Hooks take no modifier. An optional call or access, an unknown modifier, a
 * modifier after a table, or a non-literal condition is outside the grammar:
 * `{ unsupported }`.
 *
 * @coordinates-with scripts/lib/dodSyntaxTs.mjs — the registration walker this answers for
 * @module scripts/lib/dodSyntaxVitest
 */
import ts from "typescript";
import { literalTruth, unwrap } from "./dodSyntaxInvoke.mjs";

const KINDS = new Map([
  ["it", "case"], ["test", "case"],
  ["describe", "suite"], ["suite", "suite"],
  ["beforeAll", "hook"], ["beforeEach", "hook"], ["afterAll", "hook"], ["afterEach", "hook"],
]);
const PROPERTY_MODIFIERS = {
  case: new Set(["skip", "todo", "only", "concurrent", "sequential", "fails"]),
  suite: new Set(["skip", "todo", "only", "concurrent", "sequential", "shuffle"]),
  hook: new Set(),
};
const INERT = new Set(["skip", "todo"]);
const CALLED_MODIFIERS = new Set(["skipIf", "runIf"]);
const TABLE_MODIFIERS = new Set(["each", "for"]);

const optional = (node) => Boolean(node.questionDotToken);

/** True when `root` is vitest's: imported from "vitest" under its own name, or undeclared (globals). */
function vitestBound(root, checker) {
  const declarations = checker.getSymbolAtLocation(root)?.declarations ?? [];
  return declarations.every(
    (d) =>
      ts.isImportSpecifier(d) &&
      (d.propertyName ?? d.name).text === root.text &&
      ts.isStringLiteral(d.parent.parent.parent.moduleSpecifier) &&
      d.parent.parent.parent.moduleSpecifier.text === "vitest",
  );
}

/**
 * `call` read as a vitest registration: `{ kind, inert, call }`;
 * `{ unsupported: reason }` when its root is a vitest name but the chain is
 * outside the grammar; `null` when it is not a registration at all.
 */
export function vitestCall(call, checker) {
  if (optional(call)) return rootName(call.expression) ? { unsupported: "an optional call of a vitest root" } : null;
  const modifiers = [];
  let e = call.expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(e)) {
      if (optional(e)) return rootName(e) ? { unsupported: "an optional access in a vitest chain" } : null;
      modifiers.unshift({ name: e.name.text, called: false });
      e = e.expression;
    } else if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && !optional(e) && !optional(e.expression)) {
      modifiers.unshift({ name: e.expression.name.text, called: true, args: e.arguments });
      e = e.expression.expression;
    } else break;
  }
  if (!ts.isIdentifier(e) || !KINDS.has(e.text)) return null;
  const kind = KINDS.get(e.text);
  if (!vitestBound(e, checker)) return null;
  let inert = false;
  for (const [i, m] of modifiers.entries()) {
    const ok = m.called
      ? kind !== "hook" && (CALLED_MODIFIERS.has(m.name) || (TABLE_MODIFIERS.has(m.name) && i === modifiers.length - 1))
      : PROPERTY_MODIFIERS[kind].has(m.name) && !modifiers.slice(0, i).some((p) => TABLE_MODIFIERS.has(p.name));
    if (!ok) return { unsupported: `\`${e.text}\` with modifier \`${m.name}\`, which the supported modifier list does not include in that position` };
    if (INERT.has(m.name)) inert = true;
    if (m.called && CALLED_MODIFIERS.has(m.name)) {
      const truth = m.args.length === 1 ? literalTruth(m.args[0]) : undefined;
      if (truth === undefined) return { unsupported: `\`${e.text}.${m.name}(…)\` with a condition that is not a literal — whether it runs is not known here` };
      if (truth === (m.name === "skipIf")) inert = true;
    }
    if (m.called && TABLE_MODIFIERS.has(m.name) && m.args.length === 1) {
      const table = unwrap(m.args[0]);
      if (ts.isArrayLiteralExpression(table) && table.elements.length === 0) inert = true;
    }
  }
  return { kind, inert, call };
}

/** The root identifier name of a property/call chain, when it is a vitest root name. */
function rootName(expr) {
  let e = expr;
  while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)) e = e.expression;
  return ts.isIdentifier(e) && KINDS.has(e.text) ? e.text : null;
}
