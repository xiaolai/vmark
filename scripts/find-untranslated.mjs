#!/usr/bin/env node
/**
 * Find keys whose values are identical to the English source
 * (i.e., likely untranslated) across all locale files.
 *
 * Reports a structured list so we can build a translation table.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FRONTEND_LOCALES_DIR = resolve(ROOT, "src/locales");
const RUST_LOCALES_DIR = resolve(ROOT, "src-tauri/locales");

const LOCALES = ["zh-CN", "zh-TW", "ja", "ko", "de", "es", "fr", "it", "pt-BR"];

// Short acronyms & proper nouns that are allowed to be identical across locales
const ALLOWED_IDENTICAL = new Set([
  "OK", "PDF", "HTML", "Markdown", "VMark", "MCP", "YAML", "JSON",
  "Pandoc", "SVG", "CSS", "API", "URL", "CLI", "UI", "CJK", "macOS",
  "Windows", "Linux", "iOS", "Android", "Genie", "Genies",
  "Untitled",  // Keep English per existing convention
]);

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      Object.assign(out, flatten(v, path));
    } else if (typeof v === "string") {
      out[path] = v;
    }
  }
  return out;
}

function parseYaml(content) {
  // rust-i18n YAML is simple: "key.path: \"value\"" with a single top-level "menu:" / "errors:" block
  const out = {};
  const lines = content.split("\n");
  let topKey = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (/^[a-zA-Z][\w-]*:\s*$/.test(line.trim())) {
      topKey = line.trim().replace(":", "");
      continue;
    }
    const m = line.match(/^\s+([a-zA-Z][\w.-]*):\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (m && topKey) {
      const full = `${topKey}.${m[1]}`;
      out[full] = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
  }
  return out;
}

function likelyUntranslated(enVal, locVal) {
  if (typeof enVal !== "string" || typeof locVal !== "string") return false;
  if (enVal !== locVal) return false;
  if (ALLOWED_IDENTICAL.has(enVal)) return false;
  if (/^\s*$/.test(enVal)) return false;
  // Allow strings that are only punctuation/placeholders/numbers
  if (/^[\s\d\p{P}{}\[\]()"'<>-]+$/u.test(enVal)) return false;
  // Keys with only placeholder content like "{{error}}" — skip
  if (/^\{\{[\w.]+\}\}$/.test(enVal.trim())) return false;
  return true;
}

const findings = {};

// ---------- Frontend JSON ----------
const namespaces = readdirSync(resolve(FRONTEND_LOCALES_DIR, "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""));

for (const ns of namespaces) {
  const enPath = resolve(FRONTEND_LOCALES_DIR, "en", `${ns}.json`);
  const en = flatten(JSON.parse(readFileSync(enPath, "utf-8")));
  for (const locale of LOCALES) {
    const locPath = resolve(FRONTEND_LOCALES_DIR, locale, `${ns}.json`);
    let loc;
    try {
      loc = flatten(JSON.parse(readFileSync(locPath, "utf-8")));
    } catch {
      continue;
    }
    for (const [key, enVal] of Object.entries(en)) {
      const locVal = loc[key];
      if (likelyUntranslated(enVal, locVal)) {
        const fullKey = `${ns}.${key}`;
        if (!findings[fullKey]) findings[fullKey] = { en: enVal, missing: [], kind: "json" };
        findings[fullKey].missing.push(locale);
      }
    }
  }
}

// ---------- Rust YAML ----------
const enYaml = parseYaml(readFileSync(resolve(RUST_LOCALES_DIR, "en.yml"), "utf-8"));
for (const locale of LOCALES) {
  const locYamlPath = resolve(RUST_LOCALES_DIR, `${locale}.yml`);
  const locYaml = parseYaml(readFileSync(locYamlPath, "utf-8"));
  for (const [key, enVal] of Object.entries(enYaml)) {
    const locVal = locYaml[key];
    if (likelyUntranslated(enVal, locVal)) {
      const fullKey = `yaml.${key}`;
      if (!findings[fullKey]) findings[fullKey] = { en: enVal, missing: [], kind: "yaml" };
      findings[fullKey].missing.push(locale);
    }
  }
}

// Print grouped output
const entries = Object.entries(findings).sort(([a], [b]) => a.localeCompare(b));
let totalPairs = 0;
for (const [key, { en, missing, kind }] of entries) {
  totalPairs += missing.length;
  console.log(`\n${kind.toUpperCase()} :: ${key}`);
  console.log(`  EN: ${JSON.stringify(en)}`);
  console.log(`  Untranslated in: ${missing.join(", ")}`);
}
console.log(`\n---\nTotal unique keys: ${entries.length}`);
console.log(`Total (locale × key) pairs: ${totalPairs}`);
