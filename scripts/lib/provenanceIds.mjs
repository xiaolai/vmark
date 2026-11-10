/**
 * Provenance ids in production comments — what they are and whether they
 * resolve. The pure half of `scripts/check-provenance-ids.mjs`.
 *
 * Purpose: a production comment may say WHY a line exists by citing where the
 * decision was made — a work item (`WI-RA27.1`) or a dated audit
 * (`audit <date> #<n>`). Such a citation is only worth its place if a reader
 * of a fresh clone can follow it. This module finds the citations and decides,
 * offline and from tracked files alone, which of them can be followed.
 *
 * Resolution (a token that does not resolve is a finding):
 *   - A NAMESPACED work item (`WI-RA27.1`, `WI-RA17E.5`, letters after `WI-`)
 *     resolves when exactly one tracked plan mentions it, or when a tracked
 *     plan that mentions it is named in the same file's comments.
 *   - A BARE work item (`WI-<n>.<m>`, digits straight after `WI-`) resolves
 *     only when a tracked plan that mentions it is named in the same file's
 *     comments. Every plan numbers its items from 1, so a bare id with no
 *     plan beside it names a dozen plans at once — or, when the plan it came
 *     from was never tracked, a different plan's item that happens to share
 *     the number.
 *   - An AUDIT citation — `audit` followed by an identifier (`audit
 *     <date> #<n>`, `audit R<n> #<n>`, `audit-fix H<n>`, `audit round <n>`) —
 *     resolves when it carries a date and a tracked audit record for that date
 *     exists (`.cc-suite/audits/`, `.claude/tdd-guardian/audit-*`). An
 *     undated citation names no record at all.
 *   - `audit #480` alone (only `#N` after the word) is an ISSUE reference:
 *     audit findings were filed as `[audit]` GitHub issues, so it is reported
 *     as kind `issue` and, like every issue number, not judged here.
 *   - Tracked plans are `.claude/tdd-guardian/*.md` and `.claude/adr/plans/*.md`.
 *     `dev-docs/` is maintainer-local (gitignored): a clone cannot read it, so
 *     it never makes a token resolve.
 *
 * Key decisions:
 *   - Commit history is NOT a resolver. A commit subject tagged `(WI-<n>)` is
 *     one of dozens with that tag, and history depends on how the tree was
 *     cloned; a gate that reads it gives different answers on different
 *     machines. Plans and audit records are files in the tree, so the verdict
 *     is a function of the checkout alone.
 *   - Issue numbers (`#1081`) are not checked: deciding whether an issue
 *     exists needs the network, and whether its title fits the comment needs
 *     judgment. A `#N` inside an audit citation is part of that citation.
 *   - Test files are out of scope: a test header is where a WI id belongs
 *     (`scripts/check-wi-linkage.sh` reads it there).
 *   - The tooling is in scope (`TOOLING_TREES`), shell scripts included: a
 *     gate's comment that cites an id a clone cannot resolve leaves the
 *     contributor it blocks without the reason.
 *
 * @coordinates-with scripts/lib/sourceComments.mjs — every comment of a file, with offsets
 * @coordinates-with scripts/check-provenance-ids.mjs — the CLI over these functions
 * @coordinates-with scripts/check-provenance-ids.test.mjs — drives every rule here
 * @coordinates-with .claude/rules/22-comment-maintenance.md — the rule this enforces
 * @module scripts/lib/provenanceIds
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { commentRuns, isCommentedSource, lineAt } from "./sourceComments.mjs";

const posix = path.posix;

/** Production source trees, repo-relative. */
const PRODUCTION_TREES = [
  "src",
  "src-tauri/src",
  "server/mcp/src",
  "server/mcp/scripts",
  "server/content/src",
  "server/content/scripts",
  "e2e",
];
/**
 * The tooling: the gates, generators and phase checkers under `scripts/`, and
 * the Claude Code hooks that run on every edit. Production code for the
 * comment rules — their comments explain why a gate decides what it decides,
 * and a contributor whose change it blocks reads them from a clone.
 */
const TOOLING_TREES = ["scripts", ".claude/hooks"];
/** Every tree the comment rules read: production source and the tooling. */
export const COMMENT_RULE_TREES = [...PRODUCTION_TREES, ...TOOLING_TREES];
/** A file whose comments the rules read: the languages `comments` parses, plus shell scripts, read line-wise. */
export const isRuleSource = (file) => isCommentedSource(file) || file.endsWith(".sh");
const PLAN_DIRS = [".claude/tdd-guardian", ".claude/adr/plans"];
const AUDIT_DIRS = [".cc-suite/audits", ".claude/tdd-guardian"];

const SKIP_DIRS = new Set(["node_modules", "dist", "target", "coverage", "generated", ".git"]);

/** Test code — where a WI id is expected (a test header), not a finding. */
export function isTestPath(rel) {
  return (
    /\.(test|spec|bench|webkit\.test)\.[^/]+$/.test(rel) ||
    /(^|\/)(__tests__|__mocks__|__fixtures__|fixtures|tests?)\//.test(rel) ||
    rel.startsWith("src/test/") ||
    rel.startsWith("e2e/journeys/") ||
    /(^|\/|_)tests?\.rs$/.test(rel)
  );
}

/** Production files under `root` that `accept` (by default: a language `comments` reads), repo-relative and sorted. */
export function productionFiles(root, trees = PRODUCTION_TREES, accept = isCommentedSource) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(root, rel)).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const child = posix.join(rel, name);
      const stat = statSync(path.join(root, child), { throwIfNoEntry: false });
      if (stat?.isDirectory()) walk(child);
      else if (stat?.isFile() && accept(child) && !isTestPath(child)) out.push(child);
    }
  };
  for (const tree of trees) if (existsSync(path.join(root, tree))) walk(tree);
  return out;
}

