import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { BottomBar } from "./BottomBar";
import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStoreTypes";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
vi.mock("@/components/StatusBar", () => ({
  StatusBar: () => <div data-testid="statusbar" />,
}));
vi.mock("@/components/Editor/UniversalToolbar", () => ({
  UniversalToolbar: () => <div data-testid="toolbar" />,
}));
vi.mock("@/components/FindBar", () => ({
  FindBar: () => <div data-testid="findbar" />,
}));

// WI-DP3.0 pilot — archetype "React selector consumer". The mock replaced
// `useTabStore` with a bare `selector(state)` call; the real hook subscribes.
//
// Audit 019fe61c corrected an overclaim here: an earlier version of this comment
// said the conversion "exercises the subscription", while every `setActive()`
// below ran BEFORE `render()` — which only ever tests the initial snapshot. The
// mounted-transition test at the bottom is what makes the claim true, and it is
// the one case a `selector(state)` fake could never have covered.
//
// Fixtures are REAL union members, not `as unknown as Tab[]`. The double cast
// fabricated an object with no `title`, `isPinned`, `filePath`, `formatId`,
// `automationMode`, `persistPolicy` or `url`, which defeated exactly the type
// contract that moving to the real store was supposed to buy.
function documentTab(id: string): Tab {
  return { id, title: "Doc", isPinned: false, kind: "document", filePath: null, formatId: "markdown" };
}

function browserTab(id: string): Tab {
  return {
    id,
    title: "Page",
    isPinned: false,
    kind: "browser",
    automationMode: "human",
    persistPolicy: "persistent",
    url: "https://example.com",
  };
}

function setActive(kind: Tab["kind"], id: string | null = "tab-1") {
  useTabStore.setState({
    activeTabId: { main: id },
    tabs: { main: id ? [kind === "document" ? documentTab(id) : browserTab(id)] : [] },
  });
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

  // The case that justifies using the real store at all: the store changes while
  // the component is MOUNTED, so the subscription — not the initial snapshot — is
  // what has to produce the new chrome. A `selector(state)` fake returns a value
  // and never notifies, so it could not have covered this.
  it("swaps chrome on a live document -> browser -> document transition without remounting", async () => {
    setActive("document");
    render(<BottomBar />);
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();

    await act(async () => {
      setActive("browser", "tab-2");
    });
    expect(screen.queryByTestId("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("findbar")).not.toBeInTheDocument();
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();

    await act(async () => {
      setActive("document", "tab-3");
    });
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("findbar")).toBeInTheDocument();
  });
});
