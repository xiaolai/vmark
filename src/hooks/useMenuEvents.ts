import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { clearAllHistory } from "@/utils/historyUtils";

export function useMenuEvents() {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setupListeners = async () => {
      // Clean up any existing listeners first
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];

      if (cancelled) return;

      // View menu events
      const unlistenSourceMode = await listen("menu:source-mode", () => {
        useEditorStore.getState().toggleSourceMode();
      });
      if (cancelled) { unlistenSourceMode(); return; }
      unlistenRefs.current.push(unlistenSourceMode);

      const unlistenFocusMode = await listen("menu:focus-mode", () => {
        useEditorStore.getState().toggleFocusMode();
      });
      if (cancelled) { unlistenFocusMode(); return; }
      unlistenRefs.current.push(unlistenFocusMode);

      const unlistenTypewriterMode = await listen("menu:typewriter-mode", () => {
        useEditorStore.getState().toggleTypewriterMode();
      });
      if (cancelled) { unlistenTypewriterMode(); return; }
      unlistenRefs.current.push(unlistenTypewriterMode);

      const unlistenSidebar = await listen("menu:sidebar", () => {
        useUIStore.getState().toggleSidebar();
      });
      if (cancelled) { unlistenSidebar(); return; }
      unlistenRefs.current.push(unlistenSidebar);

      const unlistenOutline = await listen("menu:outline", () => {
        useUIStore.getState().toggleOutline();
      });
      if (cancelled) { unlistenOutline(); return; }
      unlistenRefs.current.push(unlistenOutline);

      const unlistenWordWrap = await listen("menu:word-wrap", () => {
        useEditorStore.getState().toggleWordWrap();
      });
      if (cancelled) { unlistenWordWrap(); return; }
      unlistenRefs.current.push(unlistenWordWrap);

      const unlistenPreferences = await listen("menu:preferences", async () => {
        // Check if settings window already exists
        const existing = await WebviewWindow.getByLabel("settings");
        if (existing) {
          await existing.setFocus();
          return;
        }
        // Create new settings window
        new WebviewWindow("settings", {
          url: "/settings",
          title: "Settings",
          width: 700,
          height: 500,
          minWidth: 500,
          minHeight: 400,
          center: true,
          resizable: true,
          hiddenTitle: true,
          titleBarStyle: "overlay",
        });
      });
      if (cancelled) { unlistenPreferences(); return; }
      unlistenRefs.current.push(unlistenPreferences);

      // History menu events
      const unlistenViewHistory = await listen("menu:view-history", () => {
        useUIStore.getState().showSidebarWithView("history");
      });
      if (cancelled) { unlistenViewHistory(); return; }
      unlistenRefs.current.push(unlistenViewHistory);

      const unlistenClearHistory = await listen("menu:clear-history", async () => {
        const confirmed = await ask(
          "This will permanently delete all document history. This action cannot be undone.",
          {
            title: "Clear All History",
            kind: "warning",
          }
        );
        if (confirmed) {
          try {
            await clearAllHistory();
            console.log("[History] All history cleared");
          } catch (error) {
            console.error("[History] Failed to clear history:", error);
          }
        }
      });
      if (cancelled) { unlistenClearHistory(); return; }
      unlistenRefs.current.push(unlistenClearHistory);
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
