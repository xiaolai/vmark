# Settings

VMark's settings panel lets you customize every aspect of the editor. Open it with `Mod + ,` or via **VMark > Settings** in the menu bar.

The settings window has a sidebar with sections grouped by topic — the most-used sections appear first, with About and Advanced at the bottom. Changes take effect immediately — there is no save button.

## Appearance

Controls the visual theme and window behavior.

### Theme

Choose one of five color themes. The active theme is indicated by a ring around its swatch.

| Theme | Background | Style |
|-------|-----------|-------|
| White | `#FFFFFF` | Clean, high contrast |
| Paper | `#EEEDED` | Warm neutral (default) |
| Mint | `#CCE6D0` | Soft green, easy on the eyes |
| Sepia | `#F9F0DB` | Warm yellowish, book-like |
| Night | `#23262B` | Dark mode |

### Language

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Language | Changes the UI language for menus, labels, and messages. Takes effect immediately | English | English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Italiano, Português (Brasil) |

### Window

| Setting | Description | Default |
|---------|-------------|---------|
| Show filename in titlebar | Display the current file name in the macOS window title bar | Off |
| Auto-hide status bar | Automatically hide the status bar when you are not interacting with it | Off |

## Editor

Typography, display, editing behavior, and whitespace settings.

### Typography

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Latin Font | Font family for Latin (English) text | System Default | System Default, Athelas, Palatino, Georgia, Charter, Literata |
| CJK Font | Font family for Chinese, Japanese, Korean text | System Default | System Default, PingFang SC, Songti SC, Kaiti SC, Noto Serif CJK, Source Han Sans |
| Mono Font | Font family for code and monospace text | System Default | System Default, SF Mono, Monaco, Menlo, Consolas, JetBrains Mono, Fira Code, SauceCodePro NFM, IBM Plex Mono, Hack, Inconsolata |
| Font Size | Base font size for editor content | 18px | 14px, 16px, 18px, 20px, 22px |
| Line Height | Vertical spacing between lines | 1.8 (Relaxed) | 1.4 (Compact), 1.6 (Normal), 1.8 (Relaxed), 2.0 (Spacious), 2.2 (Extra) |
| Block Spacing | Visual gap between block elements (headings, paragraphs, lists) measured in multiples of line height | 1x (Normal) | 0.5x (Tight), 1x (Normal), 1.5x (Relaxed), 2x (Spacious) |
| CJK Letter Spacing | Extra spacing between CJK characters, in em units | Off | Off, 0.02em (Subtle), 0.03em (Light), 0.05em (Normal), 0.08em (Wide), 0.10em (Wider), 0.12em (Extra) |

### Display

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Editor Width | Maximum content width. Wider values suit large monitors; narrower values improve readability | 50em (Medium) | 36em (Compact), 42em (Narrow), 50em (Medium), 60em (Wide), 80em (Extra Wide), Unlimited |

::: tip
50em at 18px font size is roughly 900px — a comfortable reading width for most displays.
:::

### Behavior

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Tab size | Number of spaces inserted when pressing Tab | 2 spaces | 2 spaces, 4 spaces |
| Enable auto-pairing | Automatically insert matching closing brackets and quotes when you type an opening one | On | On / Off |
| CJK brackets | Auto-pair CJK-specific brackets like `「」` `【】` `《》`. Only available when auto-pairing is enabled | Auto | Off, Auto |
| Include curly quotes | Auto-pair `""` and `''` characters. May conflict with some IME smart quote features. Appears when CJK brackets is set to Auto | On | On / Off |
| Also pair `"` | Typing the right double quote `"` also inserts a `""` pair. Useful when your IME alternates between open and close quotes. Appears when curly quotes are enabled | Off | On / Off |
| Copy format | What format to use for the plain text clipboard slot when copying from WYSIWYG mode | Plain text | Plain text, Markdown |
| Copy on select | Automatically copy text to the clipboard whenever you select it | Off | On / Off |

