// WI-3.7 — the dismissible, pull-only merge banner.
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MergeBanner } from "./MergeBanner";
import { useBreakdownStore } from "@/stores/breakdownStore";

beforeEach(() => {
  localStorage.clear();
  useBreakdownStore.getState().reset();
});

describe("MergeBanner", () => {
  it("renders nothing without a merge notice", () => {
    render(<MergeBanner />);
    expect(screen.queryByText(/a merge landed/i)).not.toBeInTheDocument();
  });

  it("shows the banner for an undismissed merge", () => {
    useBreakdownStore.getState().setMergeNotice({ sha: "abc", time: "t" });
    render(<MergeBanner />);
    expect(screen.getByText(/a merge landed/i)).toBeInTheDocument();
  });

  it("dismiss hides it and persists the SHA", async () => {
    const user = userEvent.setup();
    useBreakdownStore.getState().setMergeNotice({ sha: "abc", time: "t" });
    render(<MergeBanner />);
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/a merge landed/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("vmark-merge-dismissed")).toContain("abc");
  });

  it("stays dismissed across remounts (persisted), but a NEW merge re-shows", () => {
    localStorage.setItem("vmark-merge-dismissed", JSON.stringify(["abc"]));
    useBreakdownStore.getState().setMergeNotice({ sha: "abc", time: "t" });
    const { rerender } = render(<MergeBanner />);
    expect(screen.queryByText(/a merge landed/i)).not.toBeInTheDocument();
    // A newer merge (different SHA) is not covered by the dismissal.
    useBreakdownStore.getState().setMergeNotice({ sha: "def", time: "t2" });
    rerender(<MergeBanner />);
    expect(screen.getByText(/a merge landed/i)).toBeInTheDocument();
  });
});
