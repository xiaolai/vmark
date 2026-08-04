#!/usr/bin/env node
/**
 * Plugin→host coupling ratchet — FOUR channels (WI-11).
 *
 * A plugin that imports `@/stores/…` reaches into the app's Zustand singletons.
 * That is the property which makes it unshippable as a standalone/third-party
 * extension — you cannot hand someone a plugin that mutates your global state.
 * It is therefore the binding constraint on ADR-015's goal, not cross-plugin
 * imports.
 *
 * Why this gate exists: the 2026-07-25 goal audit
 * (`dev-docs/deep-researches/20260725-extension-goal-progress-audit.md`)
 * measured the whole extension re-architecture as a delta and found
 *
 *   cross-plugin imports  339 → 264  (−22%, and `plugin-isolation` gates it)
 *   plugin files → stores  97 →  98  (+1,  and NOTHING gated it)
 *
 * across 192 commits whose stated purpose was decoupling. The axis that
 * improved is the one dependency-cruiser could already see. This makes the
 * other axis visible.
 *
 * Why FOUR channels and not just `@/stores`: that count reached zero, but the
 * app's services are themselves store-coupled (`resolveMediaSrc` →
 * documentStore + tabStore; `unifiedHistory` → five stores). A plugin that
 * imports `@/services` is transitively coupled and equally un-liftable, and the
 * single-channel gate could not see it. `@/services`, `@/hooks` and
 * `@/components` are measured beside `@/stores`.
 *
 * Why per unit AND per channel: a bare count lets a fixed plugin pay for a
 * newly-coupled one — net zero passes while the ecosystem gets no closer to
 * extractable. Freezing per (unit, channel) (the pattern of
 * `scripts/file-size-baseline.json`) fails on BOTH halves of that swap,
 * including a swap that trades one channel for another inside one plugin.
 *
 * Detection is a real TS parse (AST module specifiers), never a grep, in EVERY
 * channel including the legacy `@/stores` one: a literal in a comment or a
 * string is prose. Type-only imports DO count — a plugin depending on the app's
 * type module cannot be lifted out either. Relative specifiers that resolve
 * into `src/stores/` &co. count the same as their `@/` spelling.
 *
 * The baseline ratchets DOWN only, and refuses to go stale: improving a plugin
 * fails the gate until the win is locked into the baseline file. Never raise a
 * number — decouple the file instead (move host reads to the call site, pass
 * state in as a parameter, or declare a seam under `plugins/shared/`).
 *
 * Usage:
 *   node scripts/check-plugin-store-coupling.mjs [--root <dir>] [--baseline <file>]
 *   node scripts/check-plugin-store-coupling.mjs --write-baseline   (freeze reality)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

/** The four ways a plugin reaches the app, in report order. */
export const CHANNELS = ["stores", "services", "hooks", "components"];
const CHANNEL_SET = new Set(CHANNELS);

const SOURCE_EXT = /\.tsx?$/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;

/**
 * Compare measured coupling against the frozen baseline.
 *
 * Pure, so it is unit-testable without a filesystem. Both inputs map a UNIT
 * (plugin directory name, or a bare filename for loose files directly under
 * `src/plugins/`) to a per-channel count of non-test files that reach that
 * channel.
 *
 * A (unit, channel) pair is a violation when it is new, grew, shrank, or
 * disappeared — the last two because an unlocked win silently becomes headroom
 * for the next regression.
 *
 * @returns violations sorted by unit then channel, so CI output is stable.
 */
export function findCouplingViolations(actual, baseline) {
  const units = new Set([...Object.keys(actual), ...Object.keys(baseline)]);
  const violations = [];

  for (const unit of [...units].sort()) {
    const now = actual[unit] ?? {};
    const was = baseline[unit] ?? {};
    const channels = new Set([...Object.keys(now), ...Object.keys(was)]);

    for (const channel of [...channels].sort()) {
      const a = now[channel] ?? 0;
      const b = was[channel] ?? 0;
      if (a === b) continue;

      let kind;
      if (b === 0) kind = "new";
      else if (a === 0) kind = "fixed";
      else if (a > b) kind = "grew";
      else kind = "stale";

      violations.push({ unit, channel, kind, actual: a, baseline: b });
    }
  }

  return violations;
}

