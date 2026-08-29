#!/usr/bin/env node
/**
 * WI-UI0.3 — the ui-consistency gate: C3, C4, C5, C7, C8, C9, C10, C11 of
 * dev-docs/plans/20260829-ui-consistency.md, with ONE identity baseline.
 *
 *   C3   chrome font-size is a --font-size-* token (editor em ratios exempt)
 *   C4   overlay/popup shells compose a canonical panel class
 *   C5   var(--font-sans) only under document selectors; chrome uses --font-ui
 *   C7   lucide sizes ∈ {12,14,16,18}; icon w-* ∈ {3,3.5,4,4.5}; no CSS
 *        svg-width override where a size= prop exists
 *   C8   clickables ≥ 24px or a ::before expander or ui-ok(target): spaced
 *   C9   hover/active/selected backgrounds speak the state vocabulary
 *   C10  every focusable JSX element resolves to a painting :focus rule, a
 *        Tailwind focus-visible: class, the caret-only marker, or ui-ok(focus)
 *   C11  bar-height literals outside index.css; z-index literals (zero-tol)
 *
 * One comment-stripped CSS rule walk (scripts/lib/uiConsistencyCss.mjs, on the
 * shared cssRules grammar) + one TS-AST walk (scripts/lib/uiConsistencyTsx.mjs).
 * Exemption grammar: `ui-ok(<check>): <reason>` — reason REQUIRED. C10 honours
 * the existing `focus: caret-only — <reason>` marker unchanged.
 *
 * Baseline: scripts/ui-consistency-baseline.json — identity list per check,
 * onAdd: fail (C4: report — a new surface legitimately adds one). A finding
 * missing from the baseline exits 1; a baselined site that now passes exits 1
 * (record the win). `--update` rewrites the lists.
 *
 * This gate REPLACED scripts/check-selection-styles.mjs (C9 covers its four
 * name fragments and every other selector too); that path is registered in
 * check-deleted-names.mjs.
 */
import { readFileSync, writeFileSync, globSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  indexTokens,
  checkFontSize,
  checkOverlayShell,
  checkFontSans,
  checkTargets,
  checkStateVocabulary,
  checkHeightsAndZ,
  focusPaintedClasses,
} from "./lib/uiConsistencyCss.mjs";
import { checkIconSizes, collectFocusables } from "./lib/uiConsistencyTsx.mjs";

const BASELINE_PATH = "scripts/ui-consistency-baseline.json";
const CHECK_KEYS = ["C3", "C4", "C5", "C7", "C8", "C9", "C10", "C11"];

