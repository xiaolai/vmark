#!/usr/bin/env -S node --import tsx
/**
 * I18n Key Completeness Check
 * Verifies all language files have the same keys as the English source.
 *
 * Usage: npx tsx scripts/check-i18n-keys.ts
 * Part of: pnpm check:all
 *
 * Checks:
 *   - src/locales/{lang}/*.json  vs  src/locales/en/*.json  (all 8 namespaces)
 *   - src-tauri/locales/{lang}.yml  vs  src-tauri/locales/en.yml
 *
 * Exit codes:
 *   0  All good (or no translations to check)
 *   1  One or more translation files have missing keys
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  IDENTICAL_ALLOWLIST,
  allowedEntries,
  staleExceptions,
} from "./i18nIdenticalAllowlist.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Flatten a nested JSON object into dot-notation keys.
 * e.g. { a: { b: "v" } } → ["a.b"]
 */
function flattenJson(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return [prefix].filter(Boolean);
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...flattenJson(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

/**
 * Parse a flat YAML file (key: "value" or key: value lines).
 * Handles:
 *   - Flat keys:   menu.foo.bar: "value"
 *   - Section heads that are also keys:  menu: "Menu"
 *   - Comment lines and blank lines are skipped
 *   - Indented block-mapping keys (nested YAML) are handled by
 *     tracking the current indent level and building the full path.
 *
 * Returns an array of fully-qualified key strings.
 */
function flattenYaml(content: string): string[] {
  const keys: string[] = [];
  // Stack of { indent, key } to build prefix for nested mappings
  const stack: Array<{ indent: number; key: string }> = [];

  for (const rawLine of content.split("\n")) {
    // Skip comments and blank lines
    const trimmed = rawLine.trimEnd();
    if (!trimmed || /^\s*#/.test(trimmed)) continue;

    // Measure indent
    const indent = trimmed.length - trimmed.trimStart().length;
    const line = trimmed.trimStart();

    // Match a YAML mapping entry: key: [optional value]
    const match = line.match(/^([A-Za-z0-9_.[\]-]+)\s*:(.*)$/);
    if (!match) continue;

    const rawKey = match[1];
    const valuePart = match[2].trim();

    // Pop stack entries that are at same or deeper indent
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    // Build full key from stack prefix + rawKey
    const prefix = stack.map((s) => s.key).join(".");
    const fullKey = prefix ? `${prefix}.${rawKey}` : rawKey;

    if (valuePart === "" || valuePart.startsWith("#")) {
      // Mapping head (no value) — push onto stack for children
      stack.push({ indent, key: rawKey });
    } else {
      // Leaf key — record it
      keys.push(fullKey);
    }
  }

  return keys;
}

/**
 * Flatten a YAML locale to key → value, mirroring `flattenYaml`'s key logic.
 *
 * Separate from `flattenYaml` rather than replacing it because the key check
 * wants every key including mapping heads, while a value check wants leaves
 * only. Quotes are stripped so `"a"` and `a` compare equal — the two locale
 * files do not always agree on quoting style for the same string.
 */
function flattenYamlValues(content: string): Map<string, string> {
  const values = new Map<string, string>();
  const stack: Array<{ indent: number; key: string }> = [];

  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trimEnd();
    if (!trimmed || /^\s*#/.test(trimmed)) continue;

    const indent = trimmed.length - trimmed.trimStart().length;
    const line = trimmed.trimStart();
    const match = line.match(/^([A-Za-z0-9_.[\]-]+)\s*:(.*)$/);
    if (!match) continue;

    const rawKey = match[1];
    const valuePart = match[2].trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const prefix = stack.map((s) => s.key).join(".");
    const fullKey = prefix ? `${prefix}.${rawKey}` : rawKey;

    if (valuePart === "" || valuePart.startsWith("#")) {
      stack.push({ indent, key: rawKey });
    } else {
      values.set(fullKey, valuePart.replace(/^["']|["']$/g, ""));
    }
  }

  return values;
}

function loadJsonKeys(filePath: string): string[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return flattenJson(parsed);
  } catch (e) {
    process.stderr.write(
      `  [ERROR] Could not parse ${filePath}: ${e instanceof Error ? e.message : String(e)}\n`
    );
    return [];
  }
}

function loadYamlKeys(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    return flattenYaml(content);
  } catch (e) {
    process.stderr.write(
      `  [ERROR] Could not read ${filePath}: ${e instanceof Error ? e.message : String(e)}\n`
    );
    return [];
  }
}

// ─── Placeholder extraction ─────────────────────────────────────────────────

/** Extract {{placeholder}} names from a translation value. */
function extractPlaceholders(value: string): Set<string> {
  const matches = value.match(/\{\{(\w+)\}\}/g) ?? [];
  return new Set(matches.map((m) => m.replace(/[{}]/g, "")));
}

/** Flatten a JSON object to key→value string map. */
function flattenJsonValues(obj: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    if (prefix && typeof obj === "string") result.set(prefix, obj);
    return result;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      for (const [fk, fv] of flattenJsonValues(v, full)) result.set(fk, fv);
    } else if (typeof v === "string") {
      result.set(full, v);
    }
  }
  return result;
}

/** Compare placeholders between source and target JSON files. Returns mismatches. */
function checkPlaceholders(
  sourceFile: string,
  targetFile: string
): string[] {
  const issues: string[] = [];
  try {
    const sourceValues = flattenJsonValues(JSON.parse(readFileSync(sourceFile, "utf-8")));
    const targetValues = flattenJsonValues(JSON.parse(readFileSync(targetFile, "utf-8")));
    for (const [key, sourceVal] of sourceValues) {
      const targetVal = targetValues.get(key);
      if (!targetVal) continue; // Missing key is caught by key check
      const sourcePh = extractPlaceholders(sourceVal);
      const targetPh = extractPlaceholders(targetVal);
      // Check source placeholders exist in target
      for (const ph of sourcePh) {
        if (!targetPh.has(ph)) issues.push(`${key}: missing {{${ph}}}`);
      }
      // Check target doesn't have extra placeholders
      for (const ph of targetPh) {
        if (!sourcePh.has(ph)) issues.push(`${key}: extra {{${ph}}}`);
      }
    }
  } catch {
    // Parse errors caught elsewhere
  }
  return issues;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

interface CheckResult {
  file: string;
  totalExpected: number;
  missing: string[];
  extra: string[];
  placeholderIssues: string[];
}

function compareKeys(
  filePath: string,
  sourceKeys: string[],
  targetKeys: string[],
  placeholderIssues: string[] = []
): CheckResult {
  const sourceSet = new Set(sourceKeys);
  const targetSet = new Set(targetKeys);
  const missing = sourceKeys.filter((k) => !targetSet.has(k));
  const extra = targetKeys.filter((k) => !sourceSet.has(k));
  return { file: filePath, totalExpected: sourceKeys.length, missing, extra, placeholderIssues };
}

function printResult(result: CheckResult): void {
  const rel = result.file.replace(ROOT + "/", "");
  if (result.missing.length === 0 && result.extra.length === 0) {
    console.log(`[OK]    ${rel} — ${result.totalExpected}/${result.totalExpected} keys`);
  } else {
    if (result.missing.length === 0) {
      console.log(`[OK]    ${rel} — ${result.totalExpected}/${result.totalExpected} keys`);
    } else {
      const found = result.totalExpected - result.missing.length;
      console.error(
        `[ERROR] ${rel} — ${found}/${result.totalExpected} keys — ` +
          `${result.missing.length} missing: ${result.missing.join(", ")}`
      );
    }
    if (result.extra.length > 0) {
      const relFile = result.file.replace(ROOT + "/", "");
      console.warn(
        `[WARN]  ${relFile} — ${result.extra.length} extra key${result.extra.length > 1 ? "s" : ""}: ${result.extra.join(", ")}`
      );
    }
    if (result.placeholderIssues.length > 0) {
      const relFile = result.file.replace(ROOT + "/", "");
      console.error(
        `[ERROR] ${relFile} — ${result.placeholderIssues.length} placeholder mismatch${result.placeholderIssues.length > 1 ? "es" : ""}: ${result.placeholderIssues.join("; ")}`
      );
    }
  }
}

// ─── JSON locale check ───────────────────────────────────────────────────────

function checkJsonLocales(): boolean {
  const localesDir = join(ROOT, "src", "locales");
  if (!existsSync(localesDir)) return true;

  const enDir = join(localesDir, "en");
  if (!existsSync(enDir)) {
    console.warn("[WARN]  src/locales/en/ not found — skipping JSON check");
    return true;
  }

  // Collect all English namespace files
  const enFiles = readdirSync(enDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (enFiles.length === 0) {
    console.log("  No English JSON files found.");
    return true;
  }

  // Build map: namespace → source keys
  const sourceMap = new Map<string, string[]>();
  let legacyPluralFound = false;
  for (const file of enFiles) {
    const keys = loadJsonKeys(join(enDir, file));
    sourceMap.set(file, keys);

    // i18next v4+ resolves plurals via _one/_other; legacy v3 suffixes
    // (_plural, _0) are silently dead — t() falls back to the singular
    // base key for every count (audit 20260612 H16).
    const legacy = keys.filter((k) => /_(plural|0)$/.test(k));
    if (legacy.length > 0) {
      console.error(
        `[ERROR] en/${file} — dead legacy plural suffix (use _one/_other): ${legacy.join(", ")}`
      );
      legacyPluralFound = true;
    }
  }
  if (legacyPluralFound) return false;

  // Find other language directories
  const langDirs = readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "en")
    .map((d) => d.name)
    .sort();

  if (langDirs.length === 0) {
    console.log("  No translation directories found (only English) — nothing to check.");
    return true;
  }

  let allOk = true;

  for (const lang of langDirs) {
    const langDir = join(localesDir, lang);

    // Determine which English files this language has at all
    const presentFiles = enFiles.filter((f) => existsSync(join(langDir, f)));

    if (presentFiles.length === 0) {
      // Completely empty language directory — treat as "not started", skip silently
      console.log(
        `[SKIP]  src/locales/${lang}/ — no files yet (translation not started)`
      );
      continue;
    }

    for (const file of enFiles) {
      const targetPath = join(langDir, file);
      if (!existsSync(targetPath)) {
        // Some files present but this one is missing — that's an error
        const rel = `src/locales/${lang}/${file}`;
        const sourceKeys = sourceMap.get(file)!;
        console.error(
          `[ERROR] ${rel} — MISSING FILE — ${sourceKeys.length} keys absent`
        );
        allOk = false;
        continue;
      }
      const sourceKeys = sourceMap.get(file)!;
      const targetKeys = loadJsonKeys(targetPath);
      const phIssues = checkPlaceholders(join(enDir, file), targetPath);
      const result = compareKeys(targetPath, sourceKeys, targetKeys, phIssues);
      printResult(result);
      // Placeholder mismatches used to fail the run WITHOUT printing — a
      // silent failure (found live on 2026-08-29 when a title-case fixer
      // capitalized inside an interpolation and nothing said why the run was
      // red). Loud, always.
      if (phIssues.length > 0) {
        console.error(`[ERROR] src/locales/${lang}/${file} — ${phIssues.length} placeholder mismatch(es):`);
        for (const issue of phIssues.slice(0, 10)) console.error(`          ${issue}`);
      }
      if (result.missing.length > 0 || phIssues.length > 0) allOk = false;
    }
  }

  return allOk;
}

// ─── YAML locale check ───────────────────────────────────────────────────────

function checkYamlLocales(): boolean {
  const tauriLocalesDir = join(ROOT, "src-tauri", "locales");
  if (!existsSync(tauriLocalesDir)) return true;

  const enYml = join(tauriLocalesDir, "en.yml");
  if (!existsSync(enYml)) {
    console.warn("[WARN]  src-tauri/locales/en.yml not found — skipping YAML check");
    return true;
  }

  const sourceKeys = loadYamlKeys(enYml);

  // Find other .yml files (not en.yml)
  const otherYmls = readdirSync(tauriLocalesDir)
    .filter((f) => f.endsWith(".yml") && f !== "en.yml" && !f.startsWith("."))
    .sort();

  if (otherYmls.length === 0) {
    console.log("  No translation YAML files found (only en.yml) — nothing to check.");
    return true;
  }

  let allOk = true;

  for (const ymlFile of otherYmls) {
    const targetPath = join(tauriLocalesDir, ymlFile);
    const targetKeys = loadYamlKeys(targetPath);
    const result = compareKeys(targetPath, sourceKeys, targetKeys);
    printResult(result);
    if (result.missing.length > 0) allOk = false;
  }

  return allOk;
}

// ─── Untranslated values ─────────────────────────────────────────────────────
//
// The checks above prove a key EXISTS in every locale. They cannot tell whether
// anyone translated it: a key copied over with its English value passes, and
// ~1,160 of them once did. This check finds values byte-identical to English
// and ratchets that debt down, in the same shape as
// `scripts/file-size-baseline.json`. The debt is now zero — the baseline is
// empty and must stay that way, so a new entry means a real regression rather
// than one more line in a long list.
//
// The heuristic matters more than the comparison. Of ~3,000 identical pairs,
// most are SUPPOSED to be identical — `JSON`, `YAML`, `CLI`, `Markdown`,
// `TypeScript`, `VMark`. Requiring three words and fifteen characters keeps
// proper nouns, format names and acronyms out while still catching real
// sentences like "Application title bar". It is deliberately conservative:
// a missed untranslated string is a cosmetic bug, whereas a false positive
// would train people to edit the baseline instead of the translation.
//
// A handful survive the heuristic and still cannot be translated — a literal
// path, literal runner labels, a format string with no words. Those go in
// `i18nIdenticalAllowlist.ts` WITH A REASON, not in the baseline: the baseline
// means "not translated yet" and must be able to reach zero. The allow-list is
// checked for staleness in both directions, so translating an exempted string
// forces its dead exemption to be deleted.

const UNTRANSLATED_BASELINE = join(ROOT, "scripts/i18n-untranslated-baseline.json");
const MIN_WORDS = 3;
const MIN_CHARS = 15;

/** Is this value substantial enough that leaving it in English is a real gap? */
function looksTranslatable(value: string): boolean {
  return value.trim().split(/\s+/).length >= MIN_WORDS && value.length >= MIN_CHARS;
}

/**
 * Every value byte-identical to English and substantial enough to matter —
 * BEFORE the allow-list is applied. Staleness detection needs the raw set, so
 * the exemptions are subtracted by the caller rather than skipped here.
 */
function collectIdentical(): string[] {
  const found: string[] = [];

  const enDir = join(ROOT, "src/locales/en");
  if (existsSync(enDir)) {
    const namespaces = readdirSync(enDir).filter((f) => f.endsWith(".json"));
    const langs = readdirSync(join(ROOT, "src/locales"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "en" && d.name !== "__tests__")
      .map((d) => d.name);

    for (const ns of namespaces.sort()) {
      const en = flattenJsonValues(
        JSON.parse(readFileSync(join(enDir, ns), "utf-8")) as unknown
      );
      for (const lang of langs.sort()) {
        const path = join(ROOT, "src/locales", lang, ns);
        if (!existsSync(path)) continue;
        const target = flattenJsonValues(JSON.parse(readFileSync(path, "utf-8")) as unknown);
        for (const [key, value] of en) {
          if (target.get(key) === value && looksTranslatable(value)) {
            found.push(`src/locales/${lang}/${ns}:${key}`);
          }
        }
      }
    }
  }

  const yamlDir = join(ROOT, "src-tauri/locales");
  if (existsSync(join(yamlDir, "en.yml"))) {
    const en = flattenYamlValues(readFileSync(join(yamlDir, "en.yml"), "utf-8"));
    for (const file of readdirSync(yamlDir).filter((f) => f.endsWith(".yml") && f !== "en.yml").sort()) {
      const target = flattenYamlValues(readFileSync(join(yamlDir, file), "utf-8"));
      for (const [key, value] of en) {
        if (target.get(key) === value && looksTranslatable(value)) {
          found.push(`src-tauri/locales/${file}:${key}`);
        }
      }
    }
  }

  return found.sort();
}

function checkUntranslatedValues(update: boolean): boolean {
  const identical = collectIdentical();
  const identicalSet = new Set(identical);
  const allowed = allowedEntries();
  // Exempted values are not debt; they are the answer. Everything else is.
  const found = identical.filter((e) => !allowed.has(e));
  const stale = staleExceptions(IDENTICAL_ALLOWLIST, identicalSet);

  if (update) {
    writeFileSync(
      UNTRANSLATED_BASELINE,
      `${JSON.stringify({ _comment: BASELINE_COMMENT, minWords: MIN_WORDS, minChars: MIN_CHARS, entries: found }, null, 2)}\n`
    );
    console.log(`\n[UPDATED] ${UNTRANSLATED_BASELINE} — ${found.length} entries`);
    return true;
  }

  if (!existsSync(UNTRANSLATED_BASELINE)) {
    console.error(
      `\n[ERROR] ${UNTRANSLATED_BASELINE} missing — run: pnpm lint:i18n --update-untranslated`
    );
    return false;
  }

  const baseline = new Set<string>(
    (JSON.parse(readFileSync(UNTRANSLATED_BASELINE, "utf-8")) as { entries: string[] }).entries
  );
  const added = found.filter((e) => !baseline.has(e));
  const fixed = [...baseline].filter((e) => !found.includes(e));

  console.log("\nChecking for untranslated values (copied English)...\n");

  if (added.length > 0) {
    console.error(`[ERROR] ${added.length} value(s) left in English:`);
    for (const e of added.slice(0, 20)) console.error(`          ${e}`);
    if (added.length > 20) console.error(`          … and ${added.length - 20} more`);
    console.error("        Translate them. Do not add them to the baseline.");
  }

  if (fixed.length > 0) {
    console.error(`\n[ERROR] ${fixed.length} baselined value(s) now translated — record the win:`);
    console.error("          pnpm lint:i18n --update-untranslated");
  }

  if (stale.length > 0) {
    console.error(
      `\n[ERROR] ${stale.length} allow-list exemption(s) no longer identical to English:`
    );
    for (const e of stale.slice(0, 20)) console.error(`          ${e}`);
    if (stale.length > 20) console.error(`          … and ${stale.length - 20} more`);
    console.error(
      "        Delete them from scripts/i18nIdenticalAllowlist.ts — an exemption that\n" +
        "        no longer applies stops the list describing what is untranslatable."
    );
  }

  if (added.length === 0 && fixed.length === 0 && stale.length === 0) {
    console.log(
      `[OK]    ${found.length} untranslated value(s); ${allowed.size} legitimately identical (allow-listed).`
    );
    return true;
  }
  return false;
}

const BASELINE_COMMENT =
  "Frozen baseline of locale values still identical to English (i.e. never translated). " +
  "scripts/check-i18n-keys.ts fails on any NEW entry, and on a baselined entry that has since " +
  "been translated (record the win by re-running with --update-untranslated). Ratchets down only, " +
  "and is now EMPTY — keep it that way: translate the string, never re-add an entry here. " +
  "A value counts only if it has >= minWords words and >= minChars characters — shorter or " +
  "single-token values (JSON, CLI, Markdown, VMark) are overwhelmingly meant to stay identical. " +
  "Values that can NEVER be translated (a literal path, runner labels, a bare interpolation) do " +
  "not belong here either — they go in scripts/i18nIdenticalAllowlist.ts with a stated reason.";

// ─── Dialog-literal check (WI-UI4.1) ─────────────────────────────────────────
//
// A string LITERAL passed to ask()/confirm()/message()/confirmAction()/toast.*
// is hardcoded English the locale files cannot reach. The check walks a real
// TS AST (the house rule since check-command-error-ratchet: no hand-rolled
// lexing), and ALSO refuses raw `ask(`/`window.confirm(` call sites outside
// services/dialogs/confirmAction.ts — the funnel that keeps every destructive
// confirmation on one dialog shape. (dependency-cruiser cannot see NAMED
// imports, so the funnel is enforced here where the AST already is.)

const TOAST_MODULES = /^(sonner|@\/services\/ime\/imeToast|.*\/imeToast)$/;

/** Per-file dialog/toast literal scan — pure over (path, source), exported for
 *  behavioral tests (a walker cannot be pointed at a fixture tree). */
export function dialogLiteralFindings(rel: string, text: string): string[] {
  const DIALOG_FNS = new Set(["ask", "confirm", "message", "confirmAction"]);
  const problems: string[] = [];
  if (
    !/\b(ask|confirm|message|confirmAction|toast)\s*[(.]/.test(text) &&
    !/from ["'][^"']*(sonner|imeToast)["']/.test(text)
  ) return problems;
  {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const isFunnel = rel.endsWith("services/dialogs/confirmAction.ts");
    const line = (node: import("typescript").Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    // Toast identity is resolved from IMPORT BINDINGS, not identifier
    // spelling: `import { toast as notify }` must still be seen, and a local
    // helper that happens to be named `toast` must not be. Inside the toast
    // module itself the wrapper object is the export, so the name is trusted.
    const toastNames = new Set<string>();
    if (/imeToast\.ts$/.test(rel)) toastNames.add("toast");
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      if (!TOAST_MODULES.test(stmt.moduleSpecifier.text)) continue;
      const clause = stmt.importClause;
      if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
      for (const el of clause.namedBindings.elements) {
        const exported = (el.propertyName ?? el.name).text;
        if (exported === "toast" || exported === "imeToast") toastNames.add(el.name.text);
      }
    }

    const visit = (node: import("typescript").Node) => {
      if (ts.isCallExpression(node)) {
        let fnName: string | null = null;
        let isToast = false;
        if (ts.isIdentifier(node.expression)) {
          fnName = node.expression.text;
          // sonner's primary API is the BARE call — toast("Saved") — not just
          // toast.success(...); without this the most common form slips past.
          if (toastNames.has(fnName)) isToast = true;
        }
        else if (ts.isPropertyAccessExpression(node.expression)) {
          const obj = node.expression.expression;
          if (ts.isIdentifier(obj) && obj.text === "window") fnName = node.expression.name.text;
          if (ts.isIdentifier(obj) && toastNames.has(obj.text)) { isToast = true; fnName = obj.text; }
        }
        // The funnel: raw ask()/window.confirm() live only in confirmAction.ts.
        if (!isFunnel && (fnName === "ask" || (fnName === "confirm" && ts.isPropertyAccessExpression(node.expression)))) {
          problems.push(`${rel}:${line(node)}  raw ${fnName}() — route it through services/dialogs/confirmAction.ts`);
        }
        if (!isFunnel && fnName === "confirm" && ts.isIdentifier(node.expression)) {
          // bare confirm() — the browser global; a store method named confirm
          // is a MEMBER access and does not land here.
          problems.push(`${rel}:${line(node)}  raw confirm() — route it through services/dialogs/confirmAction.ts`);
        }
        // Hardcoded English: a first-argument string literal (or a template/
        // binary concat containing one) to a dialog/toast surface.
        const flagLiteral = (arg: import("typescript").Expression | undefined, label: string) => {
          if (!arg) return;
          const carriesLiteral = (e: import("typescript").Expression): boolean => {
            if (ts.isStringLiteralLike(e)) return /[A-Za-z]{2}/.test(e.text);
            if (ts.isTemplateExpression(e)) return /[A-Za-z]{2}\s+[A-Za-z]{2}/.test(e.head.text + e.templateSpans.map((sp) => sp.literal.text).join(""));
            if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return carriesLiteral(e.left) || carriesLiteral(e.right);
            return false;
          };
          if (carriesLiteral(arg)) {
            problems.push(`${rel}:${line(arg)}  hardcoded string passed to ${label} — key it through i18n`);
          }
        };
        if ((fnName && DIALOG_FNS.has(fnName)) || isToast) {
          if (fnName === "confirmAction" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
            for (const prop of node.arguments[0].properties) {
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && ["title", "message", "actionLabel"].includes(prop.name.text)) {
                flagLiteral(prop.initializer, `confirmAction ${prop.name.text}`);
              }
            }
          } else if (fnName === "ask" || fnName === "message" || isToast) {
            flagLiteral(node.arguments[0], `${fnName}()`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return problems;
}

function checkDialogLiterals(): boolean {
  const walkDirs = ["src"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(rel);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        files.push(rel);
      }
    }
  };
  for (const d of walkDirs) walk(d);

  const problems: string[] = [];
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    problems.push(...dialogLiteralFindings(rel, text));
  }

  if (problems.length) {
    console.error(`[FAIL]  ${problems.length} hardcoded/raw dialog call(s):`);
    for (const p of problems.slice(0, 30)) console.error(`        ${p}`);
    return false;
  }
  console.log("[OK]    dialog surfaces: no hardcoded literals, ask()/confirm() funneled through confirmAction.");
  return true;
}

// ─── Copy conventions (WI-UI4.2, R14) ────────────────────────────────────────
//
// Two casing registers, keyed on the KEY PATTERN (never guessed from the
// value): chrome nouns (menus, titles, buttons) read Title Case; running copy
// (labels, descriptions, toasts, placeholders) reads Sentence case. Plus the
// punctuation vocabulary: `…` never `...`, `→` never `->`/`>` in navigation
// paths, and descriptions carry no trailing period (Q3).
//
// The baseline (scripts/i18n-copy-baseline.json) is an IDENTITY list that
// ratchets both ways — a new violation fails, and a fixed one fails until its
// entry is removed (run with --update-copy to record wins). English only:
// each locale has its own casing conventions.

const TITLE_KEY = /^(menu|contextMenu|tabMenu|toolbar)\.|\.title$|[bB]utton/;
// ARIA labels are SPOKEN copy — sentence register regardless of their home key.
const ARIA_KEY = /aria/i;
const SENTENCE_KEY = /\.(label|description|empty|placeholder)$|^toast\./;
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "nor", "but", "of", "to", "in", "on", "at",
  "for", "with", "as", "by", "from", "into", "onto", "per", "via", "vs",
  "is", "are", "not", "no", "when", "if", "this", "that",
]);

export function titleCaseViolations(value: string): boolean {
  // Words = alphabetic runs outside interpolations; the FIRST word must be
  // capped; later words may be stop words.
  const clean = value.replace(/\{\{[^}]+\}\}|%\{[^}]+\}/g, " ");
  const words = clean.split(/[^A-Za-z’']+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.some((w, i) => {
    if (/^[A-Z0-9]/.test(w)) return false;
    if (i > 0 && STOP_WORDS.has(w.toLowerCase())) return false;
    return true;
  });
}

/** Exported (with an injectable baseline path) so the fail-closed missing-
 *  baseline behavior has a behavioral test — the scan itself reads the real
 *  locale tree either way. */
export function checkCopyConventions(
  update: boolean,
  baselinePath: string = join(ROOT, "scripts", "i18n-copy-baseline.json"),
): boolean {
  const enDir = join(ROOT, "src", "locales", "en");
  const found: string[] = [];

  for (const file of readdirSync(enDir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(enDir, file), "utf8")) as Record<string, unknown>;
    for (const [key, raw] of Object.entries(data)) {
      if (typeof raw !== "string") continue;
      const value = raw;
      const id = (check: string) => `${file}:${key}:${check}`;
      if (value.includes("...")) found.push(id("ellipsis"));
      if (/\s->\s/.test(value)) found.push(id("arrow"));
      if (/Settings\s*>\s*[A-Z]/.test(value)) found.push(id("nav-arrow"));
      if (/"\{\{/.test(value) || /\}\}"/.test(value)) found.push(id("straight-quotes"));
      if (SENTENCE_KEY.test(key) && key.endsWith(".description") && /[.。]$/.test(value.trim()) && !/[.][.][.]|…$/.test(value.trim())) {
        found.push(id("trailing-period"));
      }
      if (TITLE_KEY.test(key) && !SENTENCE_KEY.test(key) && !ARIA_KEY.test(key) && titleCaseViolations(value)) {
        found.push(id("title-case"));
      }
    }
  }

  // en.yml punctuation only (casing there follows the same menu register but
  // the yml is scanned for the vocabulary set).
  const yml = readFileSync(join(ROOT, "src-tauri", "locales", "en.yml"), "utf8");
  yml.split("\n").forEach((line, i) => {
    const m = /^\s*([A-Za-z0-9._-]+):\s*(.*)$/.exec(line);
    if (!m) return;
    const [, key, val] = m;
    if (val.includes("...")) found.push(`en.yml:${key}:ellipsis`);
    if (/Settings\s*>\s*[A-Z]/.test(val)) found.push(`en.yml:${key}:nav-arrow`);
    void i;
  });

  found.sort();
  const baseline: string[] = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, "utf8")) as { entries: string[] }).entries
    : [];
  const added = found.filter((f) => !baseline.includes(f));
  const fixed = baseline.filter((b) => !found.includes(b));

  // A missing baseline is an ERROR, not an invitation to write one: silently
  // rebaselining every current violation on a deleted/renamed file is fail-open
  // (mirrors checkUntranslatedValues). Only --update-copy writes.
  if (!update && !existsSync(baselinePath)) {
    console.error(
      `[FAIL]  copy-convention baseline missing (${baselinePath}) — restore it, or regenerate deliberately with --update-copy.`,
    );
    return false;
  }
  if (update) {
    writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          "//":
            "WI-UI4.2 copy-convention baseline (identity, ratchets both ways). A NEW casing/punctuation " +
            "violation fails; a fixed one fails until removed (pnpm lint:i18n --update-copy). English only.",
          entries: found,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`[OK]    copy conventions: baseline written with ${found.length} entr(ies).`);
    return true;
  }

  if (added.length) {
    console.error(`[FAIL]  ${added.length} NEW copy-convention violation(s):`);
    for (const a of added.slice(0, 20)) console.error(`        ${a}`);
    return false;
  }
  if (fixed.length) {
    console.error(`[FAIL]  ${fixed.length} baselined copy entr(ies) now pass — record the win with --update-copy:`);
    for (const f of fixed.slice(0, 20)) console.error(`        ${f}`);
    return false;
  }
  console.log(`[OK]    copy conventions held (${baseline.length} baselined).`);
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// Guarded so the classifier can be imported by its test without running the
// whole gate (same pattern as check-bespoke-buttons.mjs).

if (process.argv[1] && process.argv[1].endsWith("check-i18n-keys.ts")) {
  console.log("Checking i18n key completeness...\n");

  const updateUntranslated = process.argv.includes("--update-untranslated");
  const updateCopy = process.argv.includes("--update-copy");

  const jsonOk = checkJsonLocales();
  const yamlOk = checkYamlLocales();
  const valuesOk = checkUntranslatedValues(updateUntranslated);
  const dialogsOk = checkDialogLiterals();
  const copyOk = checkCopyConventions(updateCopy);

  if (jsonOk && yamlOk && valuesOk && dialogsOk && copyOk) {
    console.log("\nAll i18n checks passed.");
    process.exit(0);
  } else {
    console.error("\ni18n check FAILED.");
    process.exit(1);
  }
}
