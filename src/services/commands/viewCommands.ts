/**
 * View commands — ADR-012 migration of useViewMenuEvents.
 *
 * 20 commands covering source/focus/typewriter modes, sidebar views,
 * word wrap, line numbers, diagram preview, fit tables, read-only,
 * terminal toggle, zoom, lint check/navigation, and split-document panes.
 */

import { hasCommand, registerCommand } from "./CommandBus";
import { useUIStore } from "@/stores/uiStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWindowStatusStore } from "@/stores/windowStatusStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useLintStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";
import { toggleSplitDocuments } from "@/services/navigation/toggleSplitDocuments";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { cleanupBeforeModeSwitch } from "@/services/assembly/modeSwitchCleanup";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";
import { toggleMarkdownSplitWithCheckpoint } from "@/hooks/markdownSplitToggle";
import { getActiveTabId } from "@/services/navigation/activeDocument";
import { toggleDocumentReadOnlyWithOwnership } from "@/services/workspaces/fileOwnership";
import { scrollToSelectedDiagnostic } from "@/hooks/lintNavigation";
import { runActiveLint } from "@/services/lint/runActiveLint";
import i18n from "@/i18n";

const DEFAULT_FONT_SIZE = 18;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const FONT_SIZE_STEP = 2;

type Ctx = { windowLabel?: string };

