/**
 * Markdown rendering for the feature-metrics ledger — the template half of
 * scripts/gen-feature-ledger.mjs, kept apart from measurement so each stays
 * readable on its own. Every value that lands in a table cell goes through
 * `escapeCell`: a `|` in a feature name, flag or date would split the row, a
 * newline would end it, and a backtick, `*`, `_`, `[`, `<` or `~` would open
 * Markdown or HTML inside the cell; a value shown as code
 * goes through `codeSpan`, whose fence outlasts any backtick run inside. All
 * of it comes from the spine JSON and the CLI, not from anything this module
 * measured.
 *
 * EVERY value, including `defaultsRel`, which is interpolated twice — once in
 * prose and once inside a table CELL. Both sites wrote it between hand-typed
 * backticks, so a backtick in the path would have closed the span early and a
 * `|` would have split the provenance row: the module's own rule, applied
 * everywhere except the two places it was easiest to forget.
 *
 * @coordinates-with scripts/gen-feature-ledger.mjs — measures the rows this renders
 * @module scripts/lib/featureLedgerRender
 */
import { STATUS_TAGS, citedPaths, statusTags } from "./featureLedgerDoc.mjs";

/**
 * Every CommonMark line ending, not just LF and CRLF: a lone CR is one too,
 * and it used to survive `escapeCell` and break the row it was written into.
 */
const LINE_ENDING = /\r\n?|\n/g;

/**
 * An `&` that OPENS an HTML entity reference. Escaping every ampersand would
 * spell the ordinary `A & B` as `A \& B` on 15 of this table's rows for
 * nothing; only an entity-shaped one changes what a reader sees (`&copy;`
 * renders as `©`), so only that one is escaped.
 */
