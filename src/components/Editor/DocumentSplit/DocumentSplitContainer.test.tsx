import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { usePaneContext } from "@/contexts/PaneContext";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));

// Stub the heavy Editor with a marker that surfaces its pane context.
vi.mock("../Editor", () => ({
  Editor: () => {
    const pane = usePaneContext();
    return (
      <div data-testid="editor" data-pane={pane?.paneId ?? "none"} data-tab={pane?.tabId ?? "none"} />
    );
  },
}));

import { DocumentSplitContainer } from "./DocumentSplitContainer";

const W = "main";

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useTabStore.setState({ activeTabId: { [W]: "primary-tab" } } as never);
});

describe("DocumentSplitContainer (#1081)", () => {
  it("renders a single editor (no PaneContext, no divider) when no split is open", () => {
    render(<DocumentSplitContainer />);
    const editors = screen.getAllByTestId("editor");
    expect(editors).toHaveLength(1);
    expect(editors[0]).toHaveAttribute("data-pane", "none");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("renders two panes with the right documents + a divider when split", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    render(<DocumentSplitContainer />);

    const editors = screen.getAllByTestId("editor");
    expect(editors).toHaveLength(2);
    const byPane = Object.fromEntries(editors.map((e) => [e.getAttribute("data-pane"), e.getAttribute("data-tab")]));
    expect(byPane.primary).toBe("primary-tab");
    expect(byPane.secondary).toBe("secondary-tab");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("focusing a pane sets it as the focused pane", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const { container } = render(<DocumentSplitContainer />);
    const primaryPane = container.querySelector('.document-split__pane[data-focused]');
    expect(primaryPane).not.toBeNull();

    // Focus the primary pane (the first pane element).
    const panes = container.querySelectorAll(".document-split__pane");
    fireEvent.focus(panes[0]);
    expect(usePaneStore.getState().getSplit(W).focusedPane).toBe("primary");

    fireEvent.focus(panes[1]);
    expect(usePaneStore.getState().getSplit(W).focusedPane).toBe("secondary");
  });
});