### Whitespace

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Line endings on save | Control how line endings are handled when saving files | Preserve existing | Preserve existing, LF (`\n`), CRLF (`\r\n`) |
| Preserve consecutive line breaks | Keep multiple blank lines as-is instead of collapsing them | Off | On / Off |
| Hard break style on save | How hard line breaks are represented in the saved Markdown file | Preserve existing | Two spaces (Recommended), Preserve existing, Backslash (`\`) |
| Show `<br>` tags | Display HTML line break tags visibly in the editor | Off | On / Off |

::: tip
Two spaces is the most compatible hard break style — it works on GitHub, GitLab, and all major Markdown renderers. The backslash style may fail on Reddit, Jekyll, and some older parsers.
:::

## Markdown

Paste behavior, layout, and HTML rendering settings.

### Paste & Input

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Enable regex in search | Show a regex toggle button in the Find & Replace bar | On | On / Off |
| Paste mode | How VMark routes content from the clipboard | Smart | Smart, Plain |
| Markdown paste in WYSIWYG | When pasting text that looks like Markdown into the WYSIWYG editor, automatically convert it to rich content | Auto | Auto, Off |

### Layout

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Block element font size | Relative font size for lists, blockquotes, tables, alerts, and details blocks | 100% | 100%, 95%, 90%, 85% |
| Heading alignment | Text alignment for headings | Left | Left, Center |
| Image & diagram borders | Whether to show a border around images, Mermaid diagrams, and math blocks | None | None, Always, On hover |
| Image & table alignment | Horizontal alignment for block images and tables | Center | Center, Left |

### Lint

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Enable markdown lint | Check for common markdown issues (broken links, missing alt text, heading increments, unclosed fences, etc.) | On | On / Off |

See [Markdown Lint](/guide/lint) for the full rule list and severity levels.

### HTML Rendering

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Raw HTML in rich text | Control whether raw HTML blocks are rendered in WYSIWYG mode | Hidden | Hidden, Sanitized, Sanitized + styles |

::: tip
**Hidden** is the safest option — raw HTML blocks are collapsed and not rendered. **Sanitized** renders HTML with dangerous tags stripped. **Sanitized + styles** additionally preserves inline `style` attributes.
:::

## Files & Images

File browser, saving, document history, image handling, and document tools.

### File Browser

These settings only apply when a workspace (folder) is open.

| Setting | Description | Default |
|---------|-------------|---------|
| Show hidden files | Include dotfiles and hidden system items in the file explorer sidebar | Off |
| Show all files | Show non-markdown files in the file explorer. Non-markdown files open with your system's default application | Off |

### Quit Behavior

| Setting | Description | Default |
|---------|-------------|---------|
| Confirm quit | Require pressing `Cmd+Q` (or `Ctrl+Q`) twice to quit, preventing accidental exits | On |

### Saving

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Enable auto-save | Automatically save files after editing | On | On / Off |
| Save interval | Time between automatic saves. Only available when auto-save is enabled | 30 seconds | 10s, 30s, 1 min, 2 min, 5 min |
| Keep document history | Track document versions for undo and recovery | On | On / Off |
| Maximum versions | Number of history snapshots to keep per document | 50 versions | 10, 25, 50, 100 |
| Keep versions for | Maximum age of history snapshots before they are pruned | 7 days | 1 day, 7 days, 14 days, 30 days |
| Merge window | Consecutive auto-saves within this window consolidate into a single snapshot, reducing storage noise | 30 seconds | Off, 10s, 30s, 1 min, 2 min |
| Max file size for history | Skip taking history snapshots for files larger than this threshold | 512 KB | 256 KB, 512 KB, 1 MB, 5 MB, Unlimited |

### Images

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Auto-resize on paste | Automatically resize large images before saving to the assets folder. The value is the maximum dimension in pixels | Off | Off, 800px, 1200px, 1920px (Full HD), 2560px (2K) |
| Copy to assets folder | Copy pasted or dropped images into the document's assets folder instead of embedding them | On | On / Off |
| Clean up unused images on close | Automatically delete images from the assets folder that are no longer referenced in the document when you close it | Off | On / Off |
| Inline image threshold | Maximum size (MB) for embedding images as base64 data URLs in HTML/PDF export. Larger files are linked instead | 1.0 MB | 0.1 – 10 MB |

### Large Files

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Warn above size | Show a confirmation prompt when opening files above this size | 5 MB | On / Off |
| Auto Source mode | Automatically open files above the threshold in Source mode (skips WYSIWYG to keep performance smooth) | On | On / Off |

See [Large Files](/guide/large-files) for the full breakdown of how large files are handled.

### Updates

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Check frequency | When to check for new VMark releases | On startup | On startup, Daily, Weekly, Manual |
| Auto-download updates | Download release artifacts in the background once an update is detected | Off | On / Off |
| Skip a version | Suppresses the update prompt for a specific version (set per-update from the prompt itself) | None | — |

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
| Auto-approve edits | Apply AI-initiated document changes without showing a preview for approval first. Use with caution | Off |

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

**REST API Providers** — Connect directly to cloud APIs (Anthropic, OpenAI, Google AI, Ollama API). Each requires an endpoint, API key, and model name.

See [AI Providers](/guide/ai-providers) for detailed setup instructions for each provider.

## Formats

Opt-in toggles for non-default format adapters, plus the explicit external-editor command for the read-only code-tab escape hatch.

Markdown, plain text, and YAML/YML are **always** registered — the calm defaults. Every other adapter is **off by default** so existing users aren't surprised on upgrade. Flip a toggle and the registry rebuilds in place; open tabs remount with the proper adapter, no restart needed.

For the full list of formats and their previews, see [Supported Formats](/guide/formats).

### Format support

| Toggle | Default | Enables |
|---|---|---|
| **Data formats** | Off | `.json`, `.jsonl`, `.toml` — split-pane source + navigable tree. Schema-aware previews for `Cargo.toml`, `package.json`, `pyproject.toml`. |
| **Diagrams & SVG** | Off | `.mmd` (Mermaid) and `.svg` — split-pane source + sanitized live render. |
| **HTML preview** | Off | `.html` and `.htm` — sandboxed iframe preview (`sandbox=""` empty allow-list, DOMPurify, CSP `<meta>`). OWASP top-20 verified — see [Security model for HTML](/guide/formats#security-model-for-html). |
| **Code viewers** | Off | 12 read-only viewers (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.bash`, `.rb`, `.lua`). Open in a syntax-highlighted viewer with **Enable editing** and **Open in external editor** buttons. |

