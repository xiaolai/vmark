/**
 * Purpose: the row map for the settings-defaults doc join — one entry per
 *   documented Default row on website/guide/settings.md and
 *   website/guide/terminal.md, naming the defaults.ts key it restates and how
 *   that key's value is spelled on the page (WI-FL0.4).
 *
 * Split from settingsDefaults.mjs so the join's mechanics stay readable; the
 * map is data. `settingsDefaults.mjs` re-exports it as `ROW_MAP`.
 *
 * Entry shape:
 *
 *   { page, row, heading?, key?, render }
 *
 *   page     "settings" | "terminal" — which page the row is on
 *   row      the Setting cell with inline markdown stripped (`**X**` → X,
 *            `` `"` `` → ")
 *   heading  the nearest markdown heading above the table; REQUIRED only when
 *            the same row text appears in two tables on one page ("Font Size"
 *            is both an editor and a terminal row)
 *   key      the dotted defaults.ts key (`terminal.macOptionIsMeta`)
 *   render   how the value is written in the Default cell:
 *              "onOff"      true → On, false → Off
 *              "number"     String(value)
 *              "seconds"    `${n} seconds`
 *              "px"         `${n}px` on settings.md, `${n} px` on terminal.md
 *              "percent"    ratio → `${n}%` / `${n} %` (page-aware, as above)
 *              "thousands"  5000 → 5,000
 *              "text"       the string itself; "" → (empty)
 *              "list"       array → a, b, c
 *              { enum: { value: label } }  an explicit value→label map — the
 *                           label is what THIS page writes, not the UI string
 *              { suffix, zero? }  `${n}${suffix}`, or `zero` for 0
 *              { expected, reason }  a pinned doc value for a default the code
 *                           computes at runtime (the language auto-detect) or
 *                           keeps outside defaults.ts (per-workspace rows);
 *                           the reason is REQUIRED
 *              { notASetting: reason }  a documented row that is not a
 *                           persisted default at all (an action button, the
 *                           server's running state); the reason is REQUIRED
 *
 * Every Default row must appear here — an unmapped row fails the gate closed —
 * and every entry must find its row, so a removed row fails too. Adding a
 * row to a page therefore means adding an entry; that is the point.
 *
 * @coordinates-with scripts/lib/docJoins/settingsDefaults.mjs — consumes this
 * @coordinates-with website/guide/settings.md — the rows
 * @coordinates-with website/guide/terminal.md — the rows
 * @coordinates-with src/stores/settingsStore/defaults.ts — the keys
 * @module scripts/lib/docJoins/settingsDefaultsRowMap
 */

// ── Value → label maps, in the pages' own vocabulary ──────────────────────