let registered = false;
export function registerViewCommands(): void {
  if (registered || hasCommand("view.toggleSourceMode")) return; // HMR: module-local flag resets on reload; the bus registry survives

  registerCommand({
    id: "view.toggleSourceMode",
    title: () => i18n.t("commands:view.toggleSourceMode"),
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      cleanupBeforeModeSwitch();
      toggleSourceModeWithCheckpoint(windowLabel);
    },
  });

  registerCommand({
    id: "view.toggleFocusMode",
    title: () => i18n.t("commands:view.toggleFocusMode"),
    category: "view",
    run: () => useUIStore.getState().toggleFocusMode(),
  });

  registerCommand({
    id: "view.toggleTypewriterMode",
    title: () => i18n.t("commands:view.toggleTypewriterMode"),
    category: "view",
    run: () => useUIStore.getState().toggleTypewriterMode(),
  });

  registerCommand({
    id: "view.toggleOutline",
    title: () => i18n.t("commands:view.toggleOutline"),
    category: "view",
    run: () => useUIStore.getState().toggleSidebarView("outline"),
  });

  registerCommand({
    id: "view.toggleFileExplorer",
    title: () => i18n.t("commands:view.toggleFileExplorer"),
    category: "view",
    run: () => useUIStore.getState().toggleSidebarView("files"),
  });

  registerCommand({
    id: "view.toggleHistory",
    title: () => i18n.t("commands:view.toggleHistory"),
    category: "view",
    run: () => useUIStore.getState().toggleSidebarView("history"),
  });

  registerCommand({
    id: "view.toggleKnowledgeBase",
    title: () => i18n.t("commands:view.toggleKnowledgeBase"),
    category: "view",
    run: () => useContentServerStore.getState().togglePanel(),
  });

  registerCommand({
    id: "view.toggleWindowStatus",
    title: () => i18n.t("commands:view.toggleWindowStatus"),
    category: "view",
    run: () => useWindowStatusStore.getState().togglePanel(),
  });

  registerCommand({
    id: "view.toggleMarkdownSplit",
    title: () => i18n.t("commands:view.toggleMarkdownSplit"),
    category: "view",
    run: (_args, ctx: Ctx) =>
      toggleMarkdownSplitWithCheckpoint(ctx.windowLabel ?? "main"),
  });

  // Bound to the native "WYSIWYG Mode" radio item (#1070). WYSIWYG is the
  // absence of source/split, so this turns off whichever is on, reusing the
  // same cleanup + history-checkpoint path as the individual toggles. No-op
  // when already in WYSIWYG.
  registerCommand({
    id: "view.setWysiwygMode",
    title: () => i18n.t("commands:view.setWysiwygMode"),
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const s = useUIStore.getState();
      if (!s.sourceMode && !s.markdownSplitView) return;
      cleanupBeforeModeSwitch();
      if (s.sourceMode) toggleSourceModeWithCheckpoint(windowLabel);
      else toggleMarkdownSplitWithCheckpoint(windowLabel);
    },
  });

  registerCommand({
    id: "view.toggleWordWrap",
    title: () => i18n.t("commands:view.toggleWordWrap"),
    category: "view",
    run: () => useUIStore.getState().toggleWordWrap(),
  });

  registerCommand({
    id: "view.toggleLineNumbers",
    title: () => i18n.t("commands:view.toggleLineNumbers"),
    category: "view",
    run: () => useUIStore.getState().toggleLineNumbers(),
  });

  registerCommand({
    id: "view.toggleDiagramPreview",
    title: () => i18n.t("commands:view.toggleDiagramPreview"),
    category: "view",
    run: () => useUIStore.getState().toggleDiagramPreview(),
  });

  registerCommand({
    id: "view.toggleFitTables",
    title: () => i18n.t("commands:view.toggleFitTables"),
    category: "view",
    run: () => {
      const current = useSettingsStore.getState().markdown.tableFitToWidth;
      useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", !current);
    },
  });

  registerCommand({
    id: "view.toggleReadOnly",
    title: () => i18n.t("commands:view.toggleReadOnly"),
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const tabId = getActiveTabId(windowLabel);
      if (tabId) toggleDocumentReadOnlyWithOwnership(tabId);
    },
  });

  registerCommand({
    id: "view.toggleShowInvisibles",
    title: () => i18n.t("commands:view.toggleShowInvisibles"),
    category: "view",
    run: () => {
      const current = useSettingsStore.getState().markdown.showInvisibles;
      useSettingsStore.getState().updateMarkdownSetting("showInvisibles", !current);
    },
  });

  registerCommand({
    id: "view.toggleTerminal",
    title: () => i18n.t("commands:view.toggleTerminal"),
    category: "view",
    run: () => requestToggleTerminal(),
  });

  registerCommand({
    id: "view.zoomActual",
    title: () => i18n.t("commands:view.zoomActual"),
    category: "view",
    run: () => useSettingsStore.getState().updateAppearanceSetting("fontSize", DEFAULT_FONT_SIZE),
  });

  registerCommand({
    id: "view.zoomIn",
    title: () => i18n.t("commands:view.zoomIn"),
    category: "view",
    run: () => {
      const current = useSettingsStore.getState().appearance.fontSize;
      const newSize = Math.min(current + FONT_SIZE_STEP, MAX_FONT_SIZE);
      useSettingsStore.getState().updateAppearanceSetting("fontSize", newSize);
    },
  });

  registerCommand({
    id: "view.zoomOut",
    title: () => i18n.t("commands:view.zoomOut"),
    category: "view",
    run: () => {
      const current = useSettingsStore.getState().appearance.fontSize;
      const newSize = Math.max(current - FONT_SIZE_STEP, MIN_FONT_SIZE);
      useSettingsStore.getState().updateAppearanceSetting("fontSize", newSize);
    },
  });

  registerCommand({
    id: "lint.check",
    title: () => i18n.t("commands:lint.check"),
    category: "lint",
    run: (_args, ctx: Ctx) => {
      runActiveLint(ctx.windowLabel ?? "main");
    },
  });

  registerCommand({
    id: "lint.next",
    title: () => i18n.t("commands:lint.next"),
    category: "lint",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const tabId = getActiveTabId(windowLabel);
      if (tabId) {
        useLintStore.getState().selectNext(tabId);
        scrollToSelectedDiagnostic(tabId);
      }
    },
  });

  registerCommand({
    id: "lint.prev",
    title: () => i18n.t("commands:lint.prev"),
    category: "lint",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const tabId = getActiveTabId(windowLabel);
      if (tabId) {
        useLintStore.getState().selectPrev(tabId);
        scrollToSelectedDiagnostic(tabId);
      }
    },
  });

  // Two-documents-side-by-side toggle (#1081). Opening seeds the secondary
  // pane with the current document; the user then picks a different file there.
  registerCommand({
    id: "view.toggleSplitDocuments",
    title: () => i18n.t("commands:view.toggleSplitDocuments"),
    category: "view",
    run: (_args, ctx: Ctx) => toggleSplitDocuments(ctx.windowLabel ?? "main"),
  });

  // Synchronize scrolling between the two panes (great for bilingual reading).
  registerCommand({
    id: "view.toggleSyncScroll",
    title: () => i18n.t("commands:view.toggleSyncScroll"),
    category: "view",
    run: (_args, ctx: Ctx) =>
      usePaneStore.getState().toggleSyncScroll(ctx.windowLabel ?? "main"),
  });

  registerCommand({
    id: "view.closePane",
    title: () => i18n.t("commands:view.closePane"),
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      if (usePaneStore.getState().byWindow[windowLabel]?.enabled) {
        usePaneStore.getState().closeSplit(windowLabel);
      }
    },
  });

  registerCommand({
    id: "view.focusOtherPane",
    title: () => i18n.t("commands:view.focusOtherPane"),
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const pane = usePaneStore.getState();
      const split = pane.byWindow[windowLabel];
      if (split?.enabled) {
        const next = split.focusedPane === "primary" ? "secondary" : "primary";
        pane.setFocusedPane(windowLabel, next);
      }
    },
  });

  registered = true;
}

/** Test-only: reset the module registration guard so a fresh CommandBus can be repopulated. */
export function __resetViewCommandsRegistration(): void {
  registered = false;
}
