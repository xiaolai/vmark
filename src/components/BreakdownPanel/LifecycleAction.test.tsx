/**
 * Freezing is the only way a document ever ENTERS the suppressed group, so
 * without this control the whole lifecycle feature is unreachable from the UI —
 * it was, until now: the Rust command and the service both existed and nothing
 * could call them.
 *
 * The behaviour worth protecting is the blast radius. Freezing is a DOCUMENT
 * decision taken from ONE edge's row: it silences every edge into that
 * document, including ones not on screen. A control that reads as "hide this
 * row" would be actively misleading, so the confirm step is part of the
 * contract, not decoration.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EdgeRow } from "@/stores/breakdownStore";

const setDocumentLifecycle = vi.fn();
vi.mock("@/services/breakdown/breakdownService", () => ({
  setDocumentLifecycle: (...a: unknown[]) => setDocumentLifecycle(...a),
}));

import { LifecycleAction } from "./LifecycleAction";

function row(over: Partial<EdgeRow> = {}): EdgeRow {
  return {
    txf: "019f75b7-74f9-79f3-a00f-c426a7f6a462",
    input: 0,
    downstream: "019f758b-af1f-7821-bd64-8c5e584cf25a",
    downstream_path: "notes/plan.md",
    ...over,
  } as EdgeRow;
}

beforeEach(() => setDocumentLifecycle.mockReset().mockResolvedValue(undefined));

describe("LifecycleAction", () => {
  it("offers to finish a live document", () => {
    render(<LifecycleAction row={row()} workspaceRoot="/w" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(setDocumentLifecycle).not.toHaveBeenCalled();
  });

  it("does not freeze on the first click — the blast radius needs confirming", async () => {
    const user = userEvent.setup();
    render(<LifecycleAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByRole("button"));
    expect(setDocumentLifecycle).not.toHaveBeenCalled();
    // The confirm step must SAY the scope is the document, not this row.
    expect(screen.getByText(/notes\/plan\.md/)).toBeInTheDocument();
  });

  it("freezes the downstream object once confirmed", async () => {
    const user = userEvent.setup();
    render(<LifecycleAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByTestId("lifecycle-confirm"));
    await waitFor(() =>
      expect(setDocumentLifecycle).toHaveBeenCalledWith(
        "/w",
        "019f758b-af1f-7821-bd64-8c5e584cf25a",
        "frozen",
        undefined,
      ),
    );
  });

  it("can be backed out of without freezing", async () => {
    const user = userEvent.setup();
    render(<LifecycleAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByTestId("lifecycle-cancel"));
    expect(setDocumentLifecycle).not.toHaveBeenCalled();
    expect(screen.queryByTestId("lifecycle-confirm")).not.toBeInTheDocument();
  });

  it("reopens a frozen document immediately — reviving is not the dangerous direction", async () => {
    const user = userEvent.setup();
    render(
      <LifecycleAction row={row({ frozen_downstream: true })} workspaceRoot="/w" />,
    );
    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(setDocumentLifecycle).toHaveBeenCalledWith(
        "/w",
        "019f758b-af1f-7821-bd64-8c5e584cf25a",
        "live",
        undefined,
      ),
    );
  });

  it("stays inert without a workspace", async () => {
    const user = userEvent.setup();
    render(<LifecycleAction row={row()} workspaceRoot={null} />);
    expect(screen.getByRole("button")).toBeDisabled();
    await user.click(screen.getByRole("button"));
    expect(setDocumentLifecycle).not.toHaveBeenCalled();
  });

  it("does not double-submit while a change is in flight", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    setDocumentLifecycle.mockReturnValue(
      new Promise<void>((r) => {
        release = r;
      }),
    );
    render(
      <LifecycleAction row={row({ frozen_downstream: true })} workspaceRoot="/w" />,
    );
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("button"));
    expect(setDocumentLifecycle).toHaveBeenCalledTimes(1);
    release();
  });
});
