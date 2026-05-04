// Phase 9 follow-up — DiagnosticsBanner tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { Diagnostic } from "@/lib/ghaWorkflow/types";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { DiagnosticsBanner } from "../DiagnosticsBanner";

beforeEach(() => {
  useWorkflowViewStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    severity: "warning",
    code: "GHA-STEP-003",
    message: "Step id was synthesized",
    ...overrides,
  };
}

describe("DiagnosticsBanner — render", () => {
  it("renders nothing when diagnostics is empty", () => {
    const { container } = render(<DiagnosticsBanner diagnostics={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("groups diagnostics by severity in error → warning → info order", () => {
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({ severity: "info", code: "GHA-STEP-003", message: "info" }),
          makeDiag({
            severity: "error",
            code: "GHA-PARSE-001",
            message: "parse error",
          }),
          makeDiag({
            severity: "warning",
            code: "GHA-NEEDS-001",
            message: "warning",
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    // Order is error → warning → info.
    expect(items[0].textContent).toContain("parse error");
    expect(items[1].textContent).toContain("warning");
    expect(items[2].textContent).toContain("info");
  });

  it("displays the GHA-* code as a chip beside each diagnostic", () => {
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({ severity: "error", code: "GHA-PARSE-001", message: "boom" }),
        ]}
      />,
    );
    expect(screen.getByText("GHA-PARSE-001")).toBeDefined();
  });
});

describe("DiagnosticsBanner — interaction", () => {
  it("clicking a diagnostic with a jobId selects that job in the view store", () => {
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({
            severity: "warning",
            code: "GHA-NEEDS-001",
            message: "build references unknown",
            context: { jobId: "build" },
          }),
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: /build references/i });
    fireEvent.click(button);
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("build");
  });

  it("renders non-clickable for diagnostics without a jobId", () => {
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({
            severity: "error",
            code: "GHA-PARSE-001",
            message: "no context",
          }),
        ]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /no context/i }),
    ).toBeNull();
  });

  it("collapses to a count chip when there are >5 diagnostics", () => {
    const many: Diagnostic[] = Array.from({ length: 8 }, (_, i) => ({
      severity: "warning",
      code: "GHA-STEP-003",
      message: `synthesized id ${i}`,
    }));
    render(<DiagnosticsBanner diagnostics={many} />);
    expect(screen.getByRole("button", { name: /show all 8/i })).toBeDefined();
    // Initially collapsed: only 5 rows visible.
    expect(screen.getAllByRole("listitem").length).toBe(5);
  });

  it("expands all rows when the show-all button is clicked", () => {
    const many: Diagnostic[] = Array.from({ length: 8 }, (_, i) => ({
      severity: "warning",
      code: "GHA-STEP-003",
      message: `synthesized id ${i}`,
    }));
    render(<DiagnosticsBanner diagnostics={many} />);
    fireEvent.click(screen.getByRole("button", { name: /show all 8/i }));
    expect(screen.getAllByRole("listitem").length).toBe(8);
  });
});
