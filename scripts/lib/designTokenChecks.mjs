/**
 * WI-UI0.2 — declaration-integrity checks for the design-token gate
 * (C2b–C2f of dev-docs/plans/20260829-ui-consistency.md).
 *
 * Pure functions over source text; scripts/check-design-tokens.mjs owns the
 * filesystem, the baseline and the exit code.
 *
 * @coordinates-with scripts/check-design-tokens.mjs — the CLI
 * @coordinates-with scripts/lib/cssRules.mjs — the one CSS grammar
 */
import { blankComments, cssRules, lineOf } from "./cssRules.mjs";

/** Keyframe-step selectors (`0%`, `.5%`, `from, to`) — identical across every
 *  @keyframes block, so their identity needs the enclosing animation name. */
const KEYFRAME_STEP_RE = /^(?:from|to|(?:\d+|\d*\.\d+)%)(?:\s*,\s*(?:from|to|(?:\d+|\d*\.\d+)%))*$/;

/** Balanced brace extents of every @keyframes block — nearest-preceding-index
 *  attribution assigns a step-shaped rule AFTER a block to the wrong owner. */
function keyframeRanges(blanked) {
  const ranges = [];
  for (const m of blanked.matchAll(/@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)/g)) {
    const open = blanked.indexOf("{", m.index);
    if (open === -1) continue;
    let depth = 1;
    let i = open + 1;
    while (i < blanked.length && depth > 0) {
      if (blanked[i] === "{") depth += 1;
      else if (blanked[i] === "}") depth -= 1;
      i += 1;
    }
    ranges.push({ name: m[1], start: open, end: i });
  }
  return ranges;
}

/**
 * C2b — rgb()/rgba()/hsl() colour literals, treated like hex.
 *
 * A literal is SKIPPED when the next declaration on the SAME property is a
 * `color-mix(…)` — rule 31's browser-fallback pattern ("rgba() lines that
 * precede color-mix() lines"). Identity is `file:selector:prop:value` — one
 * entry PER DECLARATION, so a baselined selector cannot quietly accumulate
 * new colour literals on other properties (or swap a frozen literal for a
 * different one on the same property) while the gate stays green. Keyframe
 * steps are prefixed with their enclosing @keyframes name (`0%` alone is
 * ambiguous across animations in one file).
 */
