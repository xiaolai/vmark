/**
 * Unified Menu Commands
 *
 * Purpose: the native-menu listener. Subscribes to every `menu:{id}` event in
 *   the action registry, applies the invocation-source policy that is unique to
 *   the menu (window filtering + the focus gate), and hands the action to the
 *   shared executor `runEditorAction`. All execution semantics — effective-mode
 *   resolution, format/capability gates, unified undo/redo, IME-safe dispatch,
 *   tab-bound retry — live in the executor so the menu and the Command Palette
 *   run an action identically.
 *
 * Pipeline: Rust menu event → Tauri `listen("menu:{id}")` → window filter →
 *   focus gate → `runEditorAction(actionId, { windowLabel, params })`.
 *
 * Key decisions:
 *   - Mount ONCE at the EditorHost level, not per-editor.
 *   - The focus gate (`shouldBlockMenuAction`) stays HERE, not in the executor:
 *     it rejects focus inside the palette's own container, so moving it down
 *     would make the palette block its own commands (ADR-017 WI-1.2).
 *   - Retry timers belong to the window's per-window executor owner; the hook
 *     disposes that owner on unmount so no queued action runs after teardown.
 *
 * @coordinates-with services/editor/runEditorAction.ts — the shared executor
 * @coordinates-with actionRegistry.ts — MENU_TO_ACTION maps menu IDs to actions
 * @coordinates-with utils/focusGuard.ts — the menu-only focus gate
 * @module hooks/useUnifiedMenuCommands
 */

import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { MENU_TO_ACTION } from "@/plugins/actions/actionRegistry";
import type { MenuEventId } from "@/plugins/actions/types";
import { shouldBlockMenuAction } from "@/utils/focusGuard";
import { safeUnlistenAll } from "@/utils/safeUnlisten";
import { menuError } from "@/utils/debug";
import { runEditorAction } from "@/services/editor/runEditorAction";
import { disposeEditorActionOwner } from "@/services/editor/editorActionOwner";

/**
 * Unified menu command dispatcher.
 *
 * Listens to ALL menu events defined in the action registry and routes them to
 * the shared executor. Mount this hook ONCE at the EditorHost level.
 */
export function useUnifiedMenuCommands(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let disposed = false;
    const windowLabel = getCurrentWebviewWindow().label;

    const setupListeners = async () => {
      // Clean up any existing listeners
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      /* v8 ignore start -- disposed=true race: component unmounts between safeUnlistenAll and this check */
      if (disposed) return;
      /* v8 ignore stop */

      const currentWindow = getCurrentWebviewWindow();
      const listenerPromises: Promise<UnlistenFn>[] = [];

      // Register handler for EVERY menu event in the registry
      for (const [menuEvent, mapping] of Object.entries(MENU_TO_ACTION)) {
        const promise = currentWindow.listen<string>(menuEvent as MenuEventId, (event) => {
          // Window filtering — payload is the target window label
          if (typeof event.payload !== "string" || event.payload !== windowLabel) {
            return;
          }

          // Menu-only focus guard (terminal, search inputs, settings, palette).
          // Stays here, NOT in the executor — see the header note.
          if (shouldBlockMenuAction()) {
            return;
          }

          const { actionId, params } = mapping;
          runEditorAction(actionId, { windowLabel, params });
        });

        listenerPromises.push(promise);
      }

      // Wait for all listeners to be registered using allSettled to handle partial failures
      const results = await Promise.allSettled(listenerPromises);

      /* v8 ignore start -- disposed=true race: component unmounts while awaiting allSettled */
      if (disposed) {
        // Component unmounted during setup, clean up any successful listeners
        for (const result of results) {
          if (result.status === "fulfilled") {
            result.value();
          }
        }
        return;
      }
      /* v8 ignore stop */

      // Collect successful listeners, log failures
      const unlisteners: UnlistenFn[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          unlisteners.push(result.value);
        } else {
          menuError("Failed to register listener:", result.reason);
        }
      }
      unlistenRefs.current = unlisteners;
    };

    setupListeners().catch((error) => {
      menuError("Failed to setup unified menu listeners:", error);
    });

    return () => {
      disposed = true;
      disposeEditorActionOwner(windowLabel);
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
