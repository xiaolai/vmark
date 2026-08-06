import type { HtmlAllowlistLevel } from "@/utils/htmlAllowlists";
import type { CJKFormattingSettings } from "@/lib/cjkFormatter/types";
import { DEFAULT_CJK_FORMATTING } from "@/lib/cjkFormatter/types";
import type { PasteMode } from "./pasteSettings";
import type { HardBreakStyleOnSave } from "@/utils/linebreakDetection";

/**
 * Purpose: the editor settings plugins need, bound once by the host.
 *
 * Most plugins take what they need as an extension OPTION, and that stays the
 * preferred shape — an explicit parameter is easier to follow than an ambient
 * lookup. This exists for the cases where an option cannot reach: a value read
 * by a leaf utility several calls below the plugin boundary, where threading a
 * parameter through every intermediate signature obscures more than it
 * reveals. `getTabSize` in `sourceContextDetection` is the motivating case —
 * three call sites across two modules, none of them the plugin's entry point.
 *
 * The decoupling is real, not laundered. A plugin importing from here depends
 * on an INTERFACE with working defaults, not on the app's Zustand singletons,
 * so it still runs when lifted out of this repo. The app binds the real values
 * at startup; a host that binds nothing gets sane behaviour rather than a
 * crash. That is dependency inversion — the direction of the dependency is
 * what matters, not whether the value arrives as an argument.
 *
 * Keep this SMALL. It is a seam for values that are genuinely ambient to the
 * editor, not a general-purpose bag: every entry added here is one a plugin
 * could not have taken as an option, and that claim should be checkable.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/shared/hostSettings
 */

/**
 * How raw HTML is rendered, as the PLUGINS declare it.
 *
 * `mode` is spelled out here rather than imported from the app's settings
 * types; `HtmlAllowlistLevel` is imported because it lives in `utils/`, which
 * is a leaf a plugin may depend on.
 */
export interface HtmlRendering {
  mode: "hidden" | "sanitized" | "sanitizedWithStyles";
  allowlistLevel: HtmlAllowlistLevel;
  customTags: string;
}

/** Editor settings a plugin may need without an option to carry them. */
export interface HostSettings {
  /** Spaces per indent level. */
  tabSize: () => number;
  /** Whether tables are fitted to the editor width by default. */
  tableFitToWidth: () => boolean;
  /** Whether markdown lint decorations are painted at all. */
  lintEnabled: () => boolean;
  /** Keep single newlines as hard breaks when serializing. */
  preserveLineBreaks: () => boolean;
  /** Which hard-break spelling to write on save. */
  hardBreakStyleOnSave: () => HardBreakStyleOnSave;
  /** Whether a pasted image is copied into the document's assets folder. */
  copyImagesToAssets: () => boolean;
  /** Keep runs of blank lines rather than collapsing them. */
  preserveBlankLines: () => boolean;
  /** The fine-grained CJK formatter toggles. */
  cjkFormatting: () => CJKFormattingSettings;
  /** Whether selecting text also copies it. */
  copyOnSelect: () => boolean;
  /** How a paste is interpreted: smart conversion, plain text, or rich. */
  pasteMode: () => PasteMode;
  /** How raw HTML in the document is rendered. */
  htmlRendering: () => HtmlRendering;
  /** Notify when any setting changes; returns an unsubscribe. */
  onChange: (listener: () => void) => () => void;
}

/**
 * Values for a host that binds nothing.
 *
 * These MATCH VMark's own defaults (`stores/settingsStore/defaults.ts`), and
 * that is the rule for this file rather than a coincidence. A seam default
 * that differs from the app's produces silent divergence wherever binding is
 * missed — the cross-surface parity suite caught exactly that when this said
 * 4 ("CommonMark's indent unit") against the app's 2: Source indented a list
 * item four spaces where WYSIWYG did not indent it at all, in a configuration
 * that ships nowhere.
 *
 * A defensible default is not the same as the RIGHT default. The right one is
 * the one that makes an unbound path behave like the app.
 */
const DEFAULTS: HostSettings = {
  tabSize: () => 2,
  tableFitToWidth: () => false,
  lintEnabled: () => true,
  preserveLineBreaks: () => false,
  hardBreakStyleOnSave: () => "preserve",
  copyImagesToAssets: () => true,
  preserveBlankLines: () => true,
  cjkFormatting: () => DEFAULT_CJK_FORMATTING,
  copyOnSelect: () => false,
  pasteMode: () => "smart",
  // Sanitized/strict — the app's defaults, and the SAFE ones. A standalone
  // consumer that binds nothing must not get permissive HTML by accident.
  htmlRendering: () => ({ mode: "sanitized", allowlistLevel: "strict", customTags: "" }),
  onChange: () => () => {},
};

let bound: HostSettings = DEFAULTS;

/**
 * Bind the host's real settings. Called once, at app startup.
 *
 * Partial: a host may answer some questions and leave the rest at their
 * defaults, which keeps adding an entry here from breaking existing hosts.
 */
export function bindHostSettings(settings: Partial<HostSettings>): void {
  bound = { ...DEFAULTS, ...settings };
}

/** Restore defaults. Tests only — production binds once and never unbinds. */
export function resetHostSettings(): void {
  bound = DEFAULTS;
}

/**
 * The bound settings.
 *
 * Read through the accessor rather than captured, so a plugin holding a
 * reference sees the host's binding even if it loaded first.
 */
export const hostSettings: HostSettings = {
  tabSize: () => bound.tabSize(),
  tableFitToWidth: () => bound.tableFitToWidth(),
  lintEnabled: () => bound.lintEnabled(),
  preserveLineBreaks: () => bound.preserveLineBreaks(),
  hardBreakStyleOnSave: () => bound.hardBreakStyleOnSave(),
  copyImagesToAssets: () => bound.copyImagesToAssets(),
  preserveBlankLines: () => bound.preserveBlankLines(),
  cjkFormatting: () => bound.cjkFormatting(),
  copyOnSelect: () => bound.copyOnSelect(),
  pasteMode: () => bound.pasteMode(),
  htmlRendering: () => bound.htmlRendering(),
  onChange: (listener) => bound.onChange(listener),
};
