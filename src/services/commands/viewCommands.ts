/**
 * View commands — ADR-012 migration of useViewMenuEvents.
 *
 * 16 commands covering source/focus/typewriter modes, sidebar views,
 * word wrap, line numbers, diagram preview, fit tables, read-only,
 * terminal toggle, zoom, lint check/navigation.
 */

import { registerCommand } from "./CommandBus";
import { useUIStore } from "@/stores/uiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useLintStore } from "@/stores/lintStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { cleanupBeforeModeSwitch } from "@/services/assembly/modeSwitchCleanup";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";
import { getActiveDocument, getActiveTabId } from "@/services/navigation/activeDocument";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { triggerLintRefresh } from "@/plugins/codemirror/sourceLint";
import { isYamlFileName } from "@/utils/dropPaths";
import { scrollToSelectedDiagnostic } from "@/hooks/lintNavigation";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";

const DEFAULT_FONT_SIZE = 18;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const FONT_SIZE_STEP = 2;

type Ctx = { windowLabel?: string };

let registered = false;
export function registerViewCommands(): void {
  if (registered) return;

  registerCommand({
    id: "view.toggleSourceMode",
    title: "Toggle Source Mode",
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      cleanupBeforeModeSwitch();
      toggleSourceModeWithCheckpoint(windowLabel);
    },
  });

  registerCommand({
    id: "view.toggleFocusMode",
    title: "Toggle Focus Mode",
    category: "view",
    run: () => useUIStore.getState().toggleFocusMode(),
  });

  registerCommand({
    id: "view.toggleTypewriterMode",
    title: "Toggle Typewriter Mode",
    category: "view",
    run: () => useUIStore.getState().toggleTypewriterMode(),
  });

  registerCommand({
    id: "view.toggleOutline",
    title: "Toggle Outline",
    category: "view",
    run: () => useUIStore.getState().toggleSidebarView("outline"),
  });

  registerCommand({
    id: "view.toggleFileExplorer",
    title: "Toggle File Explorer",
    category: "view",
    run: () => useUIStore.getState().toggleSidebarView("files"),
  });

  registerCommand({
    id: "view.toggleHistory",
    title: "Toggle History",
    category: "view",
    run: () => useUIStore.getState().toggleSidebarView("history"),
  });

  registerCommand({
    id: "view.toggleWordWrap",
    title: "Toggle Word Wrap",
    category: "view",
    run: () => useUIStore.getState().toggleWordWrap(),
  });

  registerCommand({
    id: "view.toggleLineNumbers",
    title: "Toggle Line Numbers",
    category: "view",
    run: () => useUIStore.getState().toggleLineNumbers(),
  });

  registerCommand({
    id: "view.toggleDiagramPreview",
    title: "Toggle Diagram Preview",
    category: "view",
    run: () => useUIStore.getState().toggleDiagramPreview(),
  });

  registerCommand({
    id: "view.toggleFitTables",
    title: "Fit Tables to Width",
    category: "view",
    run: () => {
      const current = useSettingsStore.getState().markdown.tableFitToWidth;
      useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", !current);
    },
  });

  registerCommand({
    id: "view.toggleReadOnly",
    title: "Toggle Read-Only",
    category: "view",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const tabId = getActiveTabId(windowLabel);
      if (tabId) useDocumentStore.getState().toggleReadOnly(tabId);
    },
  });

  registerCommand({
    id: "view.toggleTerminal",
    title: "Toggle Terminal",
    category: "view",
    run: () => requestToggleTerminal(),
  });

  registerCommand({
    id: "view.zoomActual",
    title: "Actual Size",
    category: "view",
    run: () => useSettingsStore.getState().updateAppearanceSetting("fontSize", DEFAULT_FONT_SIZE),
  });

  registerCommand({
    id: "view.zoomIn",
    title: "Zoom In",
    category: "view",
    run: () => {
      const current = useSettingsStore.getState().appearance.fontSize;
      const newSize = Math.min(current + FONT_SIZE_STEP, MAX_FONT_SIZE);
      useSettingsStore.getState().updateAppearanceSetting("fontSize", newSize);
    },
  });

  registerCommand({
    id: "view.zoomOut",
    title: "Zoom Out",
    category: "view",
    run: () => {
      const current = useSettingsStore.getState().appearance.fontSize;
      const newSize = Math.max(current - FONT_SIZE_STEP, MIN_FONT_SIZE);
      useSettingsStore.getState().updateAppearanceSetting("fontSize", newSize);
    },
  });

  registerCommand({
    id: "lint.check",
    title: "Check Markdown",
    category: "lint",
    run: (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const lintEnabled = useSettingsStore.getState().markdown.lintEnabled;
      if (!lintEnabled) return;
      const tabId = getActiveTabId(windowLabel);
      if (!tabId) return;

      let content: string | undefined;
      const editorState = useUIStore.getState();
      const { activeSourceView } = useActiveEditorStore.getState();

      if (editorState.sourceMode && activeSourceView) {
        content = activeSourceView.state.doc.toString();
      } else {
        const tiptapEditor = useTiptapEditorStore.getState().editor;
        if (tiptapEditor) {
          content = serializeMarkdown(tiptapEditor.state.schema, tiptapEditor.state.doc);
        }
      }

      if (content === undefined) {
        const doc = getActiveDocument(windowLabel);
        content = doc?.content;
      }

      if (content !== undefined) {
        const filePath = getActiveDocument(windowLabel)?.filePath ?? null;
        const isYaml = filePath
          ? isYamlFileName(filePath.split(/[\\/]/).pop() ?? "")
          : false;
        const finalize = (totalCount: number) => {
          triggerLintRefresh();
          if (totalCount === 0) {
            toast.success(i18n.t("statusbar:lint.clean.toast"));
          } else {
            toast.info(i18n.t("dialog:toast.lintFoundIssues", { count: totalCount }));
          }
        };
        if (isYaml) {
          const yamlDiags = useLintStore.getState().runYamlLint(tabId, content);
          finalize(yamlDiags.length);
        } else {
          const syncDiagnostics = useLintStore.getState().runLint(tabId, content);
          triggerLintRefresh();
          if (filePath) {
            void useLintStore.getState().runLinkCheck(tabId, content, filePath).then((merged) => finalize(merged.length));
          } else {
            finalize(syncDiagnostics.length);
          }
        }
      }
    },
  });

  registerCommand({
    id: "lint.next",
    title: "Next Lint Issue",
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
    title: "Previous Lint Issue",
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

  registered = true;
}
