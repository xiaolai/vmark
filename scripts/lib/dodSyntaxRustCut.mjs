/**
 * Purpose: the bracket scanning `rustReachRoots` (dodSyntaxRustReach.mjs)
 *   reads Rust items with, and the CUTS — code inside an otherwise reached
 *   item that does not run on the judged target (the host unless a caller
 *   names one) and so is no evidence:
 *   - a closure nothing invokes directly. Only `(|…| …)()` is read as running
 *     it; a closure bound, stored, returned or handed to a call may never run;
 *   - an async block nothing awaits directly. Only `async { … }.await` (or
 *     `(async { … }).await`) is read as polling it;
 *   - an attributed item, statement, field or arm that target does not compile
 *     (a false `cfg`) or whose attributes this probe cannot vouch for
 *     (dodSyntaxRustAttrs.mjs).
 * It also answers whether an `fn` is `async` (`isAsyncFn`), from the tokens
 * before it rather than a character window, for the unawaited-call rule.
 * `bare` is the comment- and literal-blanked text (`rustCode`), `text` the
 * same with literals kept; offsets agree.
 *
 * @coordinates-with scripts/lib/dodSyntaxRustReach.mjs — subtracts these cuts from every item
 * @coordinates-with scripts/lib/dodSyntaxRustAttrs.mjs — the per-target verdict of an attribute group
 * @module scripts/lib/dodSyntaxRustCut
 */
import { attributeVerdict, HOST, onTarget } from "./dodSyntaxRustAttrs.mjs";

/** Index just past the `close` matching the `open` at `at` in `bare`, or the end. */
export function closing(bare, at, open, close) {
  let depth = 0;
  for (let i = at; i < bare.length; i++) {
    if (bare[i] === open) depth += 1;
    else if (bare[i] === close && --depth === 0) return i + 1;
  }
  return bare.length;
}

/** Index just past the item that starts at `at`: its `{ … }` body, or its `;` at bracket depth 0. */
export function itemEnd(bare, at) {
  let depth = 0;
  for (let i = at; i < bare.length; i++) {
    const c = bare[i];
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    else if (depth === 0 && c === ";") return i + 1;
    else if (depth === 0 && c === "{") return closing(bare, i, "{", "}");
  }
  return bare.length;
}

/** The `{ … }` span that starts at the first `{` at or after `from` at bracket depth 0. */
export function nextBlock(bare, from) {
  let depth = 0;
  for (let i = from; i < bare.length; i++) {
    const c = bare[i];
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    else if (depth === 0 && c === "{") return [i, closing(bare, i, "{", "}")];
  }
  return [from, bare.length];
}

/** Index of the first `,` or `;` at bracket depth 0 from `at`, or of the closer that ends the enclosing group. */
function expressionEnd(bare, at) {
  let depth = 0;
  for (let i = at; i < bare.length; i++) {
    const c = bare[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if ((c === ")" || c === "]" || c === "}") && --depth < 0) return i;
    else if (depth === 0 && (c === "," || c === ";")) return i;
  }
  return bare.length;
}

/** The last non-blank character before `at`, with the word it ends. */
function before(text, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  return { char: text[i] ?? "", at: i, word: /\w+$/.exec(text.slice(Math.max(0, i - 15), i + 1))?.[0] ?? "" };
}

/** A `|` where a closure can start: an expression position, not after an operand (`a || b`, `a | b`). */
function opensClosure(text, at) {
  const p = before(text, at);
  if (["move", "async", "return", "break"].includes(p.word)) return true;
  if (p.char === "" || "(,{[;:".includes(p.char)) return true;
  if (p.char === "=") return !"=!<>".includes(text[p.at - 1]);
  return p.char === ">" && text[p.at - 1] === "=";
}

/** Closures in `bare`: `{ start, end, params, paramsAt, invoked }`, `start` at the opening `|`. */
export function closures(bare, text) {
  const out = [];
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] !== "|" || !opensClosure(text, i)) continue;
    const close = bare[i + 1] === "|" ? i + 1 : bare.indexOf("|", i + 1);
    if (close === -1) break;
    const after = close + 1 + bare.slice(close + 1).search(/\S|$/);
    const end = bare.startsWith("->", after) ? nextBlock(bare, after)[1]
      : bare[after] === "{" ? closing(bare, after, "{", "}") : expressionEnd(bare, after);
    const lead = /(?:\basync\s+)?(?:\bmove\s+)?$/.exec(bare.slice(0, i))[0].length;
    const invoked = before(bare, i - lead).char === "(" && /^\s*\)\s*\(/.test(bare.slice(end));
    out.push({ start: i, end, params: bare.slice(i + 1, close), paramsAt: i + 1, invoked });
    i = close;
  }
  return out;
}

