/**
 * Purpose: the Rust probes behind `scripts/dod-syntax.mjs` — whether a module
 *   ACTIVELY includes a test file through `#[path]`, and whether a file's CODE
 *   (comments always, literals optionally, blanked) matches a pattern.
 *
 * Rust has no parser in this toolchain, so these run over
 * scripts/lib/rustSource.mjs's blanked source: what a regex sees there is code.
 *
 * @coordinates-with scripts/dod-syntax.mjs — the CLI these answer for
 * @coordinates-with scripts/lib/rustSource.mjs — the Rust comment/literal lexer
 * @module scripts/lib/dodSyntaxRust
 */
import { rustCode } from "./rustSource.mjs";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Top-level comma-separated arguments of `s` (no surrounding parentheses). */
function cfgArgs(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  if (s.slice(start) !== "") out.push(s.slice(start));
  return out;
}

/** A predicate decided by the build target alone: `unix`, `windows`, `target_*` = "…", and `not`/`any`/`all` of those. */
function platformOnly(p) {
  if (/^(unix|windows)$/.test(p) || /^target_(os|family|arch|env|pointer_width|endian|vendor)="[^"]*"$/.test(p)) return true;
  const m = /^(not|any|all)\((.*)\)$/.exec(p);
  if (!m) return false;
  const args = cfgArgs(m[2]);
  if (m[1] === "not") return args.length === 1 && platformOnly(args[0]);
  return args.length > 0 && args.every(platformOnly);
}

/**
 * Is a cfg predicate (whitespace removed) true in a `cargo test` build on SOME
 * target, with no feature switched on? `test`, a platform predicate, and
 * `all`/`any` over those are; `not` only of a platform predicate. Anything
 * else — `any()` (the canonical "disable this"), a feature, `not(test)` —
 * depends on something this probe cannot see.
 */
function liveInSomeTestBuild(p) {
  if (p === "test" || platformOnly(p)) return true;
  const m = /^(any|all)\((.*)\)$/.exec(p);
  if (!m) return false;
  const args = cfgArgs(m[2]);
  return m[1] === "all" ? args.every(liveInSomeTestBuild) : args.some(liveInSomeTestBuild);
}

/**
 * A `cfg` gate this probe cannot evaluate. `cargo test` sets `cfg(test)`, and
 * a test module needs to compile in no other build; a PLATFORM predicate
 * beside it (`cfg(all(test, unix))`, `cfg(all(test, not(target_os =
 * "windows")))`) is decided by the target alone, so the include is compiled by
 * `cargo test` on that target — the crate gates its `tauri::test` items off
 * Windows exactly this way. Anything else — `cfg(any())`, a feature,
 * `cfg_attr` — makes the include CONDITIONAL on something this probe cannot
 * see, and a conditional include is not a discovered test.
 */
function unevaluatableCfg(attrRun) {
  for (const m of attrRun.matchAll(/#\[([^\]]*)\]/g)) {
    const body = m[1].replace(/\s+/g, "");
    if (!/^cfg(_attr)?\b/.test(body)) continue;
    const inner = /^cfg\((.*)\)$/.exec(body);
    if (!inner || !liveInSomeTestBuild(inner[1])) return true;
  }
  return false;
}

/** The contiguous attribute run immediately before `index` — in Rust, attributes attached to the same item. */
const attrRunBefore = (code, index) => /(?:#\[[^\]]*\]\s*)*$/.exec(code.slice(0, index))[0];

/**
 * Does `moduleSource` include the test file `base` the way cargo compiles it:
 * an ACTIVE `#[path = "<base>"]` attribute, followed — other attributes only —
 * by the `mod x;` it decorates, with no `cfg` gate on the item this probe
 * cannot evaluate? The same grammar headerReferences.mjs reads for `@module`.
 * A commented-out attribute, or one with anything but another attribute
 * between it and a `mod`, includes nothing.
 *
 * The attribute must also be CODE. `keepStrings` is required here — the path
 * IS a string literal — which leaves a whole `#[path = "x.test.rs"] mod t;`
 * quoted inside a RAW string intact, and it matched (the
 * ordinary-string case only failed because `\"` breaks the regex, which is
 * luck, not a check). The fully-blanked source tells the two apart: a `#` that
 * survives literal blanking is code, one that does not was inside a literal.
 */
export function rustModIncludes(moduleSource, base) {
  const code = rustCode(moduleSource, { keepStrings: true });
  const bare = rustCode(moduleSource);
  const re = new RegExp(
    String.raw`#\[\s*path\s*=\s*"${escapeRe(base)}"\s*\]\s*((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_]\w*\s*;`,
    "g",
  );
  for (const m of code.matchAll(re)) {
    if (bare[m.index] !== "#") continue;
    if (unevaluatableCfg(attrRunBefore(code, m.index)) || unevaluatableCfg(m[1])) continue;
    return true;
  }
  return false;
}

/**
 * `re` without its STATEFUL flags (`g`, `y`).
 *
 * `RegExp.prototype.test` on a global or sticky regex advances `lastIndex` and
 * resumes from it on the next call, so ONE regex reused across a list of files
 * gives an answer that depends on where the previous file happened to match:
 * file 2 is tested from an offset file 1 left behind, and a real match is
 * missed. That is a silent FALSE NEGATIVE in a probe whose whole job is to
 * report a match, and both `rustCodeMatches` and the `ts-code-grep` filter did
 * it. Cloning is preferred to resetting `lastIndex` because the
 * caller's regex is not this function's to mutate.
 */
export function statelessRe(re) {
  const flags = re.flags.replace(/[gy]/g, "");
  return flags === re.flags ? re : new RegExp(re.source, flags);
}

/**
 * Does the CODE of `source` match `re`? Comments are always blanked; string
 * literals are blanked too unless `keepStrings`, which a probe whose SUBJECT
 * is a literal needs (`accel("save", …)`, `var("DBUS_SESSION_BUS_ADDRESS")`).
 */
export function rustCodeMatches(source, re, { keepStrings = false } = {}) {
  return statelessRe(re).test(rustCode(source, { keepStrings }));
}
