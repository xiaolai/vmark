/**
 * Purpose: join every translated guide page to its English page by structure
 *   — the same headings at the same levels in the same order, the same
 *   number of tables with the same number of body rows each, and the same
 *   number of fenced code blocks, Mermaid diagrams and `:::` containers
 *   (WI-RA15C.10). Rows are compared because a row English adds to an
 *   existing table (a new setting, a new rule) is as much a missing piece of
 *   the page as a missing table, and counting tables alone let it pass.
 *
 * The translations had drifted silently: whole sections missing in every
 * locale, sections English had deleted still present, a table English added
 * absent. Text cannot be compared across languages, but structure can, and a
 * section, table or diagram that exists in one language and not the other is
 * exactly the drift a reader of that locale is hurt by. A sentence-level
 * change inside an unchanged structure is not caught here; the translation
 * workflow (`.claude/skills/translate-docs/`) owns that.
 *
 * The locales are the `website/<code>/guide/` directories that exist, so a
 * new locale is checked without editing this file; finding none is a finding.
 * Every English page must exist in every locale, and a locale page with no
 * English page is an orphan. Exit semantics come from check-doc-joins.mjs.
 *
 * Doc-join module contract (consumed by scripts/check-doc-joins.mjs):
 *   `id`, `DEFAULT_PATHS`, `run({ root, paths }) → { findings, info }`.
 *
 * @coordinates-with website/.vitepress/config/sidebarParity.test.ts — the sidebar half of locale parity
 * @module scripts/lib/docJoins/localeStructure
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const id = "locale-structure";

export const DEFAULT_PATHS = { website: "website" };

/**
 * The structural shape of one page: heading levels in order, the body-row
 * count of each table in order, and the counts of tables, fences, Mermaid
 * fences and `:::` containers. A table runs from its delimiter row to the
 * first blank line or line without a `|`. Fenced content is
 * opaque, so a `#` or a `|` inside a code block counts for nothing — and a
 * four-backtick fence that shows a three-backtick example is ONE fence.
 */
export function pageShape(markdown) {
  const headings = [];
  let tables = 0;
  const tableRows = [];
  let inTable = false;
  let fences = 0;
  let mermaid = 0;
  let containers = 0;
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && fence === null) {
      fence = open[1];
      fences++;
      if (/^\s*mermaid\b/.test(open[2])) mermaid++;
      continue;
    }
    if (inTable) {
      if (line.trim() !== "" && line.includes("|")) {
        tableRows[tableRows.length - 1]++;
        continue;
      }
      inTable = false;
    }
    if (fence !== null) {
      // CommonMark: a closing fence uses the opening character, at least as many.
      if (new RegExp(`^\\s*\\${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    const h = /^(#{1,6})\s+\S/.exec(line);
    if (h) headings.push(h[1].length);
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes("|")) {
      tables++;
      tableRows.push(0);
      inTable = true;
    }
    if (/^:::\s*\w/.test(line)) containers++;
  }
  return { headings, tables, tableRows, fences, mermaid, containers };
}

/** Sentences describing how `local` differs from `english`; [] when they match. */
export function compareShapes(english, local) {
  const out = [];
  const a = english.headings;
  const b = local.headings;
  if (a.length !== b.length || a.some((lvl, i) => lvl !== b[i])) {
    const i = a.findIndex((lvl, k) => lvl !== b[k]);
    const at = i === -1 ? Math.min(a.length, b.length) : i;
    out.push(`${b.length} headings, English ${a.length}; first difference at heading ${at + 1} (level ${b[at] ?? "none"}, English ${a[at] ?? "none"})`);
  }
  for (const key of ["tables", "fences", "mermaid", "containers"]) {
    if (english[key] !== local[key]) out.push(`${local[key]} ${key}, English ${english[key]}`);
  }
  // Rows are compared only when the tables line up; otherwise the count
  // finding above already names the drift and positions would be misleading.
  if (english.tables === local.tables) {
    english.tableRows.forEach((rows, i) => {
      if (local.tableRows[i] !== rows) out.push(`table ${i + 1} has ${local.tableRows[i]} rows, English ${rows}`);
    });
  }
  return out;
}

/** Repo-relative `.md` paths under `dir`, recursively, sorted. */
function markdownFiles(root, dir) {
  const out = [];
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...markdownFiles(root, rel));
    else if (entry.name.endsWith(".md")) out.push(rel);
  }
  return out.sort();
}

/** The locale codes with a `<website>/<code>/guide/` directory. */
export function localeCodes(root, website) {
  return readdirSync(resolve(root, website), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "guide" && !e.name.startsWith("."))
    .map((e) => e.name)
    .filter((code) => existsSync(join(resolve(root, website), code, "guide")) && statSync(join(resolve(root, website), code, "guide")).isDirectory())
    .sort();
}

export async function run({ root, paths }) {
  const website = paths.website;
  const locales = localeCodes(root, website);
  if (locales.length === 0) return { findings: [`no ${website}/<locale>/guide/ directory found`], info: [] };
  const englishPages = markdownFiles(root, `${website}/guide`).map((p) => p.slice(`${website}/guide/`.length));
  const findings = [];
  for (const page of englishPages) {
    const english = pageShape(readFileSync(resolve(root, website, "guide", page), "utf8"));
    for (const code of locales) {
      const localPath = resolve(root, website, code, "guide", page);
      if (!existsSync(localPath)) {
        findings.push(`${code}/guide/${page}: missing (English has it)`);
        continue;
      }
      for (const diff of compareShapes(english, pageShape(readFileSync(localPath, "utf8")))) {
        findings.push(`${code}/guide/${page}: ${diff}`);
      }
    }
  }
  const englishSet = new Set(englishPages);
  for (const code of locales) {
    for (const rel of markdownFiles(root, `${website}/${code}/guide`)) {
      const page = rel.slice(`${website}/${code}/guide/`.length);
      if (!englishSet.has(page)) findings.push(`${code}/guide/${page}: no English page (orphan)`);
    }
  }
  return { findings, info: [`${englishPages.length} pages × ${locales.length} locales (${locales.join(", ")})`] };
}
