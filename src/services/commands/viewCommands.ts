/**
 * View commands — ADR-012 migration of useViewMenuEvents.
 *
 * Commands covering source/focus/typewriter modes, the universal toolbar,
 * sidebar views and panels (knowledge base, window status, breakdown), word
 * wrap, line numbers, diagram preview, fit tables, read-only, terminal
 * toggle, and zoom. Three sibling sets are registered from here so callers
 * keep one entry point: the split-document pane commands (paneCommands.ts),
 * the markdown-lint commands (lintCommands.ts), and the file-tree visibility
 * toggles (explorerCommands.ts).
 *
 * The specs are built by FOUR cohesive builders — mode, sidebar/panel, display,
 * zoom (audit #942). One 229-line function is not more atomic than four short
 * ones concatenated, and the zoom family, which is the only one with real
 * arithmetic in it, now lives in `viewZoomCommands.ts` with its bounds and the
 * monotonicity rule (#941) beside it.
 *
 * @coordinates-with services/commands/viewZoomCommands.ts — the zoom family
 * @module services/commands/viewCommands
 */

import { registerCommands, type CommandDefinition } from "./CommandBus";
import { registerPaneCommands } from "./paneCommands";
import { registerLintCommands } from "./lintCommands";
import { registerExplorerCommands } from "./explorerCommands";
import { useUIStore } from "@/stores/uiStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWindowStatusStore } from "@/stores/windowStatusStore";
import { useBreakdownStore } from "@/stores/breakdownStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { requestToggleTerminal } from "@/services/terminal/terminalGate";
import { cleanupBeforeModeSwitch } from "@/services/assembly/modeSwitchCleanup";
import { toggleSourceModeWithCheckpoint } from "@/services/history/unifiedHistory";
import { toggleMarkdownSplitWithCheckpoint } from "@/services/editor/markdownSplitToggle";
import { applySplitPaneViewShortcut } from "@/services/keybinding/splitPaneViewShortcut";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { toggleDocumentReadOnlyWithOwnership } from "@/services/workspaces/fileOwnership";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import i18n from "@/i18n";
import { toggleUniversalToolbar } from "@/services/editor/universalToolbarToggle";
import { zoomCommandSpecs } from "./viewZoomCommands";

type Ctx = { windowLabel?: string };

/** Owner token the whole view-command batch registers under (HMR-safe, atomic). */
const VIEW_COMMANDS_OWNER = "view-commands";

/**
 * Whether the active document is displayed in SOURCE right now — the global
 * flag OR the per-tab forced-source override a large file sets.
 *
 * The distinction is what `markdownSurface.tsx` renders from
 * (`sourceMode = globalSourceMode || forcedSource`), so a command that reads
 * only the global flag is asking a different question than the user sees.
 */
function isEffectivelySourceMode(windowLabel: string): boolean {
  if (useUIStore.getState().sourceMode) return true;
  const tabId = getActiveTabId(windowLabel);
  return tabId !== null && useLargeFileSessionStore.getState().isForcedSource(tabId);
}

/** Editing-mode commands: source, split, WYSIWYG, and the chrome around them. */
function modeCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "view.toggleSourceMode",
      title: () => i18n.t("commands:view.toggleSourceMode"),
      category: "view",
      run: (_args, ctx: Ctx) => {
        const windowLabel = ctx.windowLabel ?? "main";
        // A split-pane / viewer tab (JSON, YAML, …) owns a per-tab Source ⇄ Split
        // view mode; F6 toggles that, not the markdown source mode (formats.md).
        if (applySplitPaneViewShortcut(windowLabel, "source")) return;
        cleanupBeforeModeSwitch();
        toggleSourceModeWithCheckpoint(windowLabel);
      },
    },
    {
      id: "view.toggleMarkdownSplit",
      title: () => i18n.t("commands:view.toggleMarkdownSplit"),
      category: "view",
      run: (_args, ctx: Ctx) => {
        const windowLabel = ctx.windowLabel ?? "main";
        // Preview ⇄ Split on a split-pane / viewer tab — see view.toggleSourceMode.
        if (applySplitPaneViewShortcut(windowLabel, "preview")) return;
        toggleMarkdownSplitWithCheckpoint(windowLabel);
      },
    },
    // Bound to the native "WYSIWYG Mode" radio item (#1070). WYSIWYG is the
    // absence of source/split, so this turns off whichever is on, reusing the
    // same cleanup + history-checkpoint path as the individual toggles.
    {
      id: "view.setWysiwygMode",
      title: () => i18n.t("commands:view.setWysiwygMode"),
      category: "view",
      run: (_args, ctx: Ctx) => {
        const windowLabel = ctx.windowLabel ?? "main";
        // EFFECTIVE source, not the global flag (audit #945). A large file puts
        // its tab in forced source with `sourceMode` still false, so this
        // returned early and the menu item did nothing on exactly the documents
        // whose forced state the user most wants to leave —
        // `toggleSourceModeWithCheckpoint` clears the marker and is the only
        // path that does.
        const source = isEffectivelySourceMode(windowLabel);
        if (!source && !useUIStore.getState().markdownSplitView) return;
        if (source) {
          cleanupBeforeModeSwitch();
          toggleSourceModeWithCheckpoint(windowLabel);
          return;
        }
        // NO cleanup call here (audit #946): `toggleMarkdownSplitWithCheckpoint`
        // runs `cleanupBeforeModeSwitch` itself, and running it twice meant two
        // popup resets and two WYSIWYG flushes for one mode switch.
        toggleMarkdownSplitWithCheckpoint(windowLabel);
      },
    },
    {
      id: "view.toggleUniversalToolbar",
      title: () => i18n.t("commands:view.toggleUniversalToolbar"),
      category: "view",
      run: () => toggleUniversalToolbar(),
    },
    {
      id: "view.toggleFocusMode",
      title: () => i18n.t("commands:view.toggleFocusMode"),
      category: "view",
      run: () => useUIStore.getState().toggleFocusMode(),
    },
    {
      id: "view.toggleTypewriterMode",
      title: () => i18n.t("commands:view.toggleTypewriterMode"),
      category: "view",
      run: () => useUIStore.getState().toggleTypewriterMode(),
    },
  ];
}