const ON_OFF = "onOff";
const FONT = { system: "System Default" };
const LATIN_FONT = { ...FONT, athelas: "Athelas", palatino: "Palatino", georgia: "Georgia", charter: "Charter", literata: "Literata" };
const CJK_FONT = { ...FONT, pingfang: "PingFang SC", songti: "Songti SC", kaiti: "Kaiti SC", notoserif: "Noto Serif CJK", sourcehans: "Source Han Sans" };
const MONO_FONT = {
  ...FONT, sfmono: "SF Mono", monaco: "Monaco", menlo: "Menlo", consolas: "Consolas", dejavu: "DejaVu Sans Mono",
  liberation: "Liberation Mono", ubuntumono: "Ubuntu Mono", notosansmono: "Noto Sans Mono", notosansmonocjk: "Noto Sans Mono CJK SC",
  jetbrains: "JetBrains Mono", firacode: "Fira Code", saucecodepro: "SauceCodePro NFM", ibmplexmono: "IBM Plex Mono", hack: "Hack", inconsolata: "Inconsolata",
};
const EDITOR_LINE_HEIGHT = { 1.4: "1.4 (Compact)", 1.6: "1.6 (Normal)", 1.8: "1.8 (Relaxed)", 2: "2.0 (Spacious)", 2.2: "2.2 (Extra)" };
const BLOCK_SPACING = { 0.5: "0.5x (Tight)", 1: "1x (Normal)", 1.5: "1.5x (Relaxed)", 2: "2x (Spacious)" };
const CJK_LETTER_SPACING = { 0: "Off", 0.02: "0.02em (Subtle)", 0.03: "0.03em (Light)", 0.05: "0.05em (Normal)", 0.08: "0.08em (Wide)", "0.10": "0.10em (Wider)", 0.12: "0.12em (Extra)" };
const EDITOR_WIDTH = { 36: "36em (Compact)", 42: "42em (Narrow)", 50: "50em (Medium)", 60: "60em (Wide)", 80: "80em (Extra Wide)", 0: "Unlimited" };
const TERMINAL_LINE_HEIGHT = { 1: "1.0 (Tight)", 1.2: "1.2 (Compact)", 1.4: "1.4 (Normal)", 1.6: "1.6 (Relaxed)", 1.8: "1.8 (Spacious)", 2: "2.0 (Extra)" };
const CONTRAST = { 1: "Off", 4.5: "WCAG AA (4.5:1)", 7: "WCAG AAA (7:1)", 21: "Maximum" };
const BELL = { off: "Off", visual: "Visual", audible: "Audible" };
const PRESERVE_LF_CRLF = { preserve: "Preserve existing", lf: "LF (\\n)", crlf: "CRLF (\\r\\n)" };
const HARD_BREAK = { preserve: "Preserve existing", twoSpaces: "Two spaces (Recommended)", backslash: "Backslash (\\)" };

const settings = (row, key, render, heading) => ({ page: "settings", row, ...(heading ? { heading } : {}), key, render });
const terminal = (row, key, render) => ({ page: "terminal", row, key, render });
const pinned = (page, row, expected, reason) => ({ page, row, render: { expected, reason } });
const notASetting = (page, row, reason) => ({ page, row, render: { notASetting: reason } });

