/**
 * Shared TypeScript-AST helpers for the window-addressed-event guards
 * (`addressedEventListeners.test.ts`, `rustAddressedEventListeners.test.ts`):
 * read production sources and decide, from the syntax tree, which `listen(…)`
 * calls from `@tauri-apps/api/event` are global (target `Any`) and which are
 * scoped to a window.
 *
 * @module test/eventListenerScan
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const EVENT_MODULE = "@tauri-apps/api/event";

/** Production `.ts`/`.tsx` files under `dir`, as `[path, source]`. */
export function sources(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "test") continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push([path, readFileSync(path, "utf8")]);
    }
  }
  return out;
}

export function parse(code: string, path = "fixture.ts"): ts.SourceFile {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, kind);
}

/** Local names the file binds to the event module's `listen`, `emitTo` and namespace. */
function eventBindings(sf: ts.SourceFile) {
  const names = { listen: new Set<string>(), emitTo: new Set<string>(), namespaces: new Set<string>() };
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== EVENT_MODULE) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      names.namespaces.add(bindings.name.text);
      continue;
    }
    for (const spec of bindings.elements) {
      const imported = (spec.propertyName ?? spec.name).text;
      if (imported === "listen") names.listen.add(spec.name.text);
      if (imported === "emitTo") names.emitTo.add(spec.name.text);
    }
  }
  return names;
}

function calls(sf: ts.SourceFile): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function literal(arg: ts.Expression | undefined): string | null {
  return arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null;
}

/** True when `call` invokes the event module's `fn` (bare, aliased or via a namespace import). */
function callsEventApi(call: ts.CallExpression, names: ReturnType<typeof eventBindings>, fn: "listen" | "emitTo") {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return names[fn].has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    names.namespaces.has(callee.expression.text) &&
    callee.name.text === fn
  );
}

export function addressedEvents(sf: ts.SourceFile): string[] {
  const names = eventBindings(sf);
  return calls(sf)
    .filter((c) => callsEventApi(c, names, "emitTo"))
    .map((c) => literal(c.arguments[1]))
    .filter((e): e is string => e !== null);
}

/** `expr` without the wrappers that change its type but not its value. */
function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e)
  ) {
    e = e.expression;
  }
  return e;
}

/** A property's name whether written `target` or `"target"`; null when computed. */
function propName(prop: ts.ObjectLiteralElementLike): string | null {
  const name = prop.name;
  if (!name) return null;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)
    ? name.text
    : null;
}

/** `undefined`, `null` or `void …` — what Tauri treats as "no target". */
function isNullish(e: ts.Expression): boolean {
  return (
    (ts.isIdentifier(e) && e.text === "undefined") ||
    e.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(e)
  );
}

/** A spread or a computed key: either can overwrite a safe value, and neither can be read. */
function unprovable(prop: ts.ObjectLiteralElementLike): boolean {
  return ts.isSpreadAssignment(prop) || (prop.name !== undefined && ts.isComputedPropertyName(prop.name));
}

/**
 * `{ target: <a window> }` — and not `{ target: { kind: "Any" } }`, which is the
 * default. A spread makes the result unknowable (it can overwrite a safe target
 * with `Any`), so it does not count as scoped: say the target out loud.
 */
function targetsAWindow(options: ts.Expression | undefined): boolean {
  const opts = options && unwrap(options);
  if (!opts || !ts.isObjectLiteralExpression(opts)) return false;
  if (opts.properties.some(unprovable)) return false;
  const target = opts.properties.filter((p) => propName(p) === "target").at(-1);
  if (!target) return false;
  if (ts.isShorthandPropertyAssignment(target)) return true;
  if (!ts.isPropertyAssignment(target)) return false;
  const value = unwrap(target.initializer);
  if (isNullish(value)) return false; // Tauri reads an absent target as `Any`
  if (!ts.isObjectLiteralExpression(value)) return true; // a label, or a variable holding a target
  if (value.properties.some(unprovable)) return false;
  const kind = value.properties.filter((p) => propName(p) === "kind").at(-1);
  if (!kind || !ts.isPropertyAssignment(kind)) return false;
  const named = literal(unwrap(kind.initializer));
  return named !== null && named !== "Any";
}

/** Global `listen(…)` calls (any event argument) that are not scoped to a window. */
export function untargetedListenCalls(sf: ts.SourceFile): ts.CallExpression[] {
  const names = eventBindings(sf);
  return calls(sf)
    .filter((c) => callsEventApi(c, names, "listen"))
    .filter((c) => !targetsAWindow(c.arguments[2]));
}

/** Offsets of global `listen("event", …)` calls that are not scoped to a window. */
export function untargetedListeners(sf: ts.SourceFile, event: string): number[] {
  return untargetedListenCalls(sf)
    .filter((c) => literal(c.arguments[0]) === event)
    .map((c) => c.getStart(sf));
}
