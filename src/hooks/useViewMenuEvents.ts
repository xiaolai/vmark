/**
 * View Menu Events Hook
 *
 * Purpose: Handles View menu events — toggle source/focus/typewriter mode,
 *   word wrap, line numbers, sidebar, outline, toolbar, status bar, and terminal.
 *
 * @coordinates-with editorStore.ts — view mode toggles
 * @coordinates-with uiStore.ts — UI panel toggles
 * @module hooks/useViewMenuEvents
 */

import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEditorStore } from "@/stores/editorStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { useSettingsStore } from "@/stores/settingsStore";
import { cleanupBeforeModeSwitch } from "@/utils/modeSwitchCleanup";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";
import { safeUnlistenAll } from "@/utils/safeUnlisten";
import { useLintStore } from "@/stores/lintStore";
import { getActiveDocument, getActiveTabId } from "@/utils/activeDocument";
import { toast } from "sonner";
import i18n from "@/i18n";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { triggerLintRefresh } from "@/plugins/codemirror/sourceLint";
import { scrollToSelectedDiagnostic } from "@/hooks/lintNavigation";
import { menuError } from "@/utils/debug";

const DEFAULT_FONT_SIZE = 18;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const FONT_SIZE_STEP = 2;

/**
 * Handles View menu events: source mode, focus mode, typewriter mode,
 * sidebar, outline, word wrap, and line endings.
 */
