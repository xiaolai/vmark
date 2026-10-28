/**
 * Purpose: the test cases, suite titles and hooks a TypeScript test file
 *   REGISTERS, read through a documented subset of registration forms — the
 *   roots of `declaredTestCases` and of `--test-reach` evidence.
 *
 * Registration code is the module's statements, suite callbacks, and the
 * bodies registration code invokes; each is read in straight line
 * (`straightLine`, dodSyntaxInvoke.mjs). Within it, the supported statements:
 *   - a vitest registration (the grammar is dodSyntaxVitest.mjs);
 *   - a call of a same-file function bound immutably (`functionValue`): its
 *     body is registration code, and a parameter it calls in straight line
 *     runs the function its caller passed there (inline or immutably bound);
 *   - an immediately invoked function expression;
 *   - `forEach`/`map`/`flatMap`/`filter` on a non-empty array literal;
 *   - any of these awaited, parenthesised, or as a `const`/`let` initializer.
 * Everything else registers nothing and is reported in `unsupported`: a
 * registration under `if`, a loop, `switch` or `try`; a callback stored,
 * forwarded to another helper, aliased, deferred, handed to an unknown callee,
 * or passed to a helper that does not invoke it in straight line; a binding
 * written outside its declaration (a reassigned parameter or helper) or a
 * `let`/`var` helper; recursion (each recursive frame's registrations are
 * dropped); a shadowed, renamed or foreign root, an unknown modifier, or a
 * non-literal `skipIf`/`runIf` condition.
 *
 * @coordinates-with scripts/lib/dodSyntaxTs.mjs — re-exports this as the probe API
 * @coordinates-with scripts/lib/dodSyntaxVitest.mjs — the registration-call grammar
 * @coordinates-with scripts/lib/dodSyntaxInvoke.mjs — immutable bindings and straight-line reading
 * @module scripts/lib/dodSyntaxRegister
 */
import ts from "typescript";
import { arrayLiteralCallback, functionValue, isFunctionLike, reassigned, straightLine, unwrap } from "./dodSyntaxInvoke.mjs";
import { vitestCall } from "./dodSyntaxVitest.mjs";