/** One entry per documented Default row, in page order. See the header for the shape. */
export const ROW_MAP = [
  // ── settings.md › Appearance ────────────────────────────────────────────
  settings("Follow system appearance", "appearance.followSystemAppearance", ON_OFF),
  { page: "settings", row: "Language", key: "general.language", render: { expected: "English", reason: "resolveInitialLanguage() reads navigator.languages on first run; English is the fallback the page names" } },
  settings("Show filename in titlebar", "appearance.showFilenameInTitlebar", ON_OFF),
  settings("Dim level", "appearance.focusModeDim", { enum: { standard: "Standard", strong: "Strong", stronger: "Stronger" } }),
  // ── settings.md › Editor ────────────────────────────────────────────────
  settings("Latin Font", "appearance.latinFont", { enum: LATIN_FONT }),
  settings("CJK Font", "appearance.cjkFont", { enum: CJK_FONT }),
  settings("Mono Font", "appearance.monoFont", { enum: MONO_FONT }),
  settings("Font Size", "appearance.fontSize", "px", "Typography"),
  settings("Line Height", "appearance.lineHeight", { enum: EDITOR_LINE_HEIGHT }, "Typography"),
  settings("Block Spacing", "appearance.blockSpacing", { enum: BLOCK_SPACING }),
  settings("CJK Letter Spacing", "appearance.cjkLetterSpacing", { enum: CJK_LETTER_SPACING }),
  settings("Editor Width", "appearance.editorWidth", { enum: EDITOR_WIDTH }),
  settings("Tab size", "general.tabSize", { enum: { 2: "2 spaces", 4: "4 spaces" } }),
  settings("Open files in a new tab", "general.openInNewTab", ON_OFF),
  settings("Enable auto-pairing", "markdown.autoPairEnabled", ON_OFF),
  settings("CJK brackets", "markdown.autoPairCJKStyle", { enum: { auto: "Auto", off: "Off" } }),
  settings("Include curly quotes", "markdown.autoPairCurlyQuotes", ON_OFF),
  settings('Also pair "', "markdown.autoPairRightDoubleQuote", ON_OFF),
  settings("Copy format", "markdown.copyFormat", { enum: { default: "Plain text", markdown: "Markdown" } }),
  settings("Copy on select", "markdown.copyOnSelect", ON_OFF),
  settings("Line endings on save", "general.lineEndingsOnSave", { enum: PRESERVE_LF_CRLF }),
  settings("Line breaks become hard breaks", "markdown.preserveLineBreaks", ON_OFF),
  settings("Preserve consecutive line breaks", "markdown.preserveBlankLines", ON_OFF),
  settings("Hard break style on save", "markdown.hardBreakStyleOnSave", { enum: HARD_BREAK }),
  settings("Show <br> tags", "markdown.showBrTags", ON_OFF),
  settings("Show invisibles", "markdown.showInvisibles", ON_OFF),
  // ── settings.md › Markdown ──────────────────────────────────────────────
  settings("Enable regex in search", "markdown.enableRegexSearch", ON_OFF),
  settings("Paste mode", "markdown.pasteMode", { enum: { smart: "Smart", plain: "Plain", rich: "Rich" } }),
  settings("Markdown paste in WYSIWYG", "markdown.pasteMarkdownInWysiwyg", { enum: { auto: "Auto", off: "Off" } }),
  settings("Split source/preview by default", "markdown.splitViewByDefault", ON_OFF),
  settings("Block element font size", "markdown.blockFontSize", { enum: { 1: "100%", 0.95: "95%", 0.9: "90%", 0.85: "85%" } }),
  settings("Heading alignment", "markdown.headingAlignment", { enum: { left: "Left", center: "Center" } }),
  settings("Image & diagram borders", "markdown.mediaBorderStyle", { enum: { none: "None", always: "Always", hover: "On hover" } }),
  settings("Image & table alignment", "markdown.mediaAlignment", { enum: { center: "Center", left: "Left" } }),
  settings("Fit tables to width", "markdown.tableFitToWidth", ON_OFF),
  settings("Code block line numbers", "markdown.codeBlockLineNumbers", ON_OFF),
  settings("Enable markdown lint", "markdown.lintEnabled", ON_OFF),
  settings("Raw HTML in rich text", "markdown.htmlRenderingMode", { enum: { hidden: "Hidden", sanitized: "Sanitized", sanitizedWithStyles: "Sanitized + styles" } }),
  settings("Allowed HTML tags", "markdown.htmlAllowlistLevel", { enum: { strict: "Strict", extended: "Extended" } }),
  settings("Also allow these tags", "markdown.htmlAllowlistCustomTags", "text"),
  // ── settings.md › Files & Images ────────────────────────────────────────
  settings("Workspace rail", "general.workspaceRailMode", ON_OFF),
  pinned("settings", "Show hidden files", "Off", "a per-workspace preference (workspaceStore config.showHiddenFiles ?? false), not a defaults.ts key"),
  pinned("settings", "Show all files", "Off", "a per-workspace preference (workspaceStore config.showAllFiles ?? false), not a defaults.ts key"),
  settings("Show file extensions", "general.showFileExtensions", ON_OFF),
  settings("Confirm quit", "general.confirmQuit", ON_OFF),
  settings("Enable auto-save", "general.autoSaveEnabled", ON_OFF),
  settings("Stamp identity block on save", "general.coherenceCaptureOnSave", ON_OFF),
  settings("Save interval", "general.autoSaveInterval", "seconds"),
  settings("Keep document history", "general.historyEnabled", ON_OFF),
  settings("Maximum versions", "general.historyMaxSnapshots", { suffix: " versions" }),
  settings("Keep versions for", "general.historyMaxAgeDays", { suffix: " days" }),
  settings("Merge window", "general.historyMergeWindow", { suffix: " seconds", zero: "Off" }),
  settings("Max file size for history", "general.historyMaxFileSize", { suffix: " KB", zero: "Unlimited" }),
  settings("Auto-resize on paste", "image.autoResizeMax", { suffix: "px", zero: "Off" }),
  settings("Copy to assets folder", "image.copyToAssets", ON_OFF),
  settings("Clean up unused images on close", "image.cleanupOrphansOnClose", ON_OFF),
  settings("Warn above size", "largeFile.warnAbove5MB", ON_OFF),
  settings("Auto Source mode", "largeFile.autoSourceMode", ON_OFF),
  // ── settings.md › Integrations ──────────────────────────────────────────
  notASetting("settings", "Enable MCP Server", "the toggle starts and stops the running sidecar; the persisted default is the Start on launch row"),
  settings("Start on launch", "advanced.mcpServer.autoStart", ON_OFF),
  settings("Auto-approve saves to a new location and genie results", "advanced.mcpServer.autoApproveEdits", ON_OFF),
  // ── settings.md › Formats ───────────────────────────────────────────────
  settings("Data formats", "formats.dataFormats", ON_OFF),
  settings("Diagrams & SVG", "formats.diagrams", ON_OFF),
  settings("HTML preview", "formats.htmlPreview", ON_OFF),
  settings("Code viewers", "formats.codeViewers", ON_OFF),
  // ── settings.md › Language (CJK formatting) ─────────────────────────────
  settings("Convert fullwidth letters/numbers", "cjkFormatting.fullwidthAlphanumeric", ON_OFF),
  settings("Normalize punctuation width", "cjkFormatting.fullwidthPunctuation", ON_OFF),
  settings("Convert parentheses", "cjkFormatting.fullwidthParentheses", ON_OFF),
  settings("Convert brackets", "cjkFormatting.fullwidthBrackets", ON_OFF),
  settings("Add CJK-English spacing", "cjkFormatting.cjkEnglishSpacing", ON_OFF),
  settings("Add CJK-parenthesis spacing", "cjkFormatting.cjkParenthesisSpacing", ON_OFF),
  settings("Remove currency spacing", "cjkFormatting.currencySpacing", ON_OFF),
  settings("Remove slash spacing", "cjkFormatting.slashSpacing", ON_OFF),
  settings("Collapse multiple spaces", "cjkFormatting.spaceCollapsing", ON_OFF),
  settings("Convert dashes", "cjkFormatting.dashConversion", ON_OFF),
  settings("Fix em-dash spacing", "cjkFormatting.emdashSpacing", ON_OFF),
  settings("Convert straight quotes", "cjkFormatting.smartQuoteConversion", ON_OFF),
  settings("Quote style", "cjkFormatting.quoteStyle", { enum: { curly: "Curly \"\" ''" } }),
  settings("Contextual quotes", "cjkFormatting.contextualQuotes", ON_OFF),
  settings("Quote toggle behavior", "cjkFormatting.quoteToggleMode", { enum: { simple: "Simple", "full-cycle": "Full cycle" } }),
  settings("Fix double quote spacing", "cjkFormatting.quoteSpacing", ON_OFF),
  settings("Fix single quote spacing", "cjkFormatting.singleQuoteSpacing", ON_OFF),
  settings("CJK corner quotes", "cjkFormatting.cjkCornerQuotes", ON_OFF),
  settings("Nested corner quotes", "cjkFormatting.cjkNestedQuotes", ON_OFF),
  settings("Skip reference sections", "cjkFormatting.skipReferenceSections", ON_OFF),
  settings("Limit consecutive punctuation", "cjkFormatting.consecutivePunctuationLimit", { enum: { 0: "Off", 1: "Single (!! to !)", 2: "Double (!!! to !!)" } }),
  settings("Remove trailing spaces", "cjkFormatting.trailingSpaceRemoval", ON_OFF),
  settings("Normalize ellipsis", "cjkFormatting.ellipsisNormalization", ON_OFF),
  settings("Collapse newlines", "cjkFormatting.newlineCollapsing", ON_OFF),
  // ── settings.md › Terminal ──────────────────────────────────────────────
  settings("Shell", "terminal.shell", { enum: { "": "System Default" } }),
  settings("Panel Position", "terminal.position", { enum: { auto: "Auto", top: "Top", bottom: "Bottom", left: "Left", right: "Right" } }),
  settings("Panel Size", "terminal.panelRatio", "percent"),
  settings("Font Size", "terminal.fontSize", "px", "Terminal"),
  settings("Line Height", "terminal.lineHeight", { enum: TERMINAL_LINE_HEIGHT }, "Terminal"),
  settings("Cursor Style", "terminal.cursorStyle", { enum: { bar: "Bar", block: "Block", underline: "Underline" } }),
  settings("Cursor Blink", "terminal.cursorBlink", ON_OFF),
  settings("Copy on Select", "terminal.copyOnSelect", ON_OFF),
  settings("WebGL Renderer", "terminal.useWebGL", ON_OFF),
  settings("Remote Clipboard (OSC 52)", "terminal.osc52Clipboard", ON_OFF),
  settings("Scrollback", "terminal.scrollback", "thousands"),
  settings("Screen Reader Mode", "terminal.screenReaderMode", ON_OFF),
  settings("Terminal bell", "terminal.bellMode", { enum: BELL }),
  settings("Notify when unfocused", "terminal.notifyOnBell", ON_OFF),
  settings("Minimum contrast", "terminal.minimumContrastRatio", { enum: CONTRAST }),
  // ── settings.md › About ─────────────────────────────────────────────────
  settings("Automatic updates", "update.autoCheckEnabled", ON_OFF),
  settings("Check frequency", "update.checkFrequency", { enum: { startup: "On startup", daily: "Daily", weekly: "Weekly", manual: "Manual only" } }),
  settings("Download updates automatically", "update.autoDownload", ON_OFF),
  notASetting("settings", "Check Now", "an action button, not a persisted setting"),
  // ── settings.md › Advanced ──────────────────────────────────────────────
  settings("Custom link protocols", "advanced.customLinkProtocols", "list"),
  settings("Keep both editors alive", "advanced.keepBothEditorsAlive", ON_OFF),
  settings("Semantic check confidence", "general.coherenceCheckTau", "number"),
  settings("Fetch action metadata", "advanced.workflowFetchActionMetadata", ON_OFF),
  settings("Use actionlint when available", "advanced.workflowActionlint", ON_OFF),
  settings("Preserve YAML formatting", "advanced.workflowEditorPreserveYamlFormatting", ON_OFF),
  settings("Workflow engine", "advanced.workflowEngine", ON_OFF),
  settings("Embedded browser", "browser.enabled", ON_OFF),
  settings("AI browser session", "browser.aiSession", { enum: { sandbox: "Sandbox", shared: "Shared" } }),
  settings("Allow AI loopback access", "browser.aiAllowLoopback", ON_OFF),
  settings("Clear macOS quarantine on open", "advanced.clearMacQuarantineOnOpen", ON_OFF),
  settings("Mac Option as Meta (terminal)", "terminal.macOptionIsMeta", ON_OFF),
  settings("Developer tools", "advanced.developerMode", ON_OFF),
  // ── terminal.md › Settings ──────────────────────────────────────────────
  terminal("Panel Size", "terminal.panelRatio", "percent"),
  terminal("Font Size", "terminal.fontSize", "px"),
  terminal("Line Height", "terminal.lineHeight", "number"),
  terminal("Copy on Select", "terminal.copyOnSelect", ON_OFF),
  terminal("Mac Option as Meta", "terminal.macOptionIsMeta", ON_OFF),
  terminal("Shell Integration", "terminal.shellIntegration", ON_OFF),
  terminal("Remote Clipboard (OSC 52)", "terminal.osc52Clipboard", ON_OFF),
  terminal("Scrollback", "terminal.scrollback", "thousands"),
  terminal("Screen Reader Mode", "terminal.screenReaderMode", ON_OFF),
  // ── terminal.md › Accessibility ─────────────────────────────────────────
  terminal("Terminal bell", "terminal.bellMode", { enum: BELL }),
  terminal("Minimum contrast", "terminal.minimumContrastRatio", { enum: CONTRAST }),
];
