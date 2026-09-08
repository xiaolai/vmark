/**
 * Purpose: join the Default columns of website/guide/settings.md and
 *   website/guide/terminal.md to src/stores/settingsStore/defaults.ts, in both
 *   directions, so a documented default cannot drift from the shipped one and a
 *   row cannot appear or vanish unnoticed (WI-FL0.4).
 *
 * Why structural and two-way (Codex objection #7): the previous guard,
 * `terminalDocDefaults.test.ts`, transcribed the terminal table by hand and
 * compared the transcription to defaults.ts. A transcription cannot see a row
 * the page has REMOVED — the test kept passing against a row that was gone —
 * and it covered one of the two pages. This module parses every table on both
 * pages, keeps the rows whose header has a `Default` column, and asserts:
 *
 *   - every ROW_MAP entry finds its row (a removed or renamed row is a finding);
 *   - every Default row has a ROW_MAP entry (an added row fails CLOSED until it
 *     is mapped — "docs follow code" only works if the doc cannot grow silently);
 *   - the value defaults.ts ships, rendered the way that page spells it, equals
 *     the row's Default cell.
 *
 * Rendering is explicit per row (`settingsDefaultsRowMap.mjs`): `true` → On,
 * `0.4` → 40% on settings.md but 40 % on terminal.md, enum values through a
 * value→label map in the page's own vocabulary. A default the code computes at
 * runtime (the language auto-detect) or keeps outside defaults.ts (the two
 * per-workspace file-browser rows) is pinned with `{ expected, reason }`; a
 * documented row that is not a persisted default at all (an action button) is
 * claimed with `{ notASetting: reason }`. Both reasons are required.
 *
 * defaults.ts is EXECUTED, not pattern-matched: `tsx`'s `tsImport` runs the
 * real module (it honours the tsconfig `paths` alias for `@/`, and the tsconfig
 * is passed explicitly so the gate does not depend on the caller's cwd), so the
 * `cjkFormatting` spread and every literal are the values the app boots with.
 * Measured on adoption: the import succeeds in plain Node — `resolveInitialLanguage()`
 * guards its `navigator` read, and Node ≥ 21 has a `navigator` global anyway.
 * If it ever fails, `loadDefaults` falls back to the textual parse
 * `parseSettingsDefaults` from scripts/gen-feature-ledger.mjs (dotted key →
 * literal), JSON-parses each literal, spreads `DEFAULT_CJK_FORMATTING` imported
 * from src/lib/cjkFormatter/types.ts, and marks a non-literal initialiser as
 * `{ unresolved }` so a renderer fails loudly on it. `run()` reports which path
 * was taken in `info`.
 *
 * Doc-join module contract (consumed by scripts/check-doc-joins.mjs):
 *   `id`, `DEFAULT_PATHS`, `run({ root, paths, deps }) → { findings, info }`.
 *   `deps.defaults` injects the resolved initialState object and `deps.rowMap`
 *   a row map, for fixture tests.
 *
 * The runner loads join modules by PATH (a computed `import()`), which knip
 * cannot follow, so `scripts/lib/docJoins/*.mjs` is declared a production entry
 * in scripts/knip-production.json — knip's remedy for a computed import — or
 * `pnpm lint:test-only-modules` would report every join as test-only.
 *
 * @coordinates-with scripts/lib/docJoins/settingsDefaultsRowMap.mjs — the row map
 * @coordinates-with scripts/lib/docJoins/markdownTables.mjs — the structural table parser
 * @coordinates-with scripts/gen-feature-ledger.mjs — parseSettingsDefaults, the textual fallback
 * @coordinates-with src/pages/settings/__tests__/terminalDocRanges.test.ts — the Range half that stayed in the app tier
 * @module scripts/lib/docJoins/settingsDefaults
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSettingsDefaults } from "../../gen-feature-ledger.mjs";
import { defaultRows, parseTables, splitRow, stripMarkdown } from "./markdownTables.mjs";
import { ROW_MAP } from "./settingsDefaultsRowMap.mjs";

/** The table parser and the row map, re-exported so this module is the whole join for its consumers and tests. */
export { ROW_MAP, defaultRows, parseTables, splitRow, stripMarkdown };

export const id = "settings-defaults";

export const DEFAULT_PATHS = {
  settingsDoc: "website/guide/settings.md",
  terminalDoc: "website/guide/terminal.md",
  defaults: "src/stores/settingsStore/defaults.ts",
  cjkDefaults: "src/lib/cjkFormatter/types.ts",
};

const PAGES = ["settings", "terminal"];

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

// ── Renderers: a defaults.ts value → the string the page writes ────────────

function expectType(value, type, render) {
  const ok = type === "array" ? Array.isArray(value) : typeof value === type;
  if (!ok) throw new Error(`renderer "${render}" expects ${type === "array" ? "an array" : `a ${type}`}, got ${JSON.stringify(value)}`);
  return value;
}

