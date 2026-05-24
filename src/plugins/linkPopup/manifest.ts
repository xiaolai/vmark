/**
 * linkPopup manifest — ADR-011 demonstrator.
 *
 * First plugin to declare its `PluginManifest`. The existing wiring in
 * `editorPlugins.tiptap.ts` and `sourceLinkPopup/index.ts` continues
 * to compose this plugin manually; the manifest is additive metadata
 * for the registry to surface.
 */

import type { PluginManifest } from "@/plugins/registry";

export const manifest: PluginManifest = {
  id: "linkPopup",
  formats: ["markdown"],
  modes: ["wysiwyg", "source"],
  slots: [{ id: "linkPopup", position: "overlay" }],
};