export function findColorFnLiterals(css, file) {
  const findings = [];
  const blanked = blankComments(css);
  const ranges = keyframeRanges(blanked);
  const idCounts = new Map();
  for (const rule of cssRules(css)) {
    let selectorId = rule.selector;
    if (KEYFRAME_STEP_RE.test(selectorId)) {
      const owner = ranges.find((r) => rule.index > r.start && rule.index < r.end);
      if (owner) selectorId = `@keyframes ${owner.name} ${selectorId}`;
    }
    const decls = [...rule.body.matchAll(/([-a-zA-Z]+)\s*:\s*([^;}]+)/g)].map((m) => ({
      prop: m[1],
      value: m[2],
    }));
    for (let i = 0; i < decls.length; i++) {
      const { prop, value } = decls[i];
      if (!/\b(?:rgb|rgba|hsl|hsla)\(/.test(value)) continue;
      if (/color-mix\(/.test(value)) continue; // the literal IS inside a color-mix — token math
      const next = decls[i + 1];
      if (next && next.prop === prop && /color-mix\(/.test(next.value)) continue; // sanctioned fallback
      // A duplicate identity (the same declaration repeated — two identical
      // rules, or one prop declared twice with the same literal) gets an
      // occurrence ordinal, or set-comparison in the caller collapses them
      // and additions/removals of duplicates stay invisible.
      const base = `${file}:${selectorId}:${prop}:${value.trim().replace(/\s+/g, " ")}`;
      const n = (idCounts.get(base) ?? 0) + 1;
      idCounts.set(base, n);
      findings.push({
        id: n === 1 ? base : `${base}#${n}`,
        file,
        selector: rule.selector,
        line: rule.line,
      });
    }
  }
  return findings;
}

/**
 * C2c — a custom property declared twice inside ONE `:root`/`.dark-theme`
 * block. The same name in `:root` AND `.dark-theme` is the theme mechanism and
 * allowed; twice in one block means one of them silently wins.
 */
export function findDuplicateDeclarations(css, file) {
  const findings = [];
  for (const rule of cssRules(css)) {
    // Exactly `:root` / `.dark-theme` — the token blocks. Descendant rules
    // (`.dark-theme .cm-alert`) re-declare a local custom property as the
    // rgba-then-color-mix progressive-enhancement pair, which rule 31
    // sanctions; the same pair inside a token block is allowed too.
    // The selector capture may carry non-rule preamble (`@import …;`,
    // `@custom-variant …;`) — statements CSS_RULE_RE cannot distinguish from
    // selectors. The rule's actual selector is what follows the last `;`.
    const selector = rule.selector.split(";").pop().trim();
    if (!selector.split(",").some((s) => /^(:root|\.dark-theme)$/.test(s.trim()))) continue;
    const seen = new Map(); // name -> value of last declaration
    for (const m of rule.body.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)/g)) {
      const name = m[1];
      const value = m[2];
      if (seen.has(name)) {
        if (/color-mix\(/.test(value)) {
          seen.set(name, value); // progressive enhancement over the previous line
          continue;
        }
        findings.push({
          file,
          name,
          selector: rule.selector,
          message: `${name} declared twice in one ${rule.selector.split(" ")[0]} block (${file}) — one silently wins.`,
        });
      } else {
        seen.set(name, value);
      }
    }
  }
  return findings;
}

/** All `@keyframes <name>` declared in a stylesheet. */
export function collectKeyframes(css) {
  const names = new Set();
  for (const m of blankComments(css).matchAll(/@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)/g)) {
    names.add(m[1]);
  }
  return names;
}

const ANIMATION_KEYWORDS = new Set([
  "linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end",
  "infinite", "normal", "reverse", "alternate", "alternate-reverse",
  "forwards", "backwards", "both", "none", "running", "paused", "initial", "inherit", "unset",
]);

/**
 * C2d — animation names referenced by `animation:`/`animation-name:` with no
 * `@keyframes` anywhere in the given set. An undeclared name silently renders
 * nothing — the popup that never faded in.
 */