/** Sidebar views and the standalone panels, plus workspace content search. */
function sidebarCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "view.contentSearch",
      title: () => i18n.t("commands:view.contentSearch"),
      category: "view",
      run: () => useUIStore.getState().contentSearchOpen(),
    },
    {
      id: "view.toggleSidebar",
      title: () => i18n.t("commands:view.toggleSidebar"),
      category: "view",
      run: () => useUIStore.getState().toggleSidebar(),
    },
    {
      id: "view.toggleOutline",
      title: () => i18n.t("commands:view.toggleOutline"),
      category: "view",
      run: () => useUIStore.getState().toggleSidebarView("outline"),
    },
    {
      id: "view.toggleFileExplorer",
      title: () => i18n.t("commands:view.toggleFileExplorer"),
      category: "view",
      run: () => useUIStore.getState().toggleSidebarView("files"),
    },
    {
      id: "view.toggleHistory",
      title: () => i18n.t("commands:view.toggleHistory"),
      category: "view",
      run: () => useUIStore.getState().toggleSidebarView("history"),
    },
    {
      id: "view.toggleKnowledgeBase",
      title: () => i18n.t("commands:view.toggleKnowledgeBase"),
      category: "view",
      run: () => useContentServerStore.getState().togglePanel(),
    },
    {
      id: "view.toggleWindowStatus",
      title: () => i18n.t("commands:view.toggleWindowStatus"),
      category: "view",
      run: () => useWindowStatusStore.getState().togglePanel(),
    },
    {
      id: "view.toggleBreakdown",
      title: () => i18n.t("commands:view.toggleBreakdown"),
      category: "view",
      run: () => useBreakdownStore.getState().togglePanel(),
    },
  ];
}

/** How the document is rendered, plus the terminal toggle. */
function displayCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "view.toggleWordWrap",
      title: () => i18n.t("commands:view.toggleWordWrap"),
      category: "view",
      run: () => useUIStore.getState().toggleWordWrap(),
    },
    {
      id: "view.toggleLineNumbers",
      title: () => i18n.t("commands:view.toggleLineNumbers"),
      category: "view",
      run: () => useUIStore.getState().toggleLineNumbers(),
    },
    {
      id: "view.toggleDiagramPreview",
      title: () => i18n.t("commands:view.toggleDiagramPreview"),
      category: "view",
      run: () => useUIStore.getState().toggleDiagramPreview(),
    },
    {
      id: "view.toggleFitTables",
      title: () => i18n.t("commands:view.toggleFitTables"),
      category: "view",
      run: () => {
        const current = useSettingsStore.getState().markdown.tableFitToWidth;
        useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", !current);
      },
    },
    {
      id: "view.toggleShowInvisibles",
      title: () => i18n.t("commands:view.toggleShowInvisibles"),
      category: "view",
      run: () => {
        const current = useSettingsStore.getState().markdown.showInvisibles;
        useSettingsStore.getState().updateMarkdownSetting("showInvisibles", !current);
      },
    },
    {
      id: "view.toggleReadOnly",
      title: () => i18n.t("commands:view.toggleReadOnly"),
      category: "view",
      run: (_args, ctx: Ctx) => {
        const windowLabel = ctx.windowLabel ?? "main";
        const tabId = getActiveTabId(windowLabel);
        if (tabId) toggleDocumentReadOnlyWithOwnership(tabId);
      },
    },
    {
      id: "view.toggleTerminal",
      title: () => i18n.t("commands:view.toggleTerminal"),
      category: "view",
      run: () => requestToggleTerminal(),
    },
  ];
}

/** Build the view command specs (pure — no registration). */
function buildViewCommandSpecs(): CommandDefinition[] {
  return [
    ...modeCommandSpecs(),
    ...sidebarCommandSpecs(),
    ...displayCommandSpecs(),
    ...zoomCommandSpecs(),
  ];
}

/**
 * Register the view/lint/pane/explorer command sets.
 *
 * An OWNER BATCH, not a first-id sentinel (audit #459). `hasCommand("view.
 * toggleSourceMode")` answered "is this id taken?", which is not the question:
 * a foreign registrar holding it made the guard report the whole set as
 * installed, so the other 32 commands were never registered and nothing said
 * so. `registerCommands` PREFLIGHTS every id — a foreign owner fails loudly,
 * before anything is written — and replaces its own previous batch, which is
 * what makes an HMR reload and the registerAllCommands retry converge (#514).
 */
export function registerViewCommands(): void {
  registerCommands(VIEW_COMMANDS_OWNER, buildViewCommandSpecs());
  registerPaneCommands();
  registerLintCommands();
  registerExplorerCommands();
}
