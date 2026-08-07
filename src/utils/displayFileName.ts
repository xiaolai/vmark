/**
 * File-name display formatting.
 *
 * Purpose: one place that decides whether a file's extension is shown to the
 * user, so the sidebar tree and the tab strip cannot disagree.
 *
 * Key decisions:
 *   - Only a REGISTERED extension is ever hidden. Hiding ".vue" would show a
 *     name that does not exist on disk for a file VMark cannot even open —
 *     the confusion behind #1224, where `requirements.txt` read as a
 *     mysterious extensionless `requirements`.
 *   - Names are the only input: no store, no settings lookup. Callers pass the
 *     current preference, which keeps this a leaf-pure util (ADR-013).
 *   - Never returns an empty label. A file named exactly `.md` is all
 *     extension, and a blank row in the tree or a nameless tab is worse than
 *     the suffix it was hiding.
 *
 * Known limitation — the registry is mutable, and this reads it:
 *   Which extensions count as "registered" comes from the format registry,
 *   which the Formats settings can rebuild at runtime. Nothing here subscribes
 *   to that, so in principle a label could go stale. In practice both
 *   consumers converge without help, and only in the non-default
 *   extensions-hidden mode is there anything to converge:
 *     - Tab strip: `rebootstrapFormats` calls `recomputeAllFormatIds()`, which
 *       replaces every tab object and re-renders the strip.
 *     - File tree: Formats settings live in a SEPARATE window, and `useFileTree`
 *       re-lists on window focus, so returning to the document re-labels it.
 *   Do not "fix" this by threading a registry version through every caller
 *   before checking whether either path actually goes stale.
 *
 * @coordinates-with utils/dropPaths.ts — the registered-extension list
 * @coordinates-with services/formats/formatSettingsBridge.ts — rebuilds the registry
 * @module utils/displayFileName
 */
import { stripSupportedExtension } from "./dropPaths";

/**
 * The name to show for `name`, hiding its extension when `showExtensions` is
 * false and the extension is one VMark recognises.
 */
export function formatFileDisplayName(name: string, showExtensions: boolean): string {
  if (showExtensions) return name;
  const stripped = stripSupportedExtension(name);
  return stripped === "" ? name : stripped;
}
