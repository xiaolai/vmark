/**
 * Workspace settings types — format support, large-file handling, general
 * (auto-save/history/tabs), and update checking.
 *
 * Extracted from settingsTypes.ts, which remains the stable entry point.
 *
 * @module stores/settingsTypes/workspace
 */

import type { LineEndingOnSave } from "@/utils/linebreakDetection";
import type { SplitViewMode } from "@/lib/formats/types";

// ---------------------------------------------------------------------------
// Format support (multi-format rebrand opt-in)
// ---------------------------------------------------------------------------

/**
 * Format support settings — opt-in toggles for non-default format adapters.
 *
 * Markdown, plain text, and YAML/YML are always registered (markdown is the
 * core product; YAML shipped on by default in the previous release with the
 * GHA workflow viewer — reverting it would break the contract). Every other
 * adapter is grouped here behind a category toggle so the existing user base
 * isn't surprised by VMark suddenly opening `.html` / `.toml` / `.ts` files
 * with rich previews. Defaults are all OFF on first install AND on upgrade.
 *
 * `externalEditor` is the explicit override for the "Open in external editor"
 * button on read-only code tabs (WI-4.4). Empty string = fall back to the
 * env-var chain (`$VMARK_EXTERNAL_EDITOR` → `$VISUAL` → `$EDITOR` → platform
 * default). The GUI setting wins over env vars when both are set — explicit
 * beats implicit.
 */
export interface FormatsSettings {
  /** Register `.json` / `.jsonl` / `.toml` adapters (split-pane source + tree). */
  dataFormats: boolean;
  /** Register `.mmd` (Mermaid) and `.svg` adapters (source + sanitized render). */
  diagrams: boolean;
  /** Register `.html` / `.htm` adapter (sandboxed iframe + DOMPurify + CSP). */
  htmlPreview: boolean;
  /** Register `.ts` / `.tsx` / `.js` / `.jsx` / `.py` / `.rs` / `.go` /
   *  `.css` / `.sh` / `.bash` / `.rb` / `.lua` viewers (read-only by default). */
  codeViewers: boolean;
  /** Explicit external-editor command for the read-only code-tab escape hatch.
   *  Empty = env-var fallback chain. Browse button populates. */
  externalEditor: string;
  /** Default Source/Split/Preview view mode for newly-opened split-pane /
   *  viewer tabs that have no per-tab override. `"split"` preserves today's
   *  behavior. See dev-docs/plans/20260703-split-pane-view-modes.md. */
  defaultViewMode: SplitViewMode;
  /** Internal: set true once the upgrade nudge toast has been shown so it
   *  never repeats. Not user-toggled — only updated by the nudge handler. */
  upgradeNudgeShown: boolean;
  /** User format associations: lookup-key → formatId. The manual override
   *  behind "Set File Type…". Keys are produced by `formatLookupKeys`
   *  (full filename, dotfile stem, or bare extension — e.g. `txt`, `.env`,
   *  `dockerfile`). Empty by default. Wins over the built-in extension map
   *  so a user can render a `.txt` as markdown or force any file to plain
   *  text. */
  associations: Record<string, string>;
}

/** General settings — auto-save, document history, tab size, line endings, and quit behavior. */
// ---------------------------------------------------------------------------
// Large file open behavior
// ---------------------------------------------------------------------------

/** User-togglable behavior for opening large files.
 *
 * @see `src/utils/fileSizeThresholds.ts` for the threshold byte values.
 */
export interface LargeFileSettings {
  /** When true, files ≥ 1 MB open in Source mode by default (sub-second open). */
  autoSourceMode: boolean;
  /** When true, a pre-open confirmation dialog appears for files ≥ 5 MB. */
  warnAbove5MB: boolean;
}

export interface GeneralSettings {
  // Auto-save
  autoSaveEnabled: boolean;
  autoSaveInterval: number; // seconds
  // Document history
  historyEnabled: boolean;
  historyMaxSnapshots: number;
  historyMaxAgeDays: number;
  historyMergeWindow: number; // seconds, 0 = disabled (consecutive auto-saves within window overwrite)
  historyMaxFileSize: number; // KB, 0 = unlimited (skip snapshot for files larger than this)
  // Editor
  tabSize: number; // Number of spaces for Tab key (2 or 4)
  lineEndingsOnSave: LineEndingOnSave; // Preserve or normalize line endings
  // Quit behavior
  confirmQuit: boolean; // Require double Cmd+Q to quit (default: true)
  // Tab behavior
  // fix(#946) — when true, opening an existing file uses a new tab instead of
  // replacing the current clean untitled tab. Default false preserves the
  // legacy "reuse the empty tab" behavior so existing users are unaffected.
  openInNewTab: boolean;
  // Workspace rail/window model; default false preserves the classic model.
  workspaceRailMode: boolean;
  // i18n
  language: string; // Default: "en" — UI language (BCP 47 tag, e.g. "en", "zh-CN", "zh-TW")
}

// ---------------------------------------------------------------------------
// Update Settings
// ---------------------------------------------------------------------------

/** How often the app checks for updates. */
export type UpdateCheckFrequency = "startup" | "daily" | "weekly" | "manual";

/** Update checking and download preferences. */
export interface UpdateSettings {
  autoCheckEnabled: boolean; // Periodically check for updates
  checkFrequency: UpdateCheckFrequency; // When to check
  autoDownload: boolean; // Download updates automatically
  lastCheckTimestamp: number | null; // Unix timestamp of last check
  skipVersion: string | null; // Version to skip (user clicked "Skip")
}
