// WI-5.1 — Knowledge Base panel reachable via command/menu (plan-audit C-1).
// Plus full coverage of the ADR-012 view/lint command set: every command's
// run() + title() closure is exercised. UI / settings / content-server stores
// run for real in jsdom; only the editor/lint/terminal side-effecting deps
// (which need a live editor) are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/services/history/unifiedHistory", () => ({ toggleSourceModeWithCheckpoint }));
vi.mock("@/services/assembly/modeSwitchCleanup", () => ({ cleanupBeforeModeSwitch }));
vi.mock("@/services/terminal/terminalGate", () => ({ requestToggleTerminal }));
vi.mock("@/services/workspaces/fileOwnership", () => ({ toggleDocumentReadOnlyWithOwnership }));
vi.mock("@/services/lint/lintNavigation", () => ({ scrollToSelectedDiagnostic }));
vi.mock("@/services/lint/runActiveLint", () => ({ runActiveLint }));

import { registerViewCommands } from "./viewCommands";
import {
  getCommand,
  executeCommand,
  listCommands,
  registerCommand,
  registerCommands,
  resolveLocalizedString,
  searchCommands,
  _resetCommandBus,
} from "./CommandBus";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePaneStore, DEFAULT_SPLIT } from "@/stores/paneStore";
import { useTabStore } from "@/stores/tabStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { registerFormat, __resetRegistry } from "@/lib/formats/registry";
import type { FormatConfig } from "@/lib/formats/types";

