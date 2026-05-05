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

describe("DiagnosticsBanner — per-row collapse", () => {
  it("clicking a row's chevron hides that row's message but keeps the code", () => {
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({ message: "first message" }),
          makeDiag({ message: "second message" }),
        ]}
      />,
    );
    expect(screen.getByText("first message")).toBeTruthy();
    expect(screen.getByText("second message")).toBeTruthy();

    // Click the first row's chevron only.
    const chevrons = screen
      .getAllByRole("button")
      .filter((b) =>
        b.className.includes("workflow-diagnostics-banner__chevron"),
      );
    expect(chevrons.length).toBeGreaterThan(0);
    fireEvent.click(chevrons[0]);

    // First row's message gone; the code stays.
    expect(screen.queryByText("first message")).toBeNull();
    expect(screen.getByText("second message")).toBeTruthy();
    expect(screen.getAllByText(/GHA-STEP-003/).length).toBeGreaterThan(0);

    // Click again to expand.
    fireEvent.click(chevrons[0]);
    expect(screen.getByText("first message")).toBeTruthy();
  });

  it("Collapse all collapses ALL diagnostics including those hidden behind the >5 truncation", () => {
    // 8 diagnostics: only 5 are rendered initially. Collapse-all must
    // hide the 3 not-yet-rendered ones too, otherwise clicking "Show all"
    // reveals them still expanded (Codex audit MED-2 + regression test).
    const eight: Diagnostic[] = Array.from({ length: 8 }, (_, i) => ({
      severity: "warning",
      code: "GHA-STEP-003",
      message: `synthesized id ${i}`,
    }));
    render(<DiagnosticsBanner diagnostics={eight} />);
    expect(screen.getByText(/synthesized id 0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    // First 5 already had their messages hidden.
    expect(screen.queryByText(/synthesized id 0/)).toBeNull();
    // Reveal the rest — they should also be collapsed.
    fireEvent.click(screen.getByRole("button", { name: /show all 8/i }));
    expect(screen.queryByText(/synthesized id 7/)).toBeNull();
  });

  it("preserves per-row collapse state when the diagnostics array reorders", () => {
    // Repeated codes with distinct messages: collapsed rows should
    // stay collapsed by content, not by their index in the array.
    const initial: Diagnostic[] = [
      makeDiag({ message: "alpha" }),
      makeDiag({ message: "beta" }),
      makeDiag({ message: "gamma" }),
    ];
    const { rerender } = render(<DiagnosticsBanner diagnostics={initial} />);
    // Collapse beta only.
    const chevrons = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("workflow-diagnostics-banner__chevron"));
    fireEvent.click(chevrons[1]);
    expect(screen.queryByText("beta")).toBeNull();
    expect(screen.getByText("alpha")).toBeTruthy();

    // Rerender with reordered + extra diagnostic; beta is now at index 2
    // instead of 1 — content-based key should keep it collapsed.
    rerender(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({ message: "alpha" }),
          makeDiag({ message: "delta" }),
          makeDiag({ message: "beta" }),
          makeDiag({ message: "gamma" }),
        ]}
      />,
    );
    expect(screen.queryByText("beta")).toBeNull();
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("delta")).toBeTruthy();
    expect(screen.getByText("gamma")).toBeTruthy();
  });

  it("Collapse all / Expand all toggles every visible row", () => {
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({ message: "alpha" }),
          makeDiag({ message: "beta" }),
          makeDiag({ message: "gamma" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.queryByText("beta")).toBeNull();
    expect(screen.queryByText("gamma")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /expand all/i }));
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("gamma")).toBeTruthy();
  });

  it("chevron click does NOT trigger the row's jump action", () => {
    const view = {
      state: { doc: { lines: 5, line: () => ({ from: 10, to: 20 }) } },
      dispatch: vi.fn(),
      focus: vi.fn(),
      dom: { isConnected: true },
    };
    useActiveEditorStore.setState({
      activeWysiwygEditor: null,
      activeSourceView: view as never,
    });
    render(
      <DiagnosticsBanner
        diagnostics={[
          makeDiag({
            position: { startLine: 3, startCol: 1, endLine: 3, endCol: 5 },
          }),
        ]}
      />,
    );
    const chevron = screen
      .getAllByRole("button")
      .find((b) =>
        b.className.includes("workflow-diagnostics-banner__chevron"),
      )!;
    fireEvent.click(chevron);
    // Chevron click must NOT have dispatched the source-jump scroll.
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});
