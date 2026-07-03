// Media viewer format adapter — images / audio / video.
//
// kind:"media" — a binary format. It is rendered full-width by a dedicated
// surface (Editor.tsx routes kind:"media" to MediaViewer), NOT by
// SplitPaneEditor, so no CodeMirror source pane mounts and the file is never
// read as UTF-8 text. The bytes reach the webview via the Tauri asset
// protocol (convertFileSrc), so a media tab's document `content` stays empty.
//
// Extensions come from the shared source of truth in utils/mediaExtensions.ts,
// minus `svg` (which owns its own text/split-pane format). See
// dev-docs/plans/20260703-media-viewer.md.

import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
} from "@/utils/mediaExtensions";
import { registerFormat } from "../registry";
import type { FormatConfig } from "../types";

/**
 * All previewable media extensions except `svg` (its own format). Frozen and
 * typed `readonly` so a consumer can't mutate this shared list and corrupt
 * format dispatch (`mediaFormat.extensions` reuses the same array).
 */
export const MEDIA_EXTENSIONS: readonly string[] = Object.freeze([
  ...IMAGE_EXTENSIONS.filter((e) => e !== "svg"),
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
]);

export const mediaFormat: FormatConfig = {
  id: "media",
  nameI18nKey: "format.media",
  // FormatConfig.extensions is typed `string[]`; the runtime array is the frozen
  // constant above, so the declared mutability is nominal — attempts to mutate it
  // throw. The registry deep-copies at registration, so dispatch is doubly safe.
  extensions: MEDIA_EXTENSIONS as string[],
  kind: "media",
  // No wysiwygComponent / genericPreview: the media surface is mounted by
  // Editor.tsx's kind:"media" branch, not the split-pane preview slot.
  adapters: {
    saveDialogFilters: [],
    untitledExtension: "png",
    exportEnabled: false,
    findEnabled: false,
    // Required by the shared FormatAdapters type but inert for kind:"media":
    // media never mounts a search surface (no CodeMirror/Tiptap editor). The
    // value is a placeholder to satisfy the type, not a real adapter selection.
    // Binary: never indexed for workspace content search (also guarded by the
    // Rust is_binary() NUL-byte scan).
    contentSearchIndexed: false,
    // Read-only and never editable — no editingEnabled toggle for media.
    readOnlyDefault: true,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    },
    // Never dirty, never saved. The registry carve-out for kind:"media" allows
    // save-as-only alongside readOnlyDefault.
    closeSavePolicy: "save-as-only",
  },
};

export function registerMediaFormat(): void {
  registerFormat(mediaFormat);
}
