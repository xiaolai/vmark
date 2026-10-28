// WI-AL3.1 — the review list's window is clamped to the rows it has: after a scroll deep into a long list, a list that shrinks (hunks reviewed or cleared) still shows its rows instead of an empty window past its end. Edge cases: shrink to fewer rows than the viewport, shrink to none, a scroll the browser never reported clamped
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewList } from "../ReviewList";

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => `行 ${i}`);

function List({ rows }: { rows: string[] }) {
  return <ReviewList rows={rows} rowKey={(r) => r} renderRow={(r) => <span>{r}</span>} label="review" />;
}

function scrollTo(top: number) {
  const viewport = screen.getByTestId("review-list");
  Object.defineProperty(viewport, "scrollTop", { configurable: true, value: top });
  fireEvent.scroll(viewport);
}

describe("ReviewList after its rows shrink", () => {
  it("shows the remaining rows, not an empty window past their end", () => {
    const { rerender } = render(<List rows={rowsOf(600)} />);
    scrollTo(52 * 400);
    expect(screen.getByText("行 400")).toBeTruthy();
    rerender(<List rows={rowsOf(3)} />);
    expect(screen.getAllByRole("listitem").map((el) => el.textContent)).toEqual(["行 0", "行 1", "行 2"]);
  });

  it("shows the last rows of a list still longer than the viewport", () => {
    const { rerender } = render(<List rows={rowsOf(600)} />);
    scrollTo(52 * 400);
    rerender(<List rows={rowsOf(20)} />);
    expect(screen.getByText("行 19")).toBeTruthy();
  });

  it("renders nothing for an emptied list", () => {
    const { rerender } = render(<List rows={rowsOf(600)} />);
    scrollTo(52 * 400);
    rerender(<List rows={[]} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
