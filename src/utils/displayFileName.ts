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

/** What a display label's trailing extension can look like: a dot plus a
 *  short alphanumeric run. Deliberately shape-based, NOT the registered
 *  list — truncation must preserve `.vue` and `.gz` too, since the point is
 *  telling similarly-prefixed files apart, not knowing how to open them. */
const DISPLAY_EXTENSION_RE = /\.[A-Za-z0-9]{1,8}$/;

/**
 * Split a display label so the tab strip can ellipsize the NAME while the
 * extension stays visible (WI-UA12): `design-system.md` → `design-system` +
 * `.md`. A label with no extension-shaped suffix — dotfiles, trailing dots,
 * prose after the last dot, or a name that is ALL extension — stays whole in
 * `base` (never an empty base; same rule as formatFileDisplayName).
 */
export function splitDisplayExtension(label: string): { base: string; ext: string } {
  const match = DISPLAY_EXTENSION_RE.exec(label);
  if (!match || match.index === 0) return { base: label, ext: "" };
  return { base: label.slice(0, match.index), ext: match[0] };
}
