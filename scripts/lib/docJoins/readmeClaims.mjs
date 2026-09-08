/**
 * Purpose: join README.md's feature claims to the registries they restate, so
 *   the README cannot drift from the code without a gate going red (WI-FL0.5).
 *
 * Four claims, four registries:
 *
 *   | README claim                            | Registry                                            |
 *   |-----------------------------------------|-----------------------------------------------------|
 *   | `Supported: …` line + AI-Native bullet  | non-`legacy` entries of `PROVIDERS` (providers.rs)  |
 *   | `- **[N ]Shortcuts**` bullet            | object literals in `DEFAULT_SHORTCUTS`              |
 *   | `- **[N ]Languages** — a · b · c.`      | `ALL_LANGUAGES` labels (LanguageSettings.tsx)       |
 *   | `- **[N ]Themes** — …` (shape below)    | `themes` catalog + `NON_MAC_THEME_IDS`              |
 *
 * Counts are OPTIONAL and checked when present: `**Shortcuts**` and
 * `**127 Shortcuts**` both pass, `**122 Shortcuts**` fails. A README is free
 * to stop counting; it is not free to count wrong.
 *
 * Themes sentence shape — asserted exactly, because the platform qualification
 * is the point (Windows and Linux draw their own chrome and offer only the
 * light/dark pair, `themeAvailability.ts`):
 *
 *   - **N Themes** — <every catalog theme, comma-separated> on macOS; Windows and Linux offer <A and B>.
 *
 * where `<A and B>` are the `NON_MAC_THEME_IDS` themes. Theme names compare
 * case- and punctuation-insensitively to the catalog ids ("Solarized" ↔ its
 * lowercase id); every list compares as a multiset, order-insensitive.
 *
 * A LEGACY provider is one VMark no longer targets (providers.rs: install and
 * preview refuse it, only removal is offered). Any README line naming one is a
 * finding — README-wide, not just at the two MCP claim sites, because a dead
 * target reads as supported wherever it appears.
 *
 * The registries are read from source text by `readmeRegistries.mjs`, whose
 * parsers THROW on a declaration they cannot find; `run()` turns each throw
 * into a finding naming the file, so one broken registry does not hide the
 * others.
 *
 * Doc-join module contract (consumed by scripts/check-doc-joins.mjs):
 *   `id`, `DEFAULT_PATHS`, `run({ root, paths }) → { findings, info }`.
 *
 * @coordinates-with scripts/lib/docJoins/readmeRegistries.mjs — reads the four registries
 * @coordinates-with README.md — the claims
 * @module scripts/lib/docJoins/readmeClaims
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countShortcutDefinitions,
  parseLanguages,
  parseNonMacThemeIds,
  parseProviders,
  parseThemeIds,
} from "./readmeRegistries.mjs";

/** The registry parsers, re-exported so this module is the whole join for its consumers and tests. */
export { countShortcutDefinitions, parseLanguages, parseNonMacThemeIds, parseProviders, parseThemeIds };

export const id = "readme-claims";

export const DEFAULT_PATHS = {
  readme: "README.md",
  providers: "src-tauri/src/mcp_config/providers.rs",
  shortcuts: "src/stores/settingsStore/shortcutDefinitions.ts",
  languages: "src/pages/settings/LanguageSettings.tsx",
  themes: "src/theme/themes/index.ts",
  themeAvailability: "src/theme/themeAvailability.ts",
};

// ── README claims ──────────────────────────────────────────────────────────

