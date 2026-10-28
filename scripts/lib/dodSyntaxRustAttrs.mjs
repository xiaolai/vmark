/**
 * Purpose: whether cargo RUNS a Rust test fn on the HOST — the one target the
 *   phase gate's `cargo test` (scripts/lib/al-gate.sh) executes — read from
 *   the attributes on it, on the inline modules around it and at the top of
 *   the file; and whether an attributed item or statement is compiled on the
 *   host at all. The root filter behind `rustTestReach` (dodSyntaxReach.mjs).
 *
 * A closed attribute list: the test markers `test` and `tokio::test`;
 * `ignore`, which makes the fn no root; `cfg(…)`, which must evaluate true;
 * `cfg_attr(p, …)`, whose attributes apply when `p` is true; and the inert
 * `allow`, `warn`, `deny`, `forbid`, `expect`, `doc`, `must_use`, `inline`,
 * `path`, `should_panic`, `track_caller` and `rustfmt::skip`. Any other
 * attribute (a macro that could rewrite or drop the item) makes the verdict
 * unknown, and an unknown verdict is no root and no evidence.
 *
 * `cfg` predicates are evaluated for ONE target, in a test build: `test` and
 * `debug_assertions` are true, `unix`/`windows`, `target_os = "…"` and
 * `target_family = "…"` follow the target, and `any`/`all`/`not` combine
 * them. Any other predicate (a `feature`, a custom cfg) is unknown. Every
 * verdict is the HOST's by default: a test compiled only for another OS is
 * not executed by the gate that reads this, so it is no evidence there — the
 * test marker and the `cfg`s that compile the fn must both hold on the host.
 * A caller that asks for one of `TARGETS` by name (`targetNamed`) gets that
 * target's verdict instead; al-gate.sh does so only for a witness it reports
 * as compiled for that target and NOT executed by the gate.
 *
 * @coordinates-with scripts/lib/dodSyntaxRustReach.mjs — the roots this filters
 * @coordinates-with scripts/lib/al-gate.sh — the host `cargo test` the verdict mirrors
 * @coordinates-with .github/workflows/ci.yml — the `rust` job's OS matrix `TARGETS` mirrors
 * @module scripts/lib/dodSyntaxRustAttrs
 */

/** The targets `cargo test` runs on in the required CI `rust` job — named in notes only. */
export const TARGETS = [
  { os: "macos", family: "unix" },
  { os: "linux", family: "unix" },
  { os: "windows", family: "windows" },
];
const HOST_OS = { darwin: "macos", win32: "windows" }[process.platform] ?? process.platform;
/** The target this process — and the gate's `cargo test` beside it — runs on. */
export const HOST = TARGETS.find((t) => t.os === HOST_OS) ?? { os: HOST_OS, family: process.platform === "win32" ? "windows" : "unix" };
/** The target named `os`, or undefined for a name not in `TARGETS`. */
export const targetNamed = (os) => TARGETS.find((t) => t.os === os);
/** How a note names `target`: the host, or a target named by the caller. */
export const onTarget = (target) => (target === HOST ? `this host (${HOST.os})` : `the named target (${target.os})`);
const TEST_MARKERS = new Set(["test", "tokio::test"]);
const INERT = new Set(["allow", "warn", "deny", "forbid", "expect", "doc", "must_use", "inline", "path", "should_panic", "track_caller", "rustfmt::skip"]);

/** Split `text` at depth-0 commas. */
function topLevel(text) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (i === text.length || (c === "," && depth === 0)) {
      parts.push(text.slice(last, i).trim());
      last = i + 1;
    }
  }
  return parts.filter(Boolean);
}

/** A cfg predicate's value on `target`: true, false, or undefined when unknown. */
function cfgValue(pred, target) {
  const p = pred.trim();
  const call = /^(any|all|not)\s*\(([\s\S]*)\)$/.exec(p);
  if (call) {
    const values = topLevel(call[2]).map((x) => cfgValue(x, target));
    if (call[1] === "not") return values.length === 1 && values[0] !== undefined ? !values[0] : undefined;
    const want = call[1] === "any";
    if (values.includes(want)) return want;
    return values.includes(undefined) ? undefined : !want;
  }
  const pair = /^(\w+)\s*=\s*"([^"]*)"$/.exec(p);
  if (pair) {
    if (pair[1] === "target_os") return pair[2] === target.os;
    if (pair[1] === "target_family") return pair[2] === target.family;
    return undefined;
  }
  if (p === "test" || p === "debug_assertions") return true;
  if (p === "unix" || p === "windows") return p === target.family;
  return undefined;
}