/** terminal.md writes `13 px` and `40 %`; settings.md writes `13px` and `40%`. */
const unit = (page, symbol) => (page === "terminal" ? ` ${symbol}` : symbol);

export const RENDERERS = {
  onOff: (v) => (expectType(v, "boolean", "onOff") ? "On" : "Off"),
  number: (v) => String(expectType(v, "number", "number")),
  seconds: (v) => `${expectType(v, "number", "seconds")} seconds`,
  px: (v, page) => `${expectType(v, "number", "px")}${unit(page, "px")}`,
  percent: (v, page) => `${Math.round(expectType(v, "number", "percent") * 100)}${unit(page, "%")}`,
  thousands: (v) => expectType(v, "number", "thousands").toLocaleString("en-US"),
  text: (v) => expectType(v, "string", "text") || "(empty)",
  list: (v) => expectType(v, "array", "list").join(", "),
};

/** Render `value` per a ROW_MAP `render` spec (a renderer name, `{ enum }` or `{ suffix, zero? }`); throws on anything it cannot express. */
export function renderDefault(render, value, page) {
  if (typeof render === "string") {
    const fn = RENDERERS[render];
    if (!fn) throw new Error(`unknown renderer "${render}"`);
    return fn(value, page);
  }
  if (render && typeof render === "object") {
    if ("enum" in render) {
      const label = Object.hasOwn(render.enum, String(value)) ? render.enum[String(value)] : undefined;
      if (label === undefined) throw new Error(`no label for value ${JSON.stringify(String(value))} in the enum map`);
      return label;
    }
    if ("suffix" in render) {
      if (value === 0 && render.zero !== undefined) return render.zero;
      return `${expectType(value, "number", "suffix")}${render.suffix}`;
    }
  }
  throw new Error(`unknown renderer ${JSON.stringify(render)}`);
}

