/**
 * #1224 — the title bar showed the file name with its extension chopped off by
 * `getFileNameWithoutExtension`, which cuts at the last dot regardless of
 * whether VMark knows the format. `App.vue` displayed as `App`: a name that
 * exists nowhere on disk, for a file VMark cannot even open.
 *
 * Stores are real (settings + tabs, driven via setState); only the document
 * state hook — a hook, not a store — is stubbed, since it reaches into editor
 * state this suite has no reason to bootstrap.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ filePath: "/tmp/notes.md" as string | null }));

vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentFilePath: () => mocks.filePath,
  useDocumentIsDirty: () => false,
  useDocumentIsMissing: () => false,
  useActiveTabId: () => "tab-1",
}));

vi.mock("./useTitleBarRename", () => ({
  useTitleBarRename: () => ({ renameFile: vi.fn(), isRenaming: false }),
}));

import { TitleBar } from "./TitleBar";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStore";

const untitledTab: Tab = {
  kind: "document",
  id: "tab-1",
  filePath: null,
  title: "Untitled-1",
  isPinned: false,
  formatId: "markdown",
};

function setShowExtensions(value: boolean) {
  useSettingsStore.setState((s) => ({
    general: { ...s.general, showFileExtensions: value },
    appearance: { ...s.appearance, showFilenameInTitlebar: true },
  }));
}

beforeEach(() => {
  mocks.filePath = "/tmp/notes.md";
  setShowExtensions(true);
  useTabStore.setState({ tabs: { main: [untitledTab] }, activeTabId: { main: "tab-1" } });
});

afterEach(() => {
  useSettingsStore.setState((s) => ({
    general: { ...s.general, showFileExtensions: true },
    appearance: { ...s.appearance, showFilenameInTitlebar: false },
  }));
  useTabStore.setState({ tabs: {}, activeTabId: {} });
});

describe("TitleBar — file name", () => {
  it("shows the name as it is on disk by default", () => {
    render(<TitleBar />);
    expect(screen.getByRole("banner")).toHaveTextContent("notes.md");
  });

  it("hides a known extension when the setting is off", () => {
    setShowExtensions(false);
    render(<TitleBar />);
    expect(screen.getByText("notes")).toBeInTheDocument();
  });

  it("keeps an unknown extension visible even when hiding", () => {
    mocks.filePath = "/tmp/App.vue";
    setShowExtensions(false);
    render(<TitleBar />);
    expect(screen.getByText("App.vue")).toBeInTheDocument();
  });

  it("falls back to the tab title for an unsaved document", () => {
    mocks.filePath = null;
    render(<TitleBar />);
    expect(screen.getByText("Untitled-1")).toBeInTheDocument();
  });
});