beforeEach(() => {
  _resetCommandBus();
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

describe("view.setWysiwygMode (#1070)", () => {
  it("from Source mode: cleans up then toggles source off for the window", async () => {
    useUIStore.getState().setSourceMode(true);
    vi.clearAllMocks();
    await executeCommand("view.setWysiwygMode", undefined, { windowLabel: "main" });
    expect(cleanupBeforeModeSwitch).toHaveBeenCalledTimes(1);
    expect(toggleSourceModeWithCheckpoint).toHaveBeenCalledWith("main");
  });

  it("is a no-op when already in WYSIWYG (neither flag set)", async () => {
    useUIStore.getState().setSourceMode(false);
    useUIStore.getState().setMarkdownSplitView(false);
    vi.clearAllMocks();
    await executeCommand("view.setWysiwygMode");
    expect(cleanupBeforeModeSwitch).not.toHaveBeenCalled();
    expect(toggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
  });

  // Audit #946 — `toggleMarkdownSplitWithCheckpoint` runs the cleanup itself
  // (markdownSplitToggle.ts, Codex #8), so the caller running it too meant two
  // popup resets and two WYSIWYG flushes for one mode switch. Each toggle
  // helper owns its cleanup exactly once.
  it("from Split view: leaves the cleanup to the split toggle, running it once", async () => {
    useUIStore.getState().setSourceMode(false);
    useUIStore.getState().setMarkdownSplitView(true);
    vi.clearAllMocks();

    await executeCommand("view.setWysiwygMode", undefined, { windowLabel: "main" });

    expect(cleanupBeforeModeSwitch).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().markdownSplitView).toBe(false);
    expect(toggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
  });

  // Audit #945 — a large file forces its TAB into source with the global
  // `sourceMode` still false, so reading only the global flag made the WYSIWYG
  // menu item a no-op on exactly the documents whose forced state the user most
  // wants to leave. `toggleSourceModeWithCheckpoint` is the only path that
  // clears the marker.
  describe("a forced-source tab (large file)", () => {
    beforeEach(() => {
      useTabStore.setState({
        tabs: { main: [{ id: "t-big", kind: "document" } as never] },
        activeTabId: { main: "t-big" },
      } as never);
      useLargeFileSessionStore.getState().markForcedSource("t-big");
      useUIStore.getState().setSourceMode(false);
      useUIStore.getState().setMarkdownSplitView(false);
      vi.clearAllMocks();
    });

    afterEach(() => {
      useLargeFileSessionStore.getState().clearForcedSource("t-big");
      useTabStore.setState({ tabs: {}, activeTabId: {} } as never);
    });

    it("leaves forced source through the toggle instead of returning early", async () => {
      await executeCommand("view.setWysiwygMode", undefined, { windowLabel: "main" });

      expect(cleanupBeforeModeSwitch).toHaveBeenCalledTimes(1);
      expect(toggleSourceModeWithCheckpoint).toHaveBeenCalledWith("main");
    });

    it("still does nothing for a tab that is NOT forced", async () => {
      useLargeFileSessionStore.getState().clearForcedSource("t-big");

      await executeCommand("view.setWysiwygMode", undefined, { windowLabel: "main" });

      expect(toggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
    });
  });
});

describe("registerViewCommands — full command set", () => {
  it("is idempotent — a second call does not throw on duplicate ids", () => {
    expect(() => registerViewCommands()).not.toThrow();
    expect(getCommand("view.toggleSourceMode")).toBeDefined();
  });

  it("registers all 33 view/lint commands", () => {
    const ids = listCommands().map((c) => c.id);
    expect(ids).toContain("view.toggleSidebar");
    expect(ids).toContain("view.toggleSourceMode");
    expect(ids).toContain("view.setWysiwygMode");
    expect(ids).toContain("view.toggleSplitDocuments");
    expect(ids).toContain("lint.prev");
    expect(ids).toContain("view.toggleSyncScroll");
    expect(ids).toContain("view.closePane");
    expect(ids).toContain("view.focusOtherPane");
    expect(ids).toContain("view.toggleBreakdown");
    expect(ids).toContain("view.contentSearch");
    expect(ids).toContain("explorer.toggleHiddenFiles");
    expect(ids).toContain("explorer.toggleAllFiles");
    expect(ids).toContain("view.toggleUniversalToolbar");
    expect(ids.length).toBe(33);
  });

  it("every command resolves a non-empty title and executes without throwing", async () => {
    for (const cmd of listCommands()) {
      expect(resolveLocalizedString(cmd.title)).toBeTruthy();
      // What this asserts is that nothing THROWS. A command carrying a `when`
      // is legitimately unavailable in this bare context — no split, no
      // workspace (audit #924/#944) — and `executeCommand` reports that as
      // `false` rather than running a no-op.
      const available = cmd.when ? cmd.when({ windowLabel: "main" }) : true;
      await expect(
        executeCommand(cmd.id, undefined, { windowLabel: "main" }),
      ).resolves.toBe(available);
    }
  });
});

// Audit 20260907 (#459), round 3. The guard was "does the FIRST id exist?",
// which answers a different question than the one it was asked. A foreign
// registrar holding `view.toggleSourceMode` made the sentinel report the set as
// already installed, so the other 32 commands were never registered and nothing
// said so — the palette and every view menu item simply did nothing. The set
// registers as an owner batch now: the preflight refuses a foreign id LOUDLY,
// and re-registering the batch replaces its own predecessor.
describe("registerViewCommands — foreign collisions (audit #459)", () => {
  it("throws instead of silently skipping when another registrar holds one of its ids", () => {
    _resetCommandBus();
    registerCommand({ id: "view.toggleSourceMode", title: "impostor", run: () => {} });
    expect(() => registerViewCommands()).toThrow(/already registered/);
  });

  it("throws on a foreign LATER id, and writes nothing before it", () => {
    _resetCommandBus();
    registerCommand({ id: "view.zoomOut", title: "impostor", run: () => {} });
    expect(() => registerViewCommands()).toThrow(/already registered/);
    // The preflight runs before any write, so the collision cannot leave the
    // commands ahead of it half-installed — the state the old sentinel would
    // then have read as "already done".
    expect(listCommands().map((c) => c.id)).toEqual(["view.zoomOut"]);
  });

  it("re-registering replaces its own batch rather than skipping it", () => {
    // The whole set must come back even when its first id is already present:
    // this is the case the sentinel could not distinguish from a collision.
    const ids = listCommands().map((c) => c.id).sort();
    registerViewCommands();
    expect(listCommands().map((c) => c.id).sort()).toEqual(ids);
  });

  it("does not collide with a sibling owner batch", () => {
    registerCommands("unrelated-owner", [{ id: "other.thing", title: "x", run: () => {} }]);
    expect(() => registerViewCommands()).not.toThrow();
    expect(getCommand("other.thing")).toBeDefined();
  });
});

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("does not throw when the module flag resets but the bus registry survives", () => {
    const before = listCommands().length;
    // Simulate Vite HMR: the registrar module re-instantiates while
    // CommandBus's REGISTRY survives. Owner registration is replace-own, so a
    // second call converges on exactly this batch rather than colliding.
    expect(() => registerViewCommands()).not.toThrow();
    expect(listCommands().length).toBe(before);
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

  // audit #941 — the zoom step's own bounds are NARROWER than the settings
  // store's valid range for `appearance.fontSize` (`clamp.ts`: [8, 48]), so a
  // size set outside the zoom range made each command move the text the WRONG
  // WAY: `Math.min(48 + 2, 32)` shrank on Zoom In, `Math.max(8 - 2, 12)` grew
  // on Zoom Out. Each command must be monotonic in its own direction.
  it("zoomIn never shrinks and zoomOut never grows, outside the zoom range", async () => {
    useSettingsStore.getState().updateAppearanceSetting("fontSize", 48);
    await executeCommand("view.zoomIn");
    expect(useSettingsStore.getState().appearance.fontSize).toBe(48);
    // …and Zoom Out from there walks back toward the range rather than jumping.
    await executeCommand("view.zoomOut");
    expect(useSettingsStore.getState().appearance.fontSize).toBe(46);

    useSettingsStore.getState().updateAppearanceSetting("fontSize", 8);
    await executeCommand("view.zoomOut");
    expect(useSettingsStore.getState().appearance.fontSize).toBe(8);
    await executeCommand("view.zoomIn");
    expect(useSettingsStore.getState().appearance.fontSize).toBe(10);
  });
});

describe("split-document view commands (#1081)", () => {
  const W = "main";
  let tab1: string;
  let tab2: string;
  beforeEach(() => {
    usePaneStore.setState({ byWindow: {} });
    useTabStore.getState().removeWindow(W);
    tab1 = useTabStore.getState().createTab(W, "/a.md");
    tab2 = useTabStore.getState().createTab(W, "/b.md");
    useTabStore.getState().setActiveTab(W, tab1);
  });

  it("toggleSplitDocuments opens then closes the split", async () => {
    await executeCommand("view.toggleSplitDocuments", undefined, { windowLabel: W });
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(true);
    await executeCommand("view.toggleSplitDocuments", undefined, { windowLabel: W });
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("toggleSplitDocuments is a no-op with no active document", async () => {
    useTabStore.getState().removeWindow(W); // no tabs ⇒ getActiveTabId null
    await expect(
      executeCommand("view.toggleSplitDocuments", undefined, { windowLabel: W }),
    ).resolves.toBe(true);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("toggleSyncScroll flips the split's syncScroll flag", async () => {
    usePaneStore.getState().openSplit(W, tab2);
    const before = usePaneStore.getState().getSplit(W).syncScroll;
    await executeCommand("view.toggleSyncScroll", undefined, { windowLabel: W });
    expect(usePaneStore.getState().getSplit(W).syncScroll).toBe(!before);
  });

  it("closePane collapses an open split back to single pane", async () => {
    usePaneStore.getState().openSplit(W, tab2);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(true);
    await executeCommand("view.closePane", undefined, { windowLabel: W });
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("closePane is unavailable when no split is open (#924)", async () => {
    // It used to be executable and do nothing, which also meant the palette
    // listed it. `executeCommand` reports an unavailable command as `false`.
    await expect(
      executeCommand("view.closePane", undefined, { windowLabel: W }),
    ).resolves.toBe(false);
    expect(usePaneStore.getState().getSplit(W).enabled).toBe(false);
  });

  it("focusOtherPane flips the focused pane; no-op without a split", async () => {
    usePaneStore.getState().openSplit(W, tab2); // focus = secondary
    await executeCommand("view.focusOtherPane", undefined, { windowLabel: W });
    expect(usePaneStore.getState().getSplit(W).focusedPane).toBe("primary");
    await executeCommand("view.focusOtherPane", undefined, { windowLabel: W });
    expect(usePaneStore.getState().getSplit(W).focusedPane).toBe("secondary");

    usePaneStore.setState({ byWindow: {} });
    await expect(
      executeCommand("view.focusOtherPane", undefined, { windowLabel: W }),
    ).resolves.toBe(false); // unavailable without a split (#924)
  });
});

// formats.md promises "F6 toggles Source ⇄ Split and Shift+F6 toggles Preview ⇄
// Split" on split-pane / viewer tabs (Split is the base state). That branch lived
// in useViewShortcuts and was dropped when the view shortcuts migrated onto
// commands (af6cafc1d), so F6 on a JSON/YAML tab silently toggled the MARKDOWN
// source mode instead. Menu, chord and palette all route through the commands,
// so the per-tab branch is pinned there. Runs LAST in this file: it swaps the
// format registry for one preview-capable split-pane format and empties it
// after, and an empty registry would dispatch every later "/a.md" tab to
// whichever format registered first.
describe("F6 / Shift+F6 on split-pane tabs (formats.md: Source ⇄ Split, Preview ⇄ Split)", () => {
  const W = "main";
  const Stub = (() => null) as unknown as NonNullable<FormatConfig["genericPreview"]>;
  const previewFmt: FormatConfig = {
    id: "pfmt",
    nameI18nKey: "format.pfmt",
    extensions: ["pfmt"],
    kind: "split-pane",
    genericPreview: Stub,
    adapters: {
      saveDialogFilters: [{ nameI18nKey: "format.pfmt", extensions: ["pfmt"] }],
      untitledExtension: "pfmt",
      readOnlyDefault: false,
      closeSavePolicy: "prompt-on-close",
      menuPolicy: {
        sourceWysiwygToggle: false,
        cjkFormatActions: false,
        insertBlockActions: false,
        paragraphFormatting: false,
      },
    },
  };
  let tab: string;
  /** The per-tab view mode of a DOCUMENT tab (browser tabs carry none). */
  const viewModeOf = (id: string) => {
    const t = useTabStore.getState().findTabById(id);
    return t?.kind === "document" ? t.viewMode : undefined;
  };
  const viewMode = () => viewModeOf(tab);

  beforeEach(() => {
    __resetRegistry();
    registerFormat(previewFmt);
    useTabStore.getState().removeWindow(W);
    tab = useTabStore.getState().createTab(W, "/doc.pfmt");
    useTabStore.getState().setActiveTab(W, tab);
    useSettingsStore.setState((s) => ({ formats: { ...s.formats, defaultViewMode: "split" } }));
    useUIStore.getState().setSourceMode(false);
  });
  afterEach(() => __resetRegistry());

  it("toggleSourceMode flips the tab Split → Source → Split and never touches markdown source mode", async () => {
    await executeCommand("view.toggleSourceMode", undefined, { windowLabel: W });
    expect(viewMode()).toBe("source");
    expect(toggleSourceModeWithCheckpoint).not.toHaveBeenCalled();
    expect(cleanupBeforeModeSwitch).not.toHaveBeenCalled();
    await executeCommand("view.toggleSourceMode", undefined, { windowLabel: W });
    expect(viewMode()).toBe("split");
    expect(useUIStore.getState().sourceMode).toBe(false);
  });

  it("toggleMarkdownSplit flips the tab Split → Preview → Split and leaves markdownSplitView alone", async () => {
    await executeCommand("view.toggleMarkdownSplit", undefined, { windowLabel: W });
    expect(viewMode()).toBe("preview");
    expect(useUIStore.getState().markdownSplitView).toBe(false);
    await executeCommand("view.toggleMarkdownSplit", undefined, { windowLabel: W });
    expect(viewMode()).toBe("split");
  });

  it("F6 from Preview goes straight to Source (the other non-base mode)", async () => {
    await executeCommand("view.toggleMarkdownSplit", undefined, { windowLabel: W });
    expect(viewMode()).toBe("preview");
    await executeCommand("view.toggleSourceMode", undefined, { windowLabel: W });
    expect(viewMode()).toBe("source");
  });

  it("a markdown tab still takes the markdown source-mode path", async () => {
    const md = useTabStore.getState().createTab(W, "/a.md");
    useTabStore.getState().setTabFormatId(md, "markdown");
    useTabStore.getState().setActiveTab(W, md);
    await executeCommand("view.toggleSourceMode", undefined, { windowLabel: W });
    expect(cleanupBeforeModeSwitch).toHaveBeenCalledTimes(1);
    expect(toggleSourceModeWithCheckpoint).toHaveBeenCalledWith(W);
    expect(viewModeOf(md)).toBeUndefined();
  });
});

// Audit #924 — the three split commands used to be exposed with no split open.
// Two did nothing; `toggleSyncScroll` wrote latent state that surfaced later,
// when the user opened a split and found scroll sync in a mode they never set.
describe("split commands are unavailable without a split (#924)", () => {
  const WIN = "w-when";

  beforeEach(() => {
    usePaneStore.setState({ byWindow: {} });
  });

  it.each(["view.toggleSyncScroll", "view.closePane", "view.focusOtherPane"])(
    "%s is hidden from the palette and refused",
    async (id) => {
      expect(searchCommands("", { windowLabel: WIN }).map((r) => r.command.id)).not.toContain(id);
      await expect(executeCommand(id, undefined, { windowLabel: WIN })).resolves.toBe(false);
    },
  );

  it("toggleSyncScroll does not write latent state with no split", async () => {
    await executeCommand("view.toggleSyncScroll", undefined, { windowLabel: WIN });
    expect(usePaneStore.getState().byWindow[WIN]).toBeUndefined();
  });

  it("all three come back once a split is open", () => {
    usePaneStore.setState({
      byWindow: {
        [WIN]: {
          ...DEFAULT_SPLIT,
          enabled: true,
          primaryTabId: "a",
          secondaryTabId: "b",
        },
      },
    });
    const ids = searchCommands("", { windowLabel: WIN }).map((r) => r.command.id);
    expect(ids).toEqual(
      expect.arrayContaining(["view.toggleSyncScroll", "view.closePane", "view.focusOtherPane"]),
    );
  });
});
