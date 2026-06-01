/**
 * Plugin Registry — ADR-011.
 *
 * Defines the `PluginManifest` contract every plugin exports, and
 * composes manifests per mode/format.
 *
 * Foundation-only: existing `editorPlugins.tiptap.ts` continues to
 * hand-compose plugins. Manifests are additive metadata that the
 * registry surfaces for tooling (debug page, command palette,
 * documentation generation). Migrating the hand-composition path is
 * a follow-up.
 *
 * @module plugins/registry
 */

import type { AnyExtension } from "@tiptap/core";
import type { Extension as CMExtension } from "@codemirror/state";

// Tiptap exposes Extension, Mark, and Node as distinct types but they
// share the AnyExtension supertype — the right shape for a registry
// that doesn't care which flavour each plugin contributes.
type TiptapExtension = AnyExtension;

export type PluginId = string;
export type FormatId = "markdown" | "yaml" | "json" | "toml" | "html" | "css";
export type Mode = "wysiwyg" | "source";

/** A slot the plugin mounts content into (panel, overlay, toolbar group). */
export interface SlotDescriptor {
  id: string;
  position: "bottom" | "right" | "overlay" | "toolbar";
  priority?: number;
}

/** A command the plugin registers with the command bus (ADR-012). */
export interface CommandDescriptor {
  id: string;
  title: string;
  scope?: "global" | "editor" | "panel";
}

/** The contract every plugin exports as `manifest`. */
export interface PluginManifest {
  id: PluginId;
  formats: FormatId[];
  modes: Mode[];
  slots?: SlotDescriptor[];
  commands?: CommandDescriptor[];
  dependsOn?: PluginId[];
  /** Lazy Tiptap extension factory; called only when mode includes 'wysiwyg'. */
  tiptap?: () => TiptapExtension;
  /** Lazy CodeMirror extension factory; called only when mode includes 'source'. */
  codemirror?: () => CMExtension;
}

const REGISTRY = new Map<PluginId, PluginManifest>();

/** Register a plugin manifest. Throws on duplicate ID. */
export function registerPlugin(manifest: PluginManifest): void {
  if (REGISTRY.has(manifest.id)) {
    throw new Error(`Plugin already registered: ${manifest.id}`);
  }
  REGISTRY.set(manifest.id, manifest);
}

/** Look up a single manifest. */
export function getPlugin(id: PluginId): PluginManifest | undefined {
  return REGISTRY.get(id);
}

/** Snapshot of every registered manifest. */
export function listPlugins(): PluginManifest[] {
  return Array.from(REGISTRY.values());
}

/** Manifests applicable to a given mode + format. */
export function pluginsFor(mode: Mode, format: FormatId): PluginManifest[] {
  return listPlugins().filter(
    (p) => p.modes.includes(mode) && p.formats.includes(format),
  );
}


/** Test-only reset. */
export function _resetRegistry(): void {
  REGISTRY.clear();
}
