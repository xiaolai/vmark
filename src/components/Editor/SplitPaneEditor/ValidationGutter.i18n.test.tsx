/**
 * Audit 20260907 (#406) — the rule pill's TITLE is localized at the UI boundary.
 *
 * `ruleMeta.ts` keeps the English title as the canonical string the doc-joins
 * gate joins `website/guide/lint.md` against; the pill renders
 * `t("lint.rule.<id>")` over it with that English string as `defaultValue`. Three
 * behaviours follow, and the global test i18n mock can distinguish none of them
 * — it resolves the real English bundle, so it returns the same text whether the
 * component translated or not. This file substitutes a dictionary it controls.
 *
 * @coordinates-with src/components/Editor/SplitPaneEditor/ValidationGutter.tsx — the subject
 * @coordinates-with src/lib/lintEngine/ruleMeta.ts — the canonical English titles
 * @coordinates-with src/locales/en/editor.json — the `lint.rule.*` keys
 * @module components/Editor/SplitPaneEditor/ValidationGutter.i18n.test
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValidationDiagnostic } from "@/lib/formats/types";

const { dictionary } = vi.hoisted(() => ({ dictionary: new Map<string, string>() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      dictionary.get(key) ?? opts?.defaultValue ?? key,
    i18n: { language: "es" },
  }),
}));

import { ValidationGutter } from "./ValidationGutter";

/** E05 is declared by the lint engine, so RULE_META carries an English title for it. */
const e05: ValidationDiagnostic = {
  severity: "warning",
  line: 3,
  column: 5,
  message: "Space inside emphasis markers",
  ruleId: "E05",
};

/** A format adapter's own id — the lint engine declares no title for it. */
const adapterDiagnostic: ValidationDiagnostic = {
  severity: "error",
  line: 12,
  column: 4,
  message: "Unexpected token",
  ruleId: "json/syntax",
};

const SPANISH_E05 = "Espacio dentro de los marcadores de énfasis";

afterEach(() => {
  dictionary.clear();
  cleanup();
});

describe("ValidationGutter rule pill — localized title (#406)", () => {
  it("renders the locale's title for a rule the locale declares", () => {
    dictionary.set("lint.rule.E05", SPANISH_E05);
    render(<ValidationGutter diagnostics={[e05]} />);
    const badge = screen.getByTitle(`E05 — ${SPANISH_E05}`);
    expect(badge).toHaveClass("validation-gutter__rule");
    expect(badge).toHaveTextContent(SPANISH_E05);
  });

  it("keeps the rule id visible beside the translated title, so the docs lookup still works", () => {
    dictionary.set("lint.rule.E05", SPANISH_E05);
    render(<ValidationGutter diagnostics={[e05]} />);
    const badge = screen.getByTitle(`E05 — ${SPANISH_E05}`);
    // The id is the pill's own visible text; the title follows it as the
    // tooltip and as screen-reader-only text, never replacing the id.
    expect(badge.firstChild?.textContent).toBe("E05");
    expect(badge.textContent).toBe(`E05 — ${SPANISH_E05}`);
  });

  it("falls back to the engine's English title when the locale has no key for the rule", () => {
    render(<ValidationGutter diagnostics={[e05]} />); // dictionary deliberately empty
    const badge = screen.getByTitle("E05 — Space inside emphasis markers");
    expect(badge.textContent).toBe("E05 — Space inside emphasis markers");
  });

  it("degrades to the bare id for a rule the lint engine does not declare", () => {
    // Even with a key present, an id the engine does not declare has no
    // documented title to localize — the pill must not invent one.
    dictionary.set("lint.rule.json/syntax", "no debería usarse");
    render(<ValidationGutter diagnostics={[adapterDiagnostic]} />);
    const badge = screen.getByTitle("json/syntax");
    expect(badge.textContent).toBe("json/syntax");
  });
});
