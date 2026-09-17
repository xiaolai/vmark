// #1425 — the Knowledge Base hides behind Developer Mode, and the panel has no
// close button of its own: it is opened and closed by the menu item, the
// palette command and Ctrl+Shift+4, all three of which the same predicate
// gates. So turning Developer Mode off with the dock OPEN would leave a panel
// nothing could close. It closes itself instead.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/hooks/useContentServer", () => ({
  useContentServer: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    openInBrowser: vi.fn(),
    previewSlides: vi.fn(),
    exportSlides: vi.fn(),
  }),
}));
vi.mock("@/hooks/useBrowserOccluder", () => ({ useBrowserOccluder: vi.fn() }));

import { KnowledgeBaseOverlay } from "./KnowledgeBaseOverlay";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useSettingsStore } from "@/stores/settingsStore";

const setDeveloperMode = (developerMode: boolean) =>
  useSettingsStore.setState((s) => ({ advanced: { ...s.advanced, developerMode } }));
const dock = () => screen.queryByTestId("kb-dock");

beforeEach(() => {
  useContentServerStore.getState().reset();
  setDeveloperMode(true);
});

describe("KnowledgeBaseOverlay availability (#1425)", () => {
  it("renders nothing while the panel is closed", () => {
    render(<KnowledgeBaseOverlay />);
    expect(dock()).toBeNull();
  });

  it("renders the dock when the panel is open and the feature is available", () => {
    useContentServerStore.getState().setPanelOpen(true);
    render(<KnowledgeBaseOverlay />);
    expect(dock()).toBeInTheDocument();
  });

  it("closes itself when Developer Mode goes off mid-session", async () => {
    useContentServerStore.getState().setPanelOpen(true);
    render(<KnowledgeBaseOverlay />);
    expect(dock()).toBeInTheDocument();

    setDeveloperMode(false);

    await vi.waitFor(() => expect(dock()).toBeNull());
    // The STORE is what has to change, not just the render: a dock that merely
    // stopped painting would reappear the next time anything re-rendered, and
    // `panelOpen` would still say the feature was in use.
    expect(useContentServerStore.getState().panelOpen).toBe(false);
  });

  it("does not open by itself when the feature is unavailable", () => {
    setDeveloperMode(false);
    render(<KnowledgeBaseOverlay />);
    expect(dock()).toBeNull();
    expect(useContentServerStore.getState().panelOpen).toBe(false);
  });
});
