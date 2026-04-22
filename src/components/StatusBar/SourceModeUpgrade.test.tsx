import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

import { SourceModeUpgrade } from "./SourceModeUpgrade";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";

function setActiveTab(tabId: string | null) {
  useTabStore.setState((state) => ({
    ...state,
    activeTabId: { ...state.activeTabId, main: tabId },
  }));
}

describe("SourceModeUpgrade", () => {
  beforeEach(() => {
    cleanup();
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
    useEditorStore.getState().reset();
    setActiveTab(null);
  });

  it("renders nothing when no tab is forced-source", () => {
    const { container } = render(<SourceModeUpgrade />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the tab is forced-source but editor is WYSIWYG", () => {
    setActiveTab("tab-1");
    useLargeFileSessionStore.getState().markForcedSource("tab-1");
    const { container } = render(<SourceModeUpgrade />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the offer when active tab is forced-source and editor is Source mode", () => {
    setActiveTab("tab-1");
    useLargeFileSessionStore.getState().markForcedSource("tab-1");
    useEditorStore.getState().setSourceMode(true);

    render(<SourceModeUpgrade />);

    expect(screen.getByText("largeFile.openedInSourceMode")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /largeFile\.switchToWysiwygAria/i })
    ).toBeInTheDocument();
  });

  it("clicking the action flips sourceMode and clears the marker", async () => {
    const user = userEvent.setup();
    setActiveTab("tab-1");
    useLargeFileSessionStore.getState().markForcedSource("tab-1");
    useEditorStore.getState().setSourceMode(true);

    render(<SourceModeUpgrade />);
    await user.click(
      screen.getByRole("button", { name: /largeFile\.switchToWysiwygAria/i })
    );

    expect(useEditorStore.getState().sourceMode).toBe(false);
    expect(useLargeFileSessionStore.getState().isForcedSource("tab-1")).toBe(false);
  });

  it("does not render for an unrelated active tab", () => {
    setActiveTab("tab-1");
    useLargeFileSessionStore.getState().markForcedSource("tab-9");
    useEditorStore.getState().setSourceMode(true);

    const { container } = render(<SourceModeUpgrade />);
    expect(container).toBeEmptyDOMElement();
  });
});
