import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickOpenList, renderHighlighted } from "./QuickOpenList";
import type { RankedItem } from "./useQuickOpenItems";

function makeRanked(overrides: Partial<RankedItem["item"]> = {}): RankedItem {
  return {
    item: {
      path: "/root/a.md",
      filename: "a.md",
      relPath: "a.md",
      tier: "workspace",
      isOpenTab: false,
      ...overrides,
    },
    tier: "workspace",
    match: null,
  };
}

function setup(props: Partial<Parameters<typeof QuickOpenList>[0]> = {}) {
  return render(
    <QuickOpenList
      rankedItems={[makeRanked()]}
      selectedIndex={0}
      filter=""
      onSelectItem={vi.fn()}
      onBrowse={vi.fn()}
      onHoverIndex={vi.fn()}
      {...props}
    />,
  );
}

describe("renderHighlighted", () => {
  it("returns the raw text when there are no match indices", () => {
    expect(renderHighlighted("abc", undefined)).toBe("abc");
    expect(renderHighlighted("abc", [])).toBe("abc");
  });

  it("wraps matched characters in highlight spans", () => {
    const { container } = render(<>{renderHighlighted("abc", [1])}</>);
    const highlights = container.querySelectorAll(".quick-open-match");
    expect(highlights).toHaveLength(1);
    expect(highlights[0].textContent).toBe("b");
  });
});

describe("QuickOpenList", () => {
  it("renders one option per ranked item plus the pinned Browse row", () => {
    setup({
      rankedItems: [
        makeRanked({ path: "/root/a.md", filename: "a.md" }),
        makeRanked({ path: "/root/b.md", filename: "b.md" }),
      ],
      selectedIndex: 0,
    });
    // 2 files + 1 Browse row.
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("Browse...")).toBeInTheDocument();
  });

  it("marks the selected item via aria-selected", () => {
    setup({
      rankedItems: [makeRanked({ path: "/a", filename: "a.md" })],
      selectedIndex: 1, // selects the Browse row
    });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("calls onSelectItem with the item path on click", async () => {
    const user = userEvent.setup();
    const onSelectItem = vi.fn();
    setup({
      rankedItems: [makeRanked({ path: "/root/doc.md", filename: "doc.md" })],
      onSelectItem,
    });
    await user.click(screen.getByText("doc.md"));
    expect(onSelectItem).toHaveBeenCalledExactlyOnceWith("/root/doc.md");
  });

  it("calls onBrowse when the Browse row is clicked", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn();
    setup({ onBrowse });
    await user.click(screen.getByText("Browse..."));
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it("reports the hovered index for items and the Browse row", async () => {
    const user = userEvent.setup();
    const onHoverIndex = vi.fn();
    setup({
      rankedItems: [makeRanked({ path: "/a", filename: "a.md" })],
      onHoverIndex,
    });
    const options = screen.getAllByRole("option");
    await user.hover(options[0]);
    expect(onHoverIndex).toHaveBeenCalledWith(0);
    await user.hover(options[1]);
    expect(onHoverIndex).toHaveBeenCalledWith(1);
  });

  it("shows an empty-state message when filtering yields no items", () => {
    setup({ rankedItems: [], filter: "zzz" });
    expect(screen.getByText("No files found")).toBeInTheDocument();
  });

  it("renders the relative path when it differs from the filename", () => {
    setup({
      rankedItems: [
        makeRanked({ path: "/root/sub/a.md", filename: "a.md", relPath: "sub/a.md" }),
      ],
    });
    expect(screen.getByText("sub/a.md")).toBeInTheDocument();
  });
});
