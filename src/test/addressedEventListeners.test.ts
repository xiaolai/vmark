// @vitest-environment node
/**
 * An event addressed to one window must only be listened for BY that window.
 *
 * `emitTo(label, event)` looks window-scoped, and is not on its own: Tauri
 * delivers an addressed event to every JS listener whose target is `Any` OR
 * matches the address (`tauri-2.x/src/event/listener.rs`, `match_any_or_filter`),
 * across all webviews. `listen(event, handler)` from `@tauri-apps/api/event`
 * registers with no target, which is `Any`, so it is woken by every window's
 * `emitTo`. The outline click was addressed correctly for months while two
 * hooks listened globally, and a click in one window scrolled all the others
 * (#1672).
 *
 * So the join is asserted against the real source: for every event the app
 * sends with `emitTo`, each global `listen("event", …)` must pass a third
 * argument whose `target` is a window, not `Any`. A `.listen(` on a window
 * object is scoped to that window already and is not a global listener.
 *
 * Reads the syntax tree, not text, so a `)` in a string, a comment, an alias
 * (`import { listen as on }`) or a namespace import cannot hide a listener.
 *
 * It is conservative: anything it cannot prove scoped (a spread, a computed key,
 * a nullish or non-literal `kind`) fails, and a parameter that shadows the imported `listen` is flagged
 * rather than resolved — rename it. It never passes what it cannot read.
 *
 * What it does NOT cover, so a green run is not read as more than it is:
 * events the Rust side addresses with `emit_to` (their names are constants,
 * not literals — `browser://*` is listened for globally today and is the known
 * remaining case), and event names built at run time. Behaviour is pinned by
 * `hooks/outlineSync.windowScope.test.ts`.
 *
 * @module test/addressedEventListeners.test
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const EVENT_MODULE = "@tauri-apps/api/event";

/** Production `.ts`/`.tsx` files under `dir`, as `[path, source]`. */
function sources(dir: string): Array<[string, string]> {
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

function parse(code: string, path = "fixture.ts"): ts.SourceFile {
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

function literal(arg: ts.Expression | undefined): string | null {
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

function addressedEvents(sf: ts.SourceFile): string[] {
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

/** Offsets of global `listen("event", …)` calls that are not scoped to a window. */
function untargetedListeners(sf: ts.SourceFile, event: string): number[] {
  const names = eventBindings(sf);
  return calls(sf)
    .filter((c) => callsEventApi(c, names, "listen") && literal(c.arguments[0]) === event)
    .filter((c) => !targetsAWindow(c.arguments[2]))
    .map((c) => c.getStart(sf));
}

describe("scanner (so a pass is not vacuous)", () => {
  const unscoped = (code: string, event = "a:b") => untargetedListeners(parse(code), event);
  const IMPORT = 'import { listen } from "@tauri-apps/api/event";\n';

  it("finds addressed events, including a call as the target", () => {
    const code =
      'import { emitTo } from "@tauri-apps/api/event";\n' +
      'emitTo(getCurrentWindowLabel(), "a:b", { x: 1 }); emitTo(label, "c:d", 1); other.emitTo(l, "e:f");';
    expect(addressedEvents(parse(code))).toEqual(["a:b", "c:d"]);
  });

  it("flags a global listen with no target, with a generic, and with an alias or a namespace", () => {
    expect(unscoped(IMPORT + 'await listen<{ n: number }>("a:b", (e) => {});')).toHaveLength(1);
    expect(unscoped('import { listen as on } from "@tauri-apps/api/event";\non("a:b", h);')).toHaveLength(1);
    expect(unscoped('import * as ev from "@tauri-apps/api/event";\nev.listen("a:b", h);')).toHaveLength(1);
  });

  it("flags a target that is the default, and a `target` that is not an option", () => {
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: { kind: "Any" } });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", (e) => handle({ target: e.payload }));')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { once: true });')).toHaveLength(1);
  });

  it("sees through `as const`, parentheses, quoted keys, and rejects a spread it cannot read", () => {
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: { kind: "Any" } as const });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: ({ kind: "Any" }) });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: { "kind": "Any" } });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: "main", ...opts });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: { ...t, kind: "WebviewWindow" } });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { "target": "main" });')).toEqual([]);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: { kind: "WebviewWindow", label } as const });')).toEqual([]);
  });

  it("rejects a target Tauri reads as absent, and keys it cannot read", () => {
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: undefined });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: null });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: void 0 });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: "main", [key]: undefined });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: { kind: "WebviewWindow", [k]: "Any" } });')).toHaveLength(1);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: { kind: undefined } });')).toHaveLength(1);
  });

  it("flags a shadowed `listen` rather than guessing (rename the parameter)", () => {
    expect(unscoped(IMPORT + 'function f(listen: Fn) { listen("a:b", h); }')).toHaveLength(1);
  });

  it("accepts a window target, a label, a variable, and a window-scoped .listen", () => {
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: { kind: "WebviewWindow", label } });')).toEqual([]);
    expect(unscoped(IMPORT + 'listen("a:b", h, { target: "main" });')).toEqual([]);
    expect(unscoped(IMPORT + "listen(\"a:b\", h, { target });")).toEqual([]);
    expect(unscoped('await getCurrentWebviewWindow().listen("a:b", h);')).toEqual([]);
    expect(unscoped('win.listen<string>("a:b", h);')).toEqual([]);
  });

  it("is not fooled by strings, comments or look-alikes", () => {
    // A ")" in a string used to end the argument list early; a comment is not a call.
    expect(unscoped(IMPORT + 'listen("a:b", (e) => log(")"), { target: "main" });')).toEqual([]);
    expect(unscoped(IMPORT + '// listen("a:b", h)\nconst s = \'listen("a:b", h)\';')).toEqual([]);
    expect(unscoped(IMPORT + 'listen("a:bc", h);')).toEqual([]);
    expect(unscoped('const { listen } = deps;\nlisten("a:b", h);')).toEqual([]); // not the event module's
  });
});

describe("events the app addresses to one window", () => {
  const files = sources("src")
    .filter(([, code]) => code.includes("listen") || code.includes("emitTo"))
    .map(([path, code]) => [path, parse(code, path), code] as const);
  const events = new Set(files.flatMap(([, sf]) => addressedEvents(sf)));

  it("include the outline click, so the scan is reading the real code", () => {
    expect(events).toContain("outline:scroll-to-heading");
  });

  it("are never listened for without a window target", () => {
    const offenders: string[] = [];
    for (const event of events) {
      for (const [path, sf, code] of files) {
        for (const at of untargetedListeners(sf, event)) {
          offenders.push(`${path}:${code.slice(0, at).split("\n").length} listens for "${event}" with no window target`);
        }
      }
    }
    expect(
      offenders,
      `emitTo(<window>, event) reaches a listener with no window target in EVERY window (#1672). ` +
        `Register it with { target: { kind: "WebviewWindow", label } } or on the window object:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
