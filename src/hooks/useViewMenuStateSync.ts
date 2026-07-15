/**
 * useViewMenuStateSync — reflect the active editor mode in the native View menu.
 *
 * Purpose: keep the View menu's editor-mode radio group (WYSIWYG / Source /
 *   Markdown Split) checkmark and the enabled-state of Word Wrap / Line Numbers
 *   in sync with the editor's actual mode (#1070). Computes the desired state
 *   with the pure `selectViewMenuModeState` policy and pushes it to Rust via
 *   `sync_view_menu_state`, which diffs against its own cache (so redundant
 *   calls are cheap no-ops on the main thread).
 *
 *   Re-pushes on window focus too: the macOS menu bar is shared across document
 *   windows, so when this window regains focus its mode must be re-asserted or
 *   the menu could keep showing another window's state.
 *
 * @coordinates-with stores/selectSourceEditing.ts — selectViewMenuModeState
 * @coordinates-with src-tauri/src/menu/menu_state.rs — sync_view_menu_state
 * @coordinates-with stores/documentStore/largeFileSession — forced-source tabs
 * @module hooks/useViewMenuStateSync
 */

import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import {
  selectViewMenuModeState,
  type ViewMenuModeState,
} from "@/stores/selectSourceEditing";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { menuError } from "@/utils/debug";

const SYNC_DEBOUNCE_MS = 50;

function pushViewMenuState(s: ViewMenuModeState): void {
  void invoke("sync_view_menu_state", {
    mode: s.mode,
    modeApplies: s.modeApplies,
    wordWrapApplies: s.wordWrapApplies,
    lineNumbersApplies: s.lineNumbersApplies,
  }).catch((e) => menuError("sync_view_menu_state failed:", e));
}

export function useViewMenuStateSync(): void {
  const sourceMode = useUIStore((s) => s.sourceMode);
  const markdownSplitView = useUIStore((s) => s.markdownSplitView);
  const activeTabId = useTabStore(
    (s) => s.activeTabId[getCurrentWindowLabel()] ?? null,
  );
  // Subscribe to the active tab's format so a format change on the same tab
  // (not just a tab switch) re-evaluates applicability.
  const activeFormatId = useTabStore((s) => {
    const id = s.activeTabId[getCurrentWindowLabel()];
    const t = id ? s.findTabById(id) : null;
    return t?.kind === "document" ? t.formatId : null;
  });
  // Large markdown files force Source mode without setting the global flag.
  const forcedSource = useLargeFileSessionStore((s) =>
    activeTabId ? Boolean(s.forcedSourceTabs[activeTabId]) : false,
  );

  const state = selectViewMenuModeState(
    { sourceMode, markdownSplitView },
    {
      hasActiveTab: activeTabId !== null,
      isMarkdown: activeFormatId === "markdown",
      forcedSource,
    },
  );
  // Hold the latest state so the focus listener re-pushes current values
  // without needing to be a dependency. Updated in an effect (never during
  // render) per react-hooks/refs.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = useCallback((s: ViewMenuModeState) => pushViewMenuState(s), []);

  // Debounced push when the derived state changes.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => push(stateRef.current), SYNC_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    state.mode,
    state.modeApplies,
    state.wordWrapApplies,
    state.lineNumbersApplies,
    push,
  ]);

  // Re-assert this window's state when it regains focus (shared menu bar).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWebviewWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) push(stateRef.current);
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      // Registration can fail (window gone, IPC error). Surface it instead of
      // letting it become an unhandled rejection; cleanup stays safe because
      // `unlisten` simply remains undefined.
      .catch((e) => menuError("onFocusChanged failed:", e));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [push]);
}
