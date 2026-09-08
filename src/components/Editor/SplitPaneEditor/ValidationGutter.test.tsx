// WI-1A.8 — ValidationGutter tests.

import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ValidationDiagnostic } from "@/lib/formats/types";
import { ValidationGutter } from "./ValidationGutter";

const errorDiag: ValidationDiagnostic = {
  severity: "error",
  line: 12,
  column: 4,
  message: "Unexpected token",
  ruleId: "json/syntax",
};
const warningDiag: ValidationDiagnostic = {
  severity: "warning",
  line: 8,
  column: 1,
  message: "Trailing whitespace",
};
const infoDiag: ValidationDiagnostic = {
  severity: "info",
  line: 1,
  column: 1,
  message: "Document is empty",
};

describe("ValidationGutter", () => {
  afterEach(() => cleanup());

  it("renders nothing when diagnostics is empty", () => {
    const { container } = render(<ValidationGutter diagnostics={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per diagnostic", () => {
    render(<ValidationGutter diagnostics={[errorDiag, warningDiag, infoDiag]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("counts diagnostics by severity in the summary", () => {
    render(<ValidationGutter diagnostics={[errorDiag, warningDiag, errorDiag]} />);
    const summary = screen.getByTestId("validation-summary");
    expect(summary).toHaveTextContent("2");
    expect(summary).toHaveTextContent("1");
  });

  it("uses role=list with aria-label", () => {
    render(<ValidationGutter diagnostics={[errorDiag]} />);
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("aria-label");
  });

  it("renders line:column metadata in each row", () => {
    render(<ValidationGutter diagnostics={[errorDiag]} />);
    expect(screen.getByText(/12:4/)).toBeInTheDocument();
  });

  // Audit 20260907 (#282): an actionable row is a BUTTON inside the list item,
  // so assistive technology hears an action, not a focusable line of text.
  it("calls onJump when a diagnostic row's button is activated", async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    render(<ValidationGutter diagnostics={[errorDiag]} onJump={onJump} />);
    const button = screen.getByRole("button");
    expect(screen.getByRole("listitem")).toContainElement(button);
    await user.click(button);
    expect(onJump).toHaveBeenCalledWith(12, 4);
  });

  it("activates with Enter via keyboard for accessibility", async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    render(<ValidationGutter diagnostics={[errorDiag]} onJump={onJump} />);
    screen.getByRole("button").focus();
    await user.keyboard("{Enter}");
    expect(onJump).toHaveBeenCalledWith(12, 4);
  });

  it("without onJump, rows are plain content — no button and nothing focusable", () => {
    render(<ValidationGutter diagnostics={[errorDiag, warningDiag]} />);
    expect(screen.queryByRole("button")).toBeNull();
    for (const row of screen.getAllByRole("listitem")) {
      expect(row).not.toHaveAttribute("tabindex");
      expect(row.querySelector("[tabindex]")).toBeNull();
    }
    expect(screen.getByText(/12:4/)).toBeInTheDocument();
  });

  it("includes severity as data attribute on each row", () => {
    render(<ValidationGutter diagnostics={[errorDiag, warningDiag, infoDiag]} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("data-severity", "error");
    expect(rows[1]).toHaveAttribute("data-severity", "warning");
    expect(rows[2]).toHaveAttribute("data-severity", "info");
  });

  it("displays ruleId when available", () => {
    render(<ValidationGutter diagnostics={[errorDiag]} />);
    expect(screen.getByText(/json\/syntax/)).toBeInTheDocument();
  });

  // WI-FL0.3 — the rule pill carries the documented title as tooltip and
  // screen-reader text, so the metadata the docs are checked against is what
  // users see. Under the English bundle (what the global i18n mock resolves)
  // that title is the same string RULE_META and website/guide/lint.md carry —
  // `ruleMeta.test.ts` pins that equality. The LOCALIZED behaviour and the
  // fallbacks around it (#406) need a controlled dictionary, so they live in
  // ValidationGutter.i18n.test.tsx.
  it("gives a lint-engine rule badge its documented title as tooltip and screen-reader text", () => {
    const lintDiag: ValidationDiagnostic = {
      severity: "warning",
      line: 3,
      column: 5,
      message: "Space inside emphasis markers",
      ruleId: "E05",
    };
    render(<ValidationGutter diagnostics={[lintDiag]} />);
    const badge = screen.getByTitle("E05 — Space inside emphasis markers");
    expect(badge).toHaveClass("validation-gutter__rule");
    // The id stays the visible text; the title is appended for assistive tech.
    expect(badge.firstChild?.textContent).toBe("E05");
    expect(badge).toHaveTextContent("E05 — Space inside emphasis markers");
  });

  it("degrades a rule id the lint engine does not declare to the bare id", () => {
    render(<ValidationGutter diagnostics={[errorDiag]} />); // ruleId "json/syntax" is an adapter id
    const badge = screen.getByTitle("json/syntax");
    expect(badge.textContent).toBe("json/syntax");
  });

  it("survives rapid prop changes (no thrown reads on undefined)", () => {
    const { rerender } = render(<ValidationGutter diagnostics={[errorDiag]} />);
    rerender(<ValidationGutter diagnostics={[]} />);
    rerender(<ValidationGutter diagnostics={[warningDiag, infoDiag]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

// Audit 20260907 round 3 (#571): `useTranslation` subscribes its component to
// i18n's change events. Mounting it in `DiagnosticRow` and again in
// `RuleBadge` meant 2N subscriptions behind a list that is routinely hundreds
// of rows long, for a translator that is the same object in all of them.
//
// Asserted against the SOURCE because the property is "how many components
// subscribe", and react-i18next is globally mocked for jsdom (src/test/setup.ts)
// — the mock returns a plain object, so nothing observable at render time
// distinguishes one subscription from two hundred.
describe("ValidationGutter — one translation subscription, not one per row", () => {
  it("calls useTranslation exactly once in the module", () => {
    const source = readFileSync(
      "src/components/Editor/SplitPaneEditor/ValidationGutter.tsx",
      "utf8",
    );
    expect([...source.matchAll(/useTranslation\(/g)]).toHaveLength(1);
  });

  it("renders every row's rule pill from the translator it was handed", () => {
    render(
      <ValidationGutter
        diagnostics={[
          { severity: "error", line: 1, column: 1, message: "a", ruleId: "E05" },
          { severity: "warning", line: 2, column: 1, message: "b", ruleId: "W01" },
        ]}
      />,
    );
    expect(screen.getByText("E05")).toBeInTheDocument();
    expect(screen.getByText("W01")).toBeInTheDocument();
  });
});
