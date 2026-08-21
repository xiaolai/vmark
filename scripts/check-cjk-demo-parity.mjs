#!/usr/bin/env node
/**
 * The website's CJK demo carries a hand-maintained COPY of the formatter's
 * settings contract. This asserts the copy still matches.
 *
 * `website/.vitepress/components/demos/cjkFormatter.ts` is an ~800-line fork of
 * `src/lib/cjkFormatter/`, and it exists for a real reason: the real module
 * imports `@/utils/debug`, which reaches `@tauri-apps/plugin-log`, and VitePress
 * has no `@/` alias — importing it would drag Tauri into the marketing site's
 * bundle. So the fork stays, and this gate keeps its CONTRACT honest.
 *
 * What is checked, and why only this:
 *   - the `CJKFormattingSettings` KEY SET, both directions. A missing key means
 *     the demo silently ignores a rule the docs page documents; an extra one
 *     means the demo offers a toggle the app does not have.
 *   - each key's DEFAULT VALUE. A default that differs is worse than a missing
 *     key, because the demo then shows output the app would never produce, on
 *     the page that tells the user what the app does.
 *
 * Rule BEHAVIOUR is deliberately NOT checked. Diffing two implementations of a
 * ~40-rule pipeline would be a second implementation of the pipeline, and it
 * would drift on its own. When a rule's behaviour changes, the demo is updated
 * by hand and the docs page beside it is the test.
 *
 * Measured at zero divergence on adoption, so it ships zero-tolerance with no
 * baseline: a baseline here would list settings known to behave differently in
 * the demo than in the app.
 *
 * Usage: node scripts/check-cjk-demo-parity.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REAL = "src/lib/cjkFormatter/types.ts";
export const DEMO = "website/.vitepress/components/demos/cjkFormatter.ts";

/** The `key: value` pairs of the first object literal assigned to `name`. */
export function parseDefaults(source, name) {
  const start = source.indexOf(name);
  if (start === -1) throw new Error(`no declaration of \`${name}\``);
  const open = source.indexOf("{", start);
  const close = source.indexOf("\n};", open);
  if (open === -1 || close === -1) throw new Error(`no object literal for \`${name}\``);

  const entries = new Map();
  for (const line of source.slice(open + 1, close).split("\n")) {
    // `  key: value, // comment` — the comment and the trailing comma are noise.
    const match = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(.+?)\s*,?\s*(?:\/\/.*)?$/.exec(line);
    if (match) entries.set(match[1], match[2].replace(/,$/, "").trim());
  }
  if (entries.size === 0) throw new Error(`no entries parsed from \`${name}\``);
  return entries;
}

/** Human-readable failures. Pure apart from the two file reads. */
export function compare(realSource, demoSource) {
  const failures = [];
  const real = parseDefaults(realSource, "DEFAULT_CJK_FORMATTING");
  const demo = parseDefaults(demoSource, "defaultCJKSettings");

  for (const key of real.keys()) {
    if (!demo.has(key)) failures.push(`missing from the demo: \`${key}\``);
  }
  for (const key of demo.keys()) {
    if (!real.has(key)) failures.push(`present only in the demo: \`${key}\``);
  }
  for (const [key, value] of real) {
    const other = demo.get(key);
    if (other !== undefined && other !== value) {
      failures.push(`default differs for \`${key}\`: app ${value}, demo ${other}`);
    }
  }
  return failures;
}

function main() {
  let failures;
  try {
    failures = compare(
      readFileSync(join(root, REAL), "utf8"),
      readFileSync(join(root, DEMO), "utf8")
    );
  } catch (error) {
    // Fail closed: an unreadable or restructured file is a finding, not a pass.
    console.error(`\n❌ CJK demo parity could not be checked: ${error.message}\n`);
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${DEMO} has drifted from ${REAL}:\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "\nThe demo is a hand-maintained fork (VitePress cannot import the real\n" +
        "module — it reaches @tauri-apps/plugin-log through @/utils/debug). Update\n" +
        "the fork's `CJKFormattingSettings` and `defaultCJKSettings` to match.\n"
    );
    process.exit(1);
  }

  console.log("✅ CJK demo settings match the app's.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
