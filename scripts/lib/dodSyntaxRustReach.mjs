/**
 * Purpose: the items of a Rust test file and the items each one's code CALLS
 *   or READS, resolved by Rust's scoping rather than by spelling — the reach
 *   graph `rustTestReach` (dodSyntaxReach.mjs) walks from the test fns.
 *
 * No Rust parser here: items are read from the comment- and literal-blanked
 * text (`rustCode`). A `fn`, `const` or `static` is an item; `mod`, `impl`,
 * `trait` and `fn` bodies are its containers. A root is a test fn cargo runs
 * on the HOST, or on a target the caller names (dodSyntaxRustAttrs.mjs):
 * there a test marker, every
 * attribute on it and on its enclosing inline modules known, every `cfg` true
 * and no `ignore`, and declared in a module, not inside a fn or impl.
 *
 * An item's evidence is its text minus the fns nested in it and minus the
 * CUTS (dodSyntaxRustCut.mjs): closures nothing invokes directly, async
 * blocks nothing awaits directly, and attributed code that target does not
 * compile. An item that starts inside a cut is no target. A reference
 * followed by `(` is a CALL and reaches a fn; any other reference READS and
 * reaches a `const` or `static`; a fn named without being called (stored,
 * passed) reaches nothing. A call to an `async fn` reaches it only when the
 * call is directly `.await`ed: otherwise it builds a future nothing here
 * polls (an executor such as `block_on(f())` is not read). A reference
 * resolves only when it names exactly
 * one item:
 *   - `path::name` — through in-file modules (`crate`, `self`, `super`, a
 *     module name) to that module's own items; a path ending in a type or
 *     trait (`Foo::new`, `Self::make`) to the fns of its `impl`/`trait`
 *     blocks in this file — nothing when there are none, or when a `use` in
 *     scope renames something to that qualifier (an alias this probe cannot
 *     resolve);
 *   - a bare name — nothing when a local binding (`let`, `if let`/`while
 *     let`, `for`, a match arm, a fn or closure parameter) in scope spells it;
 *     else the free items of the innermost enclosing fn/mod that declares it;
 *     else what a `use` in scope imports (a path, `as` rename or glob);
 *   - `.name(…)` — a method call: nothing. Its receiver's type is not known
 *     here, and a mentioned type, a trait impl or every same-named method is
 *     a guess.
 *
 * @coordinates-with scripts/lib/dodSyntaxReach.mjs — rustTestReach walks these items
 * @coordinates-with scripts/lib/dodSyntaxRustAttrs.mjs — which test fns cargo runs
 * @coordinates-with scripts/lib/dodSyntaxRustCut.mjs — the code inside an item that never runs
 * @coordinates-with scripts/lib/rustSource.mjs — the comment/literal lexer
 * @module scripts/lib/dodSyntaxRustReach
 */
import { attributeVerdict, HOST, innerAttributes, onTarget, outerAttributes, TARGETS } from "./dodSyntaxRustAttrs.mjs";
import { closing, closures, itemEnd, nextBlock, rustCuts, subtract, isAsyncFn } from "./dodSyntaxRustCut.mjs";
import { rustCode } from "./rustSource.mjs";

const ID = "[A-Za-z_]\\w*";
const KEYWORDS = new Set(["mut", "ref", "box", "_", "in", "if", "else", "true", "false", "self", "Self", "crate", "super"]);
// A name that follows `fn`/`const`/`mod`/… is the item's own name, not a use of one.
const REF = new RegExp(`(?<!\\b(?:fn|const|static(?:\\s+mut)?|mod|struct|enum|union|trait|type)\\s+)((?<!\\.)\\.(?!\\.)\\s*)?((?:(?:${ID}|>)\\s*::\\s*)*)(${ID})`, "g");

/** The bindings `{ name, at }` a pattern (`(mut a, Some(b))`, `Foo { x, y: z }`) at offset `base` introduces. */
const patternNames = (text, base) => [...text.matchAll(new RegExp(`(?<![\\w:.])(${ID})\\b(?!\\s*(?:[({]|::|:(?!:)))`, "g"))]
  .filter((m) => !KEYWORDS.has(m[1]) && !/^[A-Z]/.test(m[1])).map((m) => ({ name: m[1], at: base + m.index }));

/** The bindings of a comma-separated parameter list at offset `base`: each pattern before its `: Type`. */
const paramNames = (text, base) => [...text.matchAll(/[^,]+/g)].flatMap((m) => patternNames(m[0].split(/:(?!:)/)[0], base + m.index));

/** `list` keyed by each entry's `name`. */
const groupBy = (list) => {
  const map = new Map();
  for (const x of list) map.set(x.name, [...(map.get(x.name) ?? []), x]);
  return map;
};

