import { render, screen } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { BottomBar } from "./BottomBar";

type MockTab = { id: string; kind: string };
const { state } = vi.hoisted(() => ({
  state: {
    activeTabId: { main: "tab-1" as string | null },
    tabs: { main: [{ id: "tab-1", kind: "document" }] as MockTab[] },
  },
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

function setActive(kind: string, id: string | null = "tab-1") {
  state.activeTabId = { main: id };
  state.tabs = { main: id ? [{ id, kind }] : [] };
}

describe("BottomBar", () => {
  afterEach(() => {
    setActive("document");
  });

  it("renders StatusBar and FindBar for a document tab", () => {
    setActive("document");
    render(<BottomBar />);
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
    expect(screen.getByTestId("findbar")).toBeInTheDocument();
  });

  it("renders the UniversalToolbar when a document is open", () => {
    setActive("document");
    render(<BottomBar />);
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
  });

  it("hides the UniversalToolbar on the empty-workspace window (no active tab)", () => {
    setActive("document", null);
    render(<BottomBar />);
    // Editor formatting toolbar is gone...
    expect(screen.queryByTestId("toolbar")).not.toBeInTheDocument();
    // ...but the tab strip (StatusBar) and FindBar remain.
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
    expect(screen.getByTestId("findbar")).toBeInTheDocument();
  });

  // Codex re-review (D1#4): the browser's omnibox lives in the StatusBar and is its
  // ONLY chrome. The editor formatting toolbar and the find bar share this 40px lane
  // and would cover it — and neither applies to a native web page (VMark's find
  // searches the editor document, which a browser tab does not have).
  it("hides the editor toolbar and find bar when a browser tab is active", () => {
    setActive("browser");
    render(<BottomBar />);
    expect(screen.queryByTestId("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findbar")).not.toBeInTheDocument();
    // The StatusBar (carrying the omnibox) must remain.
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
  });
});
