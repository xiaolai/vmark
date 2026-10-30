# Settings

VMark's settings panel lets you customize every aspect of the editor. Open it with `Mod + ,` or via **VMark > Settings** in the menu bar.

The settings window has a sidebar listing the sections in alphabetical order (by their English names), with About at the bottom and Advanced below it when shown. Changes take effect immediately — there is no save button.

Use the **search box** at the top of the sidebar to filter settings across every panel by name or description — matching rows are stacked together so you don't need to know which category a setting lives in. To restore everything to factory defaults, use **Reset to Defaults** in the About section.

## Appearance

Controls the visual theme and window behavior.

### Theme

Choose one of six color themes. The active theme is indicated by a ring around its swatch.

| Theme | Background | Style |
|-------|-----------|-------|
| White | `#FFFFFF` | Clean white, highest contrast |
| Paper | `#EEEDED` | Warm newsprint, the default |
| Mint | `#CCE6D0` | Soft green, easy on the eyes |
| Sepia | `#F9F0DB` | Book stock, for long reading |
| Night | `#23262B` | Dark slate for low light |
| Solarized | `#002B36` | Solarized Dark, the classic palette |

::: info Windows 10 and Linux offer White and Night only
On Windows 10 and Linux the system draws the title bar, and it can only be light or dark. So those platforms offer just **White** and **Night**, and a theme that cannot match the system chrome is shown as the nearest of the two: Paper, Mint and Sepia display as White, Solarized as Night. Your saved choice is not changed — on macOS and Windows 11 the full catalog is available. On Windows 11 the title bar takes the theme's own colors; the menu bar is still drawn light or dark.
:::

#### Follow system appearance

| Setting | Description | Default |
|---------|-------------|---------|
| Follow system appearance | Switch between your light and dark themes automatically with the system | Off |

When enabled, the single theme row is replaced by two rows — **Light theme** (used while the system is in light mode, default Paper) and **Dark theme** (used in dark mode, default Night). VMark switches between them the moment the system appearance changes; your manual theme choice is kept and restored when you turn the option off.

### Sidebar

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Sidebar style | How the sidebar and workspace rail are framed. **Full height** runs them along the window's edge with a thin divider, as macOS's own sidebars do; **Card** floats them inside the window with rounded corners and a shadow. Applies to the Settings window too | Full height | Full height, Card |

### Window

| Setting | Description | Default |
|---------|-------------|---------|
| Show filename in titlebar | Display the current file name in the macOS window title bar. **macOS only** — this setting is hidden elsewhere, because Windows and Linux always show the filename in the system title bar | Off |

On macOS, VMark draws its own title bar over the system one, so the filename is
an opt-in element of that strip. On Windows and Linux the system draws a real
title bar above the window: the filename (with a `•` while there are unsaved
changes) always appears there, and VMark adds no title strip of its own.

### Focus Mode

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Dim level | How strongly non-focused content is dimmed in Focus Mode. **Standard** keeps the default color-only dimming; **Strong** and **Stronger** add progressively lower opacity on top | Standard | Standard, Strong, Stronger |

## Editor

Typography, display, editing behavior, whitespace, and large-file settings.

### Typography

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Latin Font | Font family for Latin (English) text | System Default | System Default, Athelas, Palatino, Georgia, Charter, Literata — plus any installed font |
| CJK Font | Font family for Chinese, Japanese, Korean text | System Default | System Default, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans — plus any installed font |
| Mono Font | Font family for code and monospace text — also used by the integrated terminal | System Default | System Default, SF Mono, Monaco, Menlo, Consolas, DejaVu Sans Mono, Liberation Mono, Ubuntu Mono, Noto Sans Mono, Noto Sans Mono CJK SC, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata — plus any installed font |
| Font Size | Base font size for editor content | 18px | 14px, 16px, 18px, 20px, 22px |
| Line Height | Vertical spacing between lines | 1.8 (Relaxed) | 1.4 (Compact), 1.6 (Normal), 1.8 (Relaxed), 2.0 (Spacious), 2.2 (Extra) |
| Block Spacing | Visual gap between block elements (headings, paragraphs, lists) measured in multiples of line height | 1x (Normal) | 0.5x (Tight), 1x (Normal), 1.5x (Relaxed), 2x (Spacious) |
| CJK Letter Spacing | Extra spacing between CJK characters, in em units | Off | Off, 0.02em (Subtle), 0.03em (Light), 0.05em (Normal), 0.08em (Wide), 0.10em (Wider), 0.12em (Extra) |

#### Using a font you installed yourself

The names listed above are a shortlist, not the limit. Each of the three font
pickers also carries an **Installed Fonts** section listing every font family
on the machine, so a face you installed — LXGW WenKai, Iosevka, Source Han
Serif — is chosen the same way the built-in ones are.

