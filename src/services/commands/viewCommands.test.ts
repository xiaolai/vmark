// WI-5.1 — Knowledge Base panel reachable via command/menu (plan-audit C-1).
// Plus full coverage of the ADR-012 view/lint command set: every command's
// run() + title() closure is exercised. UI / settings / content-server stores
// run for real in jsdom; only the editor/lint/terminal side-effecting deps
// (which need a live editor) are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  toggleSourceModeWithCheckpoint,
  cleanupBeforeModeSwitch,
  requestToggleTerminal,
  toggleDocumentReadOnlyWithOwnership,
  scrollToSelectedDiagnostic,
  runActiveLint,
} = vi.hoisted(() => ({
  toggleSourceModeWithCheckpoint: vi.fn(),
  cleanupBeforeModeSwitch: vi.fn(),
  requestToggleTerminal: vi.fn(),
  toggleDocumentReadOnlyWithOwnership: vi.fn(),
  scrollToSelectedDiagnostic: vi.fn(),
  runActiveLint: vi.fn(),
}));

vi.mock("@/hooks/useUnifiedHistory", () => ({ toggleSourceModeWithCheckpoint }));
vi.mock("@/services/assembly/modeSwitchCleanup", () => ({ cleanupBeforeModeSwitch }));
vi.mock("@/components/Terminal/terminalGate", () => ({ requestToggleTerminal }));
vi.mock("@/services/workspaces/fileOwnership", () => ({ toggleDocumentReadOnlyWithOwnership }));
vi.mock("@/hooks/lintNavigation", () => ({ scrollToSelectedDiagnostic }));
vi.mock("@/services/lint/runActiveLint", () => ({ runActiveLint }));

import {
  registerViewCommands,
  __resetViewCommandsRegistration,
} from "./viewCommands";
import {
  getCommand,
  executeCommand,
  listCommands,
  resolveLocalizedString,
  _resetCommandBus,
} from "./CommandBus";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

beforeEach(() => {
  _resetCommandBus();
  __resetViewCommandsRegistration();
  useContentServerStore.getState().reset();
  useUIStore.getState().setMarkdownSplitView(false);
  registerViewCommands();
  vi.clearAllMocks();
});

describe("view.toggleKnowledgeBase", () => {
  it("is registered as a view command", () => {
    expect(getCommand("view.toggleKnowledgeBase")).toBeDefined();
    expect(getCommand("view.toggleKnowledgeBase")?.category).toBe("view");
  });

  it("toggles the KB panel open then closed", async () => {
    expect(useContentServerStore.getState().panelOpen).toBe(false);
    expect(await executeCommand("view.toggleKnowledgeBase")).toBe(true);
    expect(useContentServerStore.getState().panelOpen).toBe(true);
    await executeCommand("view.toggleKnowledgeBase");
    expect(useContentServerStore.getState().panelOpen).toBe(false);
  });
});

describe("view.toggleMarkdownSplit", () => {
  it("is registered as a view command", () => {
    expect(getCommand("view.toggleMarkdownSplit")?.category).toBe("view");
  });

  it("toggles the markdown source/preview split on then off", async () => {
    expect(useUIStore.getState().markdownSplitView).toBe(false);
    await executeCommand("view.toggleMarkdownSplit");
    expect(useUIStore.getState().markdownSplitView).toBe(true);
    await executeCommand("view.toggleMarkdownSplit");
    expect(useUIStore.getState().markdownSplitView).toBe(false);
  });
});

describe("registerViewCommands — full command set", () => {
  it("is idempotent — a second call does not throw on duplicate ids", () => {
    expect(() => registerViewCommands()).not.toThrow();
    expect(getCommand("view.toggleSourceMode")).toBeDefined();
  });

  it("registers all 21 view/lint commands", () => {
    const ids = listCommands().map((c) => c.id);
    expect(ids).toContain("view.toggleSourceMode");
    expect(ids).toContain("lint.prev");
    expect(ids.length).toBe(21);
  });

  it("every command resolves a non-empty title and executes without throwing", async () => {
    for (const cmd of listCommands()) {
      expect(resolveLocalizedString(cmd.title)).toBeTruthy();
      await expect(
        executeCommand(cmd.id, undefined, { windowLabel: "main" }),
      ).resolves.toBe(true);
    }
  });
});

describe("view command behavior", () => {
  it("toggleSourceMode cleans up then checkpoints the active window", async () => {
    await executeCommand("view.toggleSourceMode", undefined, { windowLabel: "main" });
    expect(cleanupBeforeModeSwitch).toHaveBeenCalled();
    expect(toggleSourceModeWithCheckpoint).toHaveBeenCalledWith("main");
  });

  it("toggleSourceMode defaults to 'main' when no window label is given", async () => {
    await executeCommand("view.toggleSourceMode");
    expect(toggleSourceModeWithCheckpoint).toHaveBeenCalledWith("main");
  });

  it("toggleFocusMode / toggleTypewriterMode flip their UI flags", async () => {
    const focus0 = useUIStore.getState().focusModeEnabled;
    await executeCommand("view.toggleFocusMode");
    expect(useUIStore.getState().focusModeEnabled).toBe(!focus0);

    const tw0 = useUIStore.getState().typewriterModeEnabled;
    await executeCommand("view.toggleTypewriterMode");
    expect(useUIStore.getState().typewriterModeEnabled).toBe(!tw0);
  });

  it("toggleTerminal requests the terminal gate", async () => {
    await executeCommand("view.toggleTerminal");
    expect(requestToggleTerminal).toHaveBeenCalled();
  });

  it("lint.check runs the active linter for the window", async () => {
    await executeCommand("lint.check", undefined, { windowLabel: "main" });
    expect(runActiveLint).toHaveBeenCalledWith("main");
  });

  it("toggleFitTables / toggleShowInvisibles flip their markdown settings", async () => {
    const fit0 = useSettingsStore.getState().markdown.tableFitToWidth;
    await executeCommand("view.toggleFitTables");
    expect(useSettingsStore.getState().markdown.tableFitToWidth).toBe(!fit0);

    const inv0 = useSettingsStore.getState().markdown.showInvisibles;
    await executeCommand("view.toggleShowInvisibles");
    expect(useSettingsStore.getState().markdown.showInvisibles).toBe(!inv0);
  });

  it("zoomActual resets to 18; zoomIn/zoomOut step and clamp", async () => {
    await executeCommand("view.zoomActual");
    expect(useSettingsStore.getState().appearance.fontSize).toBe(18);

    useSettingsStore.getState().updateAppearanceSetting("fontSize", 32);
    await executeCommand("view.zoomIn"); // clamp at MAX
    expect(useSettingsStore.getState().appearance.fontSize).toBe(32);

    useSettingsStore.getState().updateAppearanceSetting("fontSize", 12);
    await executeCommand("view.zoomOut"); // clamp at MIN
    expect(useSettingsStore.getState().appearance.fontSize).toBe(12);

    useSettingsStore.getState().updateAppearanceSetting("fontSize", 18);
    await executeCommand("view.zoomIn");
    expect(useSettingsStore.getState().appearance.fontSize).toBe(20);
  });
});
