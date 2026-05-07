// WI-1A.8 — Normalized validation gutter.
//
// Consumes ValidationDiagnostic[] from any format's validator() output.
// Single component, single visual language across markdown lint, JSON
// parse errors, YAML parse errors, etc. Phase 2 adapters wire validator
// → SplitPaneEditor → SourcePane → ValidationGutter via props.
//
// Click or Enter on a row calls onJump(line, column) so the source pane
// can move the cursor to the diagnostic.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ValidationDiagnostic } from "@/lib/formats/types";
import "./validation-gutter.css";

export interface ValidationGutterProps {
  diagnostics: ValidationDiagnostic[];
  onJump?: (line: number, column: number) => void;
}

type EditorTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

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

export function ValidationGutter({ diagnostics, onJump }: ValidationGutterProps) {
  const { t } = useTranslation("editor");
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const d of diagnostics) c[d.severity] += 1;
    return c;
  }, [diagnostics]);

  if (diagnostics.length === 0) return null;

  return (
    <div className="validation-gutter">
      <div
        className="validation-gutter__summary"
        data-testid="validation-summary"
        role="status"
      >
        <span className="validation-gutter__summary-count" data-severity="error">
          {counts.error}
        </span>
        <span className="validation-gutter__summary-count" data-severity="warning">
          {counts.warning}
        </span>
        <span className="validation-gutter__summary-count" data-severity="info">
          {counts.info}
        </span>
      </div>
      <ul
        className="validation-gutter__list"
        role="list"
        aria-label={t("splitPane.validationDiagnostics")}
      >
        {diagnostics.map((d, i) => (
          <li
            key={`${d.line}:${d.column}:${i}`}
            role="listitem"
            tabIndex={0}
            data-severity={d.severity}
            className="validation-gutter__row"
            onClick={() => onJump?.(d.line, d.column)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onJump?.(d.line, d.column);
              }
            }}
          >
            <span className="validation-gutter__location">
              {d.line}:{d.column}
            </span>
            <span className="validation-gutter__message">
              {translateDiagnostic(t, d)}
            </span>
            {d.ruleId && (
              <span className="validation-gutter__rule">{d.ruleId}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ValidationGutter;
