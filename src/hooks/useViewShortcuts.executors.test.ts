import { describe, it, expect, beforeEach, vi } from "vitest";

// External side-effect services — mocked so each executor has an observable,
// asserted effect without touching Tauri / the real editor.
const mocks = vi.hoisted(() => ({
  requestToggleTerminal: vi.fn(),
  toggleSourceModeWithCheckpoint: vi.fn(),
  cleanupBeforeModeSwitch: vi.fn(),
  toggleMarkdownSplitWithCheckpoint: vi.fn(),
  toggleDocumentReadOnlyWithOwnership: vi.fn(),
  runActiveLint: vi.fn(),
  scrollToSelectedDiagnostic: vi.fn(),
  getActiveTabId: vi.fn(() => "tab-1"),
  getCurrentWindowLabel: vi.fn(() => "main"),
  // store method spies
  toggleFocusMode: vi.fn(),
  toggleTypewriterMode: vi.fn(),
  toggleWordWrap: vi.fn(),
  toggleLineNumbers: vi.fn(),
  toggleSidebar: vi.fn(),
  toggleSidebarView: vi.fn(),
  updateMarkdownSetting: vi.fn(),
  togglePanel: vi.fn(),
  selectNext: vi.fn(),
  selectPrev: vi.fn(),
}));

vi.mock("@/components/Terminal/terminalGate", () => ({
  requestToggleTerminal: mocks.requestToggleTerminal,
}));
vi.mock("@/hooks/useUnifiedHistory", () => ({
  toggleSourceModeWithCheckpoint: mocks.toggleSourceModeWithCheckpoint,
}));
vi.mock("@/services/assembly/modeSwitchCleanup", () => ({
  cleanupBeforeModeSwitch: mocks.cleanupBeforeModeSwitch,
}));
vi.mock("@/hooks/markdownSplitToggle", () => ({
  toggleMarkdownSplitWithCheckpoint: mocks.toggleMarkdownSplitWithCheckpoint,
}));
vi.mock("@/services/workspaces/fileOwnership", () => ({
  toggleDocumentReadOnlyWithOwnership: mocks.toggleDocumentReadOnlyWithOwnership,
}));
vi.mock("@/services/lint/runActiveLint", () => ({ runActiveLint: mocks.runActiveLint }));
vi.mock("@/hooks/lintNavigation", () => ({
  scrollToSelectedDiagnostic: mocks.scrollToSelectedDiagnostic,
}));
vi.mock("@/services/navigation/activeDocument", () => ({
  getActiveTabId: mocks.getActiveTabId,
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: mocks.getCurrentWindowLabel,
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      toggleFocusMode: mocks.toggleFocusMode,
      toggleTypewriterMode: mocks.toggleTypewriterMode,
      toggleWordWrap: mocks.toggleWordWrap,
      toggleLineNumbers: mocks.toggleLineNumbers,
      toggleSidebar: mocks.toggleSidebar,
      toggleSidebarView: mocks.toggleSidebarView,
    }),
  },
}));
vi.mock("@/stores/contentServerStore", () => ({
  useContentServerStore: { getState: () => ({ togglePanel: mocks.togglePanel }) },
}));
vi.mock("@/stores/documentStore", () => ({
  useLintStore: {
    getState: () => ({ selectNext: mocks.selectNext, selectPrev: mocks.selectPrev }),
  },
}));
vi.mock("@/stores/settingsStore", () => ({
  useShortcutsStore: { getState: () => ({ getShortcut: () => "" }) },
  useSettingsStore: {
    getState: () => ({
      markdown: { tableFitToWidth: false },
      updateMarkdownSetting: mocks.updateMarkdownSetting,
    }),
  },
}));

import { VIEW_ACTION_EXECUTORS } from "./useViewShortcuts";