export function findMissingKeyframes(css, file, declaredKeyframes) {
  const findings = [];
  const blanked = blankComments(css);
  for (const m of blanked.matchAll(/(?:^|[;{])\s*(?:-webkit-)?animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    for (const token of m[1].split(/[\s,]+/)) {
      if (!/^[A-Za-z_][\w-]*$/.test(token)) continue; // durations, cubic-bezier(...), var(...)
      if (ANIMATION_KEYWORDS.has(token)) continue;
      if (/^(?:steps|cubic-bezier|var)$/.test(token)) continue;
      if (declaredKeyframes.has(token)) continue;
      findings.push({
        file,
        name: token,
        line: lineOf(css, m.index),
        message: `animation-name "${token}" has no @keyframes anywhere in src (${file}) — the animation silently renders nothing.`,
      });
    }
  }
  return findings;
}

/**
 * C2e — `var(--x, fallback)` where `--x` is defined NOWHERE: the "defensive"
 * fallback is the only value the app has ever rendered (the Google-blue drop
 * zone). No-fallback undefined vars are the existing check; this closes the
 * fallback half.
 */
export function findUndefinedVarFallbacks(css, file, definedVars) {
  const findings = [];
  const blanked = blankComments(css);
  for (const m of blanked.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*,/g)) {
    const name = m[1];
    if (definedVars.has(name)) continue;
    findings.push({
      file,
      name,
      line: lineOf(css, m.index),
      message: `var(${name}, …) — ${name} is defined nowhere, so the fallback is the ONLY value ever rendered. Define the token or inline the intended token expression. (${file})`,
    });
  }
  return findings;
}

/**
 * Rule-31 documented tokens: every backticked `--token` inside the first TWO
 * columns of a markdown table row. Two columns, not one, because the
 * primitive-scales table keys on a family NAME and lists its tokens in the
 * second column — a first-column-only read misses that whole table (the exact
 * miss the audit's skeptic reported). Not prose: rule 31's Rules list names
 * tokens that must NOT exist (`--bg-hover`, "those don't exist"). Wildcards
 * (`--radius-*`) surface as a trailing dash and are filtered by the caller.
 */
export function docTokensFromRule31(md) {
  const tokens = new Set();
  for (const line of md.split("\n")) {
    const m = /^\|([^|]*)\|([^|]*)(?:\||$)/.exec(line.trim());
    if (!m) continue;
    for (const cell of [m[1], m[2]]) {
      for (const t of cell.matchAll(/`(--[A-Za-z0-9-]+)`/g)) tokens.add(t[1]);
    }
  }
  return tokens;
}

/**
 * C2f — two-way parity between rule 31 and the declarations, plus the
 * zero-consumer check.
 *
 *   documented but declared nowhere (CSS or JS-emitted) → finding
 *   declared in index.css but no rule-31 row             → finding, unless the
 *     declaration line carries `token-doc-ok: <reason>`
 *   declared in index.css with zero consumers            → finding, unless
 *     `token-unused-ok: <reason>`
 *
 * A marker with no reason is refused — same rule as `focus: caret-only`.
 */
export function rule31Parity({ indexCss, ruleMd, declaredVars, consumedVars }) {
  const findings = [];
  const documented = docTokensFromRule31(ruleMd);

  for (const token of documented) {
    if (token.endsWith("-")) continue; // wildcard families like `--icon-size-` never appear whole
    if (!declaredVars.has(token)) {
      findings.push(`${token} has a rule-31 table row but is declared nowhere (CSS or JS-emitted) — declare it or delete the row.`);
    }
  }

  const markers = new Map(); // token -> {kind, reasoned}
  const lines = indexCss.split("\n");
  const indexDeclared = [];
  let inThemeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    // Declarations inside `@theme` are TAILWIND theme keys (the WI-UI2.2
    // bridge), not VMark tokens — rule 31 does not document them and nothing
    // consumes them via var() (utilities inline the values).
    if (/^@theme\b/.test(lines[i])) inThemeBlock = true;
    else if (inThemeBlock && /^\}/.test(lines[i])) { inThemeBlock = false; continue; }
    if (inThemeBlock) continue;
    const decl = /^\s*(--[A-Za-z0-9-]+)\s*:/.exec(lines[i]);
    if (!decl) continue;
    indexDeclared.push(decl[1]);
    const context = `${lines[i]} ${lines[i - 1] ?? ""}`;
    for (const kind of ["token-doc-ok", "token-unused-ok"]) {
      const mk = new RegExp(`${kind}:\\s*(\\S[^*]*)`).exec(context);
      if (mk) {
        const prev = markers.get(decl[1]) ?? {};
        prev[kind] = mk[1].trim().replace(/[—–\-\s]+$/, "").length > 0;
        markers.set(decl[1], prev);
      } else if (new RegExp(kind).test(context)) {
        findings.push(`${decl[1]}: ${kind} marker has no reason — state why, or delete the marker.`);
      }
    }
  }

  const reported = new Set();
  for (const token of indexDeclared) {
    if (reported.has(token)) continue; // declared in both :root and .dark-theme
    reported.add(token);
    if (!documented.has(token)) {
      if (markers.get(token)?.["token-doc-ok"]) continue;
      findings.push(`${token} is declared in index.css but has no rule-31 table row — add one, or mark the declaration /* token-doc-ok: <reason> */.`);
    }
    if (!consumedVars.has(token)) {
      if (markers.get(token)?.["token-unused-ok"]) continue;
      findings.push(`${token} is declared in index.css but has no consumer anywhere in src — delete it, or mark the declaration /* token-unused-ok: <reason> */.`);
    }
  }
  return findings;
}