const WI_RE = /(?<![\w-])WI-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*/g;
const DATE = String.raw`20\d{6}(?:-\d{6})?|20\d\d-\d\d-\d\d`;
// `audit` (or `audit-fix`, `audit-followups`, …) and the identifiers that
// follow it before the clause ends: a date, `#N`, `R2`, `round 3`, `rounds 1
// and 2`, `finding 10`, or a finding code (`H12`, `C3`, `S-12`), optionally
// behind a keyword (`finding`, `verification`). A citation may wrap onto the
// next comment line, so a newline plus that line's `//`, `///`, `//!` or `*`
// separates like a space does.
const SEP = String.raw`(?:[ \t,/]|\r?\n[ \t]*(?:\/\/[\/!]?|\*(?!\/))?)`;
const ID = String.raw`(?:${DATE}|#\d+|R\d+\b|rounds? \d+(?: and \d+)?\b|findings? #?\d+\b|[A-Z][A-Za-z]*-?\d+\b)`;
const KEYWORD = String.raw`(?:findings?|verification)`;
const AUDIT_RE = new RegExp(
  String.raw`\baudit(?:-[a-z]+)?\b(?<tail>${SEP}+(?:${KEYWORD}${SEP}*)?${ID}(?:${SEP}*(?:${ID}|${KEYWORD}))*)`,
  "gi",
);

/** Provenance tokens in one comment's text: `{ kind, token, index, end, date? }` — `end` closes the raw match. */
export function tokensIn(text) {
  const out = [];
  for (const m of text.matchAll(WI_RE)) out.push({ kind: "wi", token: m[0], index: m.index, end: m.index + m[0].length });
  for (const m of text.matchAll(AUDIT_RE)) {
    const token = m[0].trim().replace(/\s*\r?\n[ \t]*(?:\/\/[/!]?|\*)?\s*/g, " ");
    const date = new RegExp(DATE).exec(m.groups.tail)?.[0];
    const kind = !date && /^(?:[\s,/!*]|#\d+)*#\d+(?:[\s,/!*]|#\d+)*$/.test(m.groups.tail) ? "issue" : "audit";
    out.push({ kind, token, index: m.index, end: m.index + m[0].length, date: date ? date.replace(/-/g, "").slice(0, 8) : null });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Tracked plans: `{ path, text }` for every `*.md` in `PLAN_DIRS`. */
function readPlans(root) {
  const plans = [];
  for (const dir of PLAN_DIRS) {
    if (!existsSync(path.join(root, dir))) continue;
    for (const name of readdirSync(path.join(root, dir)).sort()) {
      if (name.endsWith(".md")) plans.push({ path: `${dir}/${name}`, text: readFileSync(path.join(root, dir, name), "utf8") });
    }
  }
  return plans;
}

/** Dates (`YYYYMMDD`) that have a tracked audit record. */
export function auditDates(root) {
  const dates = new Set();
  for (const dir of AUDIT_DIRS) {
    if (!existsSync(path.join(root, dir))) continue;
    for (const name of readdirSync(path.join(root, dir))) {
      const m = /audit\D*?(20\d{6})/.exec(name);
      if (m) dates.add(m[1]);
    }
  }
  return dates;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The tracked plans that mention `id` as a whole token. */
function plansMentioning(plans, id) {
  const re = new RegExp(`(?<![\\w-])${escape(id)}(?![\\w]|\\.[A-Za-z0-9])`);
  return plans.filter((p) => re.test(p.text)).map((p) => p.path);
}

/** Does any comment in the file name `planPath` (by path or file name)? */
const names = (commentText, planPath) => commentText.includes(planPath) || commentText.includes(posix.basename(planPath));

/**
 * Verdict for one token: `null` when it resolves, else the reason it does not.
 * `ctx` = `{ plans, dates, commentText }` (commentText: all of the file's comments).
 */
function unresolvedReason(tok, ctx) {
  if (tok.kind === "issue") return null;
  if (tok.kind === "audit") {
    if (!tok.date) return "an audit citation with no date names no record";
    return ctx.dates.has(tok.date) ? null : `no tracked audit record for ${tok.date}`;
  }
  const defining = plansMentioning(ctx.plans, tok.token);
  if (defining.some((p) => names(ctx.commentText, p))) return null;
  if (defining.length === 0) return "no tracked plan defines it";
  if (/^WI-\d/.test(tok.token)) return "a bare work-item id with no plan named beside it";
  return defining.length === 1 ? null : `defined by ${defining.length} tracked plans`;
}

/** Every token in `source`'s comments, each with `line` and `reason` (null = resolves). */
function scanSource(source, file, ctx) {
  const found = [];
  const all = commentRuns(source, file);
  const commentText = all.map((c) => c.text).join("\n");
  for (const c of all) {
    for (const tok of tokensIn(c.text)) {
      found.push({ ...tok, file, line: lineAt(source, c.start + tok.index), reason: unresolvedReason(tok, { ...ctx, commentText }) });
    }
  }
  return found;
}

/** Every provenance token in the comments of `trees` (by default production source and the tooling), resolved. */
export function scanTree(root, trees = COMMENT_RULE_TREES) {
  const ctx = { plans: readPlans(root), dates: auditDates(root) };
  const out = [];
  for (const file of productionFiles(root, trees, isRuleSource)) {
    const source = readFileSync(path.join(root, file), "utf8");
    if (!/WI-|audit/i.test(source)) continue;
    out.push(...scanSource(source, file, ctx));
  }
  return out;
}
