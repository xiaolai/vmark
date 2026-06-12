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

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("Checking i18n key completeness...\n");

const jsonOk = checkJsonLocales();
const yamlOk = checkYamlLocales();

if (jsonOk && yamlOk) {
  console.log("\nAll i18n checks passed.");
  process.exit(0);
} else {
  console.error("\ni18n check FAILED — missing keys detected.");
  process.exit(1);
}
