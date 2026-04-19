#!/usr/bin/env node
/**
 * Build per-locale translation task files listing every missing key with
 * its English source. Writes to dev-docs/tmp/translate-task-{locale}.json.
 *
 * Each file: { "namespace.key.path": "english value", ... }
 *
 * Run after find-untranslated.mjs has been verified.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "dev-docs/tmp/i18n-tasks");

const FRONTEND_LOCALES_DIR = resolve(ROOT, "src/locales");
const RUST_LOCALES_DIR = resolve(ROOT, "src-tauri/locales");

const LOCALES = ["zh-CN", "zh-TW", "ja", "ko", "de", "es", "fr", "it", "pt-BR"];

const ALLOWED_IDENTICAL = new Set([
  "OK", "PDF", "HTML", "Markdown", "VMark", "MCP", "YAML", "JSON",
  "Pandoc", "SVG", "CSS", "API", "URL", "CLI", "UI", "CJK", "macOS",
  "Windows", "Linux", "iOS", "Android", "Genie", "Genies", "Untitled",
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
      out[full] = m[2]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
  }
  return out;
}

function likelyUntranslated(enVal, locVal) {
  if (typeof enVal !== "string" || typeof locVal !== "string") return false;
  if (enVal !== locVal) return false;
  if (ALLOWED_IDENTICAL.has(enVal)) return false;
  if (/^\s*$/.test(enVal)) return false;
  if (/^[\s\d\p{P}{}\[\]()"'<>-]+$/u.test(enVal)) return false;
  if (/^\{\{[\w.]+\}\}$/.test(enVal.trim())) return false;
  return true;
}

mkdirSync(OUT_DIR, { recursive: true });

const tasks = Object.fromEntries(LOCALES.map((l) => [l, { json: {}, yaml: {} }]));

// Frontend
const namespaces = readdirSync(resolve(FRONTEND_LOCALES_DIR, "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""));
for (const ns of namespaces) {
  const en = flatten(JSON.parse(readFileSync(resolve(FRONTEND_LOCALES_DIR, "en", `${ns}.json`), "utf-8")));
  for (const locale of LOCALES) {
    const locPath = resolve(FRONTEND_LOCALES_DIR, locale, `${ns}.json`);
    let loc;
    try {
      loc = flatten(JSON.parse(readFileSync(locPath, "utf-8")));
    } catch {
      continue;
    }
    for (const [key, enVal] of Object.entries(en)) {
      if (likelyUntranslated(enVal, loc[key])) {
        tasks[locale].json[`${ns}.${key}`] = enVal;
      }
    }
  }
}

// Rust
const enYaml = parseYaml(readFileSync(resolve(RUST_LOCALES_DIR, "en.yml"), "utf-8"));
for (const locale of LOCALES) {
  const locYaml = parseYaml(readFileSync(resolve(RUST_LOCALES_DIR, `${locale}.yml`), "utf-8"));
  for (const [key, enVal] of Object.entries(enYaml)) {
    if (likelyUntranslated(enVal, locYaml[key])) {
      tasks[locale].yaml[key] = enVal;
    }
  }
}

for (const locale of LOCALES) {
  const out = resolve(OUT_DIR, `${locale}.json`);
  writeFileSync(out, JSON.stringify(tasks[locale], null, 2) + "\n");
  const counts = {
    json: Object.keys(tasks[locale].json).length,
    yaml: Object.keys(tasks[locale].yaml).length,
  };
  console.log(`${locale}: ${counts.json} JSON keys + ${counts.yaml} YAML keys → ${out}`);
}