export function useViewMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async (): Promise<void> => {
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      const unlistenSourceMode = await currentWindow.listen<string>("menu:source-mode", (event) => {
        if (event.payload !== windowLabel) return;
        cleanupBeforeModeSwitch();
        toggleSourceModeWithCheckpoint(windowLabel);
      });
      if (cancelled) { unlistenSourceMode(); return; }
      unlistenRefs.current.push(unlistenSourceMode);

      const unlistenFocusMode = await currentWindow.listen<string>("menu:focus-mode", (event) => {
        if (event.payload !== windowLabel) return;
        useEditorStore.getState().toggleFocusMode();
      });
      if (cancelled) { unlistenFocusMode(); return; }
      unlistenRefs.current.push(unlistenFocusMode);

      const unlistenTypewriterMode = await currentWindow.listen<string>("menu:typewriter-mode", (event) => {
        if (event.payload !== windowLabel) return;
        useEditorStore.getState().toggleTypewriterMode();
      });
      if (cancelled) { unlistenTypewriterMode(); return; }
      unlistenRefs.current.push(unlistenTypewriterMode);

      const unlistenOutline = await currentWindow.listen<string>("menu:outline", (event) => {
        if (event.payload !== windowLabel) return;
        useUIStore.getState().toggleSidebarView("outline");
      });
      if (cancelled) { unlistenOutline(); return; }
      unlistenRefs.current.push(unlistenOutline);

      const unlistenFileExplorer = await currentWindow.listen<string>("menu:file-explorer", (event) => {
        if (event.payload !== windowLabel) return;
        useUIStore.getState().toggleSidebarView("files");
      });
      if (cancelled) { unlistenFileExplorer(); return; }
      unlistenRefs.current.push(unlistenFileExplorer);

      const unlistenViewHistory = await currentWindow.listen<string>("menu:view-history", (event) => {
        if (event.payload !== windowLabel) return;
        useUIStore.getState().toggleSidebarView("history");
      });
      if (cancelled) { unlistenViewHistory(); return; }
      unlistenRefs.current.push(unlistenViewHistory);

      const unlistenWordWrap = await currentWindow.listen<string>("menu:word-wrap", (event) => {
        if (event.payload !== windowLabel) return;
        useEditorStore.getState().toggleWordWrap();
      });
      if (cancelled) { unlistenWordWrap(); return; }
      unlistenRefs.current.push(unlistenWordWrap);

      const unlistenLineNumbers = await currentWindow.listen<string>("menu:line-numbers", (event) => {
        if (event.payload !== windowLabel) return;
        useEditorStore.getState().toggleLineNumbers();
      });
      if (cancelled) { unlistenLineNumbers(); return; }
      unlistenRefs.current.push(unlistenLineNumbers);

      const unlistenDiagramPreview = await currentWindow.listen<string>("menu:diagram-preview", (event) => {
        if (event.payload !== windowLabel) return;
        useEditorStore.getState().toggleDiagramPreview();
      });
      if (cancelled) { unlistenDiagramPreview(); return; }
      unlistenRefs.current.push(unlistenDiagramPreview);

      const unlistenFitTables = await currentWindow.listen<string>("menu:fit-tables", (event) => {
        if (event.payload !== windowLabel) return;
        const current = useSettingsStore.getState().markdown.tableFitToWidth;
        useSettingsStore.getState().updateMarkdownSetting("tableFitToWidth", !current);
      });
      if (cancelled) { unlistenFitTables(); return; }
      unlistenRefs.current.push(unlistenFitTables);

      const unlistenReadOnly = await currentWindow.listen<string>("menu:read-only", (event) => {
        if (event.payload !== windowLabel) return;
        const tabId = getActiveTabId(windowLabel);
        if (tabId) useDocumentStore.getState().toggleReadOnly(tabId);
      });
      if (cancelled) { unlistenReadOnly(); return; }
      unlistenRefs.current.push(unlistenReadOnly);

      const unlistenToggleTerminal = await currentWindow.listen<string>("menu:toggle-terminal", (event) => {
        if (event.payload !== windowLabel) return;
        requestToggleTerminal();
      });
      if (cancelled) { unlistenToggleTerminal(); return; }
      unlistenRefs.current.push(unlistenToggleTerminal);

      // Line-ending events are handled by the unified menu dispatcher
      // (menuMapping.ts → action adapters), so no listeners here.

      // Zoom controls
      const unlistenZoomActual = await currentWindow.listen<string>("menu:zoom-actual", (event) => {
        if (event.payload !== windowLabel) return;
        useSettingsStore.getState().updateAppearanceSetting("fontSize", DEFAULT_FONT_SIZE);
      });
      if (cancelled) { unlistenZoomActual(); return; }
      unlistenRefs.current.push(unlistenZoomActual);

      const unlistenZoomIn = await currentWindow.listen<string>("menu:zoom-in", (event) => {
        if (event.payload !== windowLabel) return;
        const current = useSettingsStore.getState().appearance.fontSize;
        const newSize = Math.min(current + FONT_SIZE_STEP, MAX_FONT_SIZE);
        useSettingsStore.getState().updateAppearanceSetting("fontSize", newSize);
      });
      if (cancelled) { unlistenZoomIn(); return; }
      unlistenRefs.current.push(unlistenZoomIn);

      const unlistenZoomOut = await currentWindow.listen<string>("menu:zoom-out", (event) => {
        if (event.payload !== windowLabel) return;
        const current = useSettingsStore.getState().appearance.fontSize;
        const newSize = Math.max(current - FONT_SIZE_STEP, MIN_FONT_SIZE);
        useSettingsStore.getState().updateAppearanceSetting("fontSize", newSize);
      });
      if (cancelled) { unlistenZoomOut(); return; }
      unlistenRefs.current.push(unlistenZoomOut);

      // Lint: run validation
      const unlistenCheckMarkdown = await currentWindow.listen<string>("menu:check-markdown", (event) => {
        if (event.payload !== windowLabel) return;
        const lintEnabled = useSettingsStore.getState().markdown.lintEnabled;
        if (!lintEnabled) return;
        const tabId = getActiveTabId(windowLabel);
        if (!tabId) return;

        // Prefer fresh content from the active editor over potentially stale doc store.
        // In Source mode: read from CM view. In WYSIWYG mode: serialize Tiptap content.
        let content: string | undefined;
        const editorState = useEditorStore.getState();
        const { activeSourceView } = useActiveEditorStore.getState();

        if (editorState.sourceMode && activeSourceView) {
          content = activeSourceView.state.doc.toString();
        } else {
          const tiptapEditor = useTiptapEditorStore.getState().editor;
          if (tiptapEditor) {
            content = serializeMarkdown(tiptapEditor.state.schema, tiptapEditor.state.doc);
          }
        }

        // Fall back to persisted doc content if live content unavailable
        if (content === undefined) {
          const doc = getActiveDocument(windowLabel);
          content = doc?.content;
        }

        if (content !== undefined) {
          const diagnostics = useLintStore.getState().runLint(tabId, content);
          triggerLintRefresh();
          if (diagnostics.length === 0) {
            toast.success(i18n.t("statusbar:lint.clean.toast"));
          }
        }
      });
      if (cancelled) { unlistenCheckMarkdown(); return; }
      unlistenRefs.current.push(unlistenCheckMarkdown);

      // Lint: navigate to next issue
      const unlistenLintNext = await currentWindow.listen<string>("menu:lint-next", (event) => {
        if (event.payload !== windowLabel) return;
        const tabId = getActiveTabId(windowLabel);
        if (tabId) {
          useLintStore.getState().selectNext(tabId);
          scrollToSelectedDiagnostic(tabId);
        }
      });
      if (cancelled) { unlistenLintNext(); return; }
      unlistenRefs.current.push(unlistenLintNext);

      // Lint: navigate to previous issue
      const unlistenLintPrev = await currentWindow.listen<string>("menu:lint-prev", (event) => {
        if (event.payload !== windowLabel) return;
        const tabId = getActiveTabId(windowLabel);
        if (tabId) {
          useLintStore.getState().selectPrev(tabId);
          scrollToSelectedDiagnostic(tabId);
        }
      });
      if (cancelled) { unlistenLintPrev(); return; }
      unlistenRefs.current.push(unlistenLintPrev);
    };

    setupListeners().catch((error) => {
      menuError("Failed to setup view menu listeners:", error);
    });

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
