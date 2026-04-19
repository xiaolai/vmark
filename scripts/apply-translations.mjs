#!/usr/bin/env node
/**
 * Merge the `{locale}-translated.json` fragments produced by translator
 * subagents into the real locale files.
 *
 *   - JSON fragments under `.json` key → written into src/locales/{locale}/{ns}.json
 *     (the fragment key "ns.rest.of.path" is split on the first dot)
 *   - YAML fragments under `.yaml` key → key "menu.edit.findInFiles" becomes
 *     top-level `menu:` entry `edit.findInFiles: "..."` — we just swap the
 *     existing English value in src-tauri/locales/{locale}.yml.
 *
 * Additive-safe: never overwrites a value that's already different from the
 * English source (i.e., never clobbers a real translation). Only replaces
 * values that still equal the English source.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const LOCALES = ["zh-CN", "zh-TW", "ja", "ko", "de", "es", "fr", "it", "pt-BR"];
const FRONTEND = resolve(ROOT, "src/locales");
const RUST = resolve(ROOT, "src-tauri/locales");
const TASKS_DIR = resolve(ROOT, "dev-docs/tmp/i18n-tasks");

function getByPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

let totalJson = 0;
let totalYaml = 0;
let skippedJson = 0;
let skippedYaml = 0;

for (const locale of LOCALES) {
  const fragPath = resolve(TASKS_DIR, `${locale}-translated.json`);
  const frag = JSON.parse(readFileSync(fragPath, "utf-8"));

  // --- JSON files ---
  // Group by namespace: first dot-separated segment is the namespace file name
  const byNs = {};
  for (const [key, value] of Object.entries(frag.json || {})) {
    const firstDot = key.indexOf(".");
    if (firstDot === -1) continue;
    const ns = key.slice(0, firstDot);
    const rest = key.slice(firstDot + 1);
    byNs[ns] ||= {};
    byNs[ns][rest] = value;
  }

  for (const [ns, entries] of Object.entries(byNs)) {
    const enPath = resolve(FRONTEND, "en", `${ns}.json`);
    const locPath = resolve(FRONTEND, locale, `${ns}.json`);
    const en = JSON.parse(readFileSync(enPath, "utf-8"));
    const loc = JSON.parse(readFileSync(locPath, "utf-8"));
    let touched = false;
    for (const [path, value] of Object.entries(entries)) {
      const enVal = getByPath(en, path);
      const locVal = getByPath(loc, path);
      if (locVal !== enVal) {
        // Safety: if the current locale value differs from English, it's
        // already a real translation — don't overwrite.
        skippedJson++;
        continue;
      }
      setByPath(loc, path, value);
      touched = true;
      totalJson++;
    }
    if (touched) {
      writeFileSync(locPath, JSON.stringify(loc, null, 2) + "\n");
    }
  }

  // --- YAML file ---
  const yamlFrag = frag.yaml || {};
  if (Object.keys(yamlFrag).length > 0) {
    const enYamlPath = resolve(RUST, "en.yml");
    const locYamlPath = resolve(RUST, `${locale}.yml`);
    const enYamlText = readFileSync(enYamlPath, "utf-8");
    let locYamlText = readFileSync(locYamlPath, "utf-8");

    for (const [fullKey, newValue] of Object.entries(yamlFrag)) {
      // fullKey like "menu.edit.findInFiles". Second-level flat key in rust-i18n.
      // Find the English value from en.yml and the line in loc yaml.
      const parts = fullKey.split(".");
      const topKey = parts[0];
      const flat = parts.slice(1).join(".");
      const lineRegex = new RegExp(
        `^(\\s+${escapeRegExp(flat)}:\\s*)"((?:[^"\\\\]|\\\\.)*)"\\s*$`,
        "m"
      );

      const enMatch = enYamlText.match(lineRegex);
      if (!enMatch) {
        console.warn(`EN key not found: ${fullKey}`);
        skippedYaml++;
        continue;
      }
      const enValRaw = enMatch[2];

      const locMatch = locYamlText.match(lineRegex);
      if (!locMatch) {
        console.warn(`${locale} key not found: ${fullKey}`);
        skippedYaml++;
        continue;
      }
      const locValRaw = locMatch[2];
      if (locValRaw !== enValRaw) {
        skippedYaml++;
        continue;
      }
      // Escape the new value for YAML double-quoted string
      const escaped = newValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      const replacement = `${locMatch[1]}"${escaped}"`;
      locYamlText = locYamlText.replace(lineRegex, replacement);
      totalYaml++;
    }

    writeFileSync(locYamlPath, locYamlText);
  }

  console.log(`${locale}: done`);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

console.log(`\nApplied ${totalJson} JSON + ${totalYaml} YAML translations.`);
if (skippedJson || skippedYaml) {
  console.log(`Skipped ${skippedJson} JSON + ${skippedYaml} YAML (already translated or mismatch).`);
}
