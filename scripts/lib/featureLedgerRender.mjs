/**
 * Markdown rendering for the feature-metrics ledger — the template half of
 * scripts/gen-feature-ledger.mjs, kept apart from measurement so each stays
 * readable on its own. Every value that lands in a table cell goes through
 * `escapeCell`: a `|` in a feature name, flag or date would split the row, a
 * newline would end it, and a backtick, `*`, `_`, `[`, `<` or `~` would open
 * Markdown or HTML inside the cell (audit 20260907 #79); a value shown as code
 * goes through `codeSpan`, whose fence outlasts any backtick run inside. All
 * of it comes from the spine JSON and the CLI, not from anything this module
 * measured.
 *
 * EVERY value, including `defaultsRel`, which is interpolated twice — once in
 * prose and once inside a table CELL. Both sites wrote it between hand-typed
 * backticks, so a backtick in the path would have closed the span early and a
 * `|` would have split the provenance row: the module's own rule, applied
 * everywhere except the two places it was easiest to forget (audit R2 #168).
 *
 * @coordinates-with scripts/gen-feature-ledger.mjs — measures the rows this renders
 * @module scripts/lib/featureLedgerRender
 */

/**
 * Every CommonMark line ending, not just LF and CRLF: a lone CR is one too,
 * and it used to survive `escapeCell` and break the row it was written into
 * (audit R2 #161).
 */
const LINE_ENDING = /\r\n?|\n/g;

/**
 * An `&` that OPENS an HTML entity reference. Escaping every ampersand would
 * spell the ordinary `A & B` as `A \& B` on 15 of this table's rows for
 * nothing; only an entity-shaped one changes what a reader sees (`&copy;`
 * renders as `©`), so only that one is escaped (audit R2 #162).
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
 * unexpected non-number would have been interpolated into the row verbatim
 * (audit R2 #165/#166).
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
 * `NaN%` is not a measurement (audit R2 #163).
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
 * measured", the exact distinction the document's legend draws (audit R2 #164).
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

/** The whole generated document, from measured rows already sorted by code size. */
export function renderLedger(rows, { since, defaultsRel, covPresent }) {
  return `# VMark feature metrics (generated)

Generated by \`node scripts/gen-feature-ledger.mjs\` from \`scripts/feature-map.json\`.
**Do not hand-edit.** Every number below is joined from something this repo
already measures; nothing here is estimated, scored, or graded. The qualitative
companion — what each feature does, how it is reached and gated, what is known
to be unwired or stale — is the hand-inspected \`dev-docs/feature-ledger.md\`,
which cites these cells.

- Churn window: commits since ${codeSpan(since)}.
- \`--\` means **not measured**, which is not the same claim as \`0\`.
- Gate defaults are VERIFIED against ${codeSpan(defaultsRel)} at generation time; a
  disagreement refuses to generate rather than printing the spine's value.
- Coverage source: ${covPresent
    ? "`coverage/coverage-summary.json` (gitignored — regenerate with `pnpm test:coverage`). A cell reads `-- (n/m files)` when the summary holds only some of the feature's coverage-eligible files: the summary lists the files some test loaded, and a fraction is not the feature."
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

Spine paths overlap where two features genuinely share a module (a popup store
counted under both the popup and the math feature, for example), so column
totals across rows double-count and are not a repository total.

## Undocumented features

Features with no \`website/guide\` page in the spine:

${rows.filter((r) => !r.doc).map((r) => `- ${escapeCell(r.name)} (${n(r.code)} lines of code)`).join("\n") || "- none"}

## What this table deliberately does NOT contain

No score, grade, priority, target date, or owner. \`scripts/baseline-review-schedule.json\`
records what happened last time dates were invented for a file like this one and
stamped with somebody else's name. Judgement about what to strengthen belongs in
prose that cites these cells — that prose is \`dev-docs/feature-ledger.md\`,
written by a person and revisited when the numbers move.
`;
}
