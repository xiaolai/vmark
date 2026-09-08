// WI-1A.8 — Normalized validation gutter.
//
// Consumes ValidationDiagnostic[] from any format's validator() output.
// Single component, single visual language across markdown lint, JSON
// parse errors, YAML parse errors, etc. Phase 2 adapters wire validator
// → SplitPaneEditor → SourcePane → ValidationGutter via props.
//
// With `onJump`, each row's content is a BUTTON (click or Enter/Space calls
// onJump(line, column) so the source pane can move the cursor); without it the
// rows are plain content — nothing focusable, no action for assistive
// technology to announce (audit 20260907, #282).
//
// The rule pill shows the bare id and carries the engine's documented title
// (WI-FL0.3), localized here at the UI boundary — see RuleBadge.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ValidationDiagnostic } from "@/lib/formats/types";
import { ruleTitle } from "@/lib/lintEngine";
import "./validation-gutter.css";

export interface ValidationGutterProps {
  diagnostics: ValidationDiagnostic[];
  onJump?: (line: number, column: number) => void;
}

/** The real `t` for this namespace — see toolbarI18n.ts for why it is not hand-rolled. */
type EditorTranslate = TFunction<"editor">;

// Resolve a diagnostic message:
//   1. If ruleId has a `diagnostic.<ruleId>` translation, use it (with
//      the raw `message` plumbed in as a `{{message}}` interpolation).
//   2. Otherwise fall back to the raw message — library/parser errors
//      that we don't have a localized template for stay readable.
function translateDiagnostic(
  t: EditorTranslate,
  d: ValidationDiagnostic,
): string {
  if (!d.ruleId) return d.message;
  const key = `diagnostic.${d.ruleId}`;
  const translated = t(key, { message: d.message, defaultValue: "" });
  return translated && translated !== key ? translated : d.message;
}

// `t` is RESOLVED ONCE, by the gutter, and passed down. `useTranslation`
// subscribes its component to i18n's change events, so mounting it per row —
// and again per rule pill — put 2N subscriptions behind a list that is
// routinely hundreds of diagnostics long, for one translator that is the same
// object in every one of them (audit 20260907 round 3, #571). A locale change
// still re-renders the whole gutter, because the gutter itself subscribes.
//
// The rule pill is BOTH the localized name of the rule and the handle a user
// looks it up by, so it carries both (audit 20260907, #406 — maintainer
// decision: localize the titles AND keep the id visible).
//
//   * The ID stays the pill's own visible text. It is the key
//     `website/guide/lint.md` documents each rule under, it is identical in
//     every locale, and it is 3–4 tabular characters wide in a row whose
//     message column already ellipsizes.
//   * The TITLE is localized here, at the UI boundary, and rides along as the
//     pill's tooltip and its screen-reader suffix — so the accessible name
//     reads "E05 — <title in the user's language>". It is deliberately not
//     painted a second time: the row's message column beside it already
//     carries the localized diagnostic, of which the title is the leading
//     phrase, so showing it would duplicate that text inside a `nowrap` grid.
//
// `ruleMeta.ts` keeps the ENGLISH title as the canonical string the doc-joins
// gate joins the docs table against, and it is passed here as `defaultValue`:
// a locale missing the key degrades to today's English rather than to a raw
// key. An id the lint engine does not declare — format adapters emit their own
// (`json/syntax`) — has no documented title at all and degrades to the bare id.
function RuleBadge({ id, t }: { id: string; t: EditorTranslate }) {
  const canonical = ruleTitle(id);
  const title = canonical ? t(`lint.rule.${id}`, { defaultValue: canonical }) : undefined;
  const label = title ? `${id} — ${title}` : id;
  return (
    <span className="validation-gutter__rule" title={label}>
      {id}
      {title && <span className="sr-only"> — {title}</span>}
    </span>
  );
}

type SeverityCounts = Record<ValidationDiagnostic["severity"], number>;

/** The three severity counters — glyph + accessible name, not colour alone (R13, WI-UI4.5). */
function ValidationSummary({ counts, t }: { counts: SeverityCounts; t: EditorTranslate }) {
  const rows: [ValidationDiagnostic["severity"], string, string][] = [
    ["error", "✗", t("splitPane.errorCount", { count: counts.error })],
    ["warning", "⚠", t("splitPane.warningCount", { count: counts.warning })],
    ["info", "ℹ", t("splitPane.infoCount", { count: counts.info })],
  ];
  return (
    <div className="validation-gutter__summary" data-testid="validation-summary" role="status">
      {rows.map(([severity, glyph, label]) => (
        <span
          key={severity}
          className="validation-gutter__summary-count"
          data-severity={severity}
          aria-label={label}
        >
          <span aria-hidden="true">{glyph} </span>
          {counts[severity]}
        </span>
      ))}
    </div>
  );
}

/** One diagnostic: location, translated message, rule pill — as a button when
 *  the row can jump, as plain content when it cannot. */
function DiagnosticRow({
  diagnostic: d,
  onJump,
  t,
}: {
  diagnostic: ValidationDiagnostic;
  onJump: ValidationGutterProps["onJump"];
  t: EditorTranslate;
}) {
  const content = (
    <>
      <span className="validation-gutter__location">
        {d.line}:{d.column}
      </span>
      <span className="validation-gutter__message">{translateDiagnostic(t, d)}</span>
      {d.ruleId && <RuleBadge id={d.ruleId} t={t} />}
    </>
  );
  return (
    <li role="listitem" data-severity={d.severity} className="validation-gutter__row">
      {onJump ? (
        <button
          type="button"
          className="validation-gutter__row-content validation-gutter__jump"
          onClick={() => onJump(d.line, d.column)}
        >
          {content}
        </button>
      ) : (
        <div className="validation-gutter__row-content">{content}</div>
      )}
    </li>
  );
}

export function ValidationGutter({ diagnostics, onJump }: ValidationGutterProps) {
  const { t } = useTranslation("editor");
  const counts = useMemo(() => {
    const c: SeverityCounts = { error: 0, warning: 0, info: 0 };
    for (const d of diagnostics) c[d.severity] += 1;
    return c;
  }, [diagnostics]);

  if (diagnostics.length === 0) return null;

  return (
    <div className="validation-gutter">
      <ValidationSummary counts={counts} t={t} />
      <ul
        className="validation-gutter__list"
        role="list"
        aria-label={t("splitPane.validationDiagnostics")}
      >
        {diagnostics.map((d, i) => (
          <DiagnosticRow key={`${d.line}:${d.column}:${i}`} diagnostic={d} onJump={onJump} t={t} />
        ))}
      </ul>
    </div>
  );
}
