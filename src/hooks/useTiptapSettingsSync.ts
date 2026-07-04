/**
 * useTiptapSettingsSync
 *
 * Purpose: push settings changes into a live Tiptap editor instance —
 * show-invisibles toggle, CJK letter-spacing recalculation, and read-only
 * editability. Extracted verbatim from TiptapEditor.tsx (effect stack split).
 *
 * @coordinates-with components/Editor/TiptapEditor.tsx — sole consumer
 * @coordinates-with plugins/showInvisibles/tiptap.ts — setShowInvisibles helper
 * @module hooks/useTiptapSettingsSync
 */
import { useEffect } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { getTiptapEditorView } from "@/services/editor/tiptapView";
import { setShowInvisibles } from "@/plugins/showInvisibles/tiptap";

interface TiptapSettingsSyncOptions {
  showInvisibles: boolean;
  /** Spacing amount (e.g. "0", "0.05em") — only consumed as an effect trigger. */
  cjkLetterSpacing: string;
  readOnly: boolean;
}

/** Sync settings (invisibles, CJK spacing, read-only) into the Tiptap editor. */
export function useTiptapSettingsSync(
  editor: TiptapEditor | null,
  { showInvisibles, cjkLetterSpacing, readOnly }: TiptapSettingsSyncOptions,
): void {
  // Show-invisibles toggle — flip the extension storage flag, then dispatch a
  // tagged transaction the plugin's apply() picks up to rebuild decorations.
  useEffect(() => {
    if (!editor) return;
    const allStorage = editor.storage as unknown as
      | Record<string, { enabled?: boolean } | undefined>
      | undefined;
    const storage = allStorage?.showInvisibles;
    // editor.storage is Tiptap's intentionally-mutable extension storage, not React state (#1063).
    // eslint-disable-next-line react-hooks/immutability
    if (storage) storage.enabled = showInvisibles;
    // Force a rebuild via the plugin's helper (recognised by PluginKey identity).
    const view = editor.view;
    if (!view) return;
    setShowInvisibles(view, showInvisibles);
  }, [editor, showInvisibles]);

  // Force CJK letter spacing decorations to recalculate when setting changes.
  // The plugin tracks wasEnabled state, but needs a transaction to trigger apply().
  useEffect(() => {
    if (!editor) return;
    // Dispatch empty transaction to trigger plugin state recalculation
    const view = getTiptapEditorView(editor);
    if (view) {
      const tr = view.state.tr
        .setMeta("cjkLetterSpacingChanged", true)
        .setMeta("addToHistory", false); // Settings change shouldn't pollute undo history
      view.dispatch(tr);
    }
  }, [editor, cjkLetterSpacing]);

  // Toggle editor editability when read-only mode changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);
}