/** Async blocks in `bare`: `{ start, end, awaited }`. */
function asyncBlocks(bare) {
  return [...bare.matchAll(/\basync\s+(?:move\s+)?\{/g)].map((m) => {
    const end = closing(bare, m.index + m[0].length - 1, "{", "}");
    const awaited = /^\s*\.\s*await\b/.test(bare.slice(end))
      || (before(bare, m.index).char === "(" && /^\s*\)\s*\.\s*await\b/.test(bare.slice(end)));
    return { start: m.index, end, awaited };
  });
}

/** Index of the `]` closing the `#[` at `at`. */
const attrClose = (bare, at) => closing(bare, at + 1, "[", "]");

/** Outer attribute groups (`#[…]` runs, not `#![…]`): `{ start, end, bodies }`. */
function attributeGroups(bare, text) {
  const groups = [];
  for (const m of bare.matchAll(/#\s*\[/g)) {
    const last = groups.at(-1);
    if (last && m.index < last.end) continue;
    const close = attrClose(bare, m.index + m[0].length - 2);
    const body = text.slice(m.index + m[0].length, close - 1);
    if (last && /^\s*$/.test(bare.slice(last.end, m.index))) {
      last.end = close;
      last.bodies.push(body);
    } else groups.push({ start: m.index, end: close, bodies: [body] });
  }
  return groups;
}

const BLOCK_ITEM = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern(?:\s*"[^"]*")?)\s+)*(?:fn|mod|impl|trait|struct|enum|union)\b/;

/** The `{ span, reason }` cuts of `bare` for `target` (default: the host); see the module header. */
export function rustCuts(bare, text, target = HOST) {
  const cuts = [];
  for (const c of closures(bare, text)) if (!c.invoked) cuts.push({ span: [c.start, c.end], reason: "a closure nothing invokes directly" });
  for (const b of asyncBlocks(bare)) if (!b.awaited) cuts.push({ span: [b.start, b.end], reason: "an async block nothing awaits directly" });
  for (const g of attributeGroups(bare, text)) {
    const v = attributeVerdict(g.bodies, target);
    if (!v.disabled && !v.unknown) continue;
    const end = BLOCK_ITEM.test(bare.slice(g.end)) ? itemEnd(bare, g.end) : expressionEnd(bare, g.end) + 1;
    const reason = v.unknown ?? `code under #[${g.bodies.join("] #[")}], compiled out on ${onTarget(target)}`;
    cuts.push({ span: [g.start, end], reason });
  }
  return cuts;
}

/** `spans` ([start, end) pairs) minus every cut. */
export function subtract(spans, cuts) {
  let out = spans;
  for (const { span: [a, b] } of cuts) {
    out = out.flatMap(([s, e]) => (b <= s || e <= a ? [[s, e]] : [[s, Math.min(a, e)], [Math.max(b, s), e]].filter(([x, y]) => x < y)));
  }
  return out;
}

/**
 * Whether the `fn` keyword at `at` in `bare` (comments and literals blanked
 * to spaces) is qualified `async`: the tokens before it, read backwards, are
 * `[extern] [unsafe] async` — so no comment, however long, hides it.
 */
export function isAsyncFn(bare, at) {
  let i = at;
  const word = () => {
    while (i > 0 && /\s/.test(bare[i - 1])) i--;
    const end = i;
    while (i > 0 && /\w/.test(bare[i - 1])) i--;
    return bare.slice(i, end);
  };
  let w = word();
  if (w === "extern") w = word();
  if (w === "unsafe") w = word();
  return w === "async";
}
