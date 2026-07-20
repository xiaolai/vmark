/**
 * The finding this closes: the panel rendered EVERY row and never read the
 * suppression annotations, so freezing a document suppressed nothing in the UI
 * while `status` reported 0 — the badge and the list disagreed.
 *
 * The contract here is deliberately "collapsed, not hidden": a suppressed edge
 * is still a real dependency the owner may revive, so it stays reachable. Tests
 * assert both halves — out of the way AND still findable.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { SuppressedGroup } from "./SuppressedGroup";
import type { EdgeRow } from "@/stores/breakdownStore";

function row(over: Partial<EdgeRow> = {}): EdgeRow {
  return {
    txf: "019f75b7-74f9-79f3-a00f-c426a7f6a462",
    input: 0,
    state: "stale",
    artifact: "notes/plan.md",
    source: "notes/source.md",
    actionable: false,
    ...over,
  } as EdgeRow;
}

describe("SuppressedGroup", () => {
  it("renders nothing when no rows are suppressed", () => {
    const { container } = render(
      <SuppressedGroup rows={[]} workspaceRoot="/w" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the suppressed rows in its summary", () => {
    render(
      <SuppressedGroup rows={[row(), row({ input: 1 })]} workspaceRoot="/w" />,
    );
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("starts collapsed so suppressed edges do not interrupt", () => {
    render(<SuppressedGroup rows={[row()]} workspaceRoot="/w" />);
    const details = screen.getByTestId("breakdown-suppressed");
    expect(details).not.toHaveAttribute("open");
  });

  it("stays reachable — expanding reveals the edge", async () => {
    const user = userEvent.setup();
    render(
      <SuppressedGroup
        rows={[row({ frozen_downstream: true })]}
        workspaceRoot="/w"
      />,
    );
    await user.click(screen.getByText(/1/));
    expect(screen.getByTestId("breakdown-suppressed")).toHaveAttribute("open");
  });

  it("says WHY each edge is suppressed, distinguishing the two causes", () => {
    render(
      <SuppressedGroup
        rows={[
          row({ frozen_downstream: true }),
          row({ input: 1, anchor_status: "anchor-unchanged" }),
        ]}
        workspaceRoot="/w"
      />,
    );
    // A bare count would leave the owner unable to tell a finished document
    // from an untouched section — different revival decisions.
    expect(screen.getByText(/finished document/i)).toBeInTheDocument();
    expect(screen.getByText(/section unchanged/i)).toBeInTheDocument();
  });
});