const ENTITY_OPENER = /&(?=[A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#[xX][0-9A-Fa-f]+;)/g;

/**
 * A value made safe for a Markdown table cell as PLAIN TEXT: line breaks
 * flattened, and every character that could split the row (`|`) or start
 * Markdown/HTML inside it backslash-escaped — CommonMark honours a backslash
 * before any ASCII punctuation, so the rendered text is the original value.
 */
export const escapeCell = (v) =>
  String(v).replace(LINE_ENDING, " ").replace(/[\\`*_[\]<>|~]/g, "\\$&").replace(ENTITY_OPENER, "\\&");

/**
 * A value as a CODE SPAN: the fence is one backtick longer than the longest
 * backtick run inside (CommonMark), so a backtick in the value cannot close
 * it; a `|` still splits a table row even inside code, so it is escaped.
 */
export function codeSpan(v) {
  const text = String(v).replace(LINE_ENDING, " ").replace(/\|/g, "\\|");
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = longest > 0 ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * A MEASURED count, or `--` for one that is absent. Every numeric cell goes
 * through it: `x || "0"` printed a confident `0` for a missing or `NaN`
 * measurement, which is the one claim this document says it never makes
 * ("`--` means not measured, which is not the same claim as `0`"), and an
 * unexpected non-number would have been interpolated into the row verbatim.
 */
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "--");

/**
 * The Line cov cell: `73.2%` when the summary holds every eligible file;
 * `-- (7/12 files)` when it holds only some (the honest claim is "not
 * measured for this feature", with how partial it is); `--` when there is no
 * summary or nothing eligible (a Rust-only feature).
 *
 * A percentage outside 0–100, or a non-finite one, is REFUSED rather than
 * printed: this table's contract is that every number in it was measured, and
 * `NaN%` is not a measurement.
 */
export function coverageCell(cov, covPresent) {
  if (cov.pct !== null && cov.pct !== undefined) {
    if (typeof cov.pct !== "number" || !Number.isFinite(cov.pct) || cov.pct < 0 || cov.pct > 100) {
      throw new Error(`coverageCell: line coverage ${JSON.stringify(cov.pct)} is not a percentage from 0 through 100`);
    }
    return `${cov.pct.toFixed(1)}%`;
  }
  if (covPresent && cov.expected > 0) return `-- (${n(cov.seen)}/${n(cov.expected)} files)`;
  return "--";
}

/**
 * Test lines ÷ code lines. ZERO test lines against measured code is `0.00`,
 * not `--`: the truthiness test this replaced reported a measured zero as "not
 * measured", the exact distinction the document's legend draws.
 * A zero or absent code count has no ratio at all, so that one stays `--`.
 */
const ratio = (r) =>
  typeof r.code === "number" && r.code > 0 && typeof r.testLines === "number" && Number.isFinite(r.testLines)
    ? (r.testLines / r.code).toFixed(2)
    : "--";
const flagCell = (r) => (r.flag ? `${codeSpan(r.flag)}=${escapeCell(JSON.stringify(r.flagDefault))}` : "always on");
const row = (r, covPresent) =>
  `| ${escapeCell(r.name)} | ${n(r.code)} | ${n(r.srcFiles)} | ${n(r.testFiles)} | ${ratio(r)} | ${coverageCell(r.cov, covPresent)} | ` +
  `${n(r.bigFiles)} | ${n(r.mocks)} | ${n(r.dep)} | ${n(r.coup)} | ${n(r.commits)} | ${escapeCell(r.last)} | ${flagCell(r)} |`;

const tagsOf = (b) => statusTags(b.fields.status);
const isNone = (v) => /^none\b/i.test((v ?? "").trim());
/**
 * A block cites a website page when its `docs` field cites a `website/…md`
 * path. Testing for a leading `none` counted "none directly; see
 * `website/guide/features.md`" as uncited and a block citing only
 * `e2e/README.md` as cited — 13 wrong on the ledger that shipped.
 */
const citesWebsitePage = (b) => citedPaths(b.fields.docs ?? "").some((p) => /^website\/.+\.md$/.test(p));

/** Block counts: total, per status tag, and the two coverage gaps. */
function renderCounts(blocks) {
  const count = (pred) => blocks.filter(pred).length;
  const counts = [
    ["Blocks", blocks.length],
    ...STATUS_TAGS.map((t) => [`Status includes ${t}`, count((b) => tagsOf(b).includes(t))]),
    ["No website page cited", count((b) => !citesWebsitePage(b))],
    ["Tests: none", count((b) => isNone(b.fields.tests))],
  ];
  return `## Ledger counts

Derived from the blocks of \`.claude/feature-ledger.md\`; a block may carry several tags.

| Measure | Count |
|---|--:|
${counts.map(([k, v]) => `| ${escapeCell(k)} | ${n(v)} |`).join("\n")}
`;
}

/** Commits since each feature's blocks were verified, most-changed first. */
function renderFreshness(rows) {
  const fresh = [...rows].sort((a, b) => (b.sinceLedger ?? -1) - (a.sinceLedger ?? -1));
  return `## Ledger freshness

Commits that touched a feature's files since the commit its ledger blocks were
verified against. A non-zero count is not a defect; it is the list of blocks to
re-read next. \`--\` means no block describes the feature.

| Feature | Blocks | Commits since verified |
|---|--:|--:|
${fresh.map((r) => `| ${escapeCell(r.name)} | ${n(r.blocks)} | ${n(r.sinceLedger)} |`).join("\n")}
`;
}

/** One line per block: where it lives, what it is, how it ships. */
function renderIndex(blocks) {
  return `## Ledger at a glance

| Area | Feature | Block | Status | Gate |
|--:|---|---|---|---|
${blocks.map((b) => `| ${n(b.area)} | ${escapeCell(b.fields.feature ?? "--")} | ${escapeCell(b.title)} (${codeSpan(b.fields.id ?? "?")}) | ${escapeCell(tagsOf(b).join(", ") || "--")} | ${escapeCell(b.fields.gate ?? "--")} |`).join("\n")}
`;
}

/**
 * The tables DERIVED from the hand-written ledger: counts, freshness and the
 * at-a-glance index. They used to be typed into the ledger itself, where they
 * restated its own blocks and went stale with every edit.
 */
function renderLedgerSections(rows, ledger) {
  if (!ledger) {
    return "## Ledger\n\n`.claude/feature-ledger.md` is absent, so the ledger tables are not rendered.\n";
  }
  return `${renderCounts(ledger.blocks)}\n${renderFreshness(rows)}\n${renderIndex(ledger.blocks)}`;
}

/** The whole generated document, from measured rows already sorted by code size. */
export function renderLedger(rows, { since, defaultsRel, covPresent, ledger = null }) {
  return `# VMark feature metrics (generated)

Generated by \`node scripts/gen-feature-ledger.mjs\` from \`scripts/feature-map.json\`.
**Do not hand-edit.** Every number below is joined from something this repo
already measures; nothing here is estimated, scored, or graded. The qualitative
companion — what each feature does, how it is reached and gated, what is known
to be unwired or stale — is the hand-inspected \`.claude/feature-ledger.md\`,
which cites these cells.

- Churn window: commits since ${codeSpan(since)}.
- \`--\` means **not measured**, which is not the same claim as \`0\`.
- Gate defaults are VERIFIED against ${codeSpan(defaultsRel)} at generation time; a
  disagreement refuses to generate rather than printing the spine's value.
- Coverage source: ${covPresent
    ? "`coverage/coverage-summary.json` (gitignored — regenerate with `pnpm test:coverage`). A cell reads `-- (n/m files)` when the summary holds only some of the feature's coverage-eligible files. `vitest.config.ts` sets `coverage.include`, so a full run lists every src file, untested ones at 0%; a summary written before that, or under another coverage config, can lack some, and a fraction is not the feature."
    : "**absent.** Run `pnpm test:coverage`, then regenerate. All coverage cells read `--`."}

## Measured

| Feature | Code | Src files | Test files | Test:code | Line cov | Oversized | Mocks | Layering | Coupling | Commits | Last touch | Gate |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|---|
${rows.map((r) => row(r, covPresent)).join("\n")}

### Column provenance

| Column | Joined from | Unit |
|---|---|---|
| Code | \`tokei\`, tests excluded | lines of code (blanks/comments excluded) |
| Src / Test files | \`find\` over \`.ts/.tsx/.rs\` | file count |
| Test:code | test lines ÷ code lines | ratio, not a quality claim |
| Line cov | \`coverage/coverage-summary.json\` | covered ÷ total lines over the feature's coverage-eligible files; \`--\` unless every one is in the summary |
| Oversized | \`scripts/file-size-baseline.json\` | files frozen over the 300-line limit |
| Mocks | \`scripts/mock-boundaries-baseline.json\` | internal modules faked by this feature's tests |
| Layering | \`.dependency-cruiser-known-violations.json\` | frozen import-rule violations originating here |
| Coupling | \`scripts/plugin-store-coupling-baseline.json\` | plugin→host edges |
| Commits / Last touch | \`git log\` | count in window; ISO date |
| Gate | \`scripts/feature-map.json\`, verified against ${codeSpan(defaultsRel)} | setting key = shipped default |

Each file is measured under exactly ONE feature — the most specific spine claim
that covers it (\`scripts/check-feature-map.mjs\` enforces the same rule), so
Code, Src files, Test files, Oversized, Mocks and Layering add up across rows to
the feature-owned total. Nothing else does: Test:code and Line cov are ratios,
Last touch is a date, Coupling is joined by plugin name, and Commits counts
history, where a commit that touches two features counts under both. Files in
\`infrastructure.paths\` belong to no row, so no total includes them.

${renderLedgerSections(rows, ledger)}
## Undocumented features

Features with no \`website/guide\` page in the spine:

${rows.filter((r) => !r.doc).map((r) => `- ${escapeCell(r.name)} (${n(r.code)} lines of code)`).join("\n") || "- none"}

## What this table deliberately does NOT contain

No score, grade, priority, target date, or owner. \`scripts/baseline-review-schedule.json\`
records what happened last time dates were invented for a file like this one and
stamped with somebody else's name. Judgement about what to strengthen belongs in
prose that cites these cells — that prose is \`.claude/feature-ledger.md\`,
written by a person and revisited when the numbers move.
`;
}