When a category is off, the matching extensions fall through to the plain-text fallback so the file still opens — just without the schema view.

### External editor

For the **Open in external editor** button on read-only code tabs, pick the editor that should launch. An app bundle (e.g. `/Applications/Visual Studio Code.app`) or an executable.

The GUI setting overrides any environment variables — explicit beats implicit. Leave it empty to use the env-var fallback chain `$VMARK_EXTERNAL_EDITOR → $VISUAL → $EDITOR → platform default`. See [Open in external editor](/guide/formats#open-in-external-editor) for the full resolution order and security gate.

### One-time upgrade nudge

On the first launch after upgrading to multi-format support, VMark surfaces a non-blocking toast pointing to **Settings → Formats**. The nudge fires once per install — once shown (or dismissed), it never reappears.

## Language

CJK (Chinese, Japanese, Korean) formatting rules. These rules are applied when you run **Format → Format CJK Selection** (`Cmd+Shift+F`) on a selection, or **Format → Format CJK Document** (`Alt+Cmd+Shift+F`) on the whole file.

::: tip
The Language section contains 20+ fine-grained formatting toggles. For a full explanation of each rule with examples, see [CJK Formatting](/guide/cjk-formatting).
:::

### Fullwidth Normalization

| Setting | Description | Default |
|---------|-------------|---------|
| Convert fullwidth letters/numbers | Convert fullwidth alphanumeric characters to halfwidth (e.g., `ABC` to `ABC`) | On |
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
| Fix double quote spacing | Normalize spacing around double quotes | On |
| Fix single quote spacing | Normalize spacing around single quotes | On |
| CJK corner quotes | Convert curly quotes to corner brackets `「」` for Traditional Chinese and Japanese text. Only available when quote style is Curly | Off |
| Nested corner quotes | Convert nested single quotes to `『』` inside `「」` | Off |

### Cleanup

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Limit consecutive punctuation | Limit repeated punctuation marks like `!!!` | Off | Off, Single (`!!` to `!`), Double (`!!!` to `!!`) |
| Remove trailing spaces | Remove spaces at the end of lines | On | On / Off |
| Normalize ellipsis | Convert spaced dots (`. . .`) to proper ellipsis (`...`) | On | On / Off |
| Collapse newlines | Reduce three or more consecutive newlines to two | On | On / Off |

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
| Shell | Which shell to use. Requires a terminal restart to take effect | System Default | Auto-detected shells on your system (e.g., zsh, bash, fish) |
| Panel Position | Where to place the terminal panel | Auto | Auto (based on window aspect ratio), Bottom, Right |
| Panel Size | Proportion of available space the terminal occupies. Drag-resizing the panel also updates this value | 40% | 10% to 80% |
| Font Size | Text size in the terminal | 13px | 10px to 24px |
| Line Height | Vertical spacing between terminal lines | 1.2 (Compact) | 1.0 (Tight) to 2.0 (Extra) |
| Cursor Style | Shape of the terminal cursor | Bar | Bar, Block, Underline |
| Cursor Blink | Whether the terminal cursor blinks | On | On / Off |
| Copy on Select | Automatically copy selected terminal text to the clipboard | Off | On / Off |
| WebGL Renderer | Use GPU-accelerated rendering for the terminal. Disable if you experience IME input issues. Requires a terminal restart | On | On / Off |

See [Integrated Terminal](/guide/terminal) for more about sessions, keyboard shortcuts, and shell environment.

## About

Displays app version, links to the website and GitHub repository, and update management.

### Updates

| Setting | Description | Default |
|---------|-------------|---------|
| Automatic updates | Check for updates automatically on startup | On |
| Check Now | Manually trigger an update check | — |

When an update is available, a card appears showing the new version number, release date, and release notes. You can **Download** the update, **Skip** this version, or — once downloaded — **Restart to Update**.

## Advanced

::: tip
The Advanced section is hidden by default. Press `Ctrl + Option + Cmd + D` in the Settings window to reveal it.
:::

Developer and system-level configuration.

### Link Protocols

| Setting | Description | Default |
|---------|-------------|---------|
| Custom link protocols | Additional URL protocols VMark should recognize when inserting links. Enter each protocol as a tag | `obsidian`, `vscode`, `dict`, `x-dictionary` |

This lets you create links like `obsidian://open?vault=...` or `vscode://file/...` that VMark will treat as valid URLs.

### Performance

| Setting | Description | Default |
|---------|-------------|---------|
| Keep both editors alive | Mount both the WYSIWYG and Source mode editors simultaneously for faster mode switching. Increases memory usage | Off |

### Workflow Engine

| Setting | Description | Default | Options |
|---------|-------------|---------|---------|
| Workflow engine | Enable the GitHub Actions workflow viewer/editor for `.yml`/`.yaml` files under `.github/workflows/`. When off, those files open as plain YAML | Off | On / Off |
| Preserve YAML formatting | When saving workflow edits made via the form panel, preserve the original YAML's comments, anchors, key order, and blank lines via the CST round-trip pipeline. When off, save uses a compact serializer (faster but lossy) | On | On / Off |

See [Workflow Viewer](/guide/workflow-viewer) for the full feature surface.

### Platform-Specific

| Setting | Description | Default | Platforms |
|---------|-------------|---------|-----------|
| Clear macOS quarantine on open | When opening a file that carries the macOS quarantine attribute (`com.apple.quarantine`), strip it before reading. Helpful for files downloaded from the web that VMark would otherwise be blocked from opening | On | macOS |
| Mac Option as Meta (terminal) | Treat the macOS Option key as Meta in the integrated terminal. Required for tools like emacs and tmux that expect Alt-prefixed shortcuts | Off | macOS |

### Developer Tools

When **Developer tools** is toggled on, a **Hot Exit Dev Tools** panel appears with buttons to test session capture, inspection, restoration, clearing, and restart — useful for debugging hot exit behavior during development.

## See Also

- [Features](/guide/features) — Overview of VMark's capabilities
- [Keyboard Shortcuts](/guide/shortcuts) — Full shortcut reference
- [CJK Formatting](/guide/cjk-formatting) — Detailed CJK formatting rules
- [Integrated Terminal](/guide/terminal) — Terminal sessions and usage
- [AI Providers](/guide/ai-providers) — AI provider setup guide
- [MCP Setup](/guide/mcp-setup) — MCP server configuration for AI assistants
