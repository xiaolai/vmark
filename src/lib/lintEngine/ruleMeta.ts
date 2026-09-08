/**
 * Markdown Lint Engine — Rule Metadata
 *
 * Purpose: the ONE declaration of every lint rule id with its severity and its
 * canonical ENGLISH title — what the docs gate joins against, and what the
 * diagnostics UI shows beside a bare rule code (`ruleTitle`, through the
 * engine's public surface) when the user's locale has nothing better, so the
 * metadata the docs are checked against is the metadata users see (WI-FL0.3).
 *
 * Why it exists: `website/guide/lint.md` carries a rule table that restates
 * the engine, and nothing joined the two. By 2026-09-07 four rows had drifted —
 * E05 was documented as an Error while the code emits a warning, and the
 * E06/E08/W05 descriptions had rotated onto each other's ids — through every
 * green CI run, because a docs-only change runs no test that reads the rules.
 * `scripts/lib/docJoins/lintTable.mjs` now reads the doc table structurally and
 * asserts id, severity and title equality against this list, both directions.
 *
 * It is also the engine's source of truth for severity (audit 20260907, #405).
 * Each rule module used to redeclare `ruleId` and `severity` inline beside its
 * `createDiagnostic` call, and a synchronization test held the two declarations
 * together by scanning the emitters as source — two sources of truth joined by a
 * regex. Emitters now spread `ruleEmission("<ID>")`, so the severity a rule
 * SHIPS is the severity the docs are checked against, by construction rather
 * than by assertion. `ruleMeta.test.ts` still reads the emitters, but only to
 * prove that none has gone back to a literal and that the emitted id set equals
 * this list — a new rule cannot ship undocumented.
 *
 * Titles are the leading phrase of the documented description: the text before
 * the first ` — `, `: ` or ` (`. The locale message templates stay separate in
 * `src/locales/en/editor.json` — they carry substitutions, and the M/Y ids map
 * to shared keys (`lint.linkNotFound`, `lint.yamlParseError`).
 *
 * The title here is ENGLISH and stays English (audit 20260907, #406). It is the
 * string the doc-joins gate compares against `website/guide/lint.md`, so it has
 * to be the language that page is written in. Localization happens at the UI
 * boundary instead: `ValidationGutter` renders `t("lint.rule.<id>")` with this
 * string as `defaultValue`, which is also why a missing locale key degrades to
 * readable English rather than to a raw key. Translating a title therefore means
 * editing each locale's `editor.json`, never this file — and a title changed
 * here without its `lint.rule.<id>` counterpart leaves the two out of step.
 *
 * Dependency-free on purpose, and that is what makes it usable from BOTH sides:
 * the docs gate evaluates this module outside the app bundle (through tsx), so
 * it imports types only. Anything added here must keep that property — an
 * import that reaches `@tauri-apps/*` or the markdown pipeline would drag the
 * Tauri runtime into a documentation check. The dependency runs one way: the
 * emitters import this file, never the reverse.
 *
 * @coordinates-with src/lib/lintEngine/rules/allRules.ts — the E/W emitters, which read severity from here
 * @coordinates-with src/lib/lintEngine/yaml.ts — Y001 / Y002
 * @coordinates-with src/lib/markdownLinkCheck/check.ts — M001 / M002
 * @coordinates-with scripts/lib/docJoins/lintTable.mjs — joins website/guide/lint.md against RULE_META
 * @coordinates-with website/guide/lint.md — the documented rule table
 * @coordinates-with src/lib/lintEngine/index.ts — re-exports ruleTitle as public surface
 * @coordinates-with src/components/Editor/SplitPaneEditor/ValidationGutter.tsx — localizes ruleTitle() onto the rule pill
 * @coordinates-with src/locales/en/editor.json — the `lint.rule.<id>` titles, one per row here
 * @module lib/lintEngine/ruleMeta
 */
import type { LintDiagnostic } from "./types";

/** One rule as the docs describe it: the id it emits, the severity it emits it at, and its title. */
export interface RuleMeta {
  id: string;
  severity: LintDiagnostic["severity"];
  title: string;
}

/** Every rule id the lint engine, the YAML linter and the link checker can emit.
 *  Frozen, rows included: `readonly` guards only the array at compile time, and
 *  `BY_ID` shares these objects, so a mutable row would be a write to every
 *  reader (audit 20260907). */
const RULE_ROWS = [
    { id: "E01", severity: "error", title: "Undefined reference" },
    { id: "E02", severity: "error", title: "Table row has wrong column count" },
    { id: "E03", severity: "error", title: "Reversed link" },
    { id: "E04", severity: "error", title: "ATX heading missing space after `#`" },
    { id: "E05", severity: "warning", title: "Space inside emphasis markers" },
    { id: "E06", severity: "error", title: "Empty link text" },
    { id: "E07", severity: "error", title: "Duplicate link reference definition" },
    { id: "E08", severity: "error", title: "Unclosed fenced code block" },
    { id: "W01", severity: "warning", title: "Heading level skipped" },
    { id: "W02", severity: "warning", title: "Image missing alt text" },
    { id: "W03", severity: "warning", title: "Unused link reference definition" },
    { id: "W04", severity: "warning", title: "Anchor fragment doesn't match any heading" },
    { id: "W05", severity: "warning", title: "Empty link `href`" },
    { id: "M001", severity: "error", title: "Image file not found at the local path" },
    { id: "M002", severity: "error", title: "Linked file not found at the local path" },
    { id: "Y001", severity: "error", title: "YAML parse error" },
    { id: "Y002", severity: "warning", title: "YAML parse warning" },
] as const satisfies readonly RuleMeta[];

/** Every id this engine can emit — the closed set `ruleEmission` accepts. */
export type RuleId = (typeof RULE_ROWS)[number]["id"];

export const RULE_META: readonly Readonly<RuleMeta>[] = Object.freeze(
  RULE_ROWS.map((m) => Object.freeze(m)),
);

const BY_ID: ReadonlyMap<string, (typeof RULE_ROWS)[number]> = new Map(
  RULE_ROWS.map((m) => [m.id, m]),
);

/**
 * The `{ ruleId, severity }` pair an emitter spreads into `createDiagnostic`.
 *
 * This is the whole of #405: a rule states its id ONCE, here at the call site,
 * and its severity comes back from the table the docs are joined against — so
 * the two cannot disagree, rather than being checked for agreeing.
 *
 * A FRESH object each call: `RULE_META`'s rows are shared and frozen, and
 * handing one out would let a caller's spread target — or a mutation — reach
 * every other reader of that row.
 */
export function ruleEmission(id: RuleId): {
  ruleId: RuleId;
  severity: LintDiagnostic["severity"];
} {
  // Unreachable through the type, but the gate this file exists to be cannot
  // fail SILENTLY if a caller reaches it from untyped code.
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`Unknown lint rule id: ${id}`);
  return { ruleId: meta.id, severity: meta.severity };
}

/**
 * The documented ENGLISH title for a rule id — the canonical string the docs are
 * joined against, and the `defaultValue` the diagnostics UI translates over
 * (`lint.rule.<id>`) — or `undefined` for an id this engine does not declare
 * (format adapters emit their own, e.g. `json/syntax`), so callers degrade to
 * the bare id and look up no key for it. Exact match: ids are case-sensitive
 * identifiers.
 */
export function ruleTitle(id: string): string | undefined {
  return BY_ID.get(id)?.title;
}
