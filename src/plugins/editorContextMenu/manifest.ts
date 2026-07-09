/**
 * editorContextMenu manifest — right-click context menu for the editing
 * surfaces (WYSIWYG trigger here; the source trigger lives in
 * plugins/codemirror/editorContextMenu.ts).
 */
import type { PluginManifest } from "@/plugins/registry";

export const manifest: PluginManifest = {
  id: "editorContextMenu",
  formats: ["markdown"],
  modes: ["wysiwyg", "source"],
};