describe("VIEW_ACTION_EXECUTORS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveTabId.mockReturnValue("tab-1");
  });

  it("toggleTerminal requests the terminal toggle", () => {
    VIEW_ACTION_EXECUTORS.toggleTerminal();
    expect(mocks.requestToggleTerminal).toHaveBeenCalledTimes(1);
  });

  it("sourceMode cleans up then toggles source mode with a checkpoint", () => {
    VIEW_ACTION_EXECUTORS.sourceMode();
    expect(mocks.cleanupBeforeModeSwitch).toHaveBeenCalledTimes(1);
    expect(mocks.toggleSourceModeWithCheckpoint).toHaveBeenCalledWith("main");
  });

  it("focusMode / typewriterMode / wordWrap / lineNumbers toggle UI state", () => {
    VIEW_ACTION_EXECUTORS.focusMode();
    VIEW_ACTION_EXECUTORS.typewriterMode();
    VIEW_ACTION_EXECUTORS.wordWrap();
    VIEW_ACTION_EXECUTORS.lineNumbers();
    expect(mocks.toggleFocusMode).toHaveBeenCalledTimes(1);
    expect(mocks.toggleTypewriterMode).toHaveBeenCalledTimes(1);
    expect(mocks.toggleWordWrap).toHaveBeenCalledTimes(1);
    expect(mocks.toggleLineNumbers).toHaveBeenCalledTimes(1);
  });

  it("readOnly toggles read-only for the active tab", () => {
    VIEW_ACTION_EXECUTORS.readOnly();
    expect(mocks.toggleDocumentReadOnlyWithOwnership).toHaveBeenCalledWith("tab-1");
  });

  it("readOnly is a no-op when there is no active tab", () => {
    mocks.getActiveTabId.mockReturnValue(null as unknown as string);
    VIEW_ACTION_EXECUTORS.readOnly();
    expect(mocks.toggleDocumentReadOnlyWithOwnership).not.toHaveBeenCalled();
  });

  it("fitTables flips the tableFitToWidth setting", () => {
    VIEW_ACTION_EXECUTORS.fitTables();
    expect(mocks.updateMarkdownSetting).toHaveBeenCalledWith("tableFitToWidth", true);
  });

  it("validateMarkdown runs lint on the active document", () => {
    VIEW_ACTION_EXECUTORS.validateMarkdown();
    expect(mocks.runActiveLint).toHaveBeenCalledWith("main");
  });

  it("lintNext / lintPrev select diagnostics and scroll", () => {
    VIEW_ACTION_EXECUTORS.lintNext();
    expect(mocks.selectNext).toHaveBeenCalledWith("tab-1");
    expect(mocks.scrollToSelectedDiagnostic).toHaveBeenCalledWith("tab-1");

    VIEW_ACTION_EXECUTORS.lintPrev();
    expect(mocks.selectPrev).toHaveBeenCalledWith("tab-1");
  });

  it("lint navigation is a no-op when there is no active tab", () => {
    mocks.getActiveTabId.mockReturnValue(null as unknown as string);
    VIEW_ACTION_EXECUTORS.lintNext();
    expect(mocks.selectNext).not.toHaveBeenCalled();
    expect(mocks.scrollToSelectedDiagnostic).not.toHaveBeenCalled();
  });

  it("sidebar / panel toggles route through the UI store", () => {
    VIEW_ACTION_EXECUTORS.toggleSidebar();
    expect(mocks.toggleSidebar).toHaveBeenCalledTimes(1);

    VIEW_ACTION_EXECUTORS.toggleOutline();
    expect(mocks.toggleSidebarView).toHaveBeenCalledWith("outline");

    VIEW_ACTION_EXECUTORS.fileExplorer();
    expect(mocks.toggleSidebarView).toHaveBeenCalledWith("files");

    VIEW_ACTION_EXECUTORS.viewHistory();
    expect(mocks.toggleSidebarView).toHaveBeenCalledWith("history");
  });

  it("knowledgeBase toggles the content-server panel", () => {
    VIEW_ACTION_EXECUTORS.knowledgeBase();
    expect(mocks.togglePanel).toHaveBeenCalledTimes(1);
  });

  it("markdownSplit toggles the split view with a checkpoint", () => {
    VIEW_ACTION_EXECUTORS.markdownSplit();
    expect(mocks.toggleMarkdownSplitWithCheckpoint).toHaveBeenCalledWith("main");
  });
});
