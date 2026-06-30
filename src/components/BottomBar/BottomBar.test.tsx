import { render, screen } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { BottomBar } from "./BottomBar";

const { state } = vi.hoisted(() => ({
  state: { activeTabId: { main: "tab-1" as string | null } },
}));

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock("@/components/StatusBar", () => ({
  StatusBar: () => <div data-testid="statusbar" />,
}));
vi.mock("@/components/Editor/UniversalToolbar", () => ({
  UniversalToolbar: () => <div data-testid="toolbar" />,
}));
vi.mock("@/components/FindBar", () => ({
  FindBar: () => <div data-testid="findbar" />,
}));

describe("BottomBar", () => {
  afterEach(() => {
    state.activeTabId = { main: "tab-1" };
  });

  it("always renders StatusBar and FindBar", () => {
    render(<BottomBar />);
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
    expect(screen.getByTestId("findbar")).toBeInTheDocument();
  });

  it("renders the UniversalToolbar when a document is open", () => {
    state.activeTabId = { main: "tab-1" };
    render(<BottomBar />);
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
  });

  it("hides the UniversalToolbar on the empty-workspace window (no active tab)", () => {
    state.activeTabId = { main: null };
    render(<BottomBar />);
    // Editor formatting toolbar is gone...
    expect(screen.queryByTestId("toolbar")).not.toBeInTheDocument();
    // ...but the tab strip (StatusBar) and FindBar remain.
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
    expect(screen.getByTestId("findbar")).toBeInTheDocument();
  });
});
