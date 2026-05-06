// WI-1A.8 — ValidationGutter tests.

import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("calls onJump when a diagnostic row is activated", async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    render(<ValidationGutter diagnostics={[errorDiag]} onJump={onJump} />);
    const row = screen.getByRole("listitem");
    await user.click(row);
    expect(onJump).toHaveBeenCalledWith(12, 4);
  });

  it("activates with Enter via keyboard for accessibility", async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    render(<ValidationGutter diagnostics={[errorDiag]} onJump={onJump} />);
    const row = screen.getByRole("listitem");
    row.focus();
    await user.keyboard("{Enter}");
    expect(onJump).toHaveBeenCalledWith(12, 4);
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

  it("survives rapid prop changes (no thrown reads on undefined)", () => {
    const { rerender } = render(<ValidationGutter diagnostics={[errorDiag]} />);
    rerender(<ValidationGutter diagnostics={[]} />);
    rerender(<ValidationGutter diagnostics={[warningDiag, infoDiag]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