/** `use a::{b, c::d as e, f::*}` → [{ path, name, alias }]: name `*` for a glob; for a rename, name is the new name and alias the original. */
function useEntries(tree, prefix = []) {
  const t = tree.trim();
  const brace = t.indexOf("{");
  if (brace === -1) {
    const [path, alias] = t.split(/\s+as\s+/);
    const full = [...prefix, ...path.split("::").map((s) => s.trim()).filter(Boolean)];
    return [{ path: full.slice(0, -1), name: alias?.trim() ?? full.at(-1), alias: alias ? full.at(-1) : undefined }];
  }
  const head = t.slice(0, brace).split("::").map((s) => s.trim()).filter(Boolean);
  const inner = t.slice(brace + 1, t.lastIndexOf("}"));
  const parts = [];
  let depth = 0, last = 0;
  for (let i = 0; i <= inner.length; i++) {
    if (inner[i] === "{") depth++;
    else if (inner[i] === "}") depth--;
    else if ((inner[i] === "," && depth === 0) || i === inner.length) { parts.push(inner.slice(last, i)); last = i + 1; }
  }
  return parts.filter((p) => p.trim()).flatMap((p) => useEntries(p, [...prefix, ...head]));
}

/**
 * The test-fn `roots` of `source`, each `{ span, spans, targets }`: `spans`
 * the item's text minus its nested fns and the cuts, `targets()` the items
 * that text calls or reads. `rejected` explains each test fn that is no root;
 * `cuts` lists each cut `{ span, reason, line }`; `unawaited` fills, as
 * `targets()` runs, with each `{ name, line }` async fn call not awaited. Attributes are judged for
 * `target` (default: the host).
 */