/**
 * The verdict on `target` of a list of attribute bodies (the text inside
 * `#[…]`): `{ test, ignored, disabled, unknown }` — `disabled` when a `cfg`
 * is false there, `unknown` naming the first attribute or predicate this
 * probe cannot vouch for.
 */
export function attributeVerdict(bodies, target) {
  const verdict = { test: false, ignored: false, disabled: false, unknown: null };
  const visit = (body) => {
    const m = /^\s*([A-Za-z_]\w*(?:\s*::\s*[A-Za-z_]\w*)*)\s*([\s\S]*)$/.exec(body);
    const name = m ? m[1].replace(/\s+/g, "") : body.trim();
    const args = m ? /^\(([\s\S]*)\)$/.exec(m[2].trim())?.[1] : undefined;
    if (TEST_MARKERS.has(name)) verdict.test = true;
    else if (name === "ignore") verdict.ignored = true;
    else if (name === "cfg" && args !== undefined) {
      const v = cfgValue(args, target);
      if (v === undefined) verdict.unknown ??= `#[cfg(${args.trim()})] is not a predicate this probe evaluates`;
      else if (!v) verdict.disabled = true;
    } else if (name === "cfg_attr" && args !== undefined) {
      const [pred, ...attrs] = topLevel(args);
      const v = cfgValue(pred ?? "", target);
      if (v === undefined) verdict.unknown ??= `#[cfg_attr(${pred}, …)] is not a predicate this probe evaluates`;
      else if (v) attrs.forEach(visit);
    } else if (!INERT.has(name)) verdict.unknown ??= `#[${name}] is not an attribute this probe knows`;
  };
  bodies.forEach(visit);
  return verdict;
}

/** Index of the `[` matching the `]` at `close` in `bare`, scanning back, or -1. */
function openingBracket(bare, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (bare[i] === "]") depth++;
    else if (bare[i] === "[" && --depth === 0) return i;
  }
  return -1;
}

const QUALIFIER = /(?:\bpub(?:\s*\([^()]*\))?|\basync|\bunsafe|\bconst|\bextern(?:\s*"[^"]*")?)$/;

/**
 * The outer attribute bodies written before the item keyword at `at`, past
 * its qualifiers (`pub`, `async`, …). `bare` has comments and literals
 * blanked; `text` keeps the literals (a `target_os` value), same offsets.
 */
export function outerAttributes(bare, text, at) {
  const out = [];
  let i = at;
  for (;;) {
    while (i > 0 && /\s/.test(bare[i - 1])) i--;
    const q = QUALIFIER.exec(bare.slice(Math.max(0, i - 40), i));
    if (q && !/\w/.test(bare[i - q[0].length - 1] ?? "")) {
      i -= q[0].length;
      continue;
    }
    if (bare[i - 1] !== "]") break;
    const open = openingBracket(bare, i - 1);
    if (open < 1 || bare[open - 1] !== "#") break;
    out.unshift(text.slice(open + 1, i - 1));
    i = open - 1;
  }
  return out;
}

/** The inner attribute bodies (`#![…]`) at `from`, the start of a file or just inside a module's `{`. */
export function innerAttributes(bare, text, from) {
  const out = [];
  for (let i = from; ; ) {
    while (i < bare.length && /\s/.test(bare[i])) i++;
    if (!bare.startsWith("#!", i)) return out;
    const open = bare.indexOf("[", i);
    let depth = 0;
    let close = open;
    for (; close < bare.length; close++) {
      if (bare[close] === "[") depth++;
      else if (bare[close] === "]" && --depth === 0) break;
    }
    out.push(text.slice(open + 1, close));
    i = close + 1;
  }
}
