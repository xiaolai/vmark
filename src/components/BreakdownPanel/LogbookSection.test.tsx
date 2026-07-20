/**
 * The coherence log — the record that makes M2 and M4 readable.
 *
 * Two properties matter here and neither is cosmetic:
 *
 * 1. It must NOT load with the panel. `project_logbook` reads the entire
 *    ledger; paying that on every panel open would tax the common case to
 *    serve a view nobody asked for.
 * 2. A tau-downgraded check must be distinguishable from a genuine non-answer.
 *    Both are recorded `unknown`, and conflating them is what made the dogfood
 *    run's "24% unknown" finding uninterpretable — a model that answered and
 *    was overruled is a threshold problem, one that had no signal is not.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LogbookView } from "@/stores/breakdownStore";

const fetchLogbook = vi.fn();
vi.mock("@/services/breakdown/breakdownService", () => ({
  fetchLogbook: (...a: unknown[]) => fetchLogbook(...a),
}));

import { LogbookSection } from "./LogbookSection";

const VIEW: LogbookView = {
  rows: [
    {
      txf: "019f75b7-74f9-79f3-a00f-c426a7f6a462",
      input: 0,
      firstActivity: "2026-07-19T10:00:00Z",
      resolutions: 3,
      lastResolution: "ratification",
      checks: [
        { time: "2026-07-19T11:00:00Z", verdict: "unknown", confidence: 0.82,
          downgradedVerdict: "no-contradiction", downgradeReason: "below-tau" },
        { time: "2026-07-19T12:00:00Z", verdict: "unknown", confidence: 0.0 },
      ],
      judgment: { time: "2026-07-19T13:00:00Z", judgment: "noise", note: "finished doc" },
    },
  ],
  m2: { relevant: 1, noise: 4, unsure: 0, unjudged: 2 },
  reopenedEdges: 1,
};

beforeEach(() => fetchLogbook.mockReset().mockResolvedValue(VIEW));

describe("LogbookSection", () => {
  it("does not read the ledger until asked", () => {
    render(<LogbookSection workspaceRoot="/w" />);
    expect(fetchLogbook).not.toHaveBeenCalled();
  });

  it("loads on expand", async () => {
    const user = userEvent.setup();
    render(<LogbookSection workspaceRoot="/w" />);
    await user.click(screen.getByTestId("logbook-toggle"));
    await waitFor(() => expect(fetchLogbook).toHaveBeenCalledWith("/w"));
  });

  it("reports the M2 tally", async () => {
    const user = userEvent.setup();
    render(<LogbookSection workspaceRoot="/w" />);
    await user.click(screen.getByTestId("logbook-toggle"));
    const m2 = await screen.findByTestId("logbook-m2");
    expect(m2).toHaveTextContent("1");
    expect(m2).toHaveTextContent("4");
    expect(m2).toHaveTextContent("2");
  });

  it("surfaces churn — the M4 burden is repetition, not breadth", async () => {
    const user = userEvent.setup();
    render(<LogbookSection workspaceRoot="/w" />);
    await user.click(screen.getByTestId("logbook-toggle"));
    // 3 resolutions on one edge is the re-coherence tax; a flat entry list
    // hides it entirely.
    expect(await screen.findByTestId("logbook-reopened")).toHaveTextContent("1");
    expect(screen.getByTestId("logbook-resolutions-0")).toHaveTextContent("3");
  });

  it("tells a downgraded verdict apart from a real non-answer", async () => {
    const user = userEvent.setup();
    render(<LogbookSection workspaceRoot="/w" />);
    await user.click(screen.getByTestId("logbook-toggle"));
    await screen.findByTestId("logbook-m2");
    // The first check was answered and overruled by tau; the second had no
    // signal. Only the first may show the preserved verdict.
    expect(screen.getByTestId("logbook-check-0-0")).toHaveTextContent(
      /no-contradiction/,
    );
    expect(screen.getByTestId("logbook-check-0-1")).not.toHaveTextContent(
      /no-contradiction/,
    );
  });

  it("survives a failed read without blanking the panel", async () => {
    const user = userEvent.setup();
    fetchLogbook.mockResolvedValue(null);
    render(<LogbookSection workspaceRoot="/w" />);
    await user.click(screen.getByTestId("logbook-toggle"));
    await waitFor(() => expect(fetchLogbook).toHaveBeenCalled());
    expect(screen.queryByTestId("logbook-m2")).not.toBeInTheDocument();
  });

  it("stays inert without a workspace", async () => {
    const user = userEvent.setup();
    render(<LogbookSection workspaceRoot={null} />);
    await user.click(screen.getByTestId("logbook-toggle"));
    expect(fetchLogbook).not.toHaveBeenCalled();
  });
});
