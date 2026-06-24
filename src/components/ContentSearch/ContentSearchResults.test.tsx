import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUIStore, type FileSearchResult } from "@/stores/uiStore";
import { ContentSearchResults } from "./ContentSearchResults";

const results: FileSearchResult[] = [
  {
    path: "/root/a.md",
    relativePath: "a.md",
    matches: [
      { lineNumber: 3, lineContent: "alpha hit", matchRanges: [{ start: 0, end: 5 }] },
      { lineNumber: 8, lineContent: "second hit", matchRanges: [{ start: 7, end: 10 }] },
    ],
  },
  {
    path: "/root/b.md",
    relativePath: "b.md",
    matches: [
      { lineNumber: 1, lineContent: "beta hit", matchRanges: [{ start: 0, end: 4 }] },
    ],
  },
];

describe("ContentSearchResults", () => {
  it("renders a file header per file with its match count", () => {
    const { container } = render(
      <ContentSearchResults
        results={results}
        selectedIndex={0}
        onSelectMatch={vi.fn()}
      />,
    );
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("b.md")).toBeInTheDocument();
    // a.md has 2 matches, b.md has 1 — read the per-file count badges.
    const counts = Array.from(
      container.querySelectorAll(".content-search-file-count"),
    ).map((el) => el.textContent);
    expect(counts).toEqual(["2", "1"]);
  });

  it("renders one option per match across files", () => {
    render(
      <ContentSearchResults
        results={results}
        selectedIndex={0}
        onSelectMatch={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("marks the flat-indexed selected match via aria-selected", () => {
    render(
      <ContentSearchResults
        results={results}
        selectedIndex={2}
        onSelectMatch={vi.fn()}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[2]).toHaveAttribute("aria-selected", "true");
  });

  it("fires onSelectMatch with the file and match on click", async () => {
    const user = userEvent.setup();
    const onSelectMatch = vi.fn();
    render(
      <ContentSearchResults
        results={results}
        selectedIndex={0}
        onSelectMatch={onSelectMatch}
      />,
    );

    // The third option is b.md's only match (flat index 2).
    await user.click(screen.getAllByRole("option")[2]);

    expect(onSelectMatch).toHaveBeenCalledExactlyOnceWith(
      results[1],
      results[1].matches[0],
    );
  });

  it("updates the store's selectedIndex on hover", async () => {
    const user = userEvent.setup();
    useUIStore.setState((s) => ({
      contentSearch: { ...s.contentSearch, selectedIndex: 0 },
    }));
    render(
      <ContentSearchResults
        results={results}
        selectedIndex={0}
        onSelectMatch={vi.fn()}
      />,
    );

    await user.hover(screen.getAllByRole("option")[1]);

    expect(useUIStore.getState().contentSearch.selectedIndex).toBe(1);
  });
});
