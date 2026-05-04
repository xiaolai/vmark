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
import { useDocumentStore } from "@/stores/documentStore";
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

  it("renders the offer when active tab is forced-source (independent of global sourceMode)", () => {
    setActiveTab("tab-1");
    useLargeFileSessionStore.getState().markForcedSource("tab-1");

    render(<SourceModeUpgrade />);

    expect(screen.getByText("largeFile.openedInSourceMode")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /largeFile\.switchToWysiwygAria/i })
    ).toBeInTheDocument();
  });

  it("clicking the action clears the marker but does NOT touch global sourceMode", async () => {
    const user = userEvent.setup();
    setActiveTab("tab-1");
    useLargeFileSessionStore.getState().markForcedSource("tab-1");
    useEditorStore.getState().setSourceMode(true);

    render(<SourceModeUpgrade />);
    await user.click(
      screen.getByRole("button", { name: /largeFile\.switchToWysiwygAria/i })
    );

    // Global sourceMode is preserved — only the tab's override is lifted.
    expect(useEditorStore.getState().sourceMode).toBe(true);
    expect(useLargeFileSessionStore.getState().isForcedSource("tab-1")).toBe(false);
  });

  it("does not render for an unrelated active tab", () => {
    setActiveTab("tab-1");
    useLargeFileSessionStore.getState().markForcedSource("tab-9");

    const { container } = render(<SourceModeUpgrade />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does NOT render the offer for a YAML/YML file even if forced-source", () => {
    setActiveTab("tab-yaml");
    useLargeFileSessionStore.getState().markForcedSource("tab-yaml");
    useDocumentStore
      .getState()
      .initDocument(
        "tab-yaml",
        "name: ci\non: push\njobs: {}\n",
        "/repo/.github/workflows/ci.yml",
      );
    const { container } = render(<SourceModeUpgrade />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders the offer for a non-YAML forced-source file", () => {
    setActiveTab("tab-md");
    useLargeFileSessionStore.getState().markForcedSource("tab-md");
    useDocumentStore
      .getState()
      .initDocument("tab-md", "# big notes", "/repo/notes.md");
    render(<SourceModeUpgrade />);
    expect(screen.getByText("largeFile.openedInSourceMode")).toBeInTheDocument();
  });
});
