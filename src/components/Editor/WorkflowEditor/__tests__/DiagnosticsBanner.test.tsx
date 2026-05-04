// Phase 9 follow-up — DiagnosticsBanner tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { Diagnostic } from "@/lib/ghaWorkflow/types";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { DiagnosticsBanner } from "../DiagnosticsBanner";

beforeEach(() => {
  useWorkflowViewStore.getState().reset();
  useActiveEditorStore.setState({
    activeWysiwygEditor: null,
    activeSourceView: null,
  });
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

  it("renders non-clickable for diagnostics without a jobId or position", () => {
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

  it("clicking a diagnostic with position dispatches a CodeMirror scrollIntoView at that line", () => {
    // Stub a CodeMirror view so the banner can target it.
    const dispatch = vi.fn();
    const focus = vi.fn();
    const fakeView = {
      dom: { isConnected: true },
      state: {
        doc: {
          lines: 50,
          line: (n: number) => ({ from: (n - 1) * 10, to: n * 10 - 1 }),
        },
      },
      dispatch,
      focus,
    };
    useActiveEditorStore.setState({
      activeWysiwygEditor: null,
       
      activeSourceView: fakeView as any,
    });
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({
            severity: "error",
            code: "GHA-PARSE-001",
            message: "missing jobs key",
            position: { startLine: 7, startCol: 3, endLine: 7, endCol: 8 },
          }),
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: /missing jobs key/i });
    fireEvent.click(button);
    expect(dispatch).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    // Caret offset is line.from + (col - 1) = 60 + 2 = 62.
    const call = dispatch.mock.calls[0][0];
    expect(call.selection.anchor).toBe(62);
  });

  it("position takes priority over jobId when both are present", () => {
    const dispatch = vi.fn();
    useActiveEditorStore.setState({
      activeWysiwygEditor: null,
       
      activeSourceView: {
        dom: { isConnected: true },
        state: { doc: { lines: 100, line: () => ({ from: 0, to: 10 }) } },
        dispatch,
        focus: vi.fn(),
      } as any,
    });
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({
            severity: "error",
            code: "GHA-NEEDS-001",
            message: "ref unknown",
            context: { jobId: "build" },
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ref unknown/i }));
    // Source jump dispatched, job NOT selected because position won.
    expect(dispatch).toHaveBeenCalled();
    expect(useWorkflowViewStore.getState().selectedJobId).toBeNull();
  });

  it("falls back to jobId when no source view is active", () => {
    // No source view set in beforeEach.
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({
            severity: "error",
            code: "GHA-NEEDS-001",
            message: "ref unknown",
            context: { jobId: "build" },
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ref unknown/i }));
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("build");
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
