/**
 * Shared helper for creating menu event listeners with window filtering.
 * Used by Tiptap menu command hooks to reduce boilerplate.
 */
import { type UnlistenFn } from "@tauri-apps/api/event";
import { type WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { type MutableRefObject } from "react";
import { useViewSettingsStore } from "@/stores/viewSettingsStore";

interface MenuListenerContext {
  currentWindow: WebviewWindow;
  windowLabel: string;
  editorRef: MutableRefObject<TiptapEditor | null>;
  unlistenRefs: MutableRefObject<UnlistenFn[]>;
  cancelledRef: { current: boolean };
}

/**
 * Create a menu event listener that filters by window.
 * Returns null if the setup was cancelled.
 */
export async function createMenuListener(
  ctx: MenuListenerContext,
  eventName: string,
  handler: (editor: TiptapEditor) => void
): Promise<UnlistenFn | null> {
  const { currentWindow, windowLabel, editorRef, cancelledRef } = ctx;

  const unlisten = await currentWindow.listen<string>(eventName, (event) => {
    if (event.payload !== windowLabel) return;
    // Skip if in source mode - source mode has its own handlers
    if (useViewSettingsStore.getState().sourceMode) return;
    const editor = editorRef.current;
    if (!editor) return;
    handler(editor);
  });

  if (cancelledRef.current) {
    unlisten();
    return null;
  }
  return unlisten;
}

/**
 * Register a menu listener and add it to the unlisten refs.
 * Returns false if the setup was cancelled, true otherwise.
 */
export async function registerMenuListener(
  ctx: MenuListenerContext,
  eventName: string,
  handler: (editor: TiptapEditor) => void
): Promise<boolean> {
  const unlisten = await createMenuListener(ctx, eventName, handler);
  if (!unlisten) return false;
  ctx.unlistenRefs.current.push(unlisten);
  return true;
}
