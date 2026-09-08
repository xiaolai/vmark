# Getting Started with VMark

VMark is the plain-text workspace where humans and AI collaborate. Both parties read and write the same artifacts directly — markdown, YAML, JSON, TOML, Mermaid, SVG, HTML, code — with no translation layer in between. Where the file is a known artifact (a GitHub Actions workflow, `Cargo.toml`, `package.json`, `pyproject.toml`), VMark renders the *right* view, not a generic JSON tree.

The differentiator isn't "open more file types" — every IDE does that. It's **schema-aware previews**: the structured view per artifact, paired with a live source pane.

## Quick Start

1. **Download and install** VMark from the [download page](/download)
2. **Launch the app** and start writing immediately
3. **Open a file** with `Cmd/Ctrl + O` or drag & drop any [supported format](/guide/formats)
4. **Open a folder** with `Cmd/Ctrl + Shift + O` for workspace mode

## Interface Overview

### Main Areas

- **Editor**: The main writing area where you compose your documents
- **Sidebar**: File tree navigation (toggle with `Ctrl + Shift + 2`)
- **Outline**: Document structure view (toggle with `Ctrl + Shift + 1`)
- **Status Bar**: Word count, character count, and auto-save status (toggle with `F7`)
- **Terminal**: Integrated shell panel (toggle with `` Ctrl + ` ``)

### Menu Bar

- **File**: New, Quick Open, recent files and workspaces, document history, save, export, print, close
- **Edit**: Undo/redo, clipboard, find (including Find in Files), selection, line operations, line endings, Genies
- **Format**: Text styles, headings, lists, blockquotes, text transformations, CJK formatting, text cleanup, image cleanup
- **Insert**: Links, images, video, audio, tables, code fences, math, diagrams, footnotes, collapsible blocks, info boxes
- **View**: Editor modes, panes, sidebar panels, focus/typewriter modes, toolbar, terminal, Check Markdown, zoom
- **Window** (macOS): Minimize, Maximize, Window Status, Coherence Breakdown, Bring All to Front
- **Help**: VMark Help, Keyboard Shortcuts, the `vmark` shell command (macOS), Report an Issue

### Editing Modes

VMark supports three editing modes that you can switch between:

| Mode | Description | Shortcut |
|------|-------------|----------|
| Rich Text | WYSIWYG editing with live formatting | Default |
| Source | Raw Markdown with syntax highlighting | `F6` |
| Split | Source on the left, live read-only preview on the right | `Shift + F6` |

### View Modes

Enhance your writing focus with these view modes:

| Mode | Description | Shortcut |
|------|-------------|----------|
| Focus | Highlight current paragraph | `F8` |
| Typewriter | Keep cursor centered | `F9` |
| Word Wrap | Toggle line wrapping | `Alt + Z` |

## Basic Formatting

### Text Styles

| Style | Syntax | Shortcut |
|-------|--------|----------|
| **Bold** | `**text**` | `Cmd/Ctrl + B` |
| *Italic* | `*text*` | `Cmd/Ctrl + I` |
| ~~Strikethrough~~ | `~~text~~` | `Cmd/Ctrl + Shift + X` |
| `Code` | `` `code` `` | `Cmd/Ctrl + Shift + `` ` `` |

### Block Elements

- **Headings**: Use `#` symbols or `Cmd/Ctrl + 1-6`
- **Lists**: Start lines with `-`, `*`, `1.`, or `- [ ]` for task lists
- **Blockquotes**: Start with `>` or use `Alt/Option + Cmd + Q`
- **Code blocks**: Use triple backticks with optional language
- **Tables**: Use **Insert → Table** or `Cmd/Ctrl + Shift + T`

## Working with Files

### Creating and Opening

- **New file**: `Cmd/Ctrl + N`
- **Open file**: `Cmd/Ctrl + O`
- **Open folder**: `Cmd/Ctrl + Shift + O` (workspace mode)

### Saving

- **Save**: `Cmd/Ctrl + S`
- **Save As**: `Cmd/Ctrl + Shift + S`
- **Auto-save**: Enabled by default, configurable in settings

### Exporting

- **Export HTML**: **File → Export → HTML** — a folder with `index.html`, `standalone.html` and the interactive VMark Reader
- **Export PDF**: **File → Export → PDF** — page setup, fonts, page numbers and a sidebar outline; or Print (`Cmd/Ctrl + P`) and use the system dialog's save-as-PDF
- **Copy as HTML**: `Cmd/Ctrl + Shift + C`

Exported HTML includes the VMark Reader with table of contents, settings panel, and more. [Learn more →](/guide/export)

## Settings

Open settings with `Cmd/Ctrl + ,` to customize:

- **Appearance**: Theme, fonts, font size, line height
- **Editor**: Auto-save interval, default behaviors
- **Files & Images**: Asset management, document tools
- **Integrations**: AI providers, MCP server
- **Language**: CJK formatting rules
- **Markdown**: Export options, formatting preferences
- **Shortcuts**: Customize keyboard shortcuts
- **Terminal**: Terminal font size and line height

## AI Writing Assistance

VMark includes built-in AI Genies — select text and press `Mod + Y` to polish, expand, translate, or transform your writing with AI. Configure your preferred provider in **Settings > Integrations**.

[Learn more about AI Genies →](/guide/ai-genies) | [Configure providers →](/guide/ai-providers)

## Tips for Getting Started

1. **Navigate with outline**: Click outline items to jump between sections
2. **Try focus mode**: `F8` dims everything except the current paragraph
3. **Validate as you write**: `Alt + Mod + V` (**View → Check Markdown**) runs the markdown lint engine and broken-link check
4. **Learn shortcuts**: the full reference is in the [shortcuts guide](/guide/shortcuts)

## Next Steps

- Learn about all [features](/guide/features)
- Master [keyboard shortcuts](/guide/shortcuts)
- Explore [CJK formatting](/guide/cjk-formatting) tools