export function rustReachRoots(source, target = HOST) {
  const bare = rustCode(source);
  const text = rustCode(source, { keepStrings: true });
  const containers = [];
  const contain = (kind, start, span, extra = {}) => { const c = { kind, start, span, ...extra }; containers.push(c); return c; };
  for (const m of bare.matchAll(new RegExp(`\\bmod\\s+(${ID})\\s*\\{`, "g"))) contain("mod", m.index, [m.index, closing(bare, m.index + m[0].length - 1, "{", "}")], { name: m[1], open: m.index + m[0].length });
  // An `impl`/`trait` ITEM opens a statement; `impl Trait` in a type position does not.
  for (const m of bare.matchAll(/(?:^|[;{}\]])\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(impl|trait)\b/g)) {
    const at = m.index + m[0].length - m[1].length;
    const [open, end] = nextBlock(bare, at);
    let header = bare.slice(at + m[1].length, open).split(/\bwhere\b/)[0];
    while (/<[^<>]*>/.test(header)) header = header.replace(/<[^<>]*>/g, " ");
    const parts = header.split(/\bfor\b/);
    const names = m[1] === "trait"
      ? [header.match(new RegExp(ID))?.[0]]
      : parts.map((p) => p.match(new RegExp(`(${ID})\\s*$`))?.[1]);
    const forType = m[1] === "impl" && parts.length > 1 ? names.at(-1) : undefined;
    contain(m[1], at, [open, end], { names: new Set(names.filter(Boolean)), forType });
  }
  const items = [];
  const item = (name, start, kind) => { const it = { name, kind, span: [start, itemEnd(bare, start)] }; items.push(it); return it; };
  for (const m of bare.matchAll(new RegExp(`\\bfn\\s+(${ID})`, "g"))) {
    const fn = item(m[1], m.index, "fn");
    fn.async = isAsyncFn(bare, m.index);
    contain("fn", m.index, fn.span);
  }
  for (const m of bare.matchAll(new RegExp(`\\b(?:const|static)\\s+(?:mut\\s+)?(${ID})\\s*:`, "g"))) item(m[1], m.index, "const");
  const within = (c, at) => c.span[0] < at && at < c.span[1];
  const parentOf = (at, kinds) => containers.reduce((best, c) => (kinds.includes(c.kind) && c.start !== at && within(c, at) && (!best || c.span[0] > best.span[0]) ? c : best), null);
  const SCOPES = ["mod", "fn", "impl", "trait"];
  for (const it of items) {
    it.parent = parentOf(it.span[0], SCOPES);
    it.associated = it.parent !== null && (it.parent.kind === "impl" || it.parent.kind === "trait");
  }
  const moduleOf = (at) => parentOf(at, ["mod"]);
  const childMod = (mod, name) => containers.find((c) => c.kind === "mod" && c.name === name && moduleOf(c.start) === mod);

  // Local bindings: { name, from, to } — a use at `from < at < to` is the binding; `sites` are where they are written.
  const bindings = [];
  const sites = new Set();
  const bind = (names, from, to) => { for (const { name, at } of names) { bindings.push({ name, from, to }); sites.add(at); } };
  /** Index of the first `close` at bracket depth 0 from `at` (a `}` closing the enclosing block counts), or the end. */
  const depthZero = (at, close) => {
    let depth = 0;
    for (let i = at; i < bare.length; i++) {
      const c = bare[i];
      if (c === "(" || c === "[" || c === "{") depth += 1;
      else if ((c === ")" || c === "]" || c === "}") && --depth < 0) return i;
      else if (depth === 0 && c === close) return i;
    }
    return bare.length;
  };
  // `let p = e;` binds after its `;` to the block's end; `if let`/`while let` and `for` bind in their block.
  for (const m of bare.matchAll(/\b(if\s+|while\s+)?let\b/g)) {
    const eq = m.index + bare.slice(m.index).search(/=(?![=>])|;/);
    const names = patternNames(bare.slice(m.index + m[0].length, eq).split(/:(?!:)/)[0], m.index + m[0].length);
    if (m[1]) bind(names, ...nextBlock(bare, eq));
    else { const end = depthZero(m.index, ";"); bind(names, end, depthZero(end + 1, "}")); }
  }
  for (const m of bare.matchAll(/\bfor\b(?!\s*<)([^{;]*?)\bin\b/g)) bind(patternNames(m[1], m.index + 3), ...nextBlock(bare, m.index + m[0].length));
  for (const c of containers.filter((x) => x.kind === "fn")) {
    const open = bare.indexOf("(", c.start);
    const params = bare.slice(open + 1, closing(bare, open, "(", ")") - 1);
    bind(paramNames(params, open + 1), c.start, c.span[1]);
  }
  for (const c of closures(bare, text)) bind(paramNames(c.params, c.paramsAt), c.start, c.end);
  /** Index of `=>` at bracket depth 0 in [from, end), or -1. */
  const arrowAt = (from, end) => {
    let depth = 0;
    for (let i = from; i < end; i++) {
      const c = bare[i];
      if (c === "(" || c === "[" || c === "{") depth += 1;
      else if ((c === ")" || c === "]" || c === "}") && --depth < 0) return -1;
      else if (depth === 0 && c === "=" && bare[i + 1] === ">") return i;
    }
    return -1;
  };
  // A match arm's pattern binds from the pattern (its guard included) to the arm's end.
  for (const m of bare.matchAll(/\bmatch\b/g)) {
    const [open, end] = nextBlock(bare, m.index + m[0].length);
    for (let at = open + 1, arrow; at < end - 1 && (arrow = arrowAt(at, end - 1)) !== -1; ) {
      const body = arrow + 2 + bare.slice(arrow + 2).search(/\S|$/);
      const armEnd = bare[body] === "{" ? closing(bare, body, "{", "}") : depthZero(arrow + 2, ",");
      bind(patternNames(bare.slice(at, arrow).split(/\bif\b/)[0], at), at, armEnd);
      at = armEnd + (bare.slice(armEnd).match(/^\s*,/)?.[0].length ?? 0);
    }
  }
  const bindingsOf = groupBy(bindings);
  const uses = [...bare.matchAll(/\buse\s+([^;]+);/g)].flatMap((m) => useEntries(m[1]).map((e) => ({ ...e, at: m.index })));

  /** The in-file module a path's segments name from `at`, or undefined when a segment is not one. */
  const modulePath = (segs, at) => {
    let mod = moduleOf(at);
    for (const [i, seg] of segs.entries()) {
      if (seg === "crate") mod = null;
      else if (seg === "self") continue;
      else if (seg === "super") { if (mod === null) return undefined; mod = moduleOf(mod.start); }
      else if (i === 0) {
        let found;
        for (let m = mod; found === undefined; m = moduleOf(m.start)) { found = childMod(m, seg); if (m === null) break; }
        if (!found) return undefined;
        mod = found;
      } else { mod = childMod(mod, seg); if (!mod) return undefined; }
    }
    return mod;
  };
  const fileAttrs = innerAttributes(bare, text, 0);
  const modAttrs = (c) => [...outerAttributes(bare, text, c.start), ...innerAttributes(bare, text, c.open)];
  const cuts = rustCuts(bare, text, target);
  const line = (at) => bare.slice(0, at).split("\n").length;
  // Filled as reach() resolves calls: an async fn called without `.await` built a future nothing polls.
  const unawaited = [];
  const offHost = (attrs) => { const v = attributeVerdict(attrs, target); return v.unknown ?? (v.disabled ? `compiled out on ${onTarget(target)}` : null); };
  const fileOff = offHost(fileAttrs);
  if (fileOff) cuts.push({ span: [0, bare.length], reason: `the file: ${fileOff}` });
  for (const c of containers.filter((x) => x.kind === "mod")) {
    const why = offHost(innerAttributes(bare, text, c.open));
    if (why) cuts.push({ span: c.span, reason: `mod ${c.name}: ${why}` });
  }
  const live = (it) => !cuts.some(({ span: [a, b] }) => a <= it.span[0] && it.span[0] < b);
  const itemsOf = groupBy(items.filter(live));
  const named = (name) => itemsOf.get(name) ?? [];
  const inScope = (u, at) => { const m = parentOf(u.at, ["mod", "fn"]); return m === null || within(m, at); };
  const qualified = (segs, name, at) => {
    const mod = modulePath(segs, at);
    if (mod !== undefined) return named(name).filter((it) => it.parent === mod);
    const q = segs.at(-1);
    if (q !== "Self" && uses.some((u) => u.alias !== undefined && u.name === q && inScope(u, at))) return [];
    const blocks = q === "Self"
      ? containers.filter((c) => (c.kind === "impl" || c.kind === "trait") && within(c, at))
      : containers.filter((c) => c.names?.has(q));
    return named(name).filter((it) => it.associated && blocks.includes(it.parent));
  };
  /** What `use` entry `u` brings in as `name`: an item of an in-file module, or nothing. */
  const imported = (u, name) => {
    const mod = modulePath(u.path, u.at);
    const source = u.name === "*" ? name : (u.alias ?? name);
    return mod === undefined ? [] : named(source).filter((it) => it.parent === mod && !it.associated);
  };
  const bare_ = (name, at) => {
    if ((bindingsOf.get(name) ?? []).some((b) => b.from < at && at < b.to)) return [];
    const free = named(name).filter((it) => !it.associated);
    for (let scope = parentOf(at, ["mod", "fn"]); ; scope = parentOf(scope.start, ["mod", "fn"])) {
      const here = free.filter((it) => it.parent === scope);
      if (here.length > 0) return here;
      if (scope === null) break;
    }
    return uses.filter((u) => inScope(u, at)).flatMap((u) => (u.name === name || u.name === "*" ? imported(u, name) : []));
  };
  /** The one item reference `m` (ending at `at`) calls or reads, or nothing. */
  const resolve = (m, at) => {
    if (m[1] !== undefined || sites.has(at)) return [];
    const segs = m[2].split("::").map((s) => s.trim()).filter(Boolean);
    const call = /^\s*\(/.test(bare.slice(at + m[3].length));
    const found = (segs.length > 0 ? qualified(segs, m[3], at) : bare_(m[3], at)).filter((it) => (it.kind === "fn") === call);
    if (found.length !== 1) return [];
    if (found[0].async && !/^\s*\.\s*await\b/.test(bare.slice(closing(bare, bare.indexOf("(", at + m[3].length), "(", ")")))) {
      unawaited.push({ name: m[3], line: line(at) });
      return [];
    }
    return found;
  };
  for (const it of items) {
    const nested = items.filter((o) => o !== it && o.kind === "fn" && it.span[0] < o.span[0] && o.span[1] <= it.span[1]);
    it.spans = [];
    let from = it.span[0];
    for (const o of nested.sort((a, b) => a.span[0] - b.span[0])) {
      if (o.span[0] < from) continue;
      it.spans.push([from, o.span[0]]);
      from = o.span[1];
    }
    it.spans.push([from, it.span[1]]);
    it.spans = subtract(it.spans, cuts);
    it.targets = () => it.spans.flatMap(([a, b]) =>
      [...bare.slice(a, b).matchAll(REF)].flatMap((m) => resolve(m, a + m.index + m[0].length - m[3].length)));
  }
  const roots = [];
  const rejected = [];
  for (const fn of items.filter((it) => it.kind === "fn")) {
    const own = outerAttributes(bare, text, fn.span[0]);
    if (!attributeVerdict(own, target).test) {
      const elsewhere = TARGETS.filter((t) => t !== target && attributeVerdict(own, t).test).map((t) => t.os);
      if (elsewhere.length > 0) rejected.push({ name: fn.name, reason: `a test only on ${elsewhere.join(", ")}, not on ${onTarget(target)}` });
      continue;
    }
    const lists = [own, fileAttrs, ...containers.filter((c) => c.kind === "mod" && within(c, fn.span[0])).map(modAttrs)];
    const verdicts = lists.map((l) => attributeVerdict(l, target));
    const why = verdicts.find((v) => v.unknown)?.unknown
      ?? (fn.parent !== null && fn.parent.kind !== "mod" ? `declared inside a ${fn.parent.kind}, where cargo runs no test` : null)
      ?? (verdicts.every((v) => !v.disabled && !v.ignored) ? null : `ignored or compiled out on ${onTarget(target)}`);
    if (why) rejected.push({ name: fn.name, reason: why });
    else roots.push(fn);
  }
  return { roots, rejected, cuts: cuts.map((c) => ({ ...c, line: line(c.span[0]) })), unawaited };
}
