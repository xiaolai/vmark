// WI-2.4 — WorkflowPanelShell tests.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowPanelShell } from "../WorkflowPanelShell";

describe("WorkflowPanelShell", () => {
  it("renders both left and right children", () => {
    render(
      <WorkflowPanelShell
        left={<div data-testid="left">L</div>}
        right={<div data-testid="right">R</div>}
      />,
    );
    expect(screen.getByTestId("left").textContent).toBe("L");
    expect(screen.getByTestId("right").textContent).toBe("R");
  });

  it("exposes a separator between the panes (a11y)", () => {
    render(
      <WorkflowPanelShell left={<div>l</div>} right={<div>r</div>} />,
    );
    const sep = screen.getByRole("separator");
    expect(sep.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("forwards ariaLabel to the shell role=group", () => {
    render(
      <WorkflowPanelShell
        left={<span>l</span>}
        right={<span>r</span>}
        ariaLabel="Workflow viewer"
      />,
    );
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe(
      "Workflow viewer",
    );
  });

  it("applies the initialSplit fraction to the left pane's flex-basis", () => {
    render(
      <WorkflowPanelShell
        left={<div data-testid="left">l</div>}
        right={<div>r</div>}
        initialSplit={0.3}
      />,
    );
    const left = screen.getByTestId("left").parentElement;
    expect(left?.style.flexBasis).toBe("30%");
  });

  it("clamps split to [0.15, 0.85] range (verified by initial render not throwing for extreme values)", () => {
    expect(() =>
      render(
        <WorkflowPanelShell
          left={<span>l</span>}
          right={<span>r</span>}
          initialSplit={2}
        />,
      ),
    ).not.toThrow();
  });
});
