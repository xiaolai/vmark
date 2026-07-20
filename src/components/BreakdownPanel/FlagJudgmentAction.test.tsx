/**
 * M2 (staleness relevance) is owner-judged and can never be inferred from
 * behaviour — that was settled during the metrics session. So the judgment has
 * to be collectable at the moment the owner is looking at the flag, or it is
 * not collectable at all: the dogfood run had to record all five judgments
 * through raw invokes because no control existed.
 *
 * The trap this guards against is a default. A pre-selected answer would let
 * an idle click manufacture M2 data, and a metric with fabricated inputs is
 * worse than a missing one.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EdgeRow } from "@/stores/breakdownStore";

const judgeFlag = vi.fn();
vi.mock("@/services/breakdown/breakdownService", () => ({
  judgeFlag: (...a: unknown[]) => judgeFlag(...a),
}));

import { FlagJudgmentAction } from "./FlagJudgmentAction";

function row(over: Partial<EdgeRow> = {}): EdgeRow {
  return {
    txf: "019f75b7-74f9-79f3-a00f-c426a7f6a462",
    input: 2,
    ...over,
  } as EdgeRow;
}

beforeEach(() => judgeFlag.mockReset().mockResolvedValue(undefined));

describe("FlagJudgmentAction", () => {
  it("records nothing until the owner actually answers", async () => {
    const user = userEvent.setup();
    render(<FlagJudgmentAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByTestId("judge-open"));
    // Opening the control must not itself constitute an answer.
    expect(judgeFlag).not.toHaveBeenCalled();
  });

  it("sends the chosen judgment with the edge coordinates", async () => {
    const user = userEvent.setup();
    render(<FlagJudgmentAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByTestId("judge-open"));
    await user.click(screen.getByTestId("judge-noise"));
    await waitFor(() =>
      expect(judgeFlag).toHaveBeenCalledWith(
        "/w",
        "019f75b7-74f9-79f3-a00f-c426a7f6a462",
        2,
        "noise",
        undefined,
      ),
    );
  });

  it("offers all three answers — 'unsure' must be sayable", async () => {
    const user = userEvent.setup();
    render(<FlagJudgmentAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByTestId("judge-open"));
    // Forcing a binary would push genuine uncertainty into relevant/noise and
    // silently bias M2.
    expect(screen.getByTestId("judge-relevant")).toBeInTheDocument();
    expect(screen.getByTestId("judge-noise")).toBeInTheDocument();
    expect(screen.getByTestId("judge-unsure")).toBeInTheDocument();
  });

  it("closes after answering so the row stops soliciting", async () => {
    // The prior judgment is deliberately NOT shown here: surfacing it would
    // force the breakdown read path to project the whole logbook (O(ledger))
    // on every refresh just to render a label. Judgments are append-only and
    // newest-wins, so re-judging is safe; the logbook view is where the
    // history is meant to be read.
    const user = userEvent.setup();
    render(<FlagJudgmentAction row={row()} workspaceRoot="/w" />);
    await user.click(screen.getByTestId("judge-open"));
    await user.click(screen.getByTestId("judge-relevant"));
    await waitFor(() =>
      expect(screen.queryByTestId("judge-relevant")).not.toBeInTheDocument(),
    );
  });

  it("stays inert without a workspace", () => {
    render(<FlagJudgmentAction row={row()} workspaceRoot={null} />);
    expect(screen.getByTestId("judge-open")).toBeDisabled();
  });
});
