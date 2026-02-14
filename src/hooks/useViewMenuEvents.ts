import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { FEATURE_FLAGS } from "@/stores/featureFlagsStore";
import { normalizeLineEndings } from "@/utils/linebreaks";
import { cleanupBeforeModeSwitch } from "@/utils/modeSwitchCleanup";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";
import { safeUnlistenAll } from "@/utils/safeUnlisten";

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

      const unlistenSidebar = await currentWindow.listen<string>("menu:sidebar", (event) => {
        if (event.payload !== windowLabel) return;
        useUIStore.getState().toggleSidebar();
      });
      if (cancelled) { unlistenSidebar(); return; }
      unlistenRefs.current.push(unlistenSidebar);

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

      const unlistenToggleTerminal = await currentWindow.listen<string>("menu:toggle-terminal", (event) => {
        if (event.payload !== windowLabel) return;
        requestToggleTerminal();
      });
      if (cancelled) { unlistenToggleTerminal(); return; }
      unlistenRefs.current.push(unlistenToggleTerminal);

      const convertLineEndings = (target: "lf" | "crlf"): void => {
        const tabId = useTabStore.getState().activeTabId[windowLabel];
        if (!tabId) return;
        const doc = useDocumentStore.getState().getDocument(tabId);
        if (!doc) return;
        const normalized = normalizeLineEndings(doc.content, target);
        if (normalized !== doc.content) {
          useDocumentStore.getState().setContent(tabId, normalized);
        }
        useDocumentStore.getState().setLineMetadata(tabId, { lineEnding: target });
      };

      const unlistenLineEndingsLf = await currentWindow.listen<string>("menu:line-endings-lf", (event) => {
        if (event.payload !== windowLabel) return;
        if (FEATURE_FLAGS.UNIFIED_MENU_DISPATCHER) return;
        convertLineEndings("lf");
      });
      if (cancelled) { unlistenLineEndingsLf(); return; }
      unlistenRefs.current.push(unlistenLineEndingsLf);

      const unlistenLineEndingsCrlf = await currentWindow.listen<string>("menu:line-endings-crlf", (event) => {
        if (event.payload !== windowLabel) return;
        if (FEATURE_FLAGS.UNIFIED_MENU_DISPATCHER) return;
        convertLineEndings("crlf");
      });
      if (cancelled) { unlistenLineEndingsCrlf(); return; }
      unlistenRefs.current.push(unlistenLineEndingsCrlf);

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
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
