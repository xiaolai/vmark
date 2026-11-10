/**
 * Purpose: read `initialState` out of src/stores/settingsStore/defaults.ts as
 *   SOURCE (dotted key → initialiser text) and verify the feature map's
 *   `flagDefault` claims against it.
 *
 * Two consumers need the textual view: the feature ledger, which refuses a
 * spine whose recorded flag default disagrees with the shipped one, and the
 * settings-defaults doc join, which falls back to it when executing defaults.ts
 * fails and uses it to confirm a pinned row's key is still computed the way the
 * page says.
 *
 * @coordinates-with scripts/gen-feature-ledger.mjs — spine validation (verifyFlagDefaults)
 * @coordinates-with scripts/lib/docJoins/settingsDefaults.mjs — the textual fallback and the computed-pin check
 * @coordinates-with src/stores/settingsStore/defaults.ts — the source this reads
 * @module scripts/lib/settingsDefaultsSource
 */
import ts from "typescript";

export const DEFAULTS_REL = "src/stores/settingsStore/defaults.ts";

/**
 * Flatten `export const initialState = { … }` in `source` into dotted keys →
 * the RAW SOURCE TEXT of each leaf initializer (`"smart"`, `30`, `false`,
 * `resolveInitialLanguage()`), at any depth. Read through the TypeScript
 * parser, the way the repo's other gates read TypeScript: the line parser
 * this replaced keyed on two-space indentation, one-line values and three
 * levels of nesting, so a value that wrapped, a `key:{` without its space or
 * a fourth level silently dropped the setting, and the only consumer then
 * reported a spine flag as "not found". A spread
 * contributes no keys (its members live in another file); an object literal
 * is descended, never recorded; a shorthand or method property is not a
 * literal default and is skipped, as before.
 */
export function parseSettingsDefaults(source) {
  const map = new Map();
  const sf = ts.createSourceFile("defaults.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // A source with parse diagnostics is a RECOVERED fragment, not the shipped
  // defaults: TypeScript invents nodes around a syntax error, so the verifier
  // could approve a flag against a partial initializer and report the rest as
  // "not found". The same guard scripts/lib/arrayLiteralEnd.mjs
  // applies for the same reason. Recorded rather than thrown so the caller can
  // REFUSE with a message instead of a stack trace.
  if (sf.parseDiagnostics?.length > 0) {
    map.parseError = ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ");
    return map;
  }
  const decl = sf.statements
    .filter((st) => ts.isVariableStatement(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap((st) => st.declarationList.declarations)
    .find((d) => ts.isIdentifier(d.name) && d.name.text === "initialState");
  let init = decl?.initializer;
  while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) {
    init = init.expression;
  }
  if (!init || !ts.isObjectLiteralExpression(init)) return map;
  // Objects whose contents are COMPOSED, not written out: a spread or a
  // computed key can override a literal that sits right there in the source,
  // and JavaScript keeps the last write. Skipping them silently meant the
  // verifier could approve a default the runtime does not use, so the affected
  // prefixes are recorded and `verifyFlagDefaults` refuses them by name.
  // `initialState.cjkFormatting` is one today.
  map.unverifiable = new Set();
  const walk = (obj, prefix) => {
    const composed = obj.properties.some(
      (p) => ts.isSpreadAssignment(p) || (p.name !== undefined && ts.isComputedPropertyName(p.name)),
    );
    if (composed) map.unverifiable.add(prefix);
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue;
      const key = prefix ? `${prefix}.${prop.name.text}` : prop.name.text;
      if (ts.isObjectLiteralExpression(prop.initializer)) walk(prop.initializer, key);
      else map.set(key, prop.initializer.getText(sf));
    }
  };
  walk(init, "");
  return map;
}

/** Is `flag` inside an object this parser could not read exhaustively? */
function inComposedObject(flag, unverifiable) {
  if (!unverifiable) return false;
  const parts = flag.split(".");
  for (let i = 0; i < parts.length; i++) {
    if (unverifiable.has(parts.slice(0, i).join("."))) return true;
  }
  return false;
}

/**
 * Compare every gated spine entry against the shipped default. Returns one
 * message per disagreement; an empty array means the spine is honest.
 */
export function verifyFlagDefaults(features, defaultsSource) {
  const defaults = parseSettingsDefaults(defaultsSource);
  const findings = [];
  if (defaults.parseError) {
    return [`${DEFAULTS_REL} does not parse (${defaults.parseError}) — a recovered fragment is not the shipped defaults, so no spine flag can be verified`];
  }
  for (const f of features) {
    if (!f.flag) continue;
    if (inComposedObject(f.flag, defaults.unverifiable)) {
      findings.push(`${f.name}: ${f.flag} sits in an object composed with a spread or a computed key in ${DEFAULTS_REL} — its shipped default cannot be read statically, so it cannot be a spine flag`);
      continue;
    }
    const raw = defaults.get(f.flag);
    if (raw === undefined) {
      findings.push(`${f.name}: flag ${f.flag} not found in ${DEFAULTS_REL}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      findings.push(`${f.name}: ${f.flag} is not a literal in ${DEFAULTS_REL} (${raw}) — it cannot be verified, so it cannot be a spine flag`);
      continue;
    }
    if (JSON.stringify(parsed) !== JSON.stringify(f.flagDefault)) {
      findings.push(`${f.name}: ${f.flag} spine=${JSON.stringify(f.flagDefault)} defaults.ts=${raw}`);
    }
  }
  return findings;
}
