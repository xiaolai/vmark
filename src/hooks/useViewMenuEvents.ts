import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useViewSettingsStore } from "@/stores/viewSettingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { FEATURE_FLAGS } from "@/stores/featureFlagsStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { normalizeLineEndings } from "@/utils/linebreaks";

/**
 * Handles View menu events: source mode, focus mode, typewriter mode,
 * sidebar, outline, word wrap, and line endings.
 */
export function useViewMenuEvents(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async (): Promise<void> => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      const unlistenSourceMode = await currentWindow.listen<string>("menu:source-mode", (event) => {
        if (event.payload !== windowLabel) return;
        const toastStore = useImagePasteToastStore.getState();
        if (toastStore.isOpen) {
          toastStore.hideToast();
        }
        flushActiveWysiwygNow();
        useViewSettingsStore.getState().toggleSourceMode();
      });
      if (cancelled) { unlistenSourceMode(); return; }
      unlistenRefs.current.push(unlistenSourceMode);

      const unlistenFocusMode = await currentWindow.listen<string>("menu:focus-mode", (event) => {
        if (event.payload !== windowLabel) return;
        useViewSettingsStore.getState().toggleFocusMode();
      });
      if (cancelled) { unlistenFocusMode(); return; }
      unlistenRefs.current.push(unlistenFocusMode);

      const unlistenTypewriterMode = await currentWindow.listen<string>("menu:typewriter-mode", (event) => {
        if (event.payload !== windowLabel) return;
        useViewSettingsStore.getState().toggleTypewriterMode();
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
        useUIStore.getState().toggleOutline();
      });
      if (cancelled) { unlistenOutline(); return; }
      unlistenRefs.current.push(unlistenOutline);

      const unlistenWordWrap = await currentWindow.listen<string>("menu:word-wrap", (event) => {
        if (event.payload !== windowLabel) return;
        useViewSettingsStore.getState().toggleWordWrap();
      });
      if (cancelled) { unlistenWordWrap(); return; }
      unlistenRefs.current.push(unlistenWordWrap);

      const unlistenLineNumbers = await currentWindow.listen<string>("menu:line-numbers", (event) => {
        if (event.payload !== windowLabel) return;
        useViewSettingsStore.getState().toggleLineNumbers();
      });
      if (cancelled) { unlistenLineNumbers(); return; }
      unlistenRefs.current.push(unlistenLineNumbers);

      const unlistenDiagramPreview = await currentWindow.listen<string>("menu:diagram-preview", (event) => {
        if (event.payload !== windowLabel) return;
        useViewSettingsStore.getState().toggleDiagramPreview();
      });
      if (cancelled) { unlistenDiagramPreview(); return; }
      unlistenRefs.current.push(unlistenDiagramPreview);

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
    };

    setupListeners();

    return () => {
      cancelled = true;
      const fns = unlistenRefs.current;
      unlistenRefs.current = [];
      fns.forEach((fn) => fn());
    };
  }, []);
}