/** `defaults.terminal.fontSize` for "terminal.fontSize"; undefined for any missing segment (own properties only). */
export function lookup(defaults, dotted) {
  let cur = defaults;
  for (const part of dotted.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

// ── The join ───────────────────────────────────────────────────────────────

const isPinned = (render) => render !== null && typeof render === "object" && "expected" in render;
const isNotASetting = (render) => render !== null && typeof render === "object" && "notASetting" in render;
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;

/** Shape errors in a row map; each is a finding so a malformed entry cannot pass as a mapped row. */
export function validateRowMap(rowMap) {
  const findings = [];
  const seen = new Set();
  rowMap.forEach((entry, i) => {
    const where = `ROW_MAP[${i}]`;
    if (!PAGES.includes(entry.page)) findings.push(`${where}: page must be one of ${PAGES.join("/")}`);
    if (!nonEmpty(entry.row)) findings.push(`${where}: row text is required`);
    const r = entry.render;
    if (isPinned(r) && !nonEmpty(r.reason)) findings.push(`${where} "${entry.row}": { expected } needs a reason`);
    if (isNotASetting(r) && !nonEmpty(r.notASetting)) findings.push(`${where} "${entry.row}": { notASetting } needs a reason`);
    if (!isPinned(r) && !isNotASetting(r) && !nonEmpty(entry.key)) {
      findings.push(`${where} "${entry.row}": key is required unless the row is { expected } or { notASetting }`);
    }
    const ident = `${entry.page}|${entry.heading ?? ""}|${entry.row}`;
    if (seen.has(ident)) findings.push(`${where} "${entry.row}": duplicate entry for ${entry.page}`);
    seen.add(ident);
  });
  return findings;
}

/**
 * Both directions over `pages` (`{ settings: Table[], terminal: Table[] }`)
 * against the resolved defaults object. `labels` names the files in findings.
 */
export function compare(pages, defaults, rowMap, labels = {}) {
  const findings = validateRowMap(rowMap);
  const info = [];
  const label = (page) => labels[page] ?? `${page}.md`;
  const rows = Object.fromEntries(PAGES.map((p) => [p, defaultRows(pages[p] ?? [])]));
  const claimed = new Set();
  let compared = 0;

  for (const entry of rowMap) {
    if (!PAGES.includes(entry.page)) continue;
    const hits = rows[entry.page].filter((r) => r.row === entry.row && (entry.heading === undefined || r.heading === entry.heading));
    if (hits.length === 0) {
      const under = entry.heading ? ` under "${entry.heading}"` : "";
      findings.push(`${label(entry.page)}: mapped row "${entry.row}"${under} is not documented — add the row, or drop the map entry`);
      continue;
    }
    if (hits.length > 1) {
      findings.push(`${label(entry.page)}: row "${entry.row}" appears in ${hits.length} tables (lines ${hits.map((h) => h.line).join(", ")}) — add \`heading\` to the map entry`);
      continue;
    }
    const hit = hits[0];
    claimed.add(`${entry.page}:${hit.line}`);
    const at = `${label(entry.page)}:${hit.line} "${entry.row}"`;
    if (isNotASetting(entry.render)) continue;
    if (isPinned(entry.render)) {
      compared++;
      if (hit.docDefault !== entry.render.expected) {
        findings.push(`${at}: doc says "${hit.docDefault}", the map pins "${entry.render.expected}" (${entry.render.reason})`);
      }
      continue;
    }
    const value = lookup(defaults, entry.key);
    if (value === undefined) {
      findings.push(`${at}: key ${entry.key} is not in defaults.ts`);
      continue;
    }
    let rendered;
    try {
      rendered = renderDefault(entry.render, value, entry.page);
    } catch (err) {
      findings.push(`${at}: cannot render ${entry.key} = ${JSON.stringify(value)} — ${err.message}`);
      continue;
    }
    compared++;
    if (hit.docDefault !== rendered) findings.push(`${at}: doc says "${hit.docDefault}", code (${entry.key}) says "${rendered}"`);
  }

  for (const page of PAGES) {
    for (const r of rows[page]) {
      if (claimed.has(`${page}:${r.line}`)) continue;
      findings.push(`${label(page)}:${r.line} "${r.row}" has a Default cell ("${r.docDefault}") but no ROW_MAP entry — map it, or mark it { notASetting: reason }`);
    }
    const mapped = rows[page].filter((r) => claimed.has(`${page}:${r.line}`)).length;
    info.push(`${label(page)}: ${rows[page].length} Default rows, ${mapped} mapped`);
  }
  info.push(`${compared} defaults compared`);
  return { findings, info };
}

// ── Loading defaults.ts ────────────────────────────────────────────────────

async function tsImportFrom(root, rel) {
  const { tsImport } = await import("tsx/esm/api");
  return tsImport(pathToFileURL(resolve(root, rel)).href, { parentURL: import.meta.url, tsconfig: resolve(root, "tsconfig.json") });
}

/**
 * Textual fallback: the dotted-key → literal map of `parseSettingsDefaults`
 * rebuilt as a nested object. Literals are JSON-parsed; anything that is not a
 * literal (`resolveInitialLanguage()`) becomes `{ unresolved }`. The one spread
 * defaults.ts contains, `cjkFormatting: { ...DEFAULT_CJK_FORMATTING }`, is
 * supplied as `cjkDefaults`.
 */
export function defaultsFromSource(source, cjkDefaults, parse = parseSettingsDefaults) {
  const out = { cjkFormatting: { ...cjkDefaults } };
  for (const [dotted, raw] of parse(source)) {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = { unresolved: raw };
    }
    const parts = dotted.split(".");
    let cur = out;
    for (const part of parts.slice(0, -1)) cur = cur[part] ??= {};
    cur[parts.at(-1)] = value;
  }
  return out;
}

/** The resolved `initialState`, and a one-line account of how it was obtained. */
export async function loadDefaults(root, paths = DEFAULT_PATHS) {
  const p = { ...DEFAULT_PATHS, ...paths };
  let tsxError;
  try {
    const mod = await tsImportFrom(root, p.defaults);
    if (mod.initialState === null || typeof mod.initialState !== "object") throw new Error(`${p.defaults} exports no initialState object`);
    return { defaults: mod.initialState, via: `executed ${p.defaults} via tsx` };
  } catch (err) {
    tsxError = err;
  }
  const cjk = await tsImportFrom(root, p.cjkDefaults);
  if (cjk.DEFAULT_CJK_FORMATTING === null || typeof cjk.DEFAULT_CJK_FORMATTING !== "object") {
    throw new Error(`${p.cjkDefaults} exports no DEFAULT_CJK_FORMATTING object`);
  }
  const source = readFileSync(resolve(root, p.defaults), "utf8");
  const reason = String(tsxError?.message ?? tsxError).split("\n")[0];
  return { defaults: defaultsFromSource(source, cjk.DEFAULT_CJK_FORMATTING), via: `textual parse of ${p.defaults} (tsx import failed: ${reason})` };
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function run({ root = REPO_ROOT, paths = DEFAULT_PATHS, deps = {} } = {}) {
  const p = { ...DEFAULT_PATHS, ...paths };
  const read = (rel) => readFileSync(resolve(root, rel), "utf8");
  const pages = { settings: parseTables(read(p.settingsDoc)), terminal: parseTables(read(p.terminalDoc)) };
  const loaded = deps.defaults ? { defaults: deps.defaults, via: "injected by the caller" } : await loadDefaults(root, p);
  const { findings, info } = compare(pages, loaded.defaults, deps.rowMap ?? ROW_MAP, { settings: p.settingsDoc, terminal: p.terminalDoc });
  info.push(`defaults: ${loaded.via}`);
  return { findings, info };
}