Pick **Custom…** at the end of the list to type a family name instead. Use the
name exactly as the system reports it (macOS: Font Book; Windows: Settings →
Personalisation → Fonts) — for LXGW WenKai / 霞鹜文楷 that is `LXGW WenKai`.
The font applies as soon as the name is complete; if nothing changes, the name
does not match an installed family. A name containing quotes, commas,
semicolons or brackets is refused, and the row says so.

::: tip Installed Fonts is macOS-only
macOS lists every installed family for you. On Windows and Linux the section is
empty and **Custom…** is the way in — typing the family name works identically
on all three platforms.
:::

The choice carries into PDF export, which renders through the same engine with
the same fonts. HTML export cannot bundle a font from your machine, so an
exported page falls back to the reader's own fonts unless they have the same
family installed.

### Display

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Editor Width | Maximum content width. Wider values suit large monitors; narrower values improve readability | 50em (Medium) | 36em (Compact), 42em (Narrow), 50em (Medium), 60em (Wide), 80em (Extra Wide), Unlimited |

::: tip The same width reads differently in Latin and CJK
Editor Width is measured in `em`, so the line length in *characters* depends on the script: at 50em a Latin line holds roughly 90–100 characters (about 2× a typographer's 45–75-character measure, which suits a two-pane editor), while a CJK line holds about 50 full-width characters — right in the traditional 40–60 range for Chinese text. If you write mostly Latin prose and want a book-like measure, choose 36–42em; for mostly-CJK documents the default is already the classical measure.
:::

::: tip
50em at 18px font size is roughly 900px — a comfortable reading width for most displays.
:::

### Behavior

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Tab size | Number of spaces inserted when pressing Tab | 2 spaces | 2 spaces, 4 spaces |
| Open files in a new tab | Open existing files in a new tab instead of reusing the current empty tab | Off | On / Off |
| Enable auto-pairing | Automatically insert matching closing brackets and quotes when you type an opening one | On | On / Off |
| CJK brackets | Auto-pair CJK-specific brackets like `「」` `【】` `《》`. Only available when auto-pairing is enabled | Auto | Off, Auto |
| Include curly quotes | Auto-pair `“”` and `‘’`, and turn a typed straight `"` or `'` into a curly pair. May conflict with some IME smart quote features. Appears when CJK brackets is set to Auto | On | On / Off |
| Also pair `"` | Typing the right double quote `"` also inserts a `""` pair. Useful when your IME alternates between open and close quotes. Appears when curly quotes are enabled | Off | On / Off |
| Copy format | What format to use for the plain text clipboard slot when copying from WYSIWYG mode | Plain text | Plain text, Markdown |
| Copy on select | Automatically copy text to the clipboard whenever you select it | Off | On / Off |

### Whitespace

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Line endings on save | Control how line endings are handled when saving files | Preserve existing | Preserve existing, LF (`\n`), CRLF (`\r\n`) |
| Line breaks become hard breaks | Treat single newlines inside a paragraph as hard breaks (does not affect blank lines between blocks) | Off | On / Off |
| Preserve consecutive line breaks | Keep multiple blank lines as-is instead of collapsing them | On | On / Off |
| Hard break style on save | How hard line breaks are represented in the saved Markdown file | Preserve existing | Two spaces (Recommended), Preserve existing, Backslash (`\`) |
| Show `<br>` tags | Display HTML line break tags visibly in the editor | Off | On / Off |
| Show invisibles | Visualize whitespace: spaces as `·`, tabs as `→` (Source only), soft line breaks as `↓` (Source only), hard line breaks as `⏎`. Hidden when printing. Toggle: `F3` or View → Show Invisibles. | Off | On / Off |

::: tip
Two spaces is the most compatible hard break style — it works on GitHub, GitLab, and all major Markdown renderers. The backslash style may fail on Reddit, Jekyll, and some older parsers.
:::

### Large Files

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Auto Source mode | Open large files in Source mode — files over 1 MB, or markdown with 1,200+ estimated blocks (skips WYSIWYG to keep performance smooth). You can switch to WYSIWYG from the status bar at any time | On | On / Off |
| Warn above size | Show a confirmation prompt before opening files over 5 MB. Files of 50 MB or more are always refused | On | On / Off |

See [Large Files](/guide/large-files) for the full breakdown of how large files are handled.

## Markdown

Paste behavior, layout, and HTML rendering settings.

### Paste & Input

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Enable regex in search | Show a regex toggle button in the Find & Replace bar | On | On / Off |
| Paste mode | How content from the clipboard is processed when pasting. **Smart** converts HTML to Markdown and detects Markdown syntax; **Plain** always pastes plain text; **Rich** keeps the original HTML formatting | Smart | Smart, Plain, Rich |
| Markdown paste in WYSIWYG | When pasting text that looks like Markdown into the WYSIWYG editor, automatically convert it to rich content | Auto | Auto, Off |

### Layout

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Split source/preview by default | Open Markdown files in the side-by-side source + live preview split (otherwise WYSIWYG). Toggle per session with `Shift + F6` or **View → Markdown Split View** | Off | On / Off |
| Block element font size | Relative font size for lists, blockquotes, tables, alerts, and details blocks | 100% | 100%, 95%, 90%, 85% |
| Heading alignment | Text alignment for headings. Editor only — not applied to export or print | Left | Left, Center |
| Image & diagram borders | Whether to show a border around images, Mermaid diagrams, and math blocks. Editor only — not applied to export or print | None | None, Always, On hover |
| Image & table alignment | Horizontal alignment for block images and tables. Editor only — not applied to export or print | Center | Center, Left |
| Fit tables to width | Constrain all tables to the editor width instead of allowing horizontal scroll | Off | On / Off |
| Code block line numbers | Show line numbers inside code blocks in the WYSIWYG editor. Independent of the View menu's **Line Numbers**, which controls the Source/Split editor's gutter | Off | On / Off |

### Lint

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Enable markdown lint | Check for common markdown issues (broken links, missing alt text, heading increments, unclosed fences, etc.) | On | On / Off |

See [Markdown Lint](/guide/lint) for the full rule list and severity levels.

### HTML Rendering

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Raw HTML in rich text | Control whether raw HTML blocks are rendered in WYSIWYG mode | Sanitized | Hidden, Sanitized, Sanitized + styles |
| Allowed HTML tags | How broad the rendered tag set is | Strict | Strict, Extended |
| Also allow these tags | Extra tag names to allow, comma-separated | _(empty)_ | e.g. `kbd, samp, var` |

::: tip
**Hidden** collapses raw HTML and renders nothing. **Sanitized** renders HTML with dangerous tags stripped. **Sanitized + styles** additionally preserves a safe subset of inline `style` attributes.

**Strict** allows a small, conservative tag set. **Extended** additionally renders `<svg>` (and its safe child elements), `<figure>`/`<figcaption>`, `<details>`/`<summary>`, and other semantic/structural tags — all still sanitized. Use **Also allow these tags** to add specific extras on top (e.g. `kbd, samp, var`).
:::

::: warning
Regardless of these settings, dangerous tags (`<script>`, `<style>`, `<iframe>`, `<form>`, event handlers, …) are **always** stripped — the custom-tags field cannot re-enable them. Allow-list breadth only affects the WYSIWYG preview; the raw HTML in your file is never modified.
:::

## Files & Images

File browser, saving, document history, image handling, and document tools.

### Workspace

| Setting | Description | Default |
|---------|-------------|---------|
| Workspace rail | Show the left workspace rail and keep multiple workspaces and loose files in one window | Off |

See [Workspace Rail](/guide/workspace-rail) for what the rail adds.

### File Browser

The first two settings only apply when a workspace (folder) is open, and are saved
per workspace.

| Setting | Description | Default |
|---------|-------------|---------|
| Show hidden files | Include dotfiles and hidden system items in the file explorer sidebar | Off |
| Show all files | Show non-markdown files in the file explorer. Non-markdown files open with your system's default application | Off |
| Show file extensions | Display the full file name — `notes.md`, not `notes` — in the sidebar, tab strip, and title bar. Applies everywhere, workspace or not | On |

Turning **Show file extensions** off hides only extensions VMark recognises. A file
it cannot open keeps its suffix either way, so the name you see always exists on disk.

### Quit Behavior

| Setting | Description | Default |
|---------|-------------|---------|
| Confirm quit | Require pressing `Cmd+Q` (or `Ctrl+Q`) twice to quit, preventing accidental exits | On |
| Minimize to tray on close | **Windows only.** Closing the last window keeps VMark running in the system tray instead of quitting | Off |

**Minimize to tray on close** changes only the *last* window. With several windows open, closing one still closes it; it is the final close — the one that used to quit VMark — that now parks it in the tray instead. Nothing is closed, so unsaved work stays exactly where you left it.

- **Left-click** the tray icon to bring VMark back.
- **Right-click** it for **Show VMark** and **Quit VMark**. Quitting from the tray brings the window back first, so any unsaved-changes prompt appears where you can answer it.
- `Ctrl+Q` still quits as usual.
- Turning the setting off while VMark is in the tray brings the window back before the icon disappears, so it can never leave VMark running with no window and no icon.

The setting does not appear on macOS or Linux.

### Saving

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Enable auto-save | Automatically save files after editing | On | On / Off |
| Stamp identity block on save | Let VMark insert a `vmark:` identity block into a file's frontmatter and create a `.vmark` folder in the workspace, so the coherence layer can track the document. Covers every write — saves, AI and MCP edits, version restores and new files. When off, nothing is stamped and no `.vmark` folder is created; a workspace that already has one keeps recording changes to the documents it tracks — a document it has recorded before, or one that already carries its own `vmark:` identity, such as a tracked file you moved or checked out. See [Coherence](/guide/coherence#how-it-works-30-seconds) | Off | On / Off |
| Save interval | Time between automatic saves. Only available when auto-save is enabled | 30 seconds | 10s, 30s, 1 min, 2 min, 5 min |
| Keep document history | Track document versions for undo and recovery | On | On / Off |
| Maximum versions | Number of history snapshots to keep per document | 50 versions | 10, 25, 50, 100 |
| Keep versions for | Maximum age of history snapshots before they are pruned | 7 days | 1 day, 7 days, 14 days, 30 days |
| Merge window | Consecutive auto-saves within this window consolidate into a single snapshot, reducing storage noise | 30 seconds | Off, 10s, 30s, 1 min, 2 min |
| Max file size for history | Skip autosave history snapshots for files larger than this threshold. Manual saves, MCP saves and the safety copy taken before restoring a version are always kept | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Unlimited |

### Images

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Auto-resize on paste | Automatically resize large images before saving to the assets folder. The value is the maximum dimension in pixels | Off | Off, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copy to assets folder | Copy pasted or dropped images into the document's assets folder instead of embedding them | On | On / Off |
| Clean up unused images on close | Automatically delete images from the assets folder that the document no longer references. Runs when you close the document, the window, or the app. Images still referenced by another document in the same folder are kept, and removed images go to the system Trash | Off | On / Off |

::: tip
Enable **Auto-resize on paste** if you frequently paste screenshots or photos — it keeps your assets folder lightweight without manual resizing.
:::

### Document Tools

VMark detects [Pandoc](https://pandoc.org) to enable exporting to additional formats (DOCX, EPUB, LaTeX, and more). Click **Detect** to scan for Pandoc on your system. If found, its version and path are displayed.

See [Export & Print](/guide/export) for details on all export options.

## Integrations

MCP server and AI provider configuration.

### MCP Server

The MCP (Model Context Protocol) server allows external AI assistants like Claude Code and Cursor to control VMark programmatically.

| Setting | Description | Default |
|---------|-------------|---------|
| Enable MCP Server | Start or stop the MCP server. When running, a status badge shows the port and connected clients | On (toggle) |
| Start on launch | Automatically start the MCP server when VMark opens | On |
| Auto-approve saves to a new location and genie results | Let an MCP client save a document to a new location without asking, and let a genie apply its result directly instead of showing a preview. When off, an MCP request to save to a new path is refused and a toast notifies you. MCP document writes are never gated by this — each one is recorded in the agent edit history and can be restored from the MCP write history in the status bar | Off |

When the server is running, the panel also displays:
- **Port** — automatically assigned; AI clients discover it through the config file
- **Version** — MCP server sidecar version
- **Tools / Resources** — number of available MCP tools and resources
- **Connected Clients** — number of AI clients currently connected

Below the MCP Server section, you can install VMark's MCP configuration into supported AI clients (Claude Desktop, Claude Code, Codex CLI, Gemini CLI) with a single click.

See [MCP Setup](/guide/mcp-setup) and [MCP Tools Reference](/guide/mcp-tools) for full details.

### AI Providers

Configure which AI provider powers [AI Genies](/guide/ai-genies). Only one provider can be active at a time.

**CLI Providers** — Use locally installed AI CLI tools (Claude, Codex, Gemini). Click **Detect** to scan your `$PATH` for available CLIs. CLI providers use your subscription plan and require no API key.

**REST API Providers** — Connect directly to an API: Anthropic, OpenAI, an **OpenAI-compatible** service (DeepSeek, Groq, OpenRouter, …), Google AI, or a local Ollama server (Ollama API). Each needs a model name and an API key — except Ollama, where the key is optional. All but Google AI also take an endpoint, pre-filled where the provider has a standard one (the OpenAI-compatible slot has none, so you enter it).

See [AI Providers](/guide/ai-providers) for detailed setup instructions for each provider.

## Formats

Opt-in toggles for non-default format adapters, plus the explicit external-editor command for the read-only code-tab escape hatch.

Markdown, plain text, and YAML/YML are **always** registered — the calm defaults. Every other adapter is **off by default** so existing users aren't surprised on upgrade. Flip a toggle and the registry rebuilds in place; open tabs remount with the proper adapter, no restart needed.

For the full list of formats and their previews, see [Supported Formats](/guide/formats).

### Format Support

| Toggle | Default | Enables |
|---|---|---|
| **Data formats** | Off | `.json`, `.jsonl`, `.toml` — split-pane source + navigable tree. Schema-aware previews for `Cargo.toml`, `package.json`, `pyproject.toml`. |
| **Diagrams & SVG** | Off | `.mmd` (Mermaid) and `.svg` — split-pane source + sanitized live render. |
| **HTML preview** | Off | `.html` and `.htm` — sandboxed iframe preview (`sandbox=""` empty allow-list, DOMPurify, CSP `<meta>`). Its security sign-off is still pending, and the preview says so — see [Security model for HTML](/guide/formats#security-model-for-html). |
| **Code viewers** | Off | 12 read-only viewers (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Open in a syntax-highlighted viewer with **Enable editing** and **Open in external editor** buttons. |

When a category is off, the matching extensions fall through to the plain-text fallback so the file still opens — just without the schema view.

### Default view mode

Preview-capable files (HTML, SVG, Mermaid, JSON, YAML, TOML) open in one of three
[view modes](/guide/formats#view-modes-source-split-preview):

| Option | Result |
|---|---|
| **Source** | Editable source pane, full width. |
| **Split** (default) | Source and preview side by side. |
| **Preview** | Read-only render, full width. |

This is the default for newly-opened tabs; each tab remembers its own choice, and
you can switch any tab with the on-screen toggle or `F6` / `Shift + F6`.

### External editor

For the **Open in external editor** button on read-only code tabs, pick the editor that should launch: the name of a known editor (`code`, `zed`, `subl`, `vim`, …) or the full path of an app bundle (e.g. `/Applications/Visual Studio Code.app`) or executable. Shells, interpreters and terminal emulators are refused, as is a path that does not exist.

The GUI setting overrides any environment variables — explicit beats implicit. Leave it empty to use the env-var fallback chain `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → platform default`. See [Open in external editor](/guide/formats#open-in-external-editor) for the full resolution order and security gate.

### One-time upgrade nudge

On the first launch after upgrading to multi-format support, VMark surfaces a non-blocking toast pointing to **Settings → Formats**. The nudge fires once per install — once shown (or dismissed), it never reappears.

### File-type overrides

Beyond the category toggles, you can override how an individual file family opens via the command palette — **Set File Type: Plain Text / Markdown / Reset to Default**. Overrides are stored per file family (by extension, or by dotfile stem for files like `.env`) and persist across sessions. See [How VMark decides a file's type](/guide/formats#how-vmark-decides-a-file-s-type).

The **Formats** panel lists every override you've set, each as `key → format`. Remove a single entry with its `×` button, or use **Clear all** to drop them in one go — removed entries fall back to the built-in rule.

## Language

The interface language, and the CJK (Chinese, Japanese, Korean) formatting rules.

### Interface language

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Interface language | Changes the UI language for menus, labels, and messages. Takes effect immediately | System language | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

On first launch VMark picks the first language in your system's preferred-language list that it ships, and falls back to English when none match. Once you choose a language here, your choice is kept.

### CJK formatting

The rules below are applied when you run **Format → CJK → Format Selection** (`Cmd+Shift+F`) on a selection, or **Format → CJK → Format Entire File** (`Alt+Cmd+Shift+F`) on the whole file.

::: tip
The Language section contains 20+ fine-grained formatting toggles. For a full explanation of each rule with examples, see [CJK Formatting](/guide/cjk-formatting).
:::

### Fullwidth Normalization

| Setting | Description | Default |
|---------|-------------|---------|
| Convert fullwidth letters/numbers | Convert fullwidth alphanumeric characters to halfwidth (e.g., `ＡＢＣ` to `ABC`) | On |
| Normalize punctuation width | Convert fullwidth commas and periods to halfwidth when between CJK characters | On |
| Convert parentheses | Convert fullwidth parentheses to halfwidth when content is CJK | On |
| Convert brackets | Convert halfwidth brackets to fullwidth `【】` when content is CJK | Off |

### Spacing

| Setting | Description | Default |
|---------|-------------|---------|
| Add CJK-English spacing | Insert a space between CJK and Latin characters | On |
| Add CJK-parenthesis spacing | Insert a space between CJK characters and parentheses | On |
| Remove currency spacing | Remove extra space after currency symbols (e.g., `$ 100` becomes `$100`) | On |
| Remove slash spacing | Remove spaces around slashes (e.g., `A / B` becomes `A/B`), preserving URLs | On |
| Collapse multiple spaces | Reduce multiple consecutive spaces to a single space | On |

### Dash & Quotes

| Setting | Description | Default |
|---------|-------------|---------|
| Convert dashes | Convert double hyphens (`--`) to em-dashes (`——`) between CJK characters | On |
| Fix em-dash spacing | Ensure proper spacing around em-dashes | On |
| Convert straight quotes | Convert straight `"` and `'` to smart (curly) quotes | On |
| Quote style | Target style for smart quote conversion | Curly `""` `''` |
| Contextual quotes | Use curly quotes around CJK text but keep straight quotes in pure Latin text. Only available when Convert straight quotes is on | On |
| Quote toggle behavior | How the quote-style toggle command cycles between styles — **Simple** swaps straight ↔ your preferred style; **Full cycle** rotates through all styles | Simple |
| Fix double quote spacing | Normalize spacing around double quotes | On |
| Fix single quote spacing | Normalize spacing around single quotes | On |
| CJK corner quotes | Convert curly quotes to corner brackets `「」` for Traditional Chinese and Japanese text. Only available when quote style is Curly | Off |
| Nested corner quotes | Convert nested single quotes to `『』` inside `「」` | Off |

### Section Handling

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Skip reference sections | Leave `## References` and `## Further Reading` sections unformatted when running CJK formatting — useful for academic documents where citation text should stay verbatim | Off | On / Off |

### Cleanup

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Limit consecutive punctuation | Limit repeated punctuation marks like `!!!` | Off | Off, Single (`!!` to `!`), Double (`!!!` to `!!`) |
| Remove trailing spaces | Remove spaces at the end of lines | On | On / Off |
| Normalize ellipsis | Convert spaced dots (`. . .`) to proper ellipsis (`...`) | On | On / Off |
| Collapse newlines | Reduce three or more consecutive newlines to two | Off | On / Off |

## Shortcuts

View and customize all keyboard shortcuts. Shortcuts are grouped by category (File, Edit, View, Format, etc.).

- **Search** — Filter shortcuts by name, category, or key combination
- **Click a shortcut** to change its key binding. Press the new combination, then confirm
- **Reset** — Restore an individual shortcut to its default, or reset all at once
- **Export / Import** — Save your custom bindings as a JSON file and import them on another machine

See [Keyboard Shortcuts](/guide/shortcuts) for the full default shortcut reference.

## Terminal

Configure the integrated terminal panel. Open the terminal with `` Ctrl + ` ``.

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Shell | Which shell to use. Requires a terminal restart to take effect. A saved shell that is no longer available shows as *(unavailable)* and the default is used | System Default | Auto-detected shells on your system (e.g., zsh, bash, fish) |
| Panel Position | Where to place the terminal panel | Auto | Auto (based on window aspect ratio), Top, Bottom, Left, Right |
| Panel Size | Proportion of available space the terminal occupies. Drag-resizing the panel also updates this value | 40% | 10% to 80% |
| Font Size | Text size in the terminal | 13px | 10px to 24px |
| Line Height | Vertical spacing between terminal lines | 1.2 (Compact) | 1.0 (Tight) to 2.0 (Extra) |
| Cursor Style | Shape of the terminal cursor | Bar | Bar, Block, Underline |
| Cursor Blink | Whether the terminal cursor blinks | On | On / Off |
| Copy on Select | Automatically copy selected terminal text to the clipboard | Off | On / Off |
| Automatic transcript rendering | Render Claude/Codex Markdown, tables and Mermaid diagrams beside the terminal CLI. Adds a local SessionStart hook to the Claude Code and Codex configuration; restart running CLI sessions after enabling | Off | On / Off |
| WebGL Renderer | Use GPU-accelerated rendering for the terminal. Disable if you experience IME input issues. Requires a terminal restart. macOS and Windows only — Linux always uses the DOM renderer | On | On / Off |
| Remote Clipboard (OSC 52) | Let programs running in the terminal — over ssh, inside tmux — copy to your system clipboard. The channel is write-only: reading the clipboard is always refused, since any output printed to the terminal could request it | On | On / Off |
| Scrollback | Number of lines of output each session keeps in its scroll history. Higher values use more memory | 5,000 | 1,000 / 5,000 / 10,000 / 50,000 |
| Screen Reader Mode | Expose terminal output to assistive technology (VoiceOver). Off by default for performance | Off | On / Off |

Two platform-specific toggles also appear here, both on by default: **Option as Meta Key** (macOS only — treat the Option key as Meta, which tools like emacs and tmux expect for `Alt`-prefixed shortcuts and word navigation; turn it off if you need Option dead-key accents such as `Option + E`) and **Shell Integration** (hidden on Windows — inject command markers into zsh and bash for prompt navigation, exit-status decorations, and current-directory tracking; takes effect in new terminal sessions).

### Accessibility

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Terminal bell | How a terminal bell (BEL) is signalled. **Visual** marks background activity on the session tab; **Audible** plays a soft beep and (for a background session) also flags the tab so you can locate it; **Off** ignores it. Applies live to running sessions | Visual | Off, Visual, Audible |
| Notify when unfocused | Show an OS notification (naming the window's document) when a terminal rings the bell while that VMark window isn't focused — e.g. Claude Code finishing a turn. Lets you track Claude Code across multiple windows without watching each one. Requires granting notification permission on first use | On | On / Off |
| Minimum contrast | Lift faint terminal text to a minimum contrast ratio against its background. Raise it for readability; **Off** disables the lift. Applies live to running sessions | WCAG AA (4.5:1) | Off, WCAG AA (4.5:1), WCAG AAA (7:1), Maximum |

See [Integrated Terminal](/guide/terminal) for more about sessions, keyboard shortcuts, and shell environment.

## About

Displays app version, links to the website and GitHub repository, and update management. The **Third-party notices** link opens the license texts of the open-source software bundled with VMark, in your system's default app for text files.

### Updates

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Automatic updates | Periodically check for new versions | On | On / Off |
| Check frequency | How often to check for updates. Only available when automatic updates are on | On startup | On startup, Daily, Weekly, Manual only |
| Download updates automatically | Download new versions in the background when available | Off | On / Off |
| Check Now | Manually trigger an update check | — | — |

When an update is available, a card appears showing the new version number, release date, and release notes. You can **Download** the update, **Skip** this version, or — once downloaded — **Restart to Update**.

#### The update matches how you installed VMark

The updater downloads the same package format you installed, not a fixed one per platform:

| You installed | The updater fetches |
|---|---|
| macOS `.dmg` | the signed app bundle |
| Windows `.exe` (NSIS) | the `.exe` installer |
| Windows `.msi` | the `.msi` package |
| Linux `.deb` | the `.deb` package |
| Linux `.rpm` | the `.rpm` package |
| Linux AppImage | the AppImage |

On Linux, updating a `.deb` or `.rpm` install runs the system package manager, so you are prompted to authenticate — installing a system package needs root. AppImage updates replace the file in place and need no prompt.

#### If an update gets stuck

Checking and downloading both go over the network, and a connection that hangs rather than failing outright could otherwise leave the update in progress forever. If a check makes no progress for a minute, or a download or install for three minutes, VMark shows a sticky **Update stalled** notification in the document window. Its **Retry** button returns the updater to idle so you can try again — **Check Now** in this section, or the next automatic check, starts over from a fresh check.

Update activity is written to the log file, so if the problem repeats, the log is worth attaching to a bug report:

| Platform | Log location |
|---|---|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%LOCALAPPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Reset

| Setting | Description |
|---------|-------------|
| Reset to Defaults | Restore the settings in these panes to their default values. A confirmation prompt appears first — this cannot be undone |

Three things are stored separately and are **not** reset: keyboard shortcut customizations (use **Reset All** in the [Shortcuts](#shortcuts) pane), your AI provider configuration, and the per-workspace file-browser settings (**Show hidden files**, **Show all files**). The interface language returns to your system language.

## Advanced

::: tip
The Advanced section is visible by default — it hosts the off switch for the embedded browser, which ships on. Press `Ctrl + Option + Cmd + D` in the Settings window to hide it, and again to bring it back.
:::

Developer and system-level configuration.

### Link Protocols

| Setting | Description | Default |
|---------|-------------|---------|
| Custom link protocols | Additional URL protocols VMark treats as links. Enter each protocol as a tag | `obsidian`, `vscode`, `dict`, `x-dictionary` |

The list does two things. When you insert a link, a clipboard URL with one of these protocols is recognized as a link, just like `https://`. And when you open a link, VMark hands it to your system only if its protocol is `http`, `https`, `mailto`, or on this list — so `obsidian://open?vault=...` and `vscode://file/...` links open in their apps, while any other protocol is refused. A few protocols can never be enabled this way, whatever the list says: `javascript:`, `data:`, `file:` and similar.

A default you remove stays removed. A default protocol added in a later VMark version is added to your list once, on the first launch of that version.

### Performance

| Setting | Description | Default |
|---------|-------------|---------|
| Keep both editors alive | Mount both the WYSIWYG and Source mode editors simultaneously for faster mode switching. Increases memory usage | Off |

### Coherence

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Semantic check confidence | How sure a check must be before its answer is recorded as a verdict. Below this, the answer is kept but marked unknown | 0.9 | 0.7, 0.8, 0.9, 0.95 |

See [Coherence](/guide/coherence) for what a check is and how verdicts are recorded.

### Workflow files

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Fetch action metadata | Allow VMark to fetch `action.yml` from referenced GitHub Actions to populate the structured editor's `with:` form. Turn off to keep the workflow editor fully offline | On | On / Off |
| Use actionlint when available | If the `actionlint` binary is on your PATH, run it on workflow files for richer diagnostics. No effect if the binary is not installed | On | On / Off |

### Workflow

The GitHub Actions viewer has no switch: opening a file under
`.github/workflows/` shows the graph and the form editor, and the source-pane
aids (expression completion, cursor-to-canvas sync, `uses:` goto-definition)
load with it. What remains here is the viewer's one preference and the
separate execution engine.

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Preserve YAML formatting | When saving workflow edits made via the form panel, preserve the original YAML's comments, anchors, key order, and blank lines via the CST round-trip pipeline. When off, save uses a compact serializer (faster but lossy) | On | On / Off |
| Workflow engine | Run VMark's own YAML workflow files: a workflow file opens with its step graph and a Run / Cancel toolbar beside the source, and workflow genies can execute. Steps can call AI providers and write files, so it stays off until you ask for it | Off | On / Off |

The engine does not change what the viewer shows: GitHub Actions files open in
the viewer either way, and with the engine off a VMark workflow file shows as a
plain YAML tree. With the engine off, VMark also refuses workflow-execution
requests outright rather than merely hiding the button — including requests
that arrive over MCP — and reports "The workflow engine is turned off in
Settings".

Both rows live under **Developer Tools** (see below) — turn Developer Tools
on to reveal them. See [Workflow Viewer](/guide/workflow-viewer) for the
viewer and [Genie Workflows](/guide/workflows) for the engine.

### Embedded Browser

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Embedded browser | The in-app web browser (macOS only). While on, **New Browser Tab** is in the File menu and the command palette, and the MCP `browser` tools are available. Turning it off closes open browser tabs and withdraws the AI automation surface | On | On / Off |
| AI browser session | Choose `Sandbox` (recommended, isolated non-persistent AI cookies) or `Shared profile` (human profile with destination approvals) | Sandbox | Sandbox / Shared |
| Allow AI loopback access | Allow AI navigation to localhost and loopback addresses. Private LAN, metadata, and link-local ranges remain blocked | Off | On / Off |

These live under **Advanced → macOS**, and appear on macOS only. The two AI
posture rows appear only while the browser toggle is on, and are unaffected by
it being on — they stay at Sandbox / loopback-blocked until you change them.
See [Embedded Browser](/guide/browser) for the full feature surface.

### Platform-Specific

| Setting | Description | Default | Platforms |
|---------|-------------|---------|-----------|
| Clear macOS quarantine on open | When you open a workspace, remove the macOS download-quarantine attribute (`com.apple.quarantine`) from the workspace folder and the files directly inside it that VMark can open (subfolders are not touched). Without this, macOS can silently drop a Finder double-click on a downloaded file while VMark is running. Shown in the UI as **Clear download quarantine on workspace open**, under **Advanced → macOS** | On | macOS |

The terminal's **Option as Meta Key** setting lives in the [Terminal](#terminal) pane.

### Developer Tools

**Developer tools** is a persisted master switch for experimental and
development-only settings. Turning it on reveals the **Preserve YAML formatting**
row, the **Workflow engine** toggle and a **Hot Exit Dev Tools** panel (buttons to test
session capture, inspection, restoration, clearing, and restart). Because the
switch persists, an in-progress feature you enable stays reachable across sessions
and in release builds — you do not need to re-enable Developer tools each time you
open Settings.

It also reveals the [Knowledge Base](/guide/knowledge-base) outside Settings: the
**View → Knowledge Base** menu item, the palette command and the
`Ctrl + Shift + 4` shortcut are hidden until Developer tools is on, because no
release build on any platform ships the content-server runtime that feature
needs.

| Setting | Description | Default |
|---------|-------------|---------|
| Developer tools | Enable developer mode and reveal the experimental and development-only settings below | Off |

## See Also

- [Features](/guide/features) — Overview of VMark's capabilities
- [Keyboard Shortcuts](/guide/shortcuts) — Full shortcut reference
- [CJK Formatting](/guide/cjk-formatting) — Detailed CJK formatting rules
- [Integrated Terminal](/guide/terminal) — Terminal sessions and usage
- [AI Providers](/guide/ai-providers) — AI provider setup guide
- [MCP Setup](/guide/mcp-setup) — MCP server configuration for AI assistants
