import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { useDocumentStore } from "@/stores/documentStore";
import { bootstrapFormats, __resetBootstrap } from "@/lib/formats";
import { __resetRegistry } from "@/lib/formats/registry";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));

// The asset-protocol boundary: the real media surface turns each pane's
// document path into an <img> src through it, which is what lets these tests
// see WHICH document each real <Editor/> resolved.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

import { act } from "@testing-library/react";
import { DocumentSplitContainer } from "./DocumentSplitContainer";
import {
  armWindowListening,
  publishWindowListening,
  resetWindowListeningForTest,
} from "@/contexts/windowListening";

const W = "main";

/** Open an image tab with its document, so the real Editor mounts the media surface. */
function openImage(path: string): string {
  const id = useTabStore.getState().createTab(W, path);
  useDocumentStore.getState().initDocument(id, "", path);
  return id;
}

/** The image paths the mounted editors are showing, in DOM order. */
async function shownImages(count: number): Promise<string[]> {
  await waitFor(() => expect(document.querySelectorAll(".media-viewer img")).toHaveLength(count));
  return [...document.querySelectorAll(".media-viewer img")].map((img) =>
    decodeURIComponent(img.getAttribute("src") ?? ""),
  );
}

let primaryTab: string;

beforeEach(() => {
  __resetRegistry();
  __resetBootstrap();
  bootstrapFormats();
  usePaneStore.setState({ byWindow: {} });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  primaryTab = openImage("/pics/primary.png");
});

describe("DocumentSplitContainer (#1081)", () => {
  it("renders a single editor (no panes, no divider) when no split is open", async () => {
    const { container } = render(<DocumentSplitContainer />);
    const shown = await shownImages(1);
    expect(shown[0]).toContain("/pics/primary.png");
    expect(container.querySelector(".document-split__pane")).toBeNull();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("renders two panes with the right documents + a divider when split", async () => {
    const secondaryTab = openImage("/pics/secondary.png");
    useTabStore.getState().setActiveTab(W, primaryTab);
    usePaneStore.getState().openSplit(W, secondaryTab);
    const { container } = render(<DocumentSplitContainer />);

    await shownImages(2);
    const panes = container.querySelectorAll(".document-split__pane");
    expect(panes).toHaveLength(2);
    expect(decodeURIComponent(panes[0].querySelector("img")!.getAttribute("src")!)).toContain("/pics/primary.png");
    expect(decodeURIComponent(panes[1].querySelector("img")!.getAttribute("src")!)).toContain("/pics/secondary.png");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("focusing a pane sets it as the focused pane", () => {
    const secondaryTab = openImage("/pics/secondary.png");
    usePaneStore.getState().openSplit(W, secondaryTab); // focus = secondary
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

// WI-OC1.3 — no document surface mounts before the window has announced that
// it is listening. Building a large document's view is seconds of main-thread
// work on a slow machine; started first, it starved the listeners the
// announcement waits on (#1565).
describe("DocumentSplitContainer before the window is listening", () => {
  beforeEach(() => resetWindowListeningForTest());

  /** Give a pane a scroll range, which jsdom lays out as zero. */
  function scrollable(el: Element) {
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 100 });
  }

  it("mounts no editor until the announcement, then mounts it", async () => {
    armWindowListening();
    const { container } = render(<DocumentSplitContainer />);
    expect(container).toBeEmptyDOMElement();

    act(() => publishWindowListening());
    const shown = await shownImages(1);
    expect(shown[0]).toContain("/pics/primary.png");
  });

  it("binds split scroll sync to the real panes once the gate opens", async () => {
    const secondaryTab = openImage("/pics/secondary.png");
    usePaneStore.getState().openSplit(W, secondaryTab);
    usePaneStore.getState().toggleSyncScroll(W);
    expect(usePaneStore.getState().getSplit(W).syncScroll).toBe(true);
    armWindowListening();
    const { container } = render(<DocumentSplitContainer />);
    expect(container).toBeEmptyDOMElement();

    act(() => publishWindowListening());
    await shownImages(2);
    const [primary, secondary] = [...container.querySelectorAll(".document-split__pane")];
    scrollable(primary);
    scrollable(secondary);

    primary.scrollTop = 450;
    fireEvent.scroll(primary);
    expect(secondary.scrollTop).toBe(450);
  });

  it("mounts at once in a window that never armed the wait", async () => {
    render(<DocumentSplitContainer />);
    await shownImages(1);
  });
});