/** Recursively collect non-test `.ts`/`.tsx` files under `dir`. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "__mocks__" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXT.test(entry) && !TEST_FILE.test(entry)) out.push(full);
  }
  return out;
}

function scriptKindFor(rel) {
  return rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Every module specifier a file imports from — static, type-only, dynamic
 * `import()`, re-export, and the `import("…")` type node.
 *
 * A real AST walk: a specifier in a comment or a plain string is not a module
 * specifier, so "parse, don't grep" holds by construction. That removes the
 * documented false positive where prose ABOUT the coupling counted AS coupling
 * (`.claude/rules/00-engineering-principles.md`).
 */
export function extractImportSpecifiers(text, rel) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, scriptKindFor(rel));
  const specs = [];
  const push = (node) => {
    if (node && ts.isStringLiteralLike(node)) specs.push(node.text);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) push(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      push(node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      push(node.arguments[0]);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      push(node.moduleReference.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

/**
 * Which channel a specifier reaches, or null.
 *
 * `fileRel` is the importing file's repo-relative path, needed because a
 * relative specifier climbing out of the plugin (`../../stores/tabStore`) is
 * the same coupling as `@/stores/tabStore` wearing a disguise.
 */
export function channelOf(spec, fileRel) {
  let resolved;
  if (spec.startsWith("@/")) resolved = path.posix.join("src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fileRel), spec));
  } else return null;

  const segments = resolved.split("/");
  if (segments[0] !== "src" || segments.length < 2) return null;
  return CHANNEL_SET.has(segments[1]) ? segments[1] : null;
}

/**
 * Measure current coupling.
 *
 * @returns `{ unit: { channel: [repo-relative file, …] } }` for units with at
 *   least one coupled file. Units and channels at zero are omitted, so a fully
 *   decoupled plugin drops out of the map and surfaces as a `fixed` violation
 *   against the baseline.
 */
export function scanCoupling(repoRoot) {
  const pluginsRoot = path.join(repoRoot, "src", "plugins");
  const found = {};
  if (!existsSync(pluginsRoot)) return found;

  for (const entry of readdirSync(pluginsRoot)) {
    const full = path.join(pluginsRoot, entry);
    const isDir = statSync(full).isDirectory();
    if (isDir ? entry === "__tests__" || entry === "__mocks__" : !SOURCE_EXT.test(entry) || TEST_FILE.test(entry)) {
      continue;
    }

    for (const file of isDir ? sourceFiles(full) : [full]) {
      const rel = path.relative(repoRoot, file).split(path.sep).join("/");
      const channels = new Set();
      for (const spec of extractImportSpecifiers(readFileSync(file, "utf8"), rel)) {
        const channel = channelOf(spec, rel);
        if (channel) channels.add(channel);
      }
      for (const channel of channels) {
        ((found[entry] ??= {})[channel] ??= []).push(rel);
      }
    }
  }

  return found;
}

/** Collapse the scan's file lists into the per-channel counts the baseline freezes. */
export function countsOf(scan) {
  const counts = {};
  for (const unit of Object.keys(scan).sort()) {
    counts[unit] = {};
    for (const channel of CHANNELS) {
      if (scan[unit][channel]?.length) counts[unit][channel] = scan[unit][channel].length;
    }
  }
  return counts;
}

/** Fail loudly on malformed baseline data — a half-read baseline must never
 *  read as "nothing frozen" (fail closed). */
export function validateBaseline(raw, label) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label}: expected a JSON object with a "units" object`);
  }
  const units = raw.units;
  if (typeof units !== "object" || units === null || Array.isArray(units)) {
    throw new Error(`${label}: "units" must be an object of { unit: { channel: count } }`);
  }
  for (const [unit, channels] of Object.entries(units)) {
    if (typeof channels !== "object" || channels === null || Array.isArray(channels)) {
      throw new Error(`${label}: unit "${unit}" must map channels to counts`);
    }
    for (const [channel, count] of Object.entries(channels)) {
      if (!CHANNEL_SET.has(channel)) {
        throw new Error(`${label}: unknown channel "${channel}" on unit "${unit}"`);
      }
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`${label}: ${unit}/${channel} count must be a non-negative integer`);
      }
    }
  }
  return units;
}

// ─── CLI shell ───

const EXPLAIN = {
  new: "is NEW to the baseline — a plugin was born coupled to the app",
  grew: "gained coupling",
  stale: "improved; lock the win in",
  fixed: "is fully decoupled on this channel; remove it from the baseline",
};

const BASELINE_HEADER = [
  "Frozen plugin->host coupling, per plugin unit and per channel (@/stores, @/services, @/hooks, @/components).",
  "A plugin importing any of them cannot ship as a standalone extension - the app's services are themselves store-coupled, so @/services is transitive @/stores. See scripts/check-plugin-store-coupling.mjs and dev-docs/deep-researches/20260725-extension-goal-progress-audit.md.",
  "Checked by pnpm lint:store-coupling (in check:all). Two-way ratchet: a count above baseline fails, and a count below baseline also fails until the win is recorded here.",
  "Ratchets DOWN only: never raise a number. Decouple the file instead - read host state at the call site, pass it in as a parameter, or declare a seam under plugins/shared/.",
];

function parseArgs(argv) {
  const args = { root: null, baseline: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--baseline") args.baseline = argv[++i];
    else if (argv[i] === "--write-baseline") args.write = true;
    else {
      console.error(`❌ Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(
    args.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const baselinePath = path.resolve(
    args.baseline ?? path.join(root, "scripts", "plugin-store-coupling-baseline.json"),
  );

  const scan = scanCoupling(root);
  const actual = countsOf(scan);

  if (args.write) {
    writeFileSync(
      baselinePath,
      JSON.stringify({ "//": BASELINE_HEADER, units: actual }, null, 2) + "\n",
    );
    console.log(`✍️  Froze ${Object.keys(actual).length} coupled unit(s) into ${baselinePath}`);
    return;
  }

  let baseline;
  try {
    baseline = validateBaseline(JSON.parse(readFileSync(baselinePath, "utf8")), baselinePath);
  } catch (error) {
    console.error(`❌ Cannot read coupling baseline (${baselinePath}): ${error.message}`);
    console.error("   The gate fails closed — fix the baseline, never delete it to pass.");
    process.exit(1);
  }

  const violations = findCouplingViolations(actual, baseline);
  const total = Object.values(actual).reduce(
    (sum, channels) => sum + Object.values(channels).reduce((a, b) => a + b, 0),
    0,
  );

  if (violations.length === 0) {
    console.log(
      `✅ Plugin→host coupling held (${total} coupled file-channel pair(s) across ${Object.keys(actual).length} plugins).`,
    );
    return;
  }

  console.error(`\n❌ Plugin→host coupling changed in ${violations.length} unit/channel pair(s):\n`);
  for (const v of violations) {
    console.error(
      `   ${v.unit} @/${v.channel} — ${EXPLAIN[v.kind]} (baseline ${v.baseline}, now ${v.actual})`,
    );
    if (v.kind === "new" || v.kind === "grew") {
      for (const file of scan[v.unit]?.[v.channel] ?? []) console.error(`      ${file}`);
    }
  }

  const regressions = violations.filter((v) => v.kind === "new" || v.kind === "grew");
  if (regressions.length > 0) {
    console.error(
      "\n   A plugin that imports @/stores, @/services, @/hooks or @/components cannot\n" +
        "   ship as a standalone extension — the app's services are themselves\n" +
        "   store-coupled, so an @/services import is transitive @/stores coupling.\n" +
        "   Read host state at the call site, pass it in as a parameter, or declare a\n" +
        "   seam under plugins/shared/. This baseline ratchets DOWN only.\n",
    );
  }
  if (regressions.length < violations.length) {
    console.error(
      "\n   Some of these are IMPROVEMENTS — record the win in\n" +
        "   scripts/plugin-store-coupling-baseline.json so it cannot silently become\n" +
        "   headroom for the next regression.\n",
    );
  }

  process.exit(1);
}

// Only run when invoked directly, so the test can import the pure helpers.
if (process.argv[1] && process.argv[1].endsWith("check-plugin-store-coupling.mjs")) {
  main();
}
