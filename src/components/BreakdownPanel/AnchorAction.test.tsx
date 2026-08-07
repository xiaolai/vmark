/**
 * Anchoring narrows an edge from "did the file change?" to "did the part I
 * depend on change?" — the single biggest lever on M2, since whole-file
 * dependencies are why edits to unrelated sections raise flags.
 *
 * Both the Rust command and the service shipped with no caller, so anchoring
 * was unreachable. The property that matters most here: the picker offers only
 * paths the setter will accept. Anything else produces a UI that shows an
 * option and then refuses it.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EdgeRow } from "@/stores/breakdownStore";

const fetchEdgeHeadings = vi.fn();
const setEdgeAnchor = vi.fn();
vi.mock("@/services/breakdown/breakdownService", () => ({
  fetchEdgeHeadings: (...a: unknown[]) => fetchEdgeHeadings(...a),
  setEdgeAnchor: (...a: unknown[]) => setEdgeAnchor(...a),
}));

import { AnchorAction } from "./AnchorAction";

function row(over: Partial<EdgeRow> = {}): EdgeRow {
  return {
    txf: "019f75b7-74f9-79f3-a00f-c426a7f6a462",
    input: 0,
    ...over,
  } as EdgeRow;
}

beforeEach(() => {
  fetchEdgeHeadings.mockReset().mockResolvedValue([
    ["Paper"],
    ["Paper", "5. Resolution"],
  ]);
  setEdgeAnchor.mockReset().mockResolvedValue(undefined);
});

describe("AnchorAction", () => {
  it("does not read the upstream until asked", () => {
    render(<AnchorAction row={row()} workspaceRoot="/w" />);
    expect(fetchEdgeHeadings).not.toHaveBeenCalled();
  });

  it("offers the upstream's anchorable sections on open", async () => {
    const user = userEvent.setup();
    render(<AnchorAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByTestId("anchor-open"));
    await waitFor(() =>
      expect(fetchEdgeHeadings).toHaveBeenCalledWith(
        "/w",
        "019f75b7-74f9-79f3-a00f-c426a7f6a462",
        0,
      ),
    );
    expect(await screen.findByTestId("anchor-option-1")).toHaveTextContent(
      "5. Resolution",
    );
  });

  it("sends back exactly the path it displayed", async () => {
    const user = userEvent.setup();
    render(<AnchorAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByTestId("anchor-open"));
    await user.click(await screen.findByTestId("anchor-option-1"));
    await waitFor(() =>
      expect(setEdgeAnchor).toHaveBeenCalledWith(
        "/w",
        "019f75b7-74f9-79f3-a00f-c426a7f6a462",
        0,
        ["Paper", "5. Resolution"],
      ),
    );
  });

  it("can clear an anchor back to whole-file", async () => {
    const user = userEvent.setup();
    render(
      <AnchorAction row={row({ anchor_status: "anchor-unchanged" })} workspaceRoot="/w" />,
    );
    await user.click(screen.getByTestId("anchor-open"));
    await user.click(await screen.findByTestId("anchor-clear"));
    // The empty array IS the documented clear form; sending nothing at all
    // would leave the old anchor live and keep suppressing.
    await waitFor(() =>
      expect(setEdgeAnchor).toHaveBeenCalledWith(
        "/w",
        "019f75b7-74f9-79f3-a00f-c426a7f6a462",
        0,
        [],
      ),
    );
  });

  it("says so when the upstream has no anchorable sections", async () => {
    const user = userEvent.setup();
    fetchEdgeHeadings.mockResolvedValue([]);
    render(<AnchorAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByTestId("anchor-open"));
    expect(await screen.findByTestId("anchor-empty")).toBeInTheDocument();
    expect(setEdgeAnchor).not.toHaveBeenCalled();
  });

  it("stays inert without a workspace", async () => {
    const user = userEvent.setup();
    render(<AnchorAction row={row()} workspaceRoot={null} />);
    expect(screen.getByTestId("anchor-open")).toBeDisabled();
    await user.click(screen.getByTestId("anchor-open"));
    expect(fetchEdgeHeadings).not.toHaveBeenCalled();
  });
});