/** "A, B, and C" / "A and B" → ["A", "B", "C"]. */
function splitList(text) {
  return text
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lower-case alphanumerics only: "Solarized Dark" and `solarized-dark` compare equal. */
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Multiset difference; null when `actual` and `expected` hold the same items. */
function multisetDiff(actual, expected) {
  const tally = new Map();
  for (const x of expected) tally.set(x, (tally.get(x) ?? 0) + 1);
  const extra = [];
  for (const x of actual) {
    if ((tally.get(x) ?? 0) > 0) tally.set(x, tally.get(x) - 1);
    else extra.push(x);
  }
  const missing = [...tally].flatMap(([x, n]) => Array(n).fill(x));
  return missing.length || extra.length ? { missing, extra } : null;
}

const fmt = (items) => (items.length ? items.map((x) => `"${x}"`).join(", ") : "none");

/** The `- **[N ]Noun** — rest` bullet, or null. `count` is null for a non-numeric claim. */
function claimBullet(lines, noun) {
  const pattern = new RegExp(`^- \\*\\*(?:(\\d+) )?${noun}\\*\\*(?: — (.*))?$`);
  for (let i = 0; i < lines.length; i++) {
    const m = pattern.exec(lines[i]);
    if (m) return { index: i, count: m[1] === undefined ? null : Number(m[1]), rest: m[2] ?? "" };
  }
  return null;
}

/**
 * Check every README claim against `registries`
 * (`{ providers, languages, themeIds, nonMacThemeIds, shortcutCount }`).
 * Pure: takes text, returns `{ findings, info }`; `label` prefixes each line.
 */
export function checkReadme(readme, registries, label = "README.md") {
  const { providers, languages, themeIds, nonMacThemeIds, shortcutCount } = registries;
  const lines = readme.split("\n");
  const at = (index) => `${label}:${index + 1}`;
  const findings = [];

  // (a) MCP targets: the Supported line, the AI-Native bullet, and no legacy name anywhere.
  const current = providers.filter((p) => !p.legacy).map((p) => p.name);
  const legacy = providers.filter((p) => p.legacy).map((p) => p.name);
  lines.forEach((line, i) => {
    for (const name of legacy) {
      if (line.includes(name)) {
        findings.push(`${at(i)} mentions legacy MCP provider "${name}" — VMark no longer targets it (providers.rs: legacy: true)`);
      }
    }
  });
  const supported = lines.findIndex((line) => /^Supported:/.test(line));
  if (supported === -1) {
    findings.push(`${label}: no "Supported: …" line — the MCP target list under AI Integration`);
  } else {
    const listed = splitList(lines[supported].replace(/^Supported:\s*/, "").replace(/\.\s*$/, ""));
    const known = new Set(providers.map((p) => p.name));
    for (const name of current) {
      if (!listed.includes(name)) findings.push(`${at(supported)} "Supported:" line is missing MCP target "${name}" (non-legacy in providers.rs)`);
    }
    for (const name of listed) {
      if (!known.has(name)) findings.push(`${at(supported)} "Supported:" line names "${name}", which is not a provider in providers.rs`);
    }
  }
  const aiNative = lines.findIndex((line) => /^- \*\*AI-Native\*\*/.test(line));
  if (aiNative === -1) {
    findings.push(`${label}: no "- **AI-Native**" bullet — the MCP feature claim under Highlights`);
  } else {
    for (const name of current) {
      if (!lines[aiNative].includes(name)) findings.push(`${at(aiNative)} "AI-Native" bullet does not mention MCP target "${name}"`);
    }
  }

  // (b) Shortcuts: a count, if given, equals the number of definitions.
  const shortcuts = claimBullet(lines, "Shortcuts");
  if (!shortcuts) {
    findings.push(`${label}: no "- **Shortcuts**" (or "- **N Shortcuts**") bullet under Highlights`);
  } else if (shortcuts.count !== null && shortcuts.count !== shortcutCount) {
    findings.push(`${at(shortcuts.index)} claims ${shortcuts.count} shortcuts; DEFAULT_SHORTCUTS defines ${shortcutCount} — drop the number or match it`);
  }

  // (c) Languages: the list is exactly the ALL_LANGUAGES labels; a count, if given, matches.
  const langs = claimBullet(lines, "Languages");
  if (!langs) {
    findings.push(`${label}: no "- **Languages**" (or "- **N Languages**") bullet under Highlights`);
  } else {
    const labels = languages.map((l) => l.label);
    if (langs.count !== null && langs.count !== labels.length) {
      findings.push(`${at(langs.index)} claims ${langs.count} languages; ALL_LANGUAGES has ${labels.length}`);
    }
    const listed = langs.rest.split(/\.\s|\.$/)[0].split("·").map((s) => s.trim()).filter(Boolean);
    const diff = multisetDiff(listed, labels);
    if (diff) findings.push(`${at(langs.index)} language list ≠ ALL_LANGUAGES labels — missing: ${fmt(diff.missing)}; extra: ${fmt(diff.extra)}`);
  }

  // (d) Themes: every catalog theme on macOS, the NON_MAC pair elsewhere, in the exact sentence shape.
  const themes = claimBullet(lines, "Themes");
  if (!themes) {
    findings.push(`${label}: no "- **Themes**" (or "- **N Themes**") bullet under Highlights`);
  } else {
    const shape = /^(.+?) on macOS; Windows and Linux offer (.+?)\.?$/.exec(themes.rest);
    if (!shape) {
      findings.push(
        `${at(themes.index)} themes bullet must read "- **N Themes** — <every catalog theme> on macOS; Windows and Linux offer <the NON_MAC_THEME_IDS themes>." — got: ${lines[themes.index]}`,
      );
    } else {
      if (themes.count !== null && themes.count !== themeIds.length) {
        findings.push(`${at(themes.index)} claims ${themes.count} themes; the catalog has ${themeIds.length}`);
      }
      const macDiff = multisetDiff(splitList(shape[1]).map(norm), themeIds.map(norm));
      if (macDiff) findings.push(`${at(themes.index)} macOS theme list ≠ catalog — missing: ${fmt(macDiff.missing)}; extra: ${fmt(macDiff.extra)}`);
      const otherDiff = multisetDiff(splitList(shape[2]).map(norm), nonMacThemeIds.map(norm));
      if (otherDiff) findings.push(`${at(themes.index)} Windows and Linux theme list ≠ NON_MAC_THEME_IDS — missing: ${fmt(otherDiff.missing)}; extra: ${fmt(otherDiff.extra)}`);
    }
  }

  const shortcutClaim = shortcuts ? (shortcuts.count === null ? "non-numeric claim" : "numeric claim") : "no claim";
  const info = [
    `${label}: ${current.length} MCP targets, ${shortcutCount} shortcuts (${shortcutClaim}), ${languages.length} languages, ${themeIds.length} themes (${nonMacThemeIds.length} off macOS)`,
  ];
  return { findings, info };
}

/** Read every registry and the README under `root`; a registry that cannot be parsed is a finding naming its file. */
export async function run({ root, paths = DEFAULT_PATHS } = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("readmeClaims.run({ root }) requires the repository root");
  const read = (rel) => readFileSync(resolve(root, rel), "utf8");
  const findings = [];
  const registries = {};
  const parsers = [
    ["providers", paths.providers, parseProviders],
    ["shortcutCount", paths.shortcuts, countShortcutDefinitions],
    ["languages", paths.languages, parseLanguages],
    ["themeIds", paths.themes, parseThemeIds],
    ["nonMacThemeIds", paths.themeAvailability, parseNonMacThemeIds],
  ];
  for (const [key, rel, parse] of parsers) {
    try {
      registries[key] = parse(read(rel));
    } catch (err) {
      findings.push(`${rel}: ${err.message}`);
    }
  }
  let readme;
  try {
    readme = read(paths.readme);
  } catch (err) {
    findings.push(`${paths.readme}: ${err.message}`);
  }
  if (findings.length > 0) return { findings, info: [] };
  return checkReadme(readme, registries, paths.readme);
}