/** A type checker over `sf` alone: binding resolution only, no lib and no imports. */
export function oneFileChecker(sf) {
  const host = {
    getSourceFile: (name) => (name === sf.fileName ? sf : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => name === sf.fileName,
    readFile: () => undefined,
  };
  const options = { noLib: true, noResolve: true, allowJs: true, types: [] };
  return ts.createProgram([sf.fileName], options, host).getTypeChecker();
}

const isTitle = (arg) => arg !== undefined && (ts.isStringLiteralLike(arg) || ts.isTemplateExpression(arg));
const titleText = (arg, sf) => (ts.isStringLiteralLike(arg) ? arg.text : arg.getText(sf));

/**
 * An argument that could BE the handler. A title with nothing after it is
 * vitest's todo form, and `test("x", undefined)` is the same placeholder
 * spelled out; anything that can evaluate to a function counts, including
 * `it(title, options, fn)`.
 */
const isHandlerArg = (arg) =>
  arg !== undefined &&
  !ts.isStringLiteralLike(arg) &&
  !ts.isNumericLiteral(arg) &&
  !ts.isObjectLiteralExpression(arg) &&
  !ts.isArrayLiteralExpression(arg) &&
  !(ts.isIdentifier(arg) && arg.text === "undefined") &&
  arg.kind !== ts.SyntaxKind.NullKeyword &&
  arg.kind !== ts.SyntaxKind.TrueKeyword &&
  arg.kind !== ts.SyntaxKind.FalseKeyword;

/** The first node under `node` (functions included) that calls a vitest root — what an unsupported form would have registered. */
function registrationIn(node, ctx) {
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && vitestCall(n, ctx.checker)) found = n;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * `{ cases, suiteTitles, hooks, bodies, unsupported }`: the registered case
 * calls (minus skipped/todo ones, and with `titleIncludes` only those whose
 * title contains it), the titles of suites holding a case, the hooks of those
 * suites and of the file, `bodies` — each case or hook call mapped to the
 * function it runs, when that resolves — and `unsupported`, `{ node, reason }`
 * for each form outside the grammar that would have registered something.
 */
export function testRoots(sf, { titleIncludes } = {}) {
  const checker = oneFileChecker(sf);
  const ctx = { checker, changed: reassigned(sf, checker) };
  const cases = [];
  const suiteTitles = [];
  const hooks = [];
  const bodies = new Map();
  const unsupported = [];
  const stack = [];
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const report = (node, reason) => {
    if (unsupported.some((u) => u.node === node)) return;
    unsupported.push({ node, reason: `line ${line(node)}: ${reason}` });
  };
  /** Report `node` when it holds a registration this walk cannot read. */
  const explain = (node, reason) => {
    if (registrationIn(node, ctx)) report(node, reason);
  };

  /** Parameters registration code invoked (or forwarded) through `callable`. */
  const invoked = new Set();
  /** The function `expr` runs as a callback: inline, immutably bound, or a parameter bound by the caller. */
  const callable = (expr, params) => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) {
      const [d] = checker.getSymbolAtLocation(e)?.declarations ?? [];
      if (d && ts.isParameter(d)) {
        invoked.add(d);
        return params.get(d) ?? null;
      }
    }
    return functionValue(e, ctx);
  };

  /** Why calling the plain name `callee` is not followed, when its declaration would register something; else null. */
  const notFollowed = (callee) => {
    const declarations = checker.getSymbolAtLocation(callee)?.declarations ?? [];
    if (!declarations.some((d) => registrationIn(d, ctx))) return null;
    const name = `\`${callee.text}\``;
    if (declarations.some((d) => ctx.changed.has(d))) return `${name} is written outside its declaration — a binding that can change is not followed`;
    if (declarations.length > 1) return `${name} has several declarations — which one runs is not known here`;
    const [d] = declarations;
    if (ts.isVariableDeclaration(d) && !(d.parent.flags & ts.NodeFlags.Const)) return `${name} is a \`let\`/\`var\` binding, which can change — only a \`const\` or function declaration is followed`;
    return `${name} is not bound to a same-file function this walk can read`;
  };

  /** Run `fn` as registration code with its parameters bound to `args` (functions only). */
  const enter = (fn, inert, args, site, callerParams = new Map()) => {
    const at = stack.findIndex((f) => f.fn === fn);
    if (at !== -1) {
      for (const f of stack.slice(at)) f.recursive = true;
      return report(site, "recursive registration — the recursion never ends, so its cases are not counted");
    }
    const params = new Map();
    const name = `\`${fn.name?.getText(sf) ?? "an inline function"}\``;
    fn.parameters.forEach((p, i) => {
      if (args[i] === undefined) return;
      const value = functionValue(args[i], ctx);
      if (value && ctx.changed.has(p)) {
        if (registrationIn(value, ctx)) report(site, `parameter \`${p.name.getText(sf)}\` of ${name} is written outside its declaration — the callback passed there is not followed`);
      } else if (value) params.set(p, value);
      else {
        const forwarded = callable(args[i], callerParams);
        if (forwarded && registrationIn(forwarded, ctx)) report(site, "a callback forwarded from a parameter to another helper — forwarding is not followed");
      }
    });
    const frame = { fn, recursive: false, marks: [cases.length, suiteTitles.length, hooks.length] };
    stack.push(frame);
    if (ts.isBlock(fn.body)) for (const st of straightLine(fn.body)) statement(st, inert, params);
    else expression(fn.body, inert, params);
    stack.pop();
    for (const [p, value] of params) {
      if (!invoked.has(p) && registrationIn(value, ctx)) {
        report(site, `the callback passed as \`${p.name.getText(sf)}\` is not invoked in straight-line code of ${name} — under a branch or loop, after an exit, aliased, stored or deferred, it registers nothing`);
      }
    }
    if (frame.recursive) {
      cases.length = frame.marks[0];
      suiteTitles.length = frame.marks[1];
      hooks.length = frame.marks[2];
    }
  };

  const registration = (reg, inert) => {
    const { call } = reg;
    const title = call.arguments[0];
    const skipped = inert || reg.inert;
    if (reg.kind === "case") {
      const handler = call.arguments.slice(1).find(isHandlerArg);
      if (!skipped && isTitle(title) && handler && (titleIncludes === undefined || titleText(title, sf).includes(titleIncludes))) {
        cases.push(call);
        const fn = callable(handler, reg.params);
        if (fn) bodies.set(call, fn);
      }
      return;
    }
    if (reg.kind === "hook") {
      if (skipped) return;
      hooks.push(call);
      const fn = call.arguments[0] && callable(call.arguments[0], reg.params);
      if (fn) bodies.set(call, fn);
      return;
    }
    const fn = [...call.arguments].reverse().map((a) => callable(a, reg.params)).find(Boolean);
    if (!fn) return explain(call, "a suite whose callback is not an inline or immutably bound function");
    const before = cases.length;
    const hooksBefore = hooks.length;
    enter(fn, skipped, [], call);
    // @edge-case A suite with no runnable case runs none of its hooks.
    if (cases.length === before) hooks.length = hooksBefore;
    else if (isTitle(title)) suiteTitles.push(title);
  };

  /** One expression in straight-line registration code. */
  const expression = (expr, inert, params) => {
    let e = unwrap(expr);
    if (ts.isAwaitExpression(e)) e = unwrap(e.expression);
    if (!ts.isCallExpression(e)) return explain(e, "a registration inside an expression that is not a supported call");
    const reg = vitestCall(e, checker);
    if (reg?.unsupported) return report(e, reg.unsupported);
    if (reg) return registration({ ...reg, params }, inert);
    const callee = unwrap(e.expression);
    const fn = callable(callee, params);
    if (fn) return enter(fn, inert, e.arguments, e, params);
    const callback = arrayLiteralCallback(e);
    const each = callback && callable(callback, params);
    if (each) return enter(each, inert, [], e);
    if (ts.isIdentifier(callee)) {
      const [d] = checker.getSymbolAtLocation(callee)?.declarations ?? [];
      if (d && ts.isParameter(d)) return explain(e, `\`${callee.text}\` is a parameter whose caller passed no inline or immutably bound function — forwarding a callback to another helper is not followed`);
      const why = notFollowed(callee);
      if (why) return report(e, why);
    }
    explain(e, `a callback handed to \`${callee.getText(sf)}\`, which is not a same-file function this walk can read — a stored, forwarded, aliased or deferred callback registers nothing`);
  };

  /** One statement in straight-line registration code. */
  const statement = (st, inert, params) => {
    if (ts.isExpressionStatement(st)) return expression(st.expression, inert, params);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (d.initializer && !isFunctionLike(unwrap(d.initializer))) expression(d.initializer, inert, params);
      return;
    }
    if (isFunctionLike(st) || ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isEmptyStatement(st)) return;
    const kind = ts.SyntaxKind[st.kind].replace(/Statement$/, " statement").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    explain(st, `a registration inside ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} — only straight-line statements are read`);
  };

  for (const st of straightLine(sf)) statement(st, false, new Map());
  return { cases, suiteTitles, hooks, bodies, unsupported };
}