/** The export bundle and generated dirs are outside every UI gate's scope. */
const EXCLUDED = [/^src\/export\//, /^src\/test\//, /\/generated\//];
/** Canonical shell definers — C4 reads them as vocabulary, not drift. */
const C4_DEFINERS = [/popup-shared\.css$/, /media-popup-shared\.css$/, /overlay-shared\.css$/];

function files(pattern) {
  return globSync(pattern)
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .filter((p) => !EXCLUDED.some((re) => re.test(p)) && !p.includes(".test."))
    .sort();
}

export function runChecks({ cssFiles, tsxFiles, indexCssText, read = (p) => readFileSync(p, "utf8") }) {
  const tokens = indexTokens(indexCssText);
  const problems = [];
  const ctx = { problems };
  const findings = [];

  const focusPaint = new Set();
  const svgWidthFiles = new Map(); // dir -> [{file, selector}]
  for (const file of cssFiles) {
    const css = read(file);
    findings.push(...checkFontSize(css, file, ctx));
    if (!C4_DEFINERS.some((re) => re.test(file))) findings.push(...checkOverlayShell(css, file, tokens, ctx));
    // Format adapters render DOCUMENTS (dep trees, JSON previews) — the
    // reading font is correct there, so C5 exempts them (plan, C5 scope).
    if (!/^src\/lib\/formats\/adapters\//.test(file)) findings.push(...checkFontSans(css, file, ctx));
    findings.push(...checkTargets(css, file, tokens, ctx));
    findings.push(...checkStateVocabulary(css, file, ctx));
    findings.push(...checkHeightsAndZ(css, file, ctx));
    for (const cls of focusPaintedClasses(css)) focusPaint.add(cls);
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\bsvg\s*$/.test(m[1].trim()) && /(?:^|[;{])\s*width\s*:\s*\d+px/.test(m[2])) {
        const dir = file.slice(0, file.lastIndexOf("/"));
        if (!svgWidthFiles.has(dir)) svgWidthFiles.set(dir, []);
        svgWidthFiles.get(dir).push({ file, selector: m[1].replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim() });
      }
    }
  }

  for (const file of tsxFiles) {
    const source = read(file);
    const { findings: iconFindings, usesLucideSize } = checkIconSizes(source, file);
    findings.push(...iconFindings);
    if (usesLucideSize) {
      const dir = file.slice(0, file.lastIndexOf("/"));
      for (const hit of svgWidthFiles.get(dir) ?? []) {
        findings.push({
          check: "C7",
          id: `${hit.file}:${hit.selector}`,
          message: `${hit.file} ${hit.selector}: CSS sets svg width while ${file} passes a lucide size= prop — one channel must win (D12).`,
        });
      }
    }
    for (const el of collectFocusables(source, file)) {
      if (el.covered) continue;
      if (!el.dynamicClassName && el.classes.some((c) => focusPaint.has(c))) continue;
      findings.push({
        check: "C10",
        id: el.id,
        message: `${el.id}: no focus-visible rule paints for any of [${el.classes.slice(0, 4).join(", ")}]${el.dynamicClassName ? " (dynamic className — unresolvable, covered by nothing the gate can see)" : ""}. Add a :focus-visible rule / focus-visible: class, use a canonical control, or the caret-only marker (rule 33).`,
      });
    }
  }

  // C6 (WI-UI1.7) — reduced motion has ONE owner: the global duration-collapse
  // block in index.css (zero-tolerance), and per-file blocks are REPORTED as
  // deletable except the three that restore a resting state.
  const reports = [];
  // C3's Tailwind half (zero-tolerance since WI-UI2.2): the @theme inline
  // bridge must exist and cover the namespaces VMark uses — without it,
  // Tailwind's own rem scale re-forks chrome typography invisibly.
  if (!/@theme inline \{[^}]*--text-sm:\s*var\(--font-size-base\)[^}]*--font-sans:\s*var\(--font-ui\)[^}]*--shadow-popup:\s*var\(--shadow-popup\)/.test(indexCssText)) {
    problems.push(
      "index.css is missing the @theme inline bridge (D1/WI-UI2.2) mapping --text-*/--font-sans/--shadow-popup onto VMark tokens.",
    );
  }
  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation-duration:\s*0\.01ms\s*!important/.test(indexCssText)) {
    problems.push(
      "index.css is missing the global prefers-reduced-motion duration-collapse block (D9/R10) — per-file opt-in cannot cover Tailwind animate-* or future files.",
    );
  }
  const C6_ALLOWLIST = [/multi-cursor\.css$/, /syntax-reveal\.css$/, /StatusBar\.css$/, /index\.css$/];
  for (const file of cssFiles) {
    if (C6_ALLOWLIST.some((re) => re.test(file))) continue;
    if (/@media\s*\(prefers-reduced-motion/.test(read(file))) {
      reports.push(`${file}: per-file prefers-reduced-motion block — the global collapse in index.css covers it; delete unless it RESTORES a resting state (then allowlist it in C6).`);
    }
  }

  // C11's z-index half is zero-tolerance: report as problems, not baseline.
  const zFindings = findings.filter((f) => f.check === "C11z");
  return { findings: findings.filter((f) => f.check !== "C11z"), zFindings, problems, reports };
}

export function compareBaseline(findings, baseline) {
  const newFindings = [];
  const stale = [];
  const byCheck = new Map(CHECK_KEYS.map((k) => [k, new Set()]));
  for (const f of findings) byCheck.get(f.check)?.add(f.id);
  for (const f of findings) {
    if (!(baseline[f.check] ?? []).includes(f.id)) newFindings.push(f);
  }
  for (const key of CHECK_KEYS) {
    for (const id of baseline[key] ?? []) {
      if (!byCheck.get(key)?.has(id)) stale.push({ check: key, id });
    }
  }
  return { newFindings, stale };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const started = Date.now();
  const cssFiles = files("src/**/*.css");
  const tsxFiles = files("src/**/*.tsx");
  const indexCssText = readFileSync("src/styles/index.css", "utf8");
  const { findings, zFindings, problems, reports } = runChecks({ cssFiles, tsxFiles, indexCssText });
  for (const r of reports) console.log(`ℹ️  [C6] ${r}`);

  if (args.includes("--update")) {
    const doc = { "//": JSON.parse(readFileSync(BASELINE_PATH, "utf8"))["//"] ?? [] };
    for (const key of CHECK_KEYS) {
      doc[key] = [...new Set(findings.filter((f) => f.check === key).map((f) => f.id))].sort();
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`updated ${BASELINE_PATH}: ${findings.length} baselined site(s)`);
    process.exit(0);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const { newFindings, stale } = compareBaseline(findings, baseline);
  let failed = false;
  if (problems.length > 0) {
    failed = true;
    console.error("Marker problems:");
    for (const p of problems) console.error(`  ✗ ${p}`);
  }
  if (zFindings.length > 0) {
    failed = true;
    console.error("z-index literals (zero-tolerance):");
    for (const f of zFindings) console.error(`  ✗ ${f.message}`);
  }
  if (newFindings.length > 0) {
    failed = true;
    console.error("New ui-consistency findings (not in the baseline):");
    for (const f of newFindings) console.error(`  ✗ [${f.check}] ${f.message}`);
  }
  if (stale.length > 0) {
    failed = true;
    console.error("Stale baseline entries (now passing — record the win by removing them):");
    for (const s of stale) console.error(`  ✗ [${s.check}] ${s.id}`);
  }
  if (failed) process.exit(1);
  const counts = CHECK_KEYS.map((k) => `${k} ${findings.filter((f) => f.check === k).length}`).join(", ");
  console.log(`✅ ui-consistency held in ${Date.now() - started}ms (baselined: ${counts}).`);
}
